# Daymark

**A chat that remembers what you asked—and when.** Daymark pairs a streaming chat agent with one deliberate tool, web search, and a small local memory store. It answers with linked evidence, keeps question timestamps across restarts, and can bring an earlier ask back into context.

## Why this design

The challenge asks for three things: fast answers, grounded web research, and memory that includes time. Daymark keeps the model's action surface deliberately small: its only callable tool is `web_search`. Memory lookup is handled by the application before each model call, so the model cannot mutate its history or take unrelated actions. See [`design.md`](design.md) for the design rationale and tradeoffs.

## Features

- **One tool:** a server-side Brave Search integration returns up to five sanitized, timestampable web results. Search snippets are treated as untrusted evidence, and the model is asked to cite results by number.
- **Streaming answers:** the UI streams the assistant response and shows search results as source cards.
- **Time-aware memory:** SQLite stores each user question and assistant response with a UTC timestamp and the user's IANA timezone. A searchable memory timeline is visible in the sidebar and relevant past questions are injected into the model context.
- **Memory questions:** temporal prompts such as “When did I last ask about my portfolio?” retrieve saved questions and their original local timestamps.
- **Local-first by default:** the default model endpoint is Ollama on localhost. Conversation data and the SQLite database remain on this computer. Search queries go to Brave; choosing a hosted model also sends the necessary prompt context to that provider.
- **Focused, responsive UI:** keyboard-friendly chat, recent threads, source links, memory search, and mobile navigation.
- **Small, auditable surface:** no shell, file, email, calendar, or memory-write tools are exposed to the model.

## Run locally

Requirements: Node.js 20.9 or later, npm, Ollama with a tool-calling chat model, and a Brave Search API key.

1. Install and start [Ollama](https://ollama.com/download), then pull the default model:

   ```powershell
   ollama pull qwen2.5-coder:7b
   ```

2. Install packages and create your local environment file:

   ```powershell
   npm ci
   Copy-Item .env.example .env.local
   ```

3. Add a Brave Search API key to `.env.local` as `BRAVE_SEARCH_API_KEY`. The key is only read by the server and must never be committed. The local Ollama defaults are already listed in `.env.example`.

4. Start Daymark:

   ```powershell
   npm run dev
   ```

5. Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

To use an OpenAI-compatible hosted model, set `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` in `.env.local`. Hosted providers receive the prompt and the small amount of saved memory required for the current answer. Never commit `.env.local` or place keys in browser code.

## Verify

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

Tests cover timestamped SQLite memory, retrieval for temporal questions, safe search URL handling, the five-result cap, and missing-key behavior. Live model and Brave Search calls require credentials and are not part of the automated test suite.

## Data and privacy

Conversation data is saved at `data/daymark.sqlite` by default. Set `DATABASE_PATH` to move it. The database and its SQLite sidecar files are ignored by Git. There is no sign-in or multi-user isolation: run this app for one trusted local user and keep it bound to localhost. Add authentication and a managed database before exposing it on a public network.

The model can call only the `web_search` function. Search snippets can contain malicious or misleading text; they are isolated in the tool result and explicitly treated as untrusted. Search results are not fetched as full webpages, and source citations are limited to safe HTTP(S) URLs returned by Brave.

## Stack

- Next.js App Router, React, TypeScript
- Vercel AI SDK with an OpenAI-compatible model provider
- Brave Search API as the sole agent tool
- SQLite via `better-sqlite3`, with FTS5 search and a bounded `LIKE` fallback
- Tailwind CSS base plus a small custom design system

