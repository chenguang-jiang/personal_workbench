import { NextResponse } from "next/server";
import { getOrganizePlan, planSnapshot } from "@/lib/organize/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/knowledge/organize/[planId] — 轮询整理方案的进度与结果
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
  const plan = getOrganizePlan(planId);
  if (!plan) {
    return NextResponse.json({ error: "整理方案不存在或已过期，请重新发起整理" }, { status: 404 });
  }
  return NextResponse.json(planSnapshot(plan));
}
