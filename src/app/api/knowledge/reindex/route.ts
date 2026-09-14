import { NextResponse } from "next/server";
import { reindexKnowledge } from "@/lib/knowledge-grounding";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await reindexKnowledge());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "知识索引更新失败" },
      { status: 500 },
    );
  }
}
