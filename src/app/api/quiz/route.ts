import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  computeNudge,
  isPaperId,
  listAllQuizSets,
  paperLabel,
  todayKey,
} from "@/lib/quiz";

export async function GET() {
  const days = listAllQuizSets();
  const states = await prisma.quizSetState.findMany();
  const stateMap = new Map(states.map((state) => [state.id, state]));
  const today = todayKey();

  const items = days.map(({ day }) => {
    const state = stateMap.get(day);
    const paper = isPaperId(day);
    const nudge = computeNudge(day, state?.status ?? "pending", state?.reminderStage ?? 0);
    return {
      day,
      label: paper ? paperLabel(day) : day,
      isPaper: paper,
      status: state?.status ?? "pending",
      completedAt: state?.completedAt ?? null,
      nudgeDue: nudge.due,
      nudgeStage: nudge.stage,
      isToday: !paper && day === today,
      isOverdue: !paper && day < today && (state?.status ?? "pending") !== "done",
    };
  });

  return NextResponse.json({ items });
}
