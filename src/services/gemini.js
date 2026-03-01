import { GoogleGenerativeAI } from '@google/generative-ai';
import { CSV_TOOL_DECLARATIONS } from './csvTools';
import { YOUTUBE_TOOL_DECLARATIONS } from './youtubeTools';

const genAI = new GoogleGenerativeAI(process.env.REACT_APP_GEMINI_API_KEY || '');

const MODEL = 'gemini-2.5-flash';
const API_OPTIONS = { apiVersion: 'v1' };
// Streaming with tools (Google Search / code execution) must use v1beta; v1 rejects "tools" on streamGenerateContent.
const STREAM_API_OPTIONS = { apiVersion: 'v1beta' };

// Cap history so total request stays under model token limit (e.g. 1M).
const MAX_HISTORY_MESSAGES = 24;
function capHistory(history) {
  if (!Array.isArray(history) || history.length <= MAX_HISTORY_MESSAGES) return history;
  return history.slice(-MAX_HISTORY_MESSAGES);
}

const SEARCH_TOOL = { googleSearch: {} };
const CODE_EXEC_TOOL = { codeExecution: {} };

export const CODE_KEYWORDS = /\b(plot|chart|graph|analyz|statistic|regression|correlat|histogram|visualiz|calculat|compute|run code|write code|execute|pandas|numpy|matplotlib|csv|data)\b/i;

let cachedPrompt = null;

async function loadSystemPrompt() {
  if (cachedPrompt) return cachedPrompt;
  try {
    const res = await fetch('/prompt_chat.txt');
    cachedPrompt = res.ok ? (await res.text()).trim() : '';
  } catch {
    cachedPrompt = '';
  }
  return cachedPrompt;
}

// Yields:
//   { type: 'text', text }           — streaming text chunks
//   { type: 'fullResponse', parts }  — when code was executed; replaces streamed text
//   { type: 'grounding', data }      — Google Search metadata
//
// fullResponse parts: { type: 'text'|'code'|'result'|'image', ... }
//
// useCodeExecution: pass true to use codeExecution tool (CSV/analysis),
//                   false (default) to use googleSearch tool.
// Note: Gemini does not support both tools simultaneously.
// userDisplayName: optional "FirstName LastName" — injected into system instruction so the AI addresses the user by name.
export const streamChat = async function* (history, newMessage, imageParts = [], useCodeExecution = false, userDisplayName = '') {
  let systemInstruction = await loadSystemPrompt();
  if (userDisplayName && userDisplayName.trim()) {
    systemInstruction += `\n\nThe user you are talking to is: ${userDisplayName.trim()}. Address them by name in your first message.`;
  }
  const tools = useCodeExecution ? [CODE_EXEC_TOOL] : [SEARCH_TOOL];
  const model = genAI.getGenerativeModel(
    { model: MODEL, tools },
    STREAM_API_OPTIONS
  );

  const baseHistory = capHistory(history).map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content || '' }],
  }));

  const chatHistory = systemInstruction
    ? [
        {
          role: 'user',
          parts: [{ text: `Follow these instructions in every response:\n\n${systemInstruction}` }],
        },
        { role: 'model', parts: [{ text: "Got it! I'll follow those instructions." }] },
        ...baseHistory,
      ]
    : baseHistory;

  const chat = model.startChat({ history: chatHistory });

  const parts = [
    { text: newMessage },
    ...imageParts.map((img) => ({
      inlineData: { mimeType: img.mimeType || 'image/png', data: img.data },
    })),
  ].filter((p) => p.text !== undefined || p.inlineData !== undefined);

  const result = await chat.sendMessageStream(parts);

  // Stream text chunks for live display
  for await (const chunk of result.stream) {
    const chunkParts = chunk.candidates?.[0]?.content?.parts || [];
    for (const part of chunkParts) {
      if (part.text) yield { type: 'text', text: part.text };
    }
  }

  // After stream: inspect all response parts
  const response = await result.response;
  const allParts = response.candidates?.[0]?.content?.parts || [];

  const hasCodeExecution = allParts.some(
    (p) =>
      p.executableCode ||
      p.codeExecutionResult ||
      (p.inlineData && p.inlineData.mimeType?.startsWith('image/'))
  );

  if (hasCodeExecution) {
    // Build ordered structured parts to replace the streamed text
    const structuredParts = allParts
      .map((p) => {
        if (p.text) return { type: 'text', text: p.text };
        if (p.executableCode)
          return {
            type: 'code',
            language: p.executableCode.language || 'PYTHON',
            code: p.executableCode.code,
          };
        if (p.codeExecutionResult)
          return {
            type: 'result',
            outcome: p.codeExecutionResult.outcome,
            output: p.codeExecutionResult.output,
          };
        if (p.inlineData)
          return { type: 'image', mimeType: p.inlineData.mimeType, data: p.inlineData.data };
        return null;
      })
      .filter(Boolean);

    yield { type: 'fullResponse', parts: structuredParts };
  }

  // Grounding metadata (search sources)
  const grounding = response.candidates?.[0]?.groundingMetadata;
  if (grounding) {
    console.log('[Search grounding]', grounding);
    yield { type: 'grounding', data: grounding };
  }
};

// ── Function-calling chat for CSV tools ───────────────────────────────────────
// Gemini picks a tool + args → executeFn runs it client-side (free) → Gemini
// receives the result and returns a natural-language answer.
//
// executeFn(toolName, args) → plain JS object with the result
// Returns the final text response from the model.

export const chatWithCsvTools = async (history, newMessage, csvHeaders, executeFn, userDisplayName = '') => {
  let systemInstruction = await loadSystemPrompt();
  if (userDisplayName && userDisplayName.trim()) {
    systemInstruction += `\n\nThe user you are talking to is: ${userDisplayName.trim()}. Address them by name in your first message.`;
  }
  const model = genAI.getGenerativeModel(
    { model: MODEL, tools: [{ functionDeclarations: CSV_TOOL_DECLARATIONS }] },
    STREAM_API_OPTIONS
  );

  const baseHistory = capHistory(history).map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content || '' }],
  }));

  const chatHistory = systemInstruction
    ? [
        {
          role: 'user',
          parts: [{ text: `Follow these instructions in every response:\n\n${systemInstruction}` }],
        },
        { role: 'model', parts: [{ text: "Got it! I'll follow those instructions." }] },
        ...baseHistory,
      ]
    : baseHistory;

  const chat = model.startChat({ history: chatHistory });

  // Include column names so the model can match user intent to exact column names
  const msgWithContext = csvHeaders?.length
    ? `[CSV columns: ${csvHeaders.join(', ')}]\n\n${newMessage}`
    : newMessage;

  let response = (await chat.sendMessage(msgWithContext)).response;

  // Accumulate chart payloads and a log of every tool call made
  const charts = [];
  const toolCalls = [];

  // Function-calling loop (Gemini may chain multiple tool calls)
  for (let round = 0; round < 5; round++) {
    const parts = response.candidates?.[0]?.content?.parts || [];
    const funcCall = parts.find((p) => p.functionCall);
    if (!funcCall) break;

    const { name, args } = funcCall.functionCall;
    console.log('[CSV Tool]', name, args);
    const toolResult = executeFn(name, args);
    console.log('[CSV Tool result]', toolResult);

    // Log the call for persistence
    toolCalls.push({ name, args, result: toolResult });

    // Capture chart payloads so the UI can render them
    if (toolResult?._chartType) {
      charts.push(toolResult);
    }

    response = (
      await chat.sendMessage([
        { functionResponse: { name, response: { result: toolResult } } },
      ])
    ).response;
  }

  return { text: response.text(), charts, toolCalls };
};

// ── Function-calling chat for YouTube tools ─────────────────────────────────
// executeFn(toolName, args) → Promise<plain JS object> (e.g. generateImage calls backend)
// Returns { text, charts, toolCalls, generatedImages }.

// imageParts: optional array of { mimeType, data } for user-attached images (e.g. anchor for generateImage)
export const chatWithYouTubeTools = async (history, newMessage, channelJsonSummary, executeFn, userDisplayName = '', imageParts = []) => {
  let systemInstruction = await loadSystemPrompt();
  if (userDisplayName && userDisplayName.trim()) {
    systemInstruction += `\n\nThe user you are talking to is: ${userDisplayName.trim()}. Address them by name in your first message.`;
  }
  const model = genAI.getGenerativeModel(
    { model: MODEL, tools: [{ functionDeclarations: YOUTUBE_TOOL_DECLARATIONS }] },
    STREAM_API_OPTIONS
  );

  const baseHistory = capHistory(history).map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content || '' }],
  }));

  const chatHistory = systemInstruction
    ? [
        {
          role: 'user',
          parts: [{ text: `Follow these instructions in every response:\n\n${systemInstruction}` }],
        },
        { role: 'model', parts: [{ text: "Got it! I'll follow those instructions." }] },
        ...baseHistory,
      ]
    : baseHistory;

  const chat = model.startChat({ history: chatHistory });

  let msgWithContext = channelJsonSummary
    ? `[YouTube channel JSON loaded. Summary: ${channelJsonSummary}]\n\n${newMessage}`
    : newMessage;
  if (imageParts.length > 0) {
    msgWithContext = `[User attached an image as reference for image generation.] Use the generateImage tool with the user's prompt below. The attached image will be used as the reference.\n\n${msgWithContext}`;
  }

  // Send only text to the chat model. When the user attached an image, we do not send it here so that
  // history can stay at full cap (24) without exceeding the token limit on second+ requests. The
  // anchor image is injected in the executor (youtubeExecuteFn) when calling the image-generation API.
  const userMsgParts = [{ text: msgWithContext }];

  let response = (await chat.sendMessage(userMsgParts)).response;

  const charts = [];
  const toolCalls = [];
  const generatedImages = [];

  for (let round = 0; round < 12; round++) {
    const parts = response.candidates?.[0]?.content?.parts || [];
    const funcCall = parts.find((p) => p.functionCall);
    if (!funcCall) break;

    const { name, args } = funcCall.functionCall;
    console.log('[YouTube Tool]', name, args);
    const toolResult = await executeFn(name, args);
    console.log('[YouTube Tool result]', toolResult);

    toolCalls.push({ name, args, result: toolResult });

    if (toolResult?._multipleCharts && Array.isArray(toolResult.charts)) {
      toolResult.charts.forEach((c) => charts.push(c));
    } else if (toolResult?._chartType) {
      charts.push(toolResult);
    }
    if (toolResult?._cardType === 'play_video') {
      charts.push(toolResult);
    }
    if (toolResult?._imageResult && toolResult?.imageBase64) {
      generatedImages.push({
        imageBase64: toolResult.imageBase64,
        mimeType: toolResult.mimeType || 'image/png',
        ...(toolResult.message && { message: toolResult.message }),
      });
    }

    response = (
      await chat.sendMessage([
        { functionResponse: { name, response: { result: toolResult } } },
      ])
    ).response;
  }

  return { text: response.text(), charts, toolCalls, generatedImages };
};
