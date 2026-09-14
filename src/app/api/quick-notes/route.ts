import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const notes = await prisma.quickNote.findMany({
    where: status && status !== "all" ? { status } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ notes });
}

export async function POST(req: NextRequest) {
  const { content, images } = await req.json();
  const text = String(content ?? "").trim();
  const imageList = Array.isArray(images) ? images.map((item: unknown) => String(item)).slice(0, 9) : [];
  if (!text && imageList.length === 0) {
    return NextResponse.json({ error: "内容不能为空" }, { status: 400 });
  }
  const note = await prisma.quickNote.create({ data: { content: text, images: imageList } });
  return NextResponse.json({ note });
}
