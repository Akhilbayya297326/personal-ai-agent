import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

let temporaryDirectory = "";
let previousDatabasePath: string | undefined;
let store: typeof import("./db");

before(async () => {
  temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "daymark-test-"));
  previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(temporaryDirectory, "memory.sqlite");
  store = await import("./db");
});

after(() => {
  store?.db.close();
  if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = previousDatabasePath;
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("saved questions persist with their own timezone and can be retrieved by topic", () => {
  const chat = store.createChat(randomUUID(), "Asia/Kolkata");
  const askedAt = "2026-04-05T10:30:00.000Z";
  store.saveMessage({
    id: randomUUID(), chatId: chat.id, role: "user",
    content: "Compare the Berlin trip options and train times.",
    createdAt: askedAt, timeZone: "Asia/Kolkata", sources: [],
  });

  const results = store.searchMemories("Berlin train options", 5);
  assert.equal(results.length, 1);
  assert.equal(results[0].content, "Compare the Berlin trip options and train times.");
  assert.equal(results[0].createdAt, askedAt);
  assert.equal(results[0].timeZone, "Asia/Kolkata");
  assert.match(store.formatMemoryTime(results[0].createdAt, results[0].timeZone), /Apr 5, 2026/);
});

test("temporal questions retrieve a dated memory and exclude the current prompt", () => {
  const olderChat = store.createChat(randomUUID(), "America/Los_Angeles");
  const currentChat = store.createChat(randomUUID(), "Asia/Kolkata");
  store.saveMessage({
    id: "past-question", chatId: olderChat.id, role: "user",
    content: "How should I structure a design portfolio?",
    createdAt: "2026-06-11T18:05:00.000Z", timeZone: "America/Los_Angeles", sources: [],
  });
  store.saveMessage({
    id: "current-question", chatId: currentChat.id, role: "user",
    content: "When did I last ask about my portfolio?",
    createdAt: "2026-06-12T08:00:00.000Z", timeZone: "Asia/Kolkata", sources: [],
  });

  assert.equal(store.isTemporalMemoryQuestion("When did I last ask about my portfolio?"), true);
  const memories = store.memoryContext("When did I last ask about my portfolio?", new Set(["current-question"]));
  assert.equal(memories.some((item) => item.id === "past-question"), true);
  assert.equal(memories.some((item) => item.id === "current-question"), false);
  assert.equal(memories.find((item) => item.id === "past-question")?.timeZone, "America/Los_Angeles");
});
