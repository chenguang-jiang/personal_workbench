import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (typeof body.content === "string") data.content = body.content.trim();
  if (typeof body.status === "string") data.status = body.status;
  if (Array.isArray(body.tags)) data.tags = body.tags.map((tag: unknown) => String(tag));
  if (Array.isArray(body.images)) data.images = body.images.map((item: unknown) => String(item)).slice(0, 9);
  if (typeof body.aiMeta === "string") data.aiMeta = body.aiMeta;
  if (body.aiMeta === null) data.aiMeta = null;

  const note = await prisma.quickNote.update({ where: { id }, data });
  return NextResponse.json({ note });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await prisma.quickNote.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
