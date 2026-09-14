import { NextResponse } from "next/server";
import { getAiStatus } from "@/lib/ai";

// GET /api/ai/status — 当前 AI 后端（OpenAI 云端 / 本地 Ollama）是否可用
export async function GET() {
  return NextResponse.json(await getAiStatus());
}
