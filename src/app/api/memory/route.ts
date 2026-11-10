import { NextResponse } from "next/server";
import { recentMemories, searchMemories } from "@/lib/db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 300);
  const memories = query ? searchMemories(query, 15) : recentMemories(15);
  return NextResponse.json({ memories });
}
