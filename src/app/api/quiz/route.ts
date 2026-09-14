import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeNudge, listQuizDays, todayKey } from "@/lib/quiz";

export async function GET() {
  const days = listQuizDays();
  const states = await prisma.quizSetState.findMany();
  const stateMap = new Map(states.map((state) => [state.id, state]));
  const today = todayKey();

  const items = days.map(({ day }) => {
    const state = stateMap.get(day);
    const nudge = computeNudge(day, state?.status ?? "pending", state?.reminderStage ?? 0);
    return {
      day,
      status: state?.status ?? "pending",
      completedAt: state?.completedAt ?? null,
      nudgeDue: nudge.due,
      nudgeStage: nudge.stage,
      isToday: day === today,
      isOverdue: day < today && (state?.status ?? "pending") !== "done",
    };
  });

  return NextResponse.json({ items });
}
