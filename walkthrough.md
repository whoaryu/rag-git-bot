# Walkthrough - RAG Git Bot

This document details the completed implementation and verification of the **RAG Git Bot** system, an automated coding assistant and code reviewer.

---

## 1. Directory Structure

The repository is divided into self-contained `backend/` and `frontend/` folders:
```text
rag-git-bot/
├── docker-compose.yml       # postgres, redis, qdrant containers
├── backend/
│   ├── package.json         # backend dependencies (type: module, tsx runner)
│   ├── tsconfig.json        # TypeScript build config (ES2022, NodeNext)
│   ├── .env.example         # environment template with all required variables
│   └── src/
│       ├── index.ts         # express application entry (port 3001)
│       ├── config/
│       │   └── db.ts        # pg connection pool and schema migrations
│       ├── routes/
│       │   ├── ask.ts       # RAG Q&A streaming endpoint (SSE)
│       │   ├── repo.ts      # repository CRUD & indexing management
│       │   └── webhook.ts   # github app push/PR webhook handlers
│       └── services/
│           ├── chunker.ts   # symbol-aware code chunker (JS/TS/Python/fallback)
│           ├── cloner.ts    # shallow git clone & file traversal
│           ├── embeddings.ts# gemini text-embedding-004 (768 dimensions)
│           ├── qdrant.ts    # qdrant collection + vector CRUD
│           └── queue.ts     # bullmq background indexing worker
└── frontend/
    ├── package.json         # vite + react + lucide-react + fetch-event-source
    ├── index.html           # SEO-optimized HTML shell
    └── src/
        ├── index.css        # deep space dark theme, animations, design tokens
        ├── App.tsx          # full dashboard with tutorial, chat, citations
        └── main.tsx         # react DOM mount
```

---

## 2. Completed Architecture Details

### Databases & Infrastructure
*   [docker-compose.yml](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/docker-compose.yml) spins up **PostgreSQL 15**, **Redis 7** (for background task queues), and **Qdrant** (vector store).
*   [db.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/config/db.ts) initializes a Postgres client pool and runs migration scripts to create:
    1. `repositories`: GitHub URLs, names, indexing status, timestamps.
    2. `index_logs`: Files synced, durations, status, error messages.
    3. `chat_history`: User/bot message pairs per repository.

### Chunking Logic
*   [chunker.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/services/chunker.ts) uses RegEx patterns for JS/TS (`function`, `class`, arrow expressions) and Python (`def`, `class`). Outputs chunks between 3–60 lines. Exceeding 60 lines carries the function signature as context header to the next chunk. Non-code files default to paragraph splitting.

### Background Indexing
*   [queue.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/services/queue.ts) sets up **BullMQ** workers using `Redis` from `ioredis`.
*   [cloner.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/services/cloner.ts) runs `git clone --depth 1`, indexes files, then cleans up.
*   [embeddings.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/services/embeddings.ts) generates 768-dim vectors via Gemini `text-embedding-004`.
*   [qdrant.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/services/qdrant.ts) manages collection lifecycle, batched upserts, and cosine similarity search.

### REST API & Webhooks
*   [repo.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/routes/repo.ts) — CRUD endpoints for repositories, re-indexing, and logs.
*   [webhook.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/routes/webhook.ts) — GitHub App callbacks:
    *   **Push events**: Incremental sync via commit file diffs, selective re-embedding.
    *   **Pull request events**: AI code review using structured JSON output with severity filtering.
*   [ask.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/routes/ask.ts) — RAG Q&A: embeds question → Qdrant top-5 search → Groq streaming → SSE with citations.

### Premium Web Dashboard
*   [App.tsx](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/frontend/src/App.tsx) — Full-featured dashboard featuring:
    *   **Onboarding tutorial**: 6-step interactive walkthrough on first visit (persisted via localStorage).
    *   **Backend health indicator**: Live connection status pulse (green/red/amber).
    *   **Repository sidebar**: Status badges, action buttons with hover states, indexing log drawer.
    *   **Chat interface**: SSE streaming with ref-based closure fix, markdown rendering (code blocks, inline code, bold), blinking cursor indicator, loading states.
    *   **Citation viewer**: Slide-out drawer with line-highlighted code viewer and metadata.
    *   **GitHub Webhook setup modal**: Step-by-step integration instructions.
*   [index.css](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/frontend/src/index.css) — Deep Space dark theme with Outfit typography, glassmorphism, gradient buttons, slideInRight/pulse/blink animations, custom scrollbars, and selection colors.

---

## 3. Bugs Fixed

1. **ESModule Configuration**: Added `"type": "module"` to backend `package.json` and `.js` import extensions to resolve `import.meta` compilation errors.
2. **SSE Streaming Closure Bug**: The `onclose` callback in `fetchEventSource` captured stale React state. Fixed by accumulating text/citations in `useRef` instead of reading state variables inside the closure.
3. **Octokit `.rest` API Missing**: Imported and passed `Octokit` from `@octokit/rest` to the GitHub `App` constructor so installation clients have the full REST API surface.
4. **BullMQ/IORedis Type Mismatch**: Switched from default `IORedis` import to named `{ Redis }` export, and cast connection objects to resolve cross-package type incompatibilities.
5. **Dev Runner ESM Incompatibility**: Replaced `ts-node-dev` with `tsx` which has native ESM support for `"type": "module"` projects.
6. **Port Mismatch**: README referenced port `3002` while the actual backend defaults to `3001`. Corrected to `3001` everywhere.
7. **Unused Imports**: Removed `ChevronRight` and `Layers` from frontend imports.

---

## 4. Verification Results

| Check | Status |
|---|---|
| Backend `tsc --noEmit` | ✅ Pass |
| Frontend `tsc -b --noEmit` | ✅ Pass |
| Port consistency (3001) across backend, frontend, README, .env | ✅ Consistent |
| Frontend Vite dev server | ✅ Running |
| Backend tsx watch dev server | ✅ Running (needs Docker + .env) |
| SSE streaming closure fix | ✅ Verified via ref-based approach |

---

## 5. What You Need To Do

1. **Install Docker Desktop** and ensure it is running.
2. Run `docker-compose up -d` in the project root.
3. Copy `backend/.env.example` to `backend/.env` and fill in:
   - `GEMINI_API_KEY` (from Google AI Studio)
   - `GROQ_API_KEY` (from Groq Console)
4. Run `cd backend && npm install && npm run dev`
5. Run `cd frontend && npm run dev`
6. Open `http://localhost:5173` — the onboarding tutorial will guide you through usage.
