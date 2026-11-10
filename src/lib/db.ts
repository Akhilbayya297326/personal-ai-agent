import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type SearchSource = {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedAt?: string;
};

export type StoredMessage = {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  timeZone: string;
  sources: SearchSource[];
};

export type ChatSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  timeZone: string;
};

export type MemoryEntry = StoredMessage & { chatTitle: string; timeZone: string };

const globalForDb = globalThis as typeof globalThis & { daymarkDb?: Database.Database };

function openDatabase(): Database.Database {
  const filename = path.resolve(process.env.DATABASE_PATH || path.join(process.cwd(), "data", "daymark.sqlite"));
  mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New conversation',
      time_zone TEXT NOT NULL DEFAULT 'UTC',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      time_zone TEXT NOT NULL DEFAULT 'UTC',
      sources_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS messages_chat_created ON messages(chat_id, created_at);
    CREATE INDEX IF NOT EXISTS messages_created_role ON messages(created_at DESC, role);
  `);
  const messageColumns = db.pragma("table_info(messages)") as Array<{ name: string }>;
  if (!messageColumns.some((column) => column.name === "time_zone")) {
    db.exec("ALTER TABLE messages ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC'");
  }
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(message_id UNINDEXED, chat_id UNINDEXED, content, tokenize='unicode61 remove_diacritics 2')`);
  } catch {
    // Some SQLite builds omit FTS5. Memory falls back to a bounded LIKE search.
  }
  return db;
}

export const db = globalForDb.daymarkDb ?? (globalForDb.daymarkDb = openDatabase());

export function createChat(id: string, timeZone = "UTC"): ChatSummary {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO chats (id, title, time_zone, created_at, updated_at) VALUES (?, 'New conversation', ?, ?, ?)")
    .run(id, timeZone, now, now);
  return getChat(id)!;
}

export function getChat(id: string): ChatSummary | undefined {
  const row = db.prepare("SELECT id, title, time_zone AS timeZone, created_at AS createdAt, updated_at AS updatedAt FROM chats WHERE id = ?")
    .get(id) as ChatSummary | undefined;
  return row;
}

export function setChatTimeZone(id: string, timeZone: string): void {
  db.prepare("UPDATE chats SET time_zone = ? WHERE id = ?").run(timeZone, id);
}

export function listChats(): ChatSummary[] {
  return db.prepare("SELECT id, title, time_zone AS timeZone, created_at AS createdAt, updated_at AS updatedAt FROM chats ORDER BY updated_at DESC LIMIT 100")
    .all() as ChatSummary[];
}

export function getMessages(chatId: string, limit = 100): StoredMessage[] {
  const rows = db.prepare(`
    SELECT id, chat_id AS chatId, role, content, created_at AS createdAt, time_zone AS timeZone, sources_json AS sourcesJson
    FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(chatId, Math.max(1, Math.min(limit, 200))) as Array<Omit<StoredMessage, "sources"> & { sourcesJson: string }>;
  return rows.reverse().map((row) => ({
    id: row.id,
    chatId: row.chatId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
    timeZone: row.timeZone,
    sources: parseSources(row.sourcesJson),
  }));
}

function parseSources(value: string): SearchSource[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isSearchSource).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function isSearchSource(value: unknown): value is SearchSource {
  return Boolean(value && typeof value === "object" &&
    typeof (value as SearchSource).title === "string" &&
    typeof (value as SearchSource).url === "string" &&
    typeof (value as SearchSource).domain === "string" &&
    typeof (value as SearchSource).snippet === "string");
}

export function saveMessage(message: StoredMessage): void {
  const insert = db.prepare(`
    INSERT INTO messages (id, chat_id, role, content, created_at, time_zone, sources_json)
    VALUES (@id, @chatId, @role, @content, @createdAt, @timeZone, @sources)
    ON CONFLICT(id) DO UPDATE SET content = excluded.content, time_zone = excluded.time_zone, sources_json = excluded.sources_json
  `);
  const transaction = db.transaction(() => {
    insert.run({
      id: message.id,
      chatId: message.chatId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      timeZone: message.timeZone,
      sources: JSON.stringify(message.sources),
    });
    try {
      db.prepare("DELETE FROM memory_fts WHERE message_id = ?").run(message.id);
      db.prepare("INSERT INTO memory_fts (message_id, chat_id, content) VALUES (?, ?, ?)").run(message.id, message.chatId, message.content);
    } catch {
      // FTS is optional; the LIKE fallback searches the messages table.
    }
    const title = message.role === "user" ? message.content.replace(/\s+/g, " ").trim().slice(0, 62) : "";
    db.prepare(`UPDATE chats SET updated_at = ?, title = CASE WHEN title = 'New conversation' AND ? <> '' THEN ? ELSE title END WHERE id = ?`)
      .run(message.createdAt, title, title, message.chatId);
  });
  transaction();
}

function mapMemoryRows(rows: Array<{ id: string; chatId: string; content: string; createdAt: string; title: string; timeZone: string }>): MemoryEntry[] {
  return rows.map((row) => ({
    id: row.id,
    chatId: row.chatId,
    chatTitle: row.title,
    content: row.content,
    createdAt: row.createdAt,
    role: "user" as const,
    sources: [],
    timeZone: row.timeZone,
  }));
}

export function recentMemories(limit = 12): MemoryEntry[] {
  const rows = db.prepare(`
    SELECT m.id, m.chat_id AS chatId, m.content, m.created_at AS createdAt, c.title, m.time_zone AS timeZone
    FROM messages m JOIN chats c ON c.id = m.chat_id
    WHERE m.role = 'user' ORDER BY m.created_at DESC LIMIT ?
  `).all(Math.min(Math.max(limit, 1), 30)) as Array<{ id: string; chatId: string; content: string; createdAt: string; title: string; timeZone: string }>;
  return mapMemoryRows(rows);
}

export function searchMemories(query: string, limit = 12): MemoryEntry[] {
  const safeLimit = Math.min(Math.max(limit, 1), 30);
  const tokens = query.normalize("NFKC").match(/[\p{L}\p{N}_]{2,}/gu)?.slice(0, 8) ?? [];
  if (!tokens.length) return recentMemories(safeLimit);
  const ftsQuery = tokens.map((token) => `"${token.replace(/"/g, "")}"`).join(" OR ");
  try {
    const rows = db.prepare(`
      SELECT m.id, m.chat_id AS chatId, m.content, m.created_at AS createdAt, c.title, m.time_zone AS timeZone
      FROM memory_fts f JOIN messages m ON m.id = f.message_id JOIN chats c ON c.id = m.chat_id
      WHERE memory_fts MATCH ? AND m.role = 'user' ORDER BY bm25(memory_fts), m.created_at DESC LIMIT ?
    `).all(ftsQuery, safeLimit) as Array<{ id: string; chatId: string; content: string; createdAt: string; title: string; timeZone: string }>;
    return mapMemoryRows(rows);
  } catch {
    const patterns = tokens.map((token) => `%${token}%`);
    const where = patterns.map(() => "content LIKE ?").join(" OR ");
    const rows = db.prepare(`
      SELECT m.id, m.chat_id AS chatId, m.content, m.created_at AS createdAt, c.title, m.time_zone AS timeZone
      FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.role = 'user' AND (${where})
      ORDER BY m.created_at DESC LIMIT ?
    `).all(...patterns, safeLimit) as Array<{ id: string; chatId: string; content: string; createdAt: string; title: string; timeZone: string }>;
    return mapMemoryRows(rows);
  }
}

export function isTemporalMemoryQuestion(text: string): boolean {
  return /\b(what did i (?:last )?ask|when did i (?:last )?ask|what was my question|what did we discuss|what did i tell you|what was i asking|last time i asked|remind me what i asked|what did i ask you|when was the last time)\b/i.test(text);
}

export function memoryContext(query: string, excludedIds: Set<string>): MemoryEntry[] {
  const matches = isTemporalMemoryQuestion(query) ? recentMemories(24) : searchMemories(query, 8);
  return matches.filter((item) => !excludedIds.has(item.id)).slice(0, isTemporalMemoryQuestion(query) ? 24 : 6);
}

export function formatMemoryTime(isoDate: string, timeZone: string): string {
  const date = new Date(isoDate);
  try {
    return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC", timeZoneName: "short" }).format(date);
  }
}
