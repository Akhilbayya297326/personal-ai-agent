import { NextResponse } from "next/server";
import { getChat, getMessages } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await context.params;
  const chat = getChat(chatId);
  if (!chat) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  return NextResponse.json({ chat, messages: getMessages(chatId) });
}
