import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeNudge, gradeQuiz, listQuizDays, parseQuizSet } from "@/lib/quiz";

async function loadSet(day: string) {
  const entry = listQuizDays().find((item) => item.day === day);
  if (!entry) return null;
  return parseQuizSet(entry.file, day);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  const set = await loadSet(day);
  if (!set) return NextResponse.json({ error: "题集不存在" }, { status: 404 });

  const state = await prisma.quizSetState.upsert({
    where: { id: day },
    create: { id: day },
    update: {},
  });
  const answers = await prisma.quizAnswer.findMany({ where: { setId: day } });
  const wrongRows = await prisma.quizWrong.findMany({ where: { setId: day } });
  const nudge = computeNudge(day, state.status, state.reminderStage);
  return NextResponse.json({
    set,
    state,
    answers,
    nudge,
    wrong: wrongRows.map((row) => row.qIndex),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  const body = await req.json();
  const set = await loadSet(day);
  if (!set) return NextResponse.json({ error: "题集不存在" }, { status: 404 });

  if (body.action === "answer") {
    const question = set.questions[Number(body.qIndex)];
    if (!question) {
      return NextResponse.json({ error: "题目不存在" }, { status: 400 });
    }

    // 案例/问答题：记录自答内容，查看答案解析对照
    if (question.type === "essay") {
      const mine = String(body.mine ?? "").trim();
      if (!mine) {
        return NextResponse.json({ error: "请先写下你的作答" }, { status: 400 });
      }
      await prisma.quizAnswer.upsert({
        where: { setId_qIndex: { setId: day, qIndex: question.index } },
        create: { setId: day, qIndex: question.index, choice: "SELF", correct: true },
        update: { choice: "SELF", correct: true },
      });
      const answers = await prisma.quizAnswer.findMany({ where: { setId: day } });
      const current = await prisma.quizSetState.findUnique({ where: { id: day } });
      const state = await prisma.quizSetState.upsert({
        where: { id: day },
        create: { id: day, status: "doing" },
        update: { status: current?.status === "done" ? "done" : "doing" },
      });
      const nudge = computeNudge(day, state.status, state.reminderStage);
      return NextResponse.json({ state, answers, nudge });
    }

    const choice = String(body.choice ?? "")
      .toUpperCase()
      .split("")
      .filter((key) => /[A-Z]/.test(key))
      .sort()
      .join("");
    const validKeys =
      choice.length > 0 &&
      choice.split("").every((key) => question.options.some((option) => option.key === key));
    if (!validKeys) {
      return NextResponse.json({ error: "选项不存在" }, { status: 400 });
    }
    const correct = gradeQuiz(choice, question.answer);
    await prisma.quizAnswer.upsert({
      where: { setId_qIndex: { setId: day, qIndex: question.index } },
      create: { setId: day, qIndex: question.index, choice, correct },
      update: { choice, correct },
    });

    const all = await prisma.quizAnswer.findMany({ where: { setId: day } });
    const allCorrect = set.questions.every((item) =>
      all.some((answer) => answer.qIndex === item.index && answer.correct),
    );
    const current = await prisma.quizSetState.findUnique({ where: { id: day } });
    const nextStatus = allCorrect ? "done" : current?.status === "pending" ? "doing" : current?.status ?? "doing";
    const state = await prisma.quizSetState.upsert({
      where: { id: day },
      create: { id: day, status: nextStatus, completedAt: allCorrect ? new Date() : null },
      update: { status: nextStatus, completedAt: allCorrect ? new Date() : current?.completedAt ?? null },
    });
    const answers = await prisma.quizAnswer.findMany({ where: { setId: day } });
    const nudge = computeNudge(day, state.status, state.reminderStage);
    return NextResponse.json({ state, answers, nudge });
  }

  if (body.action === "wrong") {
    const qIndex = Number(body.qIndex);
    if (!set.questions.some((item) => item.index === qIndex)) {
      return NextResponse.json({ error: "题目不存在" }, { status: 400 });
    }
    const on = body.on !== false;
    if (on) {
      await prisma.quizWrong.upsert({
        where: { setId_qIndex: { setId: day, qIndex } },
        create: { setId: day, qIndex },
        update: {},
      });
    } else {
      await prisma.quizWrong.deleteMany({ where: { setId: day, qIndex } });
    }
    const wrongRows = await prisma.quizWrong.findMany({ where: { setId: day } });
    return NextResponse.json({ wrong: wrongRows.map((row) => row.qIndex) });
  }

  if (body.action === "status") {
    const done = body.status === "done";
    const state = await prisma.quizSetState.upsert({
      where: { id: day },
      create: { id: day, status: done ? "done" : "pending", completedAt: done ? new Date() : null },
      update: { status: done ? "done" : "pending", completedAt: done ? new Date() : null },
    });
    const answers = await prisma.quizAnswer.findMany({ where: { setId: day } });
    const nudge = computeNudge(day, state.status, state.reminderStage);
    return NextResponse.json({ state, answers, nudge });
  }

  if (body.action === "nudge") {
    const nudgeNow = computeNudge(day, "pending", 0);
    const state = await prisma.quizSetState.upsert({
      where: { id: day },
      create: { id: day, reminderStage: nudgeNow.stage, lastNudgedAt: new Date() },
      update: { reminderStage: nudgeNow.stage, lastNudgedAt: new Date() },
    });
    const nudge = computeNudge(day, state.status, state.reminderStage);
    return NextResponse.json({ state, nudge });
  }

  if (body.action === "retry") {
    await prisma.quizAnswer.deleteMany({ where: { setId: day, correct: false } });
    const answers = await prisma.quizAnswer.findMany({ where: { setId: day } });
    const allCorrect = set.questions.every((item) =>
      answers.some((answer) => answer.qIndex === item.index && answer.correct),
    );
    const state = await prisma.quizSetState.upsert({
      where: { id: day },
      create: { id: day, status: allCorrect ? "done" : "doing" },
      update: { status: allCorrect ? "done" : "doing", completedAt: allCorrect ? new Date() : null },
    });
    const nudge = computeNudge(day, state.status, state.reminderStage);
    return NextResponse.json({ state, answers, nudge });
  }

  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}
