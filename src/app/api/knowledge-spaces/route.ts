import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureDefaultKnowledgeSpace, parseKnowledgeScope } from "@/lib/knowledge-grounding";
import { invalidJsonResponse, readJsonObject } from "@/lib/request-body";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDefaultKnowledgeSpace();
  const spaces = await prisma.knowledgeSpace.findMany({
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    include: { _count: { select: { brainstormSessions: true } } },
  });
  return NextResponse.json({ spaces });
}

export async function POST(req: NextRequest) {
  const body = await readJsonObject<{
    name?: string;
    description?: string;
    scope?: unknown;
    isDefault?: boolean;
  }>(req);
  if (!body) return invalidJsonResponse();
  const name = body.name?.trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: "知识空间名称不能为空" }, { status: 400 });
  if (body.isDefault) {
    await prisma.knowledgeSpace.updateMany({ data: { isDefault: false } });
  }
  const space = await prisma.knowledgeSpace.create({
    data: {
      name,
      description: body.description?.trim().slice(0, 500) || null,
      scope: parseKnowledgeScope(body.scope),
      isDefault: Boolean(body.isDefault),
    },
  });
  return NextResponse.json(space, { status: 201 });
}
