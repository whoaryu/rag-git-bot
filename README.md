# RAG Codebase Assistant & AI Git Bot

A dual-purpose AI developer tool: a **RAG-powered chat assistant** that answers architectural and code queries using citations, combined with a **GitHub App integration** that indexes pushed files incrementally and performs automated, inline pull request reviews.

---

## 📸 Demo & Screenshots

### Video Walkthrough

<p align="center">
  <video src="ragmp4.mp4" width="100%" controls muted></video>
</p>

### Screenshots

<p align="center">
  <img src="rag1.png" alt="" width="100%" />
</p>

<p align="center">
  <img src="rag3.png" alt="" width="100%" />
</p>

<p align="center">
  <img src="rag2.png" alt="" width="100%" />
</p>

<p align="center">
  <img src="rag4.png" alt="" width="100%" />
</p>
---

## 🏗️ Project Architecture Layout

The repository is divided into a self-contained Node/TypeScript `backend/` and React `frontend/` directories:

1. **`backend/`**
   - **`src/services/chunker.ts`**: A syntax-aware parser tailored to JS/TS (`class`, `function`, arrow declarations) and Python (`def`, `class`) that chunks files into semantic blocks (3-60 lines) carrying context headers.
   - **`src/services/queue.ts`**: BullMQ and Redis-backed background worker queues that handle async repository cloning, file traversal, and embedding generation.
   - **`src/services/embeddings.ts`**: Vector generation (768 dimensions) using Gemini's `text-embedding-004` model.
   - **`src/services/qdrant.ts`**: Collection creator, semantic search coordinator, and cosine similarity distance engine.
   - **`src/routes/ask.ts`**: The query stream controller that pulls top-5 code matches, formats context prompts, and streams tokens using Groq's Llama models.
   - **`src/routes/webhook.ts`**: GitHub App callback handlers processing push events (incremental index updates) and pull requests (sending modified files to LLM and posting inline reviews).
2. **`frontend/`**
   - **`src/App.tsx`**: A premium React dashboard interface featuring code snippet drawer viewers, chat streams, indexing logs tables, and GitHub App installation guides.

---

## 🚀 Getting Started (Quick Start)

### 1. Launch Database & Infrastructure
Spin up **PostgreSQL 15** (relational logs), **Redis 7** (BullMQ queues), and **Qdrant** (vector store) via Docker:
```bash
docker-compose up -d
```

### 2. Configure Backend Server
Create a `.env` file in the `backend/` folder:
```env
PORT=3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rag_git_bot
REDIS_URL=redis://localhost:6379
QDRANT_URL=http://localhost:6333

# AI Credentials
GEMINI_API_KEY=your_gemini_api_key       # For text-embeddings-004
GROQ_API_KEY=your_groq_api_key           # For chat LLM streams
GROQ_MODEL=llama-3.1-70b-versatile

# GitHub App Secrets (Only needed for webhooks & reviews)
GITHUB_APP_ID=your_github_app_id
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your_webhook_hmac_secret
```

### 3. Launch Backend & Frontend Services
Start the Express backend API (automatically sets up Postgres tables on start):
```bash
cd backend
npm install
npm run dev
```

Start the Vite React web dashboard (runs on port `5173` or similar):
```bash
cd ../frontend
npm install
npm run dev
```

*Note: By default, the frontend connects to the backend at `http://localhost:3001/api`. If you customize the backend port, you can configure it for the frontend by creating a `frontend/.env` file with `VITE_API_BASE=http://localhost:your_port/api`.*

---

## 🛡️ Setting Up the GitHub App Integrations

To enable automated pull request reviews and push-to-index webhooks:

1. **Register a GitHub App** in your GitHub developer settings.
2. **Set permissions:**
   - **Contents (Read):** To read files on pushes and reviews.
   - **Pull Requests (Read & Write):** To post inline PR review reviews.
   - **Metadata (Read).**
3. **Select Events:** Subscribe to **Push** and **Pull request** callbacks.
4. **Set Webhook URL:** Point the webhook URL to your backend endpoint (use `ngrok` for local development: `https://<ngrok-subdomain>.ngrok-free.app/api/webhook`).
5. **Private Key:** Generate a private key `.pem` file. Convert the contents of the key into a single-line string replacing newlines with `\n` in your `.env` file.
6. Install the App on your desired target repositories.

---

## 🌟 Core Technical Highlights

* **Syntax-Aware Chunking:** Code chunks are split cleanly at function/class structures instead of arbitrary text windows. If a function is longer than 60 lines, the signature header is carried over to the next chunk as metadata context.
* **Inline Pull Request Reviews:** When a PR is opened/synced, the bot requests a structured JSON review from the LLM, filters out low-severity comments, and issues a combined review with inline code annotations using the GitHub pulls review API.
* **Incremental Synchronization:** The push webhook calculates changed files using commit SHA diffs, deletes outdated chunks from Qdrant, and indexes only the modified/added files without performing full repository clones.
