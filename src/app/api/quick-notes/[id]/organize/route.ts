import { NextRequest, NextResponse } from "next/server";
import { organizeNote } from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import { listOrganizeFolders } from "@/lib/vault-folders";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const note = await prisma.quickNote.findUnique({ where: { id } });
  if (!note) return NextResponse.json({ error: "便签不存在" }, { status: 404 });

  try {
    const suggestion = await organizeNote(note.content, listOrganizeFolders());
    const updated = await prisma.quickNote.update({
      where: { id },
      data: { aiMeta: JSON.stringify(suggestion) },
    });
    return NextResponse.json({ note: updated, suggestion });
  } catch (error) {
    if (error instanceof Error && error.message === "AI_NOT_CONFIGURED") {
      return NextResponse.json({ error: "AI 未配置。请在设置页配置 API Key。" }, { status: 503 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 整理失败" },
      { status: 500 },
    );
  }
}
