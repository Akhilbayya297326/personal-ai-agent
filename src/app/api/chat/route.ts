import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getChat, getMessages, saveMessage, setChatTimeZone } from "@/lib/db";
import { startAgentReply } from "@/lib/agent";

export const maxDuration = 90;

type IncomingMessage = { id?: unknown; role?: unknown; parts?: unknown; content?: unknown };

function messageText(value: IncomingMessage | undefined): string {
  if (!value || value.role !== "user") return "";
  if (Array.isArray(value.parts)) {
    return value.parts
      .filter((part): part is { type: string; text: string } => Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string"))
      .map((part) => part.text).join("\n").trim();
  }
  return typeof value.content === "string" ? value.content.trim() : "";
}

function safeTimeZone(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.slice(0, 80) : fallback;
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate });
    return candidate;
  } catch {
    return "UTC";
  }
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[\\[\]()*_`]/g, "\\$&").replace(/\r?\n/g, " ");
}

export async function POST(request: Request) {
  let body: { chatId?: unknown; timeZone?: unknown; messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid JSON chat request." }, { status: 400 });
  }
  const chatId = typeof body.chatId === "string" ? body.chatId : "";
  if (!/^[0-9a-f-]{36}$/i.test(chatId)) return NextResponse.json({ error: "Invalid conversation ID." }, { status: 400 });
  const chat = getChat(chatId);
  if (!chat) return NextResponse.json({ error: "Conversation not found. Refresh and start a new chat." }, { status: 404 });
  const incomingMessages = Array.isArray(body.messages) ? body.messages as IncomingMessage[] : [];
  const incoming = incomingMessages.at(-1);
  const query = messageText(incoming);
  if (!query) return NextResponse.json({ error: "Write a message before sending." }, { status: 400 });
  if (query.length > 12_000) return NextResponse.json({ error: "Messages are limited to 12,000 characters." }, { status: 413 });
  const timeZone = safeTimeZone(body.timeZone, chat.timeZone);
  setChatTimeZone(chatId, timeZone);
  const messageId = typeof incoming?.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(incoming.id)
    ? `${chatId}:${incoming.id}` : `${chatId}:${randomUUID()}`;
  const userMessageId = messageId;
  const createdAt = new Date().toISOString();
  saveMessage({ id: userMessageId, chatId, role: "user", content: query, createdAt, timeZone, sources: [] });
  const history = getMessages(chatId, 200);
  try {
    const result = await startAgentReply({
      chatId,
      timeZone,
      query,
      history,
      currentMessageId: userMessageId,
      abortSignal: request.signal,
      onFinish: async (text, sources) => {
        const sourceFooter = sources.length
          ? `\n\n### Sources\n${sources.map((source, index) => `${index + 1}. [${escapeMarkdownLabel(source.title)}](${source.url}) — ${escapeMarkdownLabel(source.domain)}`).join("\n")}`
          : "";
        saveMessage({
          id: `${chatId}:assistant:${userMessageId.slice(chatId.length + 1)}`,
          chatId,
          role: "assistant",
          content: `${text.trim()}${sourceFooter}`.trim(),
          createdAt: new Date().toISOString(),
          timeZone,
          sources: sources.slice(0, 5),
        });
      },
    });
    return result.toUIMessageStreamResponse({
      headers: { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache, no-transform" },
      onError: () => "The model request failed. Check the local model endpoint and try again.",
    });
  } catch (error) {
    console.error("Chat generation failed:", error instanceof Error ? error.name : "Unknown error");
    return NextResponse.json({ error: "The model request failed. Check the local model endpoint and API key, then retry." }, { status: 502 });
  }
}
