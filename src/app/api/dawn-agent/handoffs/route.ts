import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const SOURCE_TYPES = ["reading-selection", "reading-document", "knowledge", "reasoning"];

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const sourceType = text(body.sourceType, 40);
    const sourceTitle = text(body.sourceTitle, 240);
    if (!SOURCE_TYPES.includes(sourceType) || !sourceTitle) {
      return NextResponse.json({ error: "交接来源无效" }, { status: 400 });
    }
    const handoff = await prisma.dawnAgentHandoff.create({
      data: {
        sourceType,
        sourceTitle,
        sourcePath: text(body.sourcePath, 800) || null,
        sourceRef: text(body.sourceRef, 200) || null,
        selectedText: text(body.selectedText, 30_000) || null,
        context: text(body.context, 40_000) || null,
        instruction: text(body.instruction, 8_000) || null,
        metadata: body.metadata && typeof body.metadata === "object" ? body.metadata as never : undefined,
      },
    });
    return NextResponse.json(handoff, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "上下文交接失败" },
      { status: 400 },
    );
  }
}
