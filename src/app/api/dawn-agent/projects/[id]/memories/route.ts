import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const KINDS = ["fact", "decision", "preference", "workflow"];

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const memories = await prisma.dawnAgentMemory.findMany({
    where: { projectId: id },
    orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }],
  });
  return NextResponse.json({ memories });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const project = await prisma.dawnAgentProject.findFirst({ where: { id, enabled: true } });
    if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    const body = (await req.json()) as {
      title?: string;
      content?: string;
      kind?: string;
      sourceType?: string;
      sourceRef?: string;
    };
    const title = body.title?.trim().slice(0, 120);
    const content = body.content?.trim().slice(0, 12_000);
    if (!title || !content) return NextResponse.json({ error: "记忆标题和内容不能为空" }, { status: 400 });
    const memory = await prisma.dawnAgentMemory.create({
      data: {
        projectId: id,
        title,
        content,
        kind: KINDS.includes(body.kind ?? "") ? body.kind! : "fact",
        sourceType: body.sourceType?.trim().slice(0, 40) || "manual",
        sourceRef: body.sourceRef?.trim().slice(0, 200) || null,
      },
    });
    return NextResponse.json(memory, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "项目记忆保存失败" },
      { status: 400 },
    );
  }
}
