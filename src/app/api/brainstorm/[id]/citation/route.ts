import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const citationId = req.nextUrl.searchParams.get("citationId");
  const messageIndex = Number(req.nextUrl.searchParams.get("messageIndex") ?? "-1");
  const session = await prisma.brainstormSession.findUnique({
    where: { id },
    select: { citations: true },
  });
  if (!session) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  const citations = Array.isArray(session.citations)
    ? (session.citations as Array<Record<string, unknown>>)
    : [];
  const citation = citations.find(
    (item) =>
      item.id === citationId &&
      (messageIndex < 0 || Number(item.messageIndex) === messageIndex),
  );
  if (!citation) return NextResponse.json({ error: "引用不存在" }, { status: 404 });
  return NextResponse.json(citation);
}
