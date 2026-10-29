import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDefaultKnowledgeSpace } from "@/lib/knowledge-grounding";
import { fallbackBrainstormTitle } from "@/lib/brainstorm-title";
import { invalidJsonResponse, readJsonObject } from "@/lib/request-body";

export const dynamic = "force-dynamic";

const SESSION_LIST_LIMIT = 100;

type JsonCounts = { id: string; propositions: number; routes: number };

/** 只在数据库里统计命题/路线数量，不把整段 JSON 加载到内存 */
async function countJsonArrays(ids: string[]): Promise<Map<string, JsonCounts>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<JsonCounts[]>`
    SELECT "id",
      CASE WHEN jsonb_typeof("propositions") = 'array' THEN jsonb_array_length("propositions") ELSE 0 END AS "propositions",
      CASE WHEN jsonb_typeof("routes") = 'array' THEN jsonb_array_length("routes") ELSE 0 END AS "routes"
    FROM "BrainstormSession"
    WHERE "id" = ANY(${ids})
  `;
  return new Map(rows.map((row) => [row.id, row]));
}

// GET /api/brainstorm — 会话列表（最新在前，最多 100 条）
export async function GET() {
  const sessions = await prisma.brainstormSession.findMany({
    orderBy: { updatedAt: "desc" },
    take: SESSION_LIST_LIMIT,
    select: {
      id: true,
      question: true,
      title: true,
      mode: true,
      knowledgeSpaceId: true,
      groundingPolicy: true,
      status: true,
      summary: true,
      increments: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const counts = await countJsonArrays(sessions.map((session) => session.id));
  return NextResponse.json({
    sessions: sessions.map((session) => ({
      id: session.id,
      question: session.question,
      title: session.title || fallbackBrainstormTitle(session.question),
      mode: session.mode,
      knowledgeSpaceId: session.knowledgeSpaceId,
      groundingPolicy: session.groundingPolicy,
      status: session.status,
      propositions: Number(counts.get(session.id)?.propositions ?? 0),
      routes: Number(counts.get(session.id)?.routes ?? 0),
      summary: session.summary,
      increments: session.increments,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    })),
  });
}

// POST /api/brainstorm {question} — 新建推演会话
export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject<{
      question?: string;
      mode?: "reasoning" | "knowledge";
      knowledgeSpaceId?: string;
      groundingPolicy?: "strict" | "assisted";
    }>(req);
    if (!body) return invalidJsonResponse();
    const question = (body.question ?? "").trim();
    if (!question) return NextResponse.json({ error: "先写一个你想推演的问题" }, { status: 400 });
    const mode = body.mode === "knowledge" ? "knowledge" : "reasoning";
    const defaultSpace = mode === "knowledge" && !body.knowledgeSpaceId
      ? await ensureDefaultKnowledgeSpace()
      : null;
    const session = await prisma.brainstormSession.create({
      data: {
        question: question.slice(0, 200),
        mode,
        knowledgeSpaceId: mode === "knowledge" ? body.knowledgeSpaceId || defaultSpace?.id : null,
        groundingPolicy: body.groundingPolicy === "assisted" ? "assisted" : "strict",
      },
    });
    return NextResponse.json({ id: session.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建失败" },
      { status: 400 },
    );
  }
}
