import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DEFAULT_USER_EMAIL = "creator@workbench.local";

async function getDefaultUserId() {
  const user = await prisma.user.upsert({
    where: { email: DEFAULT_USER_EMAIL },
    update: {},
    create: { email: DEFAULT_USER_EMAIL, name: "创作者" },
  });
  return user.id;
}

export async function GET() {
  const userId = await getDefaultUserId();
  const topics = await prisma.topic.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json(topics);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const title = String(body.title || "").trim();
  if (!title) {
    return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  }

  const userId = await getDefaultUserId();
  const topic = await prisma.$transaction(async (tx) => {
    const created = await tx.topic.create({
      data: {
        title,
        description: body.description,
        angles: body.angles || [],
        source: body.source || "manual",
        sourceId: body.sourceId,
        userId,
      },
    });

    if (body.source === "comment" && body.sourceId) {
      await tx.comment.updateMany({
        where: { id: body.sourceId, userId },
        data: { relatedTopicId: created.id },
      });
    }

    return created;
  });

  return NextResponse.json(topic, { status: 201 });
}
