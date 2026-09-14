import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDefaultKnowledgeSpace } from "@/lib/knowledge-grounding";
import { fallbackBrainstormTitle } from "@/lib/brainstorm-title";

export const dynamic = "force-dynamic";

// GET /api/brainstorm — 会话列表（最新在前）
export async function GET() {
  const sessions = await prisma.brainstormSession.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      question: true,
      title: true,
      mode: true,
      knowledgeSpaceId: true,
      groundingPolicy: true,
      status: true,
      propositions: true,
      routes: true,
      summary: true,
      increments: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({
    sessions: sessions.map((session) => ({
      id: session.id,
      question: session.question,
      title: session.title || fallbackBrainstormTitle(session.question),
      mode: session.mode,
      knowledgeSpaceId: session.knowledgeSpaceId,
      groundingPolicy: session.groundingPolicy,
      status: session.status,
      propositions: Array.isArray(session.propositions) ? session.propositions.length : 0,
      routes: Array.isArray(session.routes) ? session.routes.length : 0,
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
    const body = (await req.json()) as {
      question?: string;
      mode?: "reasoning" | "knowledge";
      knowledgeSpaceId?: string;
      groundingPolicy?: "strict" | "assisted";
    };
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
