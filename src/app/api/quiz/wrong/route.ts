import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listQuizDays, parseQuizSet } from "@/lib/quiz";

// GET /api/quiz/wrong — 错题本：跨题集汇总手动收录的错题
export async function GET() {
  const rows = await prisma.quizWrong.findMany({
    orderBy: { createdAt: "desc" },
  });
  if (rows.length === 0) return NextResponse.json({ items: [] });

  const sets = new Map(listQuizDays().map((entry) => [entry.day, entry.file]));
  const cache = new Map<
    string,
    ReturnType<typeof parseQuizSet> | null
  >();
  const items = [];
  for (const row of rows) {
    const file = sets.get(row.setId);
    if (!file) continue;
    if (!cache.has(row.setId)) {
      try {
        cache.set(row.setId, parseQuizSet(file, row.setId));
      } catch {
        cache.set(row.setId, null);
      }
    }
    const set = cache.get(row.setId);
    const question = set?.questions.find((item) => item.index === row.qIndex);
    if (!set || !question) continue;
    items.push({
      setId: row.setId,
      qIndex: row.qIndex,
      createdAt: row.createdAt,
      setTitle: set.title,
      question,
    });
  }
  return NextResponse.json({ items });
}
