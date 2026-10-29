import { after, NextResponse } from "next/server";
import { getRunningOrganizePlan, hasRunningOrganizePlan, planSnapshot } from "@/lib/organize/store";
import { enqueueOrganize, organizeAvailable, runOrganizePlan, startOrganizePlan } from "@/lib/organize/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/knowledge/organize — 启动一轮 AI 整理扫描，立即返回 planId 供前端轮询。
// 扫描 + 多批 AI 归类要跑几十秒到几分钟，实际工作用 after() 脱离请求执行，
// 并由模块级串行队列保证同一时刻只有一个整理任务。
// 已有任务在跑时返回 409 并附带运行中的 planId，让重开的对话框直接接上进度。
export async function POST() {
  if (!organizeAvailable()) {
    return NextResponse.json({ error: "Vault 不可用或当前模式不允许整理" }, { status: 403 });
  }
  if (hasRunningOrganizePlan()) {
    const running = getRunningOrganizePlan();
    return NextResponse.json(
      { ...planSnapshot(running!), error: "已有一个整理任务在运行，请等它完成", runningPlanId: running?.id ?? null },
      { status: 409 },
    );
  }
  const plan = startOrganizePlan();
  after(() => {
    enqueueOrganize(() => runOrganizePlan(plan.id)).catch((error) => {
      console.error("[organize] 后台整理任务异常:", error);
    });
  });
  return NextResponse.json({ planId: plan.id, ...planSnapshot(plan) });
}
