import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    modelEndpoint: process.env.LLM_BASE_URL || "http://127.0.0.1:11434/v1",
    searchConfigured: Boolean(process.env.BRAVE_SEARCH_API_KEY),
    model: process.env.LLM_MODEL || "qwen2.5-coder:7b",
    toolCount: 1,
  });
}
