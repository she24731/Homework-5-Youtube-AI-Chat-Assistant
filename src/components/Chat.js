import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamChat, chatWithCsvTools, chatWithYouTubeTools, CODE_KEYWORDS } from '../services/gemini';
import { parseCsvToRows, executeTool, computeDatasetSummary, enrichWithEngagement, buildSlimCsv } from '../services/csvTools';
import { executeYouTubeTool } from '../services/youtubeTools';
import {
  getSessions,
  createSession,
  deleteSession,
  saveMessage,
  loadMessages,
} from '../services/mongoApi';
import EngagementChart from './EngagementChart';
import MetricVsTimeChart from './MetricVsTimeChart';
import './Chat.css';

const API = process.env.REACT_APP_API_URL || '';

// ── Helpers ───────────────────────────────────────────────────────────────────

const chatTitle = () => {
  const d = new Date();
  return `Chat · ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

// Encode a string to base64 safely (handles unicode/emoji in tweet text etc.)
const toBase64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const parseCSV = (text) => {
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return null;
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rowCount = lines.length - 1;

  // Short human-readable preview (header + first 5 rows) for context
  const preview = lines.slice(0, 6).join('\n');

  // Full CSV as base64 — avoids ALL string-escaping issues in Python code execution
  // (tweet text with quotes, apostrophes, emojis, etc. all break triple-quoted strings)
  const raw = text.length > 500000 ? text.slice(0, 500000) : text;
  const base64 = toBase64(raw);
  const truncated = text.length > 500000;

  return { headers, rowCount, preview, base64, truncated };
};

// Extract plain text from a message (for history only — never returns base64)
const messageText = (m) => {
  if (m.parts) return m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  return m.content || '';
};

// Summary of YouTube channel JSON for model context
const channelJsonSummary = (data) => {
  const videos = Array.isArray(data) ? data : data?.videos;
  if (!videos?.length) return 'No videos';
  const keys = Object.keys(videos[0]);
  return `${videos.length} videos, fields: ${keys.join(', ')}`;
};

// ── Play video card (opens in new tab) ───────────────────────────────────────
function PlayVideoCard({ title, thumbnailUrl, videoUrl }) {
  const url = videoUrl || '#';
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="play-video-card"
      title={url !== '#' ? 'Open on YouTube' : title}
    >
      <div className="play-video-thumb">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" />
        ) : (
          <span className="play-video-placeholder">▶</span>
        )}
      </div>
      <div className="play-video-title">{title || 'Video'}</div>
      <div className="play-video-open-hint">Open on YouTube ↗</div>
    </a>
  );
}

// ── Generated image (download + click to enlarge, ESC to close) ───────────────
function GeneratedImageCard({ data, mimeType, message }) {
  const [enlarged, setEnlarged] = useState(false);
  const mime = mimeType || 'image/png';
  const src = `data:${mime};base64,${data}`;
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
  const download = () => {
    const a = document.createElement('a');
    a.href = src;
    a.download = `generated-image-${Date.now()}.${ext}`;
    a.click();
  };
  useEffect(() => {
    if (!enlarged) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setEnlarged(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enlarged]);
  return (
    <>
      {message ? <p className="generated-image-caption">{message}</p> : null}
      <div className="generated-image-wrap">
        <img
          src={src}
          alt="Generated"
          className="generated-image-thumb"
          onClick={() => setEnlarged(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && setEnlarged(true)}
        />
        <button type="button" className="generated-image-download" onClick={download}>
          Download
        </button>
      </div>
      {enlarged && (
        <div className="generated-image-modal" onClick={() => setEnlarged(false)} role="dialog" aria-modal="true" aria-label="Enlarged image">
          <div className="generated-image-modal-inner" onClick={(e) => e.stopPropagation()}>
            <img src={src} alt="Generated (enlarged)" className="generated-image-enlarged" />
            <button type="button" className="generated-image-download" onClick={download}>
              Download
            </button>
            <button type="button" className="generated-image-close" onClick={() => setEnlarged(false)}>
              Close (Esc)
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Structured part renderer (code execution responses) ───────────────────────

function StructuredParts({ parts }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text' && part.text?.trim()) {
          return (
            <div key={i} className="part-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
            </div>
          );
        }
        if (part.type === 'code') {
          return (
            <div key={i} className="part-code">
              <div className="part-code-header">
                <span className="part-code-lang">
                  {part.language === 'PYTHON' ? 'Python' : part.language}
                </span>
              </div>
              <pre className="part-code-body">
                <code>{part.code}</code>
              </pre>
            </div>
          );
        }
        if (part.type === 'result') {
          const ok = part.outcome === 'OUTCOME_OK';
          return (
            <div key={i} className="part-result">
              <div className="part-result-header">
                <span className={`part-result-badge ${ok ? 'ok' : 'err'}`}>
                  {ok ? '✓ Output' : '✗ Error'}
                </span>
              </div>
              <pre className="part-result-body">{part.output}</pre>
            </div>
          );
        }
        if (part.type === 'image') {
          return (
            <img
              key={i}
              src={`data:${part.mimeType};base64,${part.data}`}
              alt="Generated plot"
              className="part-image"
            />
          );
        }
        return null;
      })}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const userDisplayName = (user) => {
  const first = user?.firstName?.trim();
  const last = user?.lastName?.trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;
  return user?.username || '';
};

export default function Chat({ user, onLogout }) {
  const username = user?.username || '';
  const [sessions, setSessions] = useState([]);
  // Start in a fresh unsaved chat so Enter works immediately after login.
  const [activeSessionId, setActiveSessionId] = useState('new');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const [csvContext, setCsvContext] = useState(null);     // pending attachment chip
  const [jsonContext, setJsonContext] = useState(null);   // pending JSON attachment (YouTube channel data)
  const [sessionCsvRows, setSessionCsvRows] = useState(null);    // parsed rows for JS tools
  const [sessionCsvHeaders, setSessionCsvHeaders] = useState(null); // headers for tool routing
  const [sessionJsonData, setSessionJsonData] = useState(null);   // parsed YouTube channel JSON for tools
  const [csvDataSummary, setCsvDataSummary] = useState(null);    // auto-computed column stats summary
  const [sessionSlimCsv, setSessionSlimCsv] = useState(null);   // key-columns CSV string sent directly to Gemini
  const [streaming, setStreaming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(false);
  const fileInputRef = useRef(null);
  // Set to true immediately before setActiveSessionId() is called during a send
  // so the messages useEffect knows to skip the reload (streaming is in progress).
  const justCreatedSessionRef = useRef(false);

  // On login or page load: load sessions from DB; open most recent so history is visible after reopen
  useEffect(() => {
    const init = async () => {
      try {
        const list = await getSessions(username);
        setSessions(list);
        // Open most recent session so user sees their last conversation after refresh/reopen
        if (list?.length > 0) {
          setActiveSessionId(list[0].id);
        } else {
          setActiveSessionId('new');
        }
      } catch (err) {
        console.error('Failed to load sessions', err);
        setSessions([]);
        setActiveSessionId('new');
      }
    };
    init();
  }, [username]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === 'new') {
      setMessages([]);
      return;
    }
    // If a session was just created during an active send, messages are already
    // in state and streaming is in progress — don't wipe them.
    if (justCreatedSessionRef.current) {
      justCreatedSessionRef.current = false;
      return;
    }
    setMessages([]);
    loadMessages(activeSessionId)
      .then(setMessages)
      .catch((err) => {
        console.error('Failed to load messages', err);
        setMessages([]);
      });
  }, [activeSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!openMenuId) return;
    const handler = () => setOpenMenuId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenuId]);

  // ── Session management ──────────────────────────────────────────────────────

  const handleNewChat = () => {
    setActiveSessionId('new');
    setMessages([]);
    setInput('');
    setImages([]);
    setCsvContext(null);
    setJsonContext(null);
    setSessionCsvRows(null);
    setSessionCsvHeaders(null);
    setSessionJsonData(null);
  };

  const handleSelectSession = (sessionId) => {
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    setInput('');
    setImages([]);
    setCsvContext(null);
    setJsonContext(null);
    setSessionCsvRows(null);
    setSessionCsvHeaders(null);
    setSessionJsonData(null);
  };

  const handleDeleteSession = async (sessionId, e) => {
    e.stopPropagation();
    setOpenMenuId(null);
    await deleteSession(sessionId);
    const remaining = sessions.filter((s) => s.id !== sessionId);
    setSessions(remaining);
    if (activeSessionId === sessionId) {
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : 'new');
      setMessages([]);
    }
  };

  // ── Resize anchor image to reduce payload and speed up image generation ─────
  const resizeImageBase64 = (base64, mimeType, maxSize = 1024) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w <= maxSize && h <= maxSize) {
          resolve({ data: base64, mimeType: mimeType || 'image/png' });
          return;
        }
        if (w > h) {
          h = Math.round((h * maxSize) / w);
          w = maxSize;
        } else {
          w = Math.round((w * maxSize) / h);
          h = maxSize;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (!blob) return resolve({ data: base64, mimeType: mimeType || 'image/png' });
            const r = new FileReader();
            r.onload = () => resolve({ data: r.result.split(',')[1], mimeType: 'image/jpeg' });
            r.onerror = () => resolve({ data: base64, mimeType: mimeType || 'image/png' });
            r.readAsDataURL(blob);
          },
          'image/jpeg',
          0.85
        );
      };
      img.onerror = () => resolve({ data: base64, mimeType: mimeType || 'image/png' });
      img.src = `data:${mimeType || 'image/png'};base64,${base64}`;
    });

  // ── File handling ───────────────────────────────────────────────────────────

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const fileToText = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsText(file);
    });

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files];

    const csvFiles = files.filter((f) => f.name.endsWith('.csv') || f.type === 'text/csv');
    const jsonFiles = files.filter((f) => f.name.endsWith('.json') || f.type === 'application/json');
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (csvFiles.length > 0) {
      const file = csvFiles[0];
      const text = await fileToText(file);
      const parsed = parseCSV(text);
      if (parsed) {
        setCsvContext({ name: file.name, ...parsed });
        const raw = parseCsvToRows(text);
        const { rows, headers } = enrichWithEngagement(raw.rows, raw.headers);
        setSessionCsvHeaders(headers);
        setSessionCsvRows(rows);
        setCsvDataSummary(computeDatasetSummary(rows, headers));
        setSessionSlimCsv(buildSlimCsv(rows, headers));
      }
    }

    if (jsonFiles.length > 0) {
      const file = jsonFiles[0];
      const text = await fileToText(file);
      try {
        const data = JSON.parse(text);
        const videos = Array.isArray(data) ? data : data?.videos;
        if (videos?.length) {
          setJsonContext({ name: file.name, videoCount: videos.length });
          setSessionJsonData(data);
        }
      } catch (_) {
        // ignore invalid JSON
      }
    }

    if (imageFiles.length > 0) {
      const newImages = await Promise.all(
        imageFiles.map(async (f) => ({
          data: await fileToBase64(f),
          mimeType: f.type,
          name: f.name,
        }))
      );
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  const handleFileSelect = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';

    const csvFiles = files.filter((f) => f.name.endsWith('.csv') || f.type === 'text/csv');
    const jsonFiles = files.filter((f) => f.name.endsWith('.json') || f.type === 'application/json');
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));

    if (csvFiles.length > 0) {
      const text = await fileToText(csvFiles[0]);
      const parsed = parseCSV(text);
      if (parsed) {
        setCsvContext({ name: csvFiles[0].name, ...parsed });
        const raw = parseCsvToRows(text);
        const { rows, headers } = enrichWithEngagement(raw.rows, raw.headers);
        setSessionCsvHeaders(headers);
        setSessionCsvRows(rows);
        setCsvDataSummary(computeDatasetSummary(rows, headers));
        setSessionSlimCsv(buildSlimCsv(rows, headers));
      }
    }
    if (jsonFiles.length > 0) {
      const file = jsonFiles[0];
      const text = await fileToText(file);
      try {
        const data = JSON.parse(text);
        const videos = Array.isArray(data) ? data : data?.videos;
        if (videos?.length) {
          setJsonContext({ name: file.name, videoCount: videos.length });
          setSessionJsonData(data);
        }
      } catch (_) {}
    }
    if (imageFiles.length > 0) {
      const newImages = await Promise.all(
        imageFiles.map(async (f) => ({
          data: await fileToBase64(f),
          mimeType: f.type,
          name: f.name,
        }))
      );
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  // ── Stop generation ─────────────────────────────────────────────────────────

  const handlePaste = async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    const newImages = await Promise.all(
      imageItems.map(
        (item) =>
          new Promise((resolve) => {
            const file = item.getAsFile();
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ data: reader.result.split(',')[1], mimeType: file.type, name: 'pasted-image' });
            reader.readAsDataURL(file);
          })
      )
    );
    setImages((prev) => [...prev, ...newImages.filter(Boolean)]);
  };

  const handleStop = () => {
    abortRef.current = true;
  };

  // ── Send message ────────────────────────────────────────────────────────────

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !images.length && !csvContext && !jsonContext) || streaming || !activeSessionId) return;

    // Lazily create the session in DB on the very first message
    let sessionId = activeSessionId;
    let canPersist = true;
    if (sessionId === 'new') {
      const title = chatTitle();
      try {
        const { id } = await createSession(username, 'lisa', title);
        sessionId = id;
        justCreatedSessionRef.current = true; // tell useEffect to skip the reload
        setActiveSessionId(id);
        setSessions((prev) => [
          { id, agent: 'lisa', title, createdAt: new Date().toISOString(), messageCount: 0 },
          ...prev,
        ]);
      } catch (err) {
        // If the backend or DB is down (e.g. TLS error), continue with an
        // in-memory session so the chat still works.
        console.error('Failed to create session in DB', err);
        canPersist = false;
        sessionId = `local-${Date.now()}`;
        setActiveSessionId(sessionId);
        setSessions((prev) => [
          { id: sessionId, agent: 'lisa', title, createdAt: new Date().toISOString(), messageCount: 0 },
          ...prev,
        ]);
      }
    }

    // ── Routing intent ──
    const PYTHON_ONLY_KEYWORDS = /\b(regression|scatter|histogram|seaborn|matplotlib|numpy|time.?series|heatmap|box.?plot|violin|distribut|linear.?model|logistic|forecast|trend.?line)\b/i;
    const wantPythonOnly = PYTHON_ONLY_KEYWORDS.test(text);
    const wantCode = CODE_KEYWORDS.test(text) && !sessionCsvRows;
    const capturedCsv = csvContext;
    const capturedJson = jsonContext;
    const needsBase64 = !!capturedCsv && wantPythonOnly;
    // generateImage is for image generation; allow it with or without JSON (e.g. prompt + optional anchor image)
    const wantsGenerateImage = images.length > 0 || /\b(generate|create|edit|draw|make)\b.*\b(image|picture|photo|art)\b/i.test(text) || /\bgenerate\s+(an?\s+)?image\b/i.test(text);
    const useYouTubeTools = !capturedCsv && (!!sessionJsonData || wantsGenerateImage);
    const useTools = !!sessionCsvRows && !wantPythonOnly && !wantCode && !capturedCsv && !useYouTubeTools;
    const useCodeExecution = wantPythonOnly || wantCode;

    // ── Build prompt ─────────────────────────────────────────────────────────
    const sessionSummary = csvDataSummary || '';
    const slimCsvBlock = sessionSlimCsv
      ? `\n\nFull dataset (key columns):\n\`\`\`csv\n${sessionSlimCsv}\n\`\`\``
      : '';

    const jsonPrefix = sessionJsonData
      ? `[YouTube channel JSON loaded: ${channelJsonSummary(sessionJsonData)}]\n\n`
      : '';

    const csvPrefix = capturedCsv
      ? needsBase64
        // Python path: send base64 so Gemini can load it with pandas
        ? `[CSV File: "${capturedCsv.name}" | ${capturedCsv.rowCount} rows | Columns: ${capturedCsv.headers.join(', ')}]

${sessionSummary}${slimCsvBlock}

IMPORTANT — to load the full data in Python use this exact pattern:
\`\`\`python
import pandas as pd, io, base64
df = pd.read_csv(io.BytesIO(base64.b64decode("${capturedCsv.base64}")))
\`\`\`

---

`
        // Standard path: plain CSV text — no encoding needed
        : `[CSV File: "${capturedCsv.name}" | ${capturedCsv.rowCount} rows | Columns: ${capturedCsv.headers.join(', ')}]

${sessionSummary}${slimCsvBlock}

---

`
      : sessionSummary
      ? `[CSV columns: ${sessionCsvHeaders?.join(', ')}]\n\n${sessionSummary}\n\n---\n\n`
      : '';

    const promptForGeminiBase = csvPrefix + jsonPrefix + (text || (images.length ? 'What do you see in this image?' : jsonContext ? 'Please analyze this YouTube channel data.' : csvContext ? 'Please analyze this CSV data.' : ''));
    const userContent = text || (images.length ? '(Image)' : jsonContext ? '(JSON attached)' : csvContext ? '(CSV attached)' : '');
    const promptForGemini = promptForGeminiBase;

    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: userContent,
      timestamp: new Date().toISOString(),
      images: [...images],
      csvName: capturedCsv?.name || null,
      jsonName: capturedJson?.name || null,
    };

    setMessages((m) => [...m, userMsg]);
    setInput('');
    const capturedImages = [...images];
    setImages([]);
    setCsvContext(null);
    setJsonContext(null);
    setStreaming(true);

    // Store display text only — base64 is never persisted. If persistence fails,
    // log and continue so the UI doesn't break.
    if (canPersist) {
      try {
        await saveMessage(
          sessionId,
          'user',
          userContent,
          capturedImages.length ? capturedImages : null
        );
      } catch (err) {
        console.error('Failed to save user message', err);
        canPersist = false;
      }
    }

    // For YouTube tools, resize images to 512px for the executor (anchor is sent to backend at 768px in youtubeExecuteFn).
    // We do not send the image to the chat model, so history and pixel settings can stay at original values.
    let imageParts;
    if (useYouTubeTools && capturedImages.length > 0) {
      imageParts = await Promise.all(
        capturedImages.map(async (img) => {
          const r = await resizeImageBase64(img.data, img.mimeType || 'image/png', 512);
          return { mimeType: r.mimeType, data: r.data };
        })
      );
    } else {
      imageParts = capturedImages.map((img) => ({ mimeType: img.mimeType, data: img.data }));
    }

    // History: plain display text only — session summary handles CSV context on every message
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'model')
      .map((m) => ({ role: m.role, content: m.content || messageText(m) }));

    const assistantId = `a-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: assistantId, role: 'model', content: '', timestamp: new Date().toISOString() },
    ]);

    abortRef.current = false;

    let fullContent = '';
    let groundingData = null;
    let structuredParts = null;
    let toolCharts = [];
    let toolCalls = [];
    let generatedImages = [];

    const youtubeExecuteFn = async (toolName, args) => {
      if (toolName === 'generateImage') {
        try {
          // Ensure we always have a non-empty prompt (model sometimes omits it)
          const prompt =
            (args.prompt && String(args.prompt).trim()) || promptForGemini?.trim() || 'Generate an image';
          // If user dragged an anchor image and the model didn't pass it, use the attached image
          let anchorBase64 = args.anchorImageBase64 || null;
          let anchorMime = args.mimeType || 'image/png';
          if (!anchorBase64 && imageParts.length > 0) {
            anchorBase64 = imageParts[0].data;
            anchorMime = imageParts[0].mimeType || 'image/png';
          }
          // Resize anchor to max 768px so the API responds faster (text+image often times out otherwise)
          if (anchorBase64) {
            const resized = await resizeImageBase64(anchorBase64, anchorMime, 768);
            anchorBase64 = resized.data;
            anchorMime = resized.mimeType;
          }
          const res = await fetch(`${API}/api/generate-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt,
              anchorImageBase64: anchorBase64,
              mimeType: anchorMime,
            }),
          });
          const data = await res.json();
          if (!res.ok) return { error: data.error || 'Image generation failed' };
          return {
            imageBase64: data.imageBase64,
            mimeType: data.mimeType,
            _imageResult: true,
            ...(data.message && { message: data.message }),
          };
        } catch (err) {
          return { error: err.message || 'Image generation failed' };
        }
      }
      return executeYouTubeTool(toolName, args, sessionJsonData);
    };

    const TOOLS_TIMEOUT_MS = 300000; // 5 min — image generation with anchor can be slow
    const withTimeout = (promise, ms, msg) =>
      Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(msg || 'Request timed out')), ms)
        ),
      ]);

    try {
      if (useYouTubeTools) {
        const result = await withTimeout(
          chatWithYouTubeTools(
            history,
            promptForGemini,
            channelJsonSummary(sessionJsonData),
            youtubeExecuteFn,
            userDisplayName(user),
            imageParts
          ),
          TOOLS_TIMEOUT_MS,
          'Response took too long (5 min). Try again or use a smaller image.'
        );
        const { text: answer, charts: returnedCharts, toolCalls: returnedCalls, generatedImages: imgs } = result;
        fullContent = answer;
        toolCharts = returnedCharts || [];
        toolCalls = returnedCalls || [];
        generatedImages = imgs || [];
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: fullContent,
                  charts: toolCharts.length ? toolCharts : undefined,
                  toolCalls: toolCalls.length ? toolCalls : undefined,
                  generatedImages: generatedImages.length ? generatedImages : undefined,
                }
              : msg
          )
        );
      } else if (useTools) {
        console.log('[Chat] useTools=true | rows:', sessionCsvRows.length, '| headers:', sessionCsvHeaders);
        const result = await withTimeout(
          chatWithCsvTools(
            history,
            promptForGemini,
            sessionCsvHeaders,
            (toolName, args) => executeTool(toolName, args, sessionCsvRows),
            userDisplayName(user)
          ),
          TOOLS_TIMEOUT_MS,
          'Response took too long (2 min). Try again or use a smaller CSV.'
        );
        const { text: answer, charts: returnedCharts, toolCalls: returnedCalls } = result;
        fullContent = answer;
        toolCharts = returnedCharts || [];
        toolCalls = returnedCalls || [];
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: fullContent,
                  charts: toolCharts.length ? toolCharts : undefined,
                  toolCalls: toolCalls.length ? toolCalls : undefined,
                }
              : msg
          )
        );
      } else {
        // ── Streaming path: code execution or search ─────────────────────────
        for await (const chunk of streamChat(history, promptForGemini, imageParts, useCodeExecution, userDisplayName(user))) {
          if (abortRef.current) break;
          if (chunk.type === 'text') {
            fullContent += chunk.text;
            const contentSnapshot = fullContent;
            setMessages((m) =>
              m.map((msg) => (msg.id === assistantId ? { ...msg, content: contentSnapshot } : msg))
            );
          } else if (chunk.type === 'fullResponse') {
            structuredParts = chunk.parts;
            const partsSnapshot = structuredParts;
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId ? { ...msg, content: '', parts: partsSnapshot } : msg
              )
            );
          } else if (chunk.type === 'grounding') {
            groundingData = chunk.data;
          }
        }
      }
    } catch (err) {
      const errText = `Error: ${err.message}`;
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, content: errText } : msg))
      );
      fullContent = errText;
    }

    if (groundingData) {
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, grounding: groundingData } : msg))
      );
    }

    // Save plain text + any tool charts to DB
    const savedContent = structuredParts
      ? structuredParts.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
      : fullContent;
    if (canPersist) {
      try {
        await saveMessage(
          sessionId,
          'model',
          savedContent,
          generatedImages.length
            ? generatedImages.map((img) => ({
                data: img.imageBase64,
                mimeType: img.mimeType,
                ...(img.message && { message: img.message }),
              }))
            : null,
          toolCharts.length ? toolCharts : null,
          toolCalls.length ? toolCalls : null
        );
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId ? { ...s, messageCount: s.messageCount + 2 } : s
          )
        );
      } catch (err) {
        console.error('Failed to save model message', err);
      }
    }

    setStreaming(false);
    inputRef.current?.focus();
  };

  const removeImage = (i) => setImages((prev) => prev.filter((_, idx) => idx !== i));

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const diffDays = Math.floor((Date.now() - d) / 86400000);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 0) return `Today · ${time}`;
    if (diffDays === 1) return `Yesterday · ${time}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="chat-layout">
      {/* ── Sidebar ──────────────────────────────── */}
      <aside className="chat-sidebar">
        <div className="sidebar-top">
          <h1 className="sidebar-title">Chat</h1>
          <button className="new-chat-btn" onClick={handleNewChat}>
            + New Chat
          </button>
        </div>

        <div className="sidebar-sessions">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`sidebar-session${session.id === activeSessionId ? ' active' : ''}`}
              onClick={() => handleSelectSession(session.id)}
            >
              <div className="sidebar-session-info">
                <span className="sidebar-session-title">{session.title}</span>
                <span className="sidebar-session-date">{formatDate(session.createdAt)}</span>
              </div>
              <div
                className="sidebar-session-menu"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(openMenuId === session.id ? null : session.id);
                }}
              >
                <span className="three-dots">⋮</span>
                {openMenuId === session.id && (
                  <div className="session-dropdown">
                    <button
                      className="session-delete-btn"
                      onClick={(e) => handleDeleteSession(session.id, e)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <span className="sidebar-username">{username}</span>
          <button onClick={onLogout} className="sidebar-logout">
            Log out
          </button>
        </div>
      </aside>

      {/* ── Main chat area ───────────────────────── */}
      <div className="chat-main">
        <>
        <header className="chat-header">
          <h2 className="chat-header-title">{activeSession?.title ?? 'New Chat'}</h2>
        </header>

        <div
          className={`chat-messages${dragOver ? ' drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {messages.map((m) => (
            <div key={m.id} className={`chat-msg ${m.role}`}>
              <div className="chat-msg-meta">
                <span className="chat-msg-role">{m.role === 'user' ? username : 'Lisa'}</span>
                <span className="chat-msg-time">
                  {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {/* CSV / JSON badge on user messages */}
              {(m.csvName || m.jsonName) && (
                <div className="msg-csv-badge">
                  📄 {m.csvName || m.jsonName}
                </div>
              )}

              {/* Image attachments */}
              {m.images?.length > 0 && (
                <div className="chat-msg-images">
                  {m.images.map((img, i) => (
                    <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="" className="chat-msg-thumb" />
                  ))}
                </div>
              )}

              {/* Message body */}
              <div className="chat-msg-content">
                {m.role === 'model' ? (
                  m.parts ? (
                    <StructuredParts parts={m.parts} />
                  ) : m.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  ) : (
                    <span className="thinking-dots">
                      <span /><span /><span />
                    </span>
                  )
                ) : (
                  <span className="chat-msg-user-text">{m.content}</span>
                )}
              </div>

              {/* Tool calls log */}
              {m.toolCalls?.length > 0 && (
                <details className="tool-calls-details">
                  <summary className="tool-calls-summary">
                    🔧 {m.toolCalls.length} tool{m.toolCalls.length > 1 ? 's' : ''} used
                  </summary>
                  <div className="tool-calls-list">
                    {m.toolCalls.map((tc, i) => (
                      <div key={i} className="tool-call-item">
                        <span className="tool-call-name">{tc.name}</span>
                        <span className="tool-call-args">{JSON.stringify(tc.args)}</span>
                        {tc.result && !tc.result._chartType && (
                          <span className="tool-call-result">
                            → {JSON.stringify(tc.result).slice(0, 200)}
                            {JSON.stringify(tc.result).length > 200 ? '…' : ''}
                          </span>
                        )}
                        {tc.result?._chartType && (
                          <span className="tool-call-result">→ rendered chart</span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Charts and cards from tool calls */}
              {m.charts?.map((chart, ci) =>
                chart._chartType === 'engagement' ? (
                  <EngagementChart
                    key={ci}
                    data={chart.data}
                    metricColumn={chart.metricColumn}
                  />
                ) : chart._chartType === 'metric_vs_time' ? (
                  <MetricVsTimeChart
                    key={ci}
                    data={chart.data}
                    metric_field={chart.metric_field}
                    time_field={chart.time_field}
                  />
                ) : chart._cardType === 'play_video' ? (
                  <PlayVideoCard
                    key={ci}
                    title={chart.title}
                    thumbnailUrl={chart.thumbnailUrl}
                    videoUrl={chart.videoUrl}
                  />
                ) : null
              )}

              {/* Generated images (download + click to enlarge) */}
              {(m.generatedImages?.length || (m.role === 'model' && m.images?.length)) ? (
                <div className="chat-generated-images">
                  {(m.generatedImages || m.images || []).map((img, idx) => (
                    <GeneratedImageCard
                      key={idx}
                      data={img.data || img.imageBase64}
                      mimeType={img.mimeType || 'image/png'}
                      message={img.message}
                    />
                  ))}
                </div>
              ) : null}

              {/* Search sources */}
              {m.grounding?.groundingChunks?.length > 0 && (
                <div className="chat-msg-sources">
                  <span className="sources-label">Sources</span>
                  <div className="sources-list">
                    {m.grounding.groundingChunks.map((chunk, i) =>
                      chunk.web ? (
                        <a key={i} href={chunk.web.uri} target="_blank" rel="noreferrer" className="source-link">
                          {chunk.web.title || chunk.web.uri}
                        </a>
                      ) : null
                    )}
                  </div>
                  {m.grounding.webSearchQueries?.length > 0 && (
                    <div className="sources-queries">
                      Searched: {m.grounding.webSearchQueries.join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {dragOver && <div className="chat-drop-overlay">Drop CSV, JSON, or images here</div>}

        {/* ── Input area ── */}
        <div className="chat-input-area">
          {/* CSV chip */}
          {csvContext && (
            <div className="csv-chip">
              <span className="csv-chip-icon">📄</span>
              <span className="csv-chip-name">{csvContext.name}</span>
              <span className="csv-chip-meta">
                {csvContext.rowCount} rows · {csvContext.headers.length} cols
              </span>
              <button className="csv-chip-remove" onClick={() => setCsvContext(null)} aria-label="Remove CSV">×</button>
            </div>
          )}
          {/* JSON chip (YouTube channel data) */}
          {jsonContext && (
            <div className="csv-chip json-chip">
              <span className="csv-chip-icon">📋</span>
              <span className="csv-chip-name">{jsonContext.name}</span>
              <span className="csv-chip-meta">{jsonContext.videoCount} videos</span>
              <button className="csv-chip-remove" onClick={() => { setJsonContext(null); setSessionJsonData(null); }} aria-label="Remove JSON">×</button>
            </div>
          )}

          {/* Image previews */}
          {images.length > 0 && (
            <div className="chat-image-previews">
              {images.map((img, i) => (
                <div key={i} className="chat-img-preview">
                  <img src={`data:${img.mimeType};base64,${img.data}`} alt="" />
                  <button type="button" onClick={() => removeImage(i)} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
          )}

          {/* Hidden file picker */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.csv,text/csv,.json,application/json"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />

          <div className="chat-input-row">
            <button
              type="button"
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming}
              title="Attach image, CSV, or JSON"
            >
              📎
            </button>
            <textarea
              ref={inputRef}
              className="chat-input-textarea"
              placeholder="Ask a question… Enter to send, Shift+Enter for new line"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              onPaste={handlePaste}
              disabled={streaming}
              rows={2}
            />
            {streaming ? (
              <button onClick={handleStop} className="stop-btn">
                ■ Stop
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() && !images.length && !csvContext && !jsonContext}
              >
                Send
              </button>
            )}
          </div>
        </div>
        </>
      </div>
    </div>
  );
}
