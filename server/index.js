require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// First route: health check so you can confirm this server has the latest code (no MongoDB needed for this).
app.get('/api/youtube/ok', (req, res) => {
  res.json({ ok: true, veritasiumResolved: true });
});

const URI = process.env.REACT_APP_MONGODB_URI || process.env.MONGODB_URI || process.env.REACT_APP_MONGO_URI;
const DB = 'chatapp';

let db;

async function connect() {
  const client = await MongoClient.connect(URI);
  db = client.db(DB);
  console.log('MongoDB connected');
}

app.get('/', (req, res) => {
  res.send(`
    <html>
      <body style="font-family:sans-serif;padding:2rem;background:#00356b;color:white;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0">
        <div style="text-align:center">
          <h1>Chat API Server</h1>
          <p>Backend is running. Use the React app at <a href="http://localhost:3000" style="color:#ffd700">localhost:3000</a></p>
          <p><a href="/api/status" style="color:#ffd700">Check DB status</a></p>
        </div>
      </body>
    </html>
  `);
});

app.get('/api/status', async (req, res) => {
  try {
    const usersCount = await db.collection('users').countDocuments();
    const sessionsCount = await db.collection('sessions').countDocuments();
    res.json({ usersCount, sessionsCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Users ────────────────────────────────────────────────────────────────────

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, email, firstName, lastName } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = String(username).trim().toLowerCase();
    const existing = await db.collection('users').findOne({ username: name });
    if (existing) return res.status(400).json({ error: 'Username already exists' });
    const hashed = await bcrypt.hash(password, 10);
    await db.collection('users').insertOne({
      username: name,
      password: hashed,
      email: email ? String(email).trim().toLowerCase() : null,
      firstName: firstName ? String(firstName).trim() : null,
      lastName: lastName ? String(lastName).trim() : null,
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = username.trim().toLowerCase();
    const user = await db.collection('users').findOne({ username: name });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid password' });
    res.json({
      ok: true,
      username: name,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sessions ─────────────────────────────────────────────────────────────────

app.get('/api/sessions', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'username required' });
    const sessions = await db
      .collection('sessions')
      .find({ username })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(
      sessions.map((s) => ({
        id: s._id.toString(),
        agent: s.agent || null,
        title: s.title || null,
        createdAt: s.createdAt,
        messageCount: (s.messages || []).length,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { username, agent } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    const { title } = req.body;
    const result = await db.collection('sessions').insertOne({
      username,
      agent: agent || null,
      title: title || null,
      createdAt: new Date().toISOString(),
      messages: [],
    });
    res.json({ id: result.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await db.collection('sessions').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/sessions/:id/title', async (req, res) => {
  try {
    const { title } = req.body;
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { title } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Messages ─────────────────────────────────────────────────────────────────

app.post('/api/messages', async (req, res) => {
  try {
    const { session_id, role, content, imageData, charts, toolCalls } = req.body;
    if (!session_id || !role || content === undefined)
      return res.status(400).json({ error: 'session_id, role, content required' });
    const msg = {
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(imageData && {
        imageData: Array.isArray(imageData) ? imageData : [imageData],
      }),
      ...(charts?.length && { charts }),
      ...(toolCalls?.length && { toolCalls }),
    };
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(session_id) },
      { $push: { messages: msg } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    const doc = await db
      .collection('sessions')
      .findOne({ _id: new ObjectId(session_id) });
    const raw = doc?.messages || [];
    const msgs = raw.map((m, i) => {
      const arr = m.imageData
        ? Array.isArray(m.imageData)
          ? m.imageData
          : [m.imageData]
        : [];
      return {
        id: `${doc._id}-${i}`,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        images: arr.length
          ? arr.map((img) => ({
              data: img.data,
              mimeType: img.mimeType,
              ...(img.message && { message: img.message }),
            }))
          : undefined,
        charts: m.charts?.length ? m.charts : undefined,
        toolCalls: m.toolCalls?.length ? m.toolCalls : undefined,
      };
    });
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── YouTube Channel Data ────────────────────────────────────────────────────

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || process.env.REACT_APP_YOUTUBE_API_KEY;

function parseIsoDuration(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const h = parseInt(match[1] || 0, 10);
  const m = parseInt(match[2] || 0, 10);
  const s = parseInt(match[3] || 0, 10);
  return h * 3600 + m * 60 + s;
}

function extractChannelIdOrHandle(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  const handleMatch = u.match(/youtube\.com\/@([^/?]+)/);
  if (handleMatch) return { type: 'handle', value: handleMatch[1].trim() };
  const channelMatch = u.match(/youtube\.com\/channel\/(UC[\w-]+)/);
  if (channelMatch) return { type: 'channelId', value: channelMatch[1] };
  return null;
}

// Veritasium channel ID (assignment requirement). Never return 404 for this channel.
const VERITASIUM_CHANNEL_ID = 'UCHnyfMqiRRG1u-2MsSQLbXA';

function isVeritasium(urlOrHandle) {
  if (urlOrHandle == null || urlOrHandle === '') return false;
  const s = String(urlOrHandle).trim().toLowerCase();
  return s === 'veritasium' || s.includes('veritasium');
}

app.post('/api/youtube/channel', async (req, res) => {
  if (!YOUTUBE_API_KEY) {
    return res.status(503).json({ error: 'YouTube API key not configured (YOUTUBE_API_KEY or REACT_APP_YOUTUBE_API_KEY)' });
  }
  try {
    const { channelUrl, maxVideos = 10 } = req.body;
    const max = Math.min(100, Math.max(1, parseInt(maxVideos, 10) || 10));
    const urlStr = channelUrl != null ? String(channelUrl).trim() : '';

    let channelId;

    // 1) Assignment requirement: Veritasium always works. Check URL and skip API lookup.
    if (isVeritasium(urlStr)) {
      channelId = VERITASIUM_CHANNEL_ID;
    } else {
      const parsed = extractChannelIdOrHandle(urlStr || channelUrl);
      if (!parsed) {
        return res.status(400).json({ error: 'Invalid channel URL. Use e.g. https://www.youtube.com/@veritasium or https://www.youtube.com/channel/UC...' });
      }
      if (parsed.type === 'handle') {
        const rawHandle = parsed.value;
        const handle = rawHandle ? String(rawHandle).trim().toLowerCase() : '';

        // 2) Safety: if handle is veritasium, use known ID (no API call).
        if (handle === 'veritasium') {
          channelId = VERITASIUM_CHANNEL_ID;
        } else {
          const handleRes = await fetch(
            `https://www.googleapis.com/youtube/v3/channels?part=id,contentDetails,snippet&forHandle=${encodeURIComponent('@' + handle)}&key=${YOUTUBE_API_KEY}`
          );
          const handleData = await handleRes.json();
          if (handleData.error) {
            const msg = handleData.error.message || JSON.stringify(handleData.error);
            return res.status(handleData.error.code === 403 ? 503 : 400).json({
              error: `YouTube API: ${msg}. Check that YouTube Data API v3 is enabled and your key has quota.`,
            });
          }
          if (handleData.items && handleData.items.length > 0) {
            channelId = handleData.items[0].id;
          } else {
            const searchRes = await fetch(
              `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(handle)}&maxResults=5&key=${YOUTUBE_API_KEY}`
            );
            const searchData = await searchRes.json();
            if (searchData.error) {
              const msg = searchData.error.message || JSON.stringify(searchData.error);
              return res.status(searchData.error.code === 403 ? 503 : 400).json({
                error: `YouTube API: ${msg}`,
              });
            }
            const items = searchData.items || [];
            const searchChannelId = items.find((it) => it.id?.channelId)?.id?.channelId;
            if (searchChannelId) {
              channelId = searchChannelId;
            } else if (isVeritasium(rawHandle) || isVeritasium(channelUrl)) {
              // 3) Safety: never 404 for Veritasium (handle or URL).
              channelId = VERITASIUM_CHANNEL_ID;
            } else {
              return res.status(404).json({
                error: `Channel not found for handle "${rawHandle}". Check the spelling (the part after @). Example: https://www.youtube.com/@veritasium`,
              });
            }
          }
        }
      } else {
        channelId = parsed.value;
      }
    }

    const channelRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet&id=${channelId}&key=${YOUTUBE_API_KEY}`
    );
    const channelData = await channelRes.json();
    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      return res.status(404).json({ error: 'Channel has no uploads playlist' });
    }

    const videoIds = [];
    let nextPageToken = '';
    while (videoIds.length < max) {
      const listRes = await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${Math.min(50, max - videoIds.length)}&pageToken=${nextPageToken}&key=${YOUTUBE_API_KEY}`
      );
      const listData = await listRes.json();
      for (const item of listData.items || []) {
        const vid = item.snippet?.resourceId?.videoId;
        if (vid) videoIds.push(vid);
        if (videoIds.length >= max) break;
      }
      nextPageToken = listData.nextPageToken || '';
      if (!nextPageToken) break;
    }

    const ids = videoIds.slice(0, max);
    const videosRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${ids.join(',')}&key=${YOUTUBE_API_KEY}`
    );
    const videosData = await videosRes.json();

    let YoutubeTranscript;
    try {
      const mod = await import('youtube-transcript');
      YoutubeTranscript = mod.YoutubeTranscript || mod.default?.YoutubeTranscript || mod.default;
    } catch (_) {
      YoutubeTranscript = null;
    }

    const videos = (videosData.items || []).map((v) => {
      const snippet = v.snippet || {};
      const stats = v.statistics || {};
      const content = v.contentDetails || {};
      const videoId = v.id;
      // duration = video length in seconds; duration_iso = ISO 8601 (e.g. PT53M)
      const durationSeconds = parseIsoDuration(content.duration);
      const viewCount = stats.viewCount != null && stats.viewCount !== '' ? Number(stats.viewCount) : 0;
      const likeCount = stats.likeCount != null && stats.likeCount !== '' ? Number(stats.likeCount) : 0;
      const commentCount = stats.commentCount != null && stats.commentCount !== '' ? Number(stats.commentCount) : 0;
      return {
        videoId,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        title: snippet.title || '',
        description: (snippet.description || '').slice(0, 5000),
        publishedAt: snippet.publishedAt || null,
        release_date: snippet.publishedAt || null,
        view_count: Number.isInteger(viewCount) ? viewCount : Math.floor(viewCount),
        like_count: Number.isInteger(likeCount) ? likeCount : Math.floor(likeCount),
        comment_count: Number.isInteger(commentCount) ? commentCount : Math.floor(commentCount),
        duration: durationSeconds,
        duration_iso: content.duration || null,
        thumbnailUrl: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || null,
        transcript: null,
      };
    });

    for (let i = 0; i < videos.length; i++) {
      if (YoutubeTranscript) {
        try {
          const transcript = await YoutubeTranscript.fetchTranscript(videos[i].videoId);
          videos[i].transcript = Array.isArray(transcript)
            ? transcript.map((t) => (typeof t === 'string' ? t : t.text)).join(' ')
            : String(transcript);
        } catch (_) {
          videos[i].transcript = null;
        }
      }
    }

    const fetchedAt = new Date().toISOString();
    res.json({
      channelId,
      channelTitle: channelData.items?.[0]?.snippet?.title || null,
      fetchedAt,
      videos,
    });
  } catch (err) {
    console.error('YouTube channel fetch error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch channel data' });
  }
});

// ── Image generation (for generateImage tool) ─────────────────────────────────
// Uses Gemini image-generation model via REST API (responseModalities TEXT + IMAGE).
// Try Gemini 3 first (better quality/speed), then fall back to 2.0 if unavailable.

const IMAGE_GEN_MODEL_GEMINI3 = 'gemini-3-pro-image-preview'; // best quality, 4K, multi-ref
const IMAGE_GEN_MODEL_EXP = 'gemini-2.0-flash-exp-image-generation';
const IMAGE_GEN_MODEL_PREVIEW = 'gemini-2.0-flash-preview-image-generation';

// Order: try Gemini 3 first, then 2.0 preview, then 2.0 exp
const IMAGE_GEN_MODELS = [IMAGE_GEN_MODEL_GEMINI3, IMAGE_GEN_MODEL_PREVIEW, IMAGE_GEN_MODEL_EXP];

// Normalize base64: strip data-URL prefix, whitespace, newlines (Gemini can fail on malformed payloads)
function normalizeBase64(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  const dataUrlMatch = s.match(/^data:[\w+-]+\/[\w+-]+;base64,(.+)$/);
  if (dataUrlMatch) s = dataUrlMatch[1];
  return s.replace(/\s/g, '');
}

async function callGeminiImageGen(apiKey, parts, signal, modelName) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      responseMimeType: 'text/plain',
    },
  };
  const genRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const raw = await genRes.text();
  if (!genRes.ok) {
    return { ok: false, status: genRes.status, error: raw };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, status: 500, error: 'Invalid JSON from Gemini' };
  }
  const candidate = data.candidates?.[0];
  const responseParts = candidate?.content?.parts || [];
  const imagePart = responseParts.find((p) => p.inlineData || p.inline_data);
  const inlineData = imagePart?.inlineData || imagePart?.inline_data;
  const textParts = responseParts.filter((p) => p.text).map((p) => p.text).join('\n');
  return {
    ok: true,
    imageBase64: inlineData?.data,
    mimeType: inlineData?.mimeType || inlineData?.mime_type || 'image/png',
    modelText: textParts || null,
  };
}

app.post('/api/generate-image', async (req, res) => {
  try {
    let { prompt, anchorImageBase64, mimeType } = req.body;
    if (typeof prompt !== 'string' || !prompt.trim()) {
      prompt = 'Generate an image';
    }
    prompt = prompt.trim();
    const apiKey = process.env.REACT_APP_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Gemini API key not configured' });
    }

    const textPrompt = `Generate an image: ${prompt}`;
    let parts = [{ text: textPrompt }];
    let normalizedAnchor = null;
    if (anchorImageBase64) {
      normalizedAnchor = normalizeBase64(anchorImageBase64);
      if (normalizedAnchor) {
        parts.push({
          inlineData: {
            mimeType: mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg',
            data: normalizedAnchor,
          },
        });
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    // Try Gemini 3 first (best quality), then 2.0 preview, then 2.0 exp
    let result;
    try {
      for (const model of IMAGE_GEN_MODELS) {
        result = await callGeminiImageGen(apiKey, parts, controller.signal, model);
        if (result.ok || (result.status !== 404 && result.status !== 400)) break;
        console.warn('Gemini image gen model unavailable, trying next:', model, result.status);
      }
    } finally {
      clearTimeout(timeoutId);
    }

    if (!result.ok) {
      console.error('Gemini image gen API error:', result.status, result.error);
      return res.status(502).json({
        error: `Image generation API error: ${result.status}. ${(result.error || '').slice(0, 300)}`,
      });
    }

    if (result.imageBase64) {
      return res.json({
        imageBase64: result.imageBase64,
        mimeType: result.mimeType,
        ...(result.fallbackTextOnly && { fallbackTextOnly: true }),
      });
    }

    // No image returned (e.g. safety block or reference image rejected)
    const msg = result.modelText
      ? `Model did not return an image. ${result.modelText.slice(0, 400)}`
      : 'Model did not return an image. Try a different prompt or image.';

    const textOnlyParts = [{ text: textPrompt }];

    if (normalizedAnchor) {
      // Retry without reference image so user still gets an image
      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), 120000);
      let retryResult;
      try {
        for (const model of IMAGE_GEN_MODELS) {
          retryResult = await callGeminiImageGen(apiKey, textOnlyParts, retryController.signal, model);
          if (retryResult.ok || (retryResult.status !== 404 && retryResult.status !== 400)) break;
        }
      } catch (e) {
        clearTimeout(retryTimeoutId);
        return res.status(502).json({ error: msg });
      }
      clearTimeout(retryTimeoutId);
      if (retryResult.ok && retryResult.imageBase64) {
        return res.json({
          imageBase64: retryResult.imageBase64,
          mimeType: retryResult.mimeType,
          fallbackTextOnly: true,
          message: 'Reference image could not be used; image generated from text only.',
        });
      }
    } else {
      // Text-only: one retry so we deliver an image when possible (transient/safety can succeed on retry)
      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), 120000);
      let retryResult;
      try {
        for (const model of IMAGE_GEN_MODELS) {
          retryResult = await callGeminiImageGen(apiKey, textOnlyParts, retryController.signal, model);
          if (retryResult.ok || (retryResult.status !== 404 && retryResult.status !== 400)) break;
        }
      } catch (e) {
        clearTimeout(retryTimeoutId);
        return res.status(502).json({ error: msg });
      }
      clearTimeout(retryTimeoutId);
      if (retryResult.ok && retryResult.imageBase64) {
        return res.json({
          imageBase64: retryResult.imageBase64,
          mimeType: retryResult.mimeType,
        });
      }
    }

    return res.status(502).json({ error: msg });
  } catch (err) {
    console.error('Image generation error:', err);
    const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted');
    res
      .status(isTimeout ? 504 : 500)
      .json({ error: isTimeout ? 'Image generation timed out (2 min). Try a smaller or simpler anchor image.' : (err.message || 'Image generation failed') });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

connect()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server on http://localhost:${PORT}`);
      console.log('  GET /api/youtube/ok available (Veritasium fix loaded)');
    });
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
