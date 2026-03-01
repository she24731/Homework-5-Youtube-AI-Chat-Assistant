# YouTube AI Chat Assistant

A React chatbot with Gemini AI, web search, user auth, MongoDB persistence, and YouTube channel analysis. Glassmorphism UI with streaming responses, CSV/JSON upload, code execution, and chat tools: **generateImage**, **plot_metric_vs_time**, **play_video**, **compute_stats_json**.

## How It Works

- **Frontend (React)** – Login/create account, chat UI with streaming, drag-and-drop CSV/images, Recharts bar charts
- **Backend (Express)** – REST API for users and sessions, connects to MongoDB
- **AI (Gemini)** – Streaming chat, Google Search grounding, Python code execution, and function calling for client-side tools
- **Storage (MongoDB)** – Users and chat sessions stored in `chatapp` database

## API Keys & Environment Variables

Create a `.env` file in the project root with:

| Variable | Required | Where used | Description |
|----------|----------|------------|-------------|
| `REACT_APP_GEMINI_API_KEY` | Yes | Frontend (baked in at build) | Google Gemini API key. Get one at [Google AI Studio](https://aistudio.google.com/apikey). |
| `REACT_APP_MONGODB_URI` | Yes | Backend | MongoDB Atlas connection string. Format: `mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/` |
| `REACT_APP_API_URL` | Production only | Frontend (baked in at build) | Full URL of the backend, e.g. `https://your-backend.onrender.com`. Leave blank for local dev (proxy handles it). |
| `YOUTUBE_API_KEY` | For YouTube tab | Backend | YouTube Data API v3 key for the "YouTube Channel Download" tab. Get at [Google Cloud Console](https://console.cloud.google.com/apis/credentials). |

The backend also accepts `MONGODB_URI` or `REACT_APP_MONGO_URI` as the MongoDB connection string if you prefer those names.

### Example `.env` (local development)

```
REACT_APP_GEMINI_API_KEY=AIzaSy...
REACT_APP_MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/
YOUTUBE_API_KEY=your_youtube_data_api_v3_key
# REACT_APP_API_URL not needed locally — the dev server proxies /api to localhost:3001
```

## MongoDB Setup

1. Create a [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) account and cluster.
2. Get your connection string (Database → Connect → Drivers).
3. Put it in `.env` as `REACT_APP_MONGODB_URI`.

All collections are created automatically on first use.

### Database: `chatapp`

#### Collection: `users`

One document per registered user.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | Auto-generated |
| `username` | string | Lowercase username |
| `password` | string | bcrypt hash |
| `email` | string | Email address (optional) |
| `firstName` | string | First name (optional) |
| `lastName` | string | Last name (optional) |
| `createdAt` | string | ISO timestamp |

#### Collection: `sessions`

One document per chat conversation.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | Auto-generated — used as `session_id` |
| `username` | string | Owner of this chat |
| `agent` | string | AI persona (e.g. `"lisa"`) |
| `title` | string | Auto-generated name, e.g. `"Chat · Feb 18, 2:34 PM"` |
| `createdAt` | string | ISO timestamp |
| `messages` | array | Ordered list of messages (see below) |

Each item in `messages`:

| Field | Type | Description |
|-------|------|-------------|
| `role` | string | `"user"` or `"model"` |
| `content` | string | Message text (plain, no CSV base64) |
| `timestamp` | string | ISO timestamp |
| `imageData` | array | *(optional)* Base64 image attachments `[{ data, mimeType }]` |
| `toolCalls` | array | *(optional)* Client-side tool invocations `[{ name, args, result }]` |

## Deploying to Render

The repo includes a `render.yaml` Blueprint that configures both the backend (Web Service) and frontend (Static Site) in one file.

### Step-by-step

**1. Deploy the backend first**

Go to [render.com](https://render.com) → New → **Web Service** → connect your GitHub repo.

| Setting | Value |
|---------|-------|
| Environment | Node |
| Build Command | `npm install` |
| Start Command | `node server/index.js` |

Add this environment variable in the Render dashboard:

| Variable | Value |
|----------|-------|
| `MONGODB_URI` | Your MongoDB Atlas connection string |

Once deployed, copy the backend URL (e.g. `https://chatapp-backend.onrender.com`).

---

**2. Deploy the frontend**

New → **Static Site** → same repo.

| Setting | Value |
|---------|-------|
| Build Command | `npm install && npm run build` |
| Publish Directory | `build` |

Add these environment variables:

| Variable | Value |
|----------|-------|
| `REACT_APP_GEMINI_API_KEY` | Your Gemini API key |
| `REACT_APP_API_URL` | Backend URL from step 1, e.g. `https://chatapp-backend.onrender.com` |

> **Important:** `REACT_APP_*` variables are baked into the JavaScript bundle at build time. If you change them in the dashboard, you must trigger a new deploy of the static site.

---

**Or use the Blueprint (both services at once)**

New → **Blueprint** → connect your repo. Render reads `render.yaml` and creates both services. You'll be prompted to enter the four secrets (`MONGODB_URI`, `REACT_APP_GEMINI_API_KEY`, `REACT_APP_API_URL`) after creation.

> **Note:** Because `REACT_APP_API_URL` must point to the backend's URL, which is only known after the backend is deployed, you may need to set `REACT_APP_API_URL` and re-deploy the static site after the first Blueprint run.

---

### Free tier cold starts

Render's free plan spins down services after 15 minutes of inactivity. The first request after a sleep takes ~30 seconds. Upgrade to the Starter plan ($7/mo) to avoid this.

---

## Running the App

### Option 1: Both together (single terminal)

```bash
npm install
npm start
```

> **Note:** `npm install` installs all required packages automatically. See [Dependencies](#dependencies) below for the full list.

### Option 2: Separate terminals (recommended for development)

First, install dependencies once:

```bash
npm install
```

Then open two terminals in the project root:

**Terminal 1 — Backend:**
```bash
npm run server
```

**Terminal 2 — Frontend:**
```bash
npm run client
```

This starts:

- **Backend** – http://localhost:3001  
- **Frontend** – http://localhost:3000  

Use the app at **http://localhost:3000**. The React dev server proxies `/api` requests to the backend.

### Restart backend after code changes

If you change backend code (e.g. `server/index.js`), you **must fully stop and restart** the backend or you will still be running the old code.

**Recommended: use the fresh-start script (kills port 3001, then starts the server):**

```bash
# In a separate terminal (backend only). Kills any process on 3001, then starts the new server.
npm run server:fresh
```

Then start the frontend in another terminal with `npm run client` if needed.

**Manual restart:**

- **Option 1:** Stop `npm start` (Ctrl+C), then run `npm start` again.
- **Option 2:** Kill the process on 3001, then start the server:
  ```bash
  lsof -ti:3001 | xargs kill -9
  npm run server
  ```

If you see "Cannot GET /api/youtube/ok" or "Channel not found for handle: veritasium", the process on port 3001 is an **old** one. Run `npm run server:fresh` (or kill 3001 and `npm run server`), then:

- **Direct backend:** http://localhost:3001/api/youtube/ok → should return `{"ok":true,"veritasiumResolved":true}`
- **Via proxy:** http://localhost:3000/api/youtube/ok → same when frontend is running

When the **new** server starts, the terminal will show: `GET /api/youtube/ok available (Veritasium fix loaded)`.

You can confirm the route is in the code (without MongoDB) by running: `npm run verify-youtube-ok`

### Troubleshooting: "Something is already running on port 3000"

If the client exits with this message, a previous app instance (or another app) is still using port 3000. Free it and try again:

```bash
# macOS/Linux: kill whatever is on port 3000
lsof -ti:3000 | xargs kill -9
# then run npm start again
```

### Verify Backend

- http://localhost:3001 – Server status page  
- http://localhost:3001/api/status – JSON with `usersCount` and `sessionsCount`  
- http://localhost:3001/api/youtube/ok – JSON `{ "ok": true, "veritasiumResolved": true }` (confirms YouTube/Veritasium route is loaded)

## Dependencies

All packages are installed via `npm install`. Key dependencies:

### Frontend

| Package | Purpose |
|---------|---------|
| `react`, `react-dom` | UI framework |
| `react-scripts` | Create React App build tooling |
| `@google/generative-ai` | Gemini API client (chat, function calling, code execution, search grounding) |
| `react-markdown` | Render markdown in AI responses |
| `remark-gfm` | GitHub-flavored markdown (tables, strikethrough, etc.) |
| `recharts` | Interactive charts (available for future visualizations) |

### Backend

| Package | Purpose |
|---------|---------|
| `express` | HTTP server and REST API |
| `mongodb` | MongoDB driver for Node.js |
| `bcryptjs` | Password hashing |
| `cors` | Cross-origin request headers |
| `dotenv` | Load `.env` variables |
| `youtube-transcript` | Fetch video captions/transcripts for YouTube Channel Download |
| `@google/generative-ai` | Used by the server for the generateImage API endpoint |

### Dev / Tooling

| Package | Purpose |
|---------|---------|
| `concurrently` | Run frontend and backend with a single `npm start` |

---

## Assignment Checklist (100% criteria)

| # | Requirement | Implementation |
|---|-------------|----------------|
| 1 | Chat personalization: First/Last name on signup, stored in DB, in chat context, AI addresses user by name | `Auth.js` (form), `server/index.js` (users), `Chat.js` → `userDisplayName(user)` passed to Gemini; `prompt_chat.txt` (USER'S NAME) |
| 2 | YouTube Channel Download tab: URL, max videos (1–100), Download button, metadata + transcript, progress bar, JSON download; 10 Veritasium videos in public | Tab in `App.js`; `YouTubeChannelDownload.js`; `server` `/api/youtube/channel`; `public/veritasium_channel_data.json` + `scripts/fetch-veritasium.js` |
| 3 | JSON chat input: drag/drop or attach JSON, load into context, save locally; prompt updated for JSON | `Chat.js` (drag, file picker, `sessionJsonData`); `prompt_chat.txt` (CONTEXT) |
| 4 | Tool **generateImage**: text + anchor image, display, download, click to enlarge; in prompt | `youtubeTools.js`, `server` `/api/generate-image`, `Chat.js` `GeneratedImageCard`; prompt §1 |
| 5 | Tool **plot_metric_vs_time**: React chart, enlarge, download; in prompt | `youtubeTools.js`, `MetricVsTimeChart.js`; prompt §2 |
| 6 | Tool **play_video**: card (title + thumbnail), opens in new tab; by title/ordinal/most viewed; in prompt | `youtubeTools.js`, `Chat.js` `PlayVideoCard`; prompt §3 |
| 7 | Tool **compute_stats_json**: mean, median, std, min, max for numeric field; in prompt | `youtubeTools.js`; prompt §4 |
| 8 | Prompt: YouTube Analyze Assistant, JSON context, tools described | `public/prompt_chat.txt` (full prompt) |

---

## Features Added: YouTube AI Chat Assistant (Assignment)

The following features were added to extend the class chat app into a **YouTube AI Chat Assistant**:

### 1. Chat personalization
- **First Name and Last Name** on the Create Account form (both required when creating an account).
- First and last name are stored in the **database** (`users` collection: `firstName`, `lastName`).
- After login, the user’s first and last name are put in the **chat context** so the AI knows who it is talking to.
- The **system prompt** (`public/prompt_chat.txt`) instructs the AI to address the user by name in the first message.

### 2. YouTube Channel Data Download tab
- After login, a **“YouTube Channel Download”** tab appears next to Chat.
- User can enter a **YouTube channel URL** (e.g. `https://www.youtube.com/@veritasium`), set **max videos** (default 10, max 100), and click **Download Channel Data**.
- The app fetches metadata for each video: **title, description, transcript** (if available), **duration, release date, view count, like count, comment count, video URL**, and thumbnail. Data is returned as JSON that the user can **download**.
- A **progress bar** is shown while the request is in progress.
- A sample script and placeholder file are provided to pre-download 10 videos from `@veritasium` into `public/` (see `scripts/fetch-veritasium.js` and `public/veritasium_channel_data.json`).

### 3. JSON chat input
- Users can **drag a JSON file** (e.g. exported YouTube channel data) into the chat or attach it via the file picker.
- The JSON is **loaded into the conversation context** and kept in session so the AI (and tools) can use it for the rest of the conversation.
- The **system prompt** explains that the AI may receive JSON files of YouTube channel data and how to work with them.

### 4. Chat tools (required names for grading)

All four tools are declared for the model and described in **`public/prompt_chat.txt`**:

| Tool name | Purpose |
|-----------|---------|
| **generateImage** | Generate an image from a text prompt and an optional anchor image. The image is shown in the chat with **download** and **click-to-enlarge**. |
| **plot_metric_vs_time** | Plot any numeric field (views, likes, comments, duration, etc.) **vs time** for the channel videos. Rendered as a **React** chart in the chat; **click to enlarge** and **download** (e.g. as CSV). |
| **play_video** | Show a **clickable card** (title + thumbnail) for a video from the loaded channel data. **Clicking opens the video in a new tab** on YouTube. The user can specify the video by **title** (e.g. “play the asbestos video”), **ordinal** (e.g. “first”, “3rd”), or **“most viewed”**. |
| **compute_stats_json** | Compute **mean, median, std, min, max** (and count) for any numeric field in the channel JSON (e.g. `view_count`, `like_count`, `comment_count`, `duration`). Used when the user asks for statistics or distribution of a numeric column. |

### 5. Prompt engineering
- The system prompt in **`public/prompt_chat.txt`** is updated so the AI acts as a **YouTube Analyze Assistant**.
- It states that the AI will receive **JSON files of YouTube channel data** and has **tools** to analyze the data and generate content.
- Each of the four tools above is **explicitly defined and described** in the prompt so the model knows when and how to use them.

---

## Note on Gemini models (Gemini 2 vs Gemini 3)

From course observation: **Gemini 2** models can sometimes have trouble calling the tools at first but **eventually succeed**. **Gemini 3** models tend to **call the tools more reliably** but are **noticeably slower**. The app is configured to use `gemini-2.5-flash` with the v1beta API for tool calls and streaming. You can change the model in `src/services/gemini.js` (constant `MODEL`) and in `server/index.js` (image generation) if needed.

---

## Features

- **Create account / Login** – Username + password (and first/last name on signup), hashed with bcrypt
- **Session-based chat history** – Each conversation is a separate session; sidebar lists all chats with delete option
- **Streaming Gemini responses** – Text streams in real time with animated "..." while thinking; Stop button to cancel
- **Google Search grounding** – Answers include cited web sources for factual queries
- **Python code execution** – Gemini writes and runs Python for plots, regression, histogram, scatter, and any analysis the JS tools can't handle
- **CSV upload** – Drag-and-drop or click to attach a CSV; a slim version of the data (key columns as plain text) plus a full statistical summary are sent to Gemini automatically
- **Auto-computed engagement column** – When a CSV has `Favorite Count` and `View Count` columns, an `engagement` ratio (Favorite Count / View Count) is added automatically to every row
- **Client-side data analysis tools** – Fast, zero-cost function-calling tools that run in the browser. Gemini calls these automatically for data questions; results are saved to MongoDB alongside the message:
  - `compute_column_stats(column)` – mean, median, std, min, max, count for any numeric column
  - `get_value_counts(column, top_n)` – frequency count of each unique value in a categorical column
  - `get_top_tweets(sort_column, n, ascending)` – top or bottom N tweets sorted by any metric (including `engagement`), with tweet text and key metrics
- **Tool routing logic** – The app automatically routes requests: client-side JS tools for simple stats, Python code execution for plots and complex models, Google Search for factual queries
- **Markdown rendering** – AI responses render headers, lists, code blocks, tables, and links
- **Image support** – Attach images via drag-and-drop, the 📎 button, or paste from clipboard (Ctrl+V)

## Chat System Prompt

The AI’s system instructions are loaded from **`public/prompt_chat.txt`**. Edit this file to change the assistant’s behavior (tone, role, format, etc.). Changes take effect on the next message; no rebuild needed.

### How to Get a Good Persona Prompt (Make the AI Sound Like Someone)

To make the AI sound like a specific person (celebrity, character, or role), ask your AI assistant or prompt engineer to do the following:

1. **Pull a bio** – “Look up [person’s name] on Wikipedia and summarize their background, career, and key facts.”

2. **Find speech examples** – “Search for interviews [person] has done and pull direct quotes that show how they talk—phrases they use, tone, vocabulary.”

3. **Describe the vibe** – “What’s their personality? Confident, shy, funny, formal? List 3–5 traits.”

4. **Define the role** – “This person is my assistant for [context, e.g. a Yale SOM course on Generative AI]. They should help with [specific tasks] while staying in character.”

5. **Ask for the full prompt** – “Write a system prompt for `prompt_chat.txt` that includes: (a) a short bio, (b) speech examples and phrases to mimic, (c) personality traits, and (d) their role as my assistant for [your use case].”

**Example request you can paste into ChatGPT/Claude/etc.:**

> Write a system prompt for a chatbot. The AI should sound like [Person X]. Pull their Wikipedia page and 2–3 interviews. Include: (1) a brief bio, (2) 5–8 direct quotes showing how they speak, (3) personality traits, and (4) their role as my teaching assistant for [Course Name] taught by [Professor] at [School]. Put it all in a format I can paste into `prompt_chat.txt`.
