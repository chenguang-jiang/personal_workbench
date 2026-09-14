import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonicalProjectRoot } from "@/lib/dawn-agent-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const projects = await prisma.dawnAgentProject.findMany({
    where: { enabled: true },
    orderBy: { lastOpenedAt: "desc" },
    include: {
      sessions: {
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: {
          id: true,
          title: true,
          status: true,
          model: true,
          thinkingLevel: true,
          permissionMode: true,
          updatedAt: true,
        },
      },
    },
  });
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { rootPath?: string; name?: string };
    const realPath = canonicalProjectRoot(body.rootPath ?? "");
    const project = await prisma.dawnAgentProject.upsert({
      where: { realPath },
      update: {
        name: body.name?.trim().slice(0, 80) || path.basename(realPath),
        rootPath: body.rootPath?.trim() || realPath,
        enabled: true,
        lastOpenedAt: new Date(),
      },
      create: {
        name: body.name?.trim().slice(0, 80) || path.basename(realPath),
        rootPath: body.rootPath?.trim() || realPath,
        realPath,
      },
    });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "项目注册失败" },
      { status: 400 },
    );
  }
}
