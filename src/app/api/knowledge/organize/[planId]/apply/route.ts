import { NextResponse } from "next/server";
import { invalidJsonResponse, readJsonObject } from "@/lib/request-body";
import { getOrganizePlan, planSnapshot, updateOrganizePlan } from "@/lib/organize/store";
import { applyOrganizeItems, enqueueOrganize, organizeAvailable } from "@/lib/organize/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/knowledge/organize/[planId]/apply — 应用勾选的整理条目。
// 请求体只带条目 id 数组；真实路径一律从服务端存的方案里读，绝不接受客户端传路径。
export async function POST(
  req: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  if (!organizeAvailable()) {
    return NextResponse.json({ error: "Vault 不可用或当前模式不允许整理" }, { status: 403 });
  }
  const { planId } = await params;
  const body = await readJsonObject<{ itemIds?: unknown }>(req);
  if (!body || !Array.isArray(body.itemIds)) return invalidJsonResponse();
  const itemIds = [...new Set(body.itemIds.filter((id): id is string => typeof id === "string"))];
  if (itemIds.length === 0) {
    return NextResponse.json({ error: "没有勾选任何条目" }, { status: 400 });
  }

  const plan = getOrganizePlan(planId);
  if (!plan) return NextResponse.json({ error: "整理方案不存在或已过期" }, { status: 404 });
  if (plan.status === "running") {
    return NextResponse.json({ error: "整理还在进行中，请稍候" }, { status: 409 });
  }
  if (plan.status === "error") {
    return NextResponse.json({ error: plan.error || "整理任务失败，请重新发起" }, { status: 409 });
  }

  const idSet = new Set(itemIds);
  const selected = plan.items.filter((item) => idSet.has(item.id));
  if (selected.length === 0) {
    return NextResponse.json({ error: "勾选的条目不在方案中" }, { status: 400 });
  }

  // 应用可能涉及多次文件移动 + 数据库写，与扫描共用同一条串行队列防并发
  const results = await enqueueOrganize(() => applyOrganizeItems(selected));

  const appliedIds = new Set(results.filter((result) => result.ok).map((result) => result.id));
  const remainingItems = plan.items.filter((item) => !appliedIds.has(item.id));
  updateOrganizePlan(planId, {
    items: remainingItems,
    stats: {
      ...plan.stats,
      duplicates: remainingItems.filter((item) => item.kind === "duplicate").length,
      useless: remainingItems.filter((item) => item.kind === "useless").length,
      reclassify: remainingItems.filter((item) => item.kind === "reclassify").length,
    },
    appliedAt: new Date().toISOString(),
  });

  return NextResponse.json({
    results,
    applied: appliedIds.size,
    failed: results.length - appliedIds.size,
    remaining: plan.items.length - appliedIds.size,
    ...planSnapshot(getOrganizePlan(planId)!),
  });
}
