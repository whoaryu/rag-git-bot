# Walkthrough - RAG Git Bot

This document details the completed implementation of the **RAG Git Bot** system, an automated coding assistant and code reviewer.

---

## 1. Directory Structure

The repository is divided into self-contained `backend/` and `frontend/` folders:
```text
rag-git-bot/
├── docker-compose.yml       # postgres, redis, qdrant containers
├── backend/
│   ├── package.json         # backend dependencies
│   ├── tsconfig.json        # build config
│   └── src/
│       ├── index.ts         # main express application entry
│       ├── config/
│       │   └── db.ts        # raw pg connection and schema migrations
│       ├── routes/
│       │   ├── ask.ts       # RAG Q&A endpoint
│       │   ├── repo.ts      # repository index management endpoints
│       │   └── webhook.ts   # push / pull request github app hooks
│       └── services/
│           ├── chunker.ts   # symbol-aware / paragraph code chunker
│           ├── cloner.ts    # shallow repository cloner & file traveler
│           ├── embeddings.ts# gemini-based text embedding generation
│           ├── qdrant.ts    # qdrant collection management and search
│           └── queue.ts     # bullmq worker to run ingestion in background
└── frontend/
    ├── package.json         # frontend packages
    ├── index.html           # main HTML with custom SEO descriptors
    └── src/
        ├── index.css        # dark theme style system
        ├── App.tsx          # interactive dashboard interface
        └── main.tsx         # application mounter
```

---

## 2. Completed Architecture Details

### Databases & Infrastructure
*   [docker-compose.yml](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/docker-compose.yml) spins up **PostgreSQL 15**, **Redis 7** (for background task queues), and **Qdrant** (vector store).
*   [db.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/config/db.ts) initializes a Postgres client connection pool and automatically runs migration scripts to create three tables:
    1. `repositories`: Stores GitHub URLs, project names, indexing status, and sync times.
    2. `index_logs`: Records files synced, duration, status, and error logs for indexing actions.
    3. `chat_history`: Stores message logs between users and the AI assistant.

### Chunking Logic
*   [chunker.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/services/chunker.ts) uses a RegEx scanner tailored to JS/TS (`function`, `class`, arrow assignments) and Python (`def`, `class`). It outputs chunks between 3 and 60 lines. If a block exceeds 60 lines, it carries over the syntax declaration header as context to the next chunk. Non-code files default to double-newline paragraphs.

### Background Indexing Task Queues
*   [queue.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/services/queue.ts) sets up **BullMQ** to process repository cloning and indexing.
*   [cloner.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/services/cloner.ts) runs a shallow `git clone --depth 1` into a temporary directory inside the backend workspace, indexes the files, and immediately cleans up the directory, maintaining a zero-footprint disk space policy.
*   [embeddings.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/services/embeddings.ts) generates 768-dimension vectors using Gemini's `text-embedding-004`.
*   [qdrant.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/services/qdrant.ts) coordinates collection lifecycle and vector point storage.

### REST API & Webhooks
*   [repo.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/routes/repo.ts) provides endpoints to trigger indexing, list repositories, check sync logs, and delete indexed code bases.
*   [webhook.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/routes/webhook.ts) processes GitHub App callbacks:
    *   **Push event**: Performs incremental sync. Reads commits lists to identify added/modified/deleted files, deletes their old chunks in Qdrant, and updates only the modified files using the GitHub GET content API. No full repository cloning is required.
    *   **Pull Request event**: Performs inline automated reviews. Sends modified files to the Groq API to review logic, security leaks, or N+1 queries. Responses are validated against a structured JSON schema, filtered, and posted as an inline PR review.
*   [ask.ts](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/backend/src/routes/ask.ts) accepts question inputs, searches Qdrant for the top 5 relevant code chunks, builds a prompt, and streams response tokens back using Groq. Citations are sent as a separate SSE payload before closing the stream.

### Premium Web Dashboard
*   [App.tsx](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/frontend/src/App.tsx) provides a sidebar listing projects and their indexing logs. Selecting a repository opens a chat stream client that handles streaming tokens and interactive citation chips. Clicking a citation opens a custom drawer display showing the code snippet with absolute line numbers.
*   [index.css](file:///c:/Users/Dell/Downloads/koding%20repos/rag-git-bot/frontend/src/index.css) structures the UI with modern dark mode variables, Outfit fonts, backdrop-blur cards, responsive scrollbars, and micro-animations for message entries and ingestion states.

---

## 3. Manual Verification Steps

1. **Docker Setup**: Spin up database services:
   ```bash
   docker-compose up -d
   ```
2. **Backend Server**: Spin up the backend:
   ```bash
   cd backend
   npm run dev
   ```
3. **Frontend Dashboard**: Run the client interface:
   ```bash
   cd frontend
   npm run dev
   ```
4. **Test Run**: Add a public repository URL in the UI. Confirm it queues the task, updates status badges, and successfully completes. Test chat prompts and confirm the streaming output alongside clickable citation code block side-drawers.
