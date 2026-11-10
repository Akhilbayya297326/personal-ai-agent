# Daymark — product and system design

## Product intent

Daymark is a personal chat agent for two recurring needs: getting a current answer with evidence, and recalling a prior question with its date. The experience should feel quick and calm. It should make the source of a claim and the time behind a memory easy to inspect.

## Challenge constraints

- The model receives exactly one callable tool: `web_search`.
- Memory is a server-side context feature, not another model tool.
- User questions are stored with an exact UTC instant and the IANA timezone active when they were asked.
- Current or uncertain facts should use web search; everyday conversation and memory lookups should avoid an unnecessary search.
- The assistant should state when it could not verify a claim, never invent citations, and treat search results as untrusted data.

## Architecture

```text
Browser (Next.js / React)
  ├─ conversation list + streamed chat
  ├─ searchable “Remembered asks” timeline
  └─ POST /api/chat
       ├─ validates chat and latest user message
       ├─ stores the question with UTC timestamp + IANA timezone
       ├─ loads recent conversation context and matching saved questions
       ├─ AI SDK streamText with one tool: web_search
       │    └─ Brave Search API → up to five sanitized results
       └─ stores the completed assistant answer + source records
             └─ SQLite (WAL, foreign keys, FTS5; LIKE fallback)
```

The default model uses Ollama's OpenAI-compatible endpoint, so the demo can run locally with Qwen2.5-Coder. The provider can be changed through environment variables without changing application code. Search is an explicit Brave Search integration; model inference and search are separate dependencies.

## One-tool policy

The registered tool set is declared in `src/lib/agent.ts` and contains only `web_search`. Its input is a short query and an optional freshness window. The implementation:

1. trims and bounds the query;
2. makes one bounded-time request to Brave;
3. returns at most five results;
4. accepts only `http:` and `https:` result links;
5. returns titles, domains, short snippets, and optional page-age labels;
6. gives the model no browser, arbitrary HTTP, filesystem, shell, calendar, or memory-write tool.

The agent loop permits two model steps: one tool selection/execution step and one final answer step. That keeps the model's action surface and latency bounded to a single search per answer.

## Memory model

### Records

- `chats`: id, title, timezone, created time, last activity time.
- `messages`: id, chat id, role, text, creation time in UTC, and source records for assistant answers.
- `memory_fts`: searchable text index over messages, maintained in the same write path.

Timestamps are stored as ISO-8601 UTC instants. Display and model context use the timezone stored on the conversation, so an answer such as “you asked at 6:30 PM India time” can be traced to the original instant. A question about prior asks retrieves recent dated questions; ordinary follow-ups retrieve a small set of topic-matched past questions and the latest turns in the current conversation.

Memory is not summarized or rewritten by the model. This avoids creating a second source of truth for dates and preserves the user's actual wording. Prompt length stays bounded by limiting recent history and retrieved memories.

## Answer quality and latency

- Stream answer text to the browser as it is generated.
- Search only for current, unfamiliar, or consequential facts; do not add a search round trip to ordinary chat or recall questions.
- Include local time and a small set of relevant memories in the system context without calling a second tool.
- Request concise responses (900 token ceiling, low temperature) and cap search at five results and seven seconds.
- Show result cards and source domains so a reader can inspect evidence without trusting the prose alone.
- Keep a truthful distinction between “not found,” “search unavailable,” and “verified by these sources.”

No latency benchmark is claimed. Actual response time depends on the selected model, local hardware or hosted provider, network, and Brave Search response time.

## Interface design

The page uses a quiet, light interface with pine green actions, a pale green memory surface, and a warm neutral canvas. A persistent left rail places conversations and dated memory next to each other, making the promise of recall visible without interrupting chat. The center column gives answers room to breathe; sources appear directly beneath the answer that used them. On small screens, navigation becomes a drawer and the composer stays reachable. Keyboard submission, visible focus treatment, semantic buttons, accessible labels, and mobile breakpoints are part of the design, not later polish.

## Safety and privacy

- Keep search and model credentials server-side in `.env.local`.
- Bind the development and production start scripts to `127.0.0.1`.
- Do not place API keys in the browser bundle or tracked files.
- Treat search snippets as untrusted prompt input and tell the model to ignore instructions inside them.
- Validate search URLs before displaying them; open external links with `noopener noreferrer`.
- Limit input size, search query size, tool output count, context turns, and generated tokens.
- Store conversation data in a local SQLite file ignored by Git.
- This version is single-user and has no login. Do not expose it to a shared network without adding authentication, authorization, and protected storage.

## Failure behavior

- Missing Brave credentials returns a clear tool result; it does not fabricate live search evidence.
- Search timeout and rate limiting are surfaced as bounded messages.
- If the local model is unavailable, the stream reports a generic configuration error and server logs avoid echoing credentials or request contents.
- If FTS5 is missing in a SQLite build, memory search falls back to bounded token-based `LIKE` queries.
- Assistant answers and source records are saved only when generation finishes; the user question remains saved if generation is interrupted.

## Verification plan

- Unit tests: timestamped persistence, topic retrieval, temporal-memory intent, URL scheme validation, result caps, and search-key failure behavior.
- Static checks: TypeScript typecheck and ESLint.
- Production check: Next.js production build.
- Manual acceptance: search a current question and open a citation; ask a question without searching; ask a dated recall question in a later conversation; restart the app and confirm memory remains; confirm no key appears in the browser bundle or Git diff.

Live model and search integration tests require the user's own local model and Brave API key. They are separate from deterministic CI tests.

## Tradeoffs and next steps

- Brave supplies concise web snippets, not full-page extraction. This keeps the tool narrow and fast, but source pages may contain more nuance than the snippets show.
- SQLite is a good local single-user store. A public multi-user deployment should use authenticated accounts and a managed relational database with per-user isolation.
- Memory uses exact saved questions and lightweight lexical retrieval. Embeddings or model-written summaries could improve fuzzy recall, but would add another model dependency and make the stored memory less directly auditable.
- A small evaluation set should cover citation fidelity, search/no-search decisions, exact temporal recall, conflicting sources, prompt injection in snippets, and p50/p95 latency before making performance claims.

