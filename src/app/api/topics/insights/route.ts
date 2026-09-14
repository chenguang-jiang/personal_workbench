import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DEFAULT_USER_EMAIL = "creator@workbench.local";

interface InsightExample {
  id: string;
  content: string;
  author: string;
  platform: string;
  sentiment: string | null;
  createdAt: Date;
  relatedTopicId: string | null;
}

interface InsightAccumulator {
  id: string;
  title: string;
  evidenceCount: number;
  platforms: Set<string>;
  sentiments: Record<string, number>;
  examples: InsightExample[];
  relatedTopicIds: Set<string>;
}

export async function GET(request: NextRequest) {
  const user = await prisma.user.findUnique({
    where: { email: DEFAULT_USER_EMAIL },
    select: { id: true },
  });

  if (!user) {
    return NextResponse.json({ totalComments: 0, groups: [] });
  }

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform") || "all";
  const sentiment = searchParams.get("sentiment") || "all";

  const comments = await prisma.comment.findMany({
    where: {
      userId: user.id,
      ...(platform !== "all" && { platform }),
      ...(sentiment !== "all" && { sentiment }),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      content: true,
      author: true,
      platform: true,
      sentiment: true,
      keywordTags: true,
      createdAt: true,
      relatedTopicId: true,
    },
  });

  const groups = new Map<string, InsightAccumulator>();

  for (const comment of comments) {
    const labels = comment.keywordTags.length
      ? Array.from(new Set(comment.keywordTags.map((tag) => tag.trim()).filter(Boolean)))
      : ["待归类反馈"];

    for (const label of labels) {
      const id = label === "待归类反馈" ? "uncategorized" : encodeURIComponent(label.toLowerCase());
      const current = groups.get(id) ?? {
        id,
        title: label,
        evidenceCount: 0,
        platforms: new Set<string>(),
        sentiments: { positive: 0, neutral: 0, negative: 0 },
        examples: [],
        relatedTopicIds: new Set<string>(),
      };

      current.evidenceCount += 1;
      current.platforms.add(comment.platform);
      current.sentiments[comment.sentiment || "neutral"] =
        (current.sentiments[comment.sentiment || "neutral"] || 0) + 1;
      if (comment.relatedTopicId) current.relatedTopicIds.add(comment.relatedTopicId);
      if (current.examples.length < 4) current.examples.push(comment);
      groups.set(id, current);
    }
  }

  const result = Array.from(groups.values())
    .sort((left, right) => right.evidenceCount - left.evidenceCount || left.title.localeCompare(right.title, "zh-CN"))
    .slice(0, 12)
    .map((group) => ({
      id: group.id,
      title: group.title,
      evidenceCount: group.evidenceCount,
      platforms: Array.from(group.platforms),
      sentiments: group.sentiments,
      examples: group.examples,
      relatedTopicIds: Array.from(group.relatedTopicIds),
    }));

  return NextResponse.json({ totalComments: comments.length, groups: result });
}
