import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createChat, listChats } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ chats: listChats() });
}

export async function POST(request: Request) {
  let body: { timeZone?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid JSON object." }, { status: 400 });
  }
  let timeZone = typeof body.timeZone === "string" ? body.timeZone.slice(0, 80) : "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    timeZone = "UTC";
  }
  const chat = createChat(randomUUID(), timeZone);
  return NextResponse.json({ chat }, { status: 201 });
}
