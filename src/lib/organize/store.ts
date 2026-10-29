import { randomUUID } from "node:crypto";
import type { OrganizePlan } from "./types";

/**
 * 整理方案的内存存储。
 *
 * 不加 Prisma 模型是有意的：生成的客户端被烘焙进云端 Docker 镜像，
 * Dockerfile.update 只替换 .next，改 schema 会让云端运行时直接崩掉。
 * 方案本身是短命的（生成 → 勾选 → 应用），进程重启丢掉正在进行的方案
 * 只是需要重扫一次，不损失任何用户数据。
 */

const MAX_PLANS = 5;
const PLAN_TTL_MS = 2 * 60 * 60 * 1000;
// 运行中方案的兜底时限：正常一轮扫描 + 3 批 AI 最多几分钟，超过即视为僵尸
// （dev 热更新丢弃 after() 回调等情况），不再阻塞新任务
const RUNNING_STALE_MS = 15 * 60 * 1000;

// 挂 globalThis：热更新与路由模块可能持有不同模块实例，需共享同一份状态
const globalForOrganize = globalThis as typeof globalThis & {
  __dawnkbOrganizePlans?: Map<string, OrganizePlan & { touchedAt: number }> | null;
};

function plans(): Map<string, OrganizePlan & { touchedAt: number }> {
  if (!globalForOrganize.__dawnkbOrganizePlans) {
    globalForOrganize.__dawnkbOrganizePlans = new Map();
  }
  return globalForOrganize.__dawnkbOrganizePlans;
}

function prune() {
  const store = plans();
  const now = Date.now();
  for (const [id, plan] of store) {
    if (now - plan.touchedAt > PLAN_TTL_MS) store.delete(id);
  }
  while (store.size > MAX_PLANS) {
    // Map 迭代顺序即插入顺序，最旧的先淘汰；running 的方案不淘汰
    const oldest = [...store.entries()].find(([, plan]) => plan.status !== "running");
    if (!oldest) break;
    store.delete(oldest[0]);
  }
}

export function createOrganizePlan(): OrganizePlan {
  prune();
  const plan: OrganizePlan & { touchedAt: number } = {
    id: randomUUID(),
    status: "running",
    progress: 0,
    items: [],
    stats: { scanned: 0, duplicates: 0, useless: 0, reclassify: 0, remaining: 0 },
    createdAt: new Date().toISOString(),
    touchedAt: Date.now(),
  };
  plans().set(plan.id, plan);
  return plan;
}

export function getOrganizePlan(id: string): OrganizePlan | null {
  const plan = plans().get(id);
  return plan ?? null;
}

/** 把超时未更新的 running 方案标记为失败，避免僵尸任务永久阻塞新扫描 */
function sweepStaleRunning() {
  const now = Date.now();
  for (const plan of plans().values()) {
    if (plan.status === "running" && now - plan.touchedAt > RUNNING_STALE_MS) {
      plan.status = "error";
      plan.error = "整理任务长时间无响应，已自动终止，请重新发起";
      plan.touchedAt = now;
    }
  }
}

export function hasRunningOrganizePlan(): boolean {
  sweepStaleRunning();
  return [...plans().values()].some((plan) => plan.status === "running");
}

/** 当前正在运行的方案（同一时刻最多一个），供"重新打开对话框时接上进行中的任务" */
export function getRunningOrganizePlan(): OrganizePlan | null {
  sweepStaleRunning();
  return [...plans().values()].find((plan) => plan.status === "running") ?? null;
}

/** 原地更新方案（store 里的对象就是引用，直接改字段即可） */
export function updateOrganizePlan(id: string, patch: Partial<Omit<OrganizePlan, "id">>): OrganizePlan | null {
  const plan = plans().get(id);
  if (!plan) return null;
  Object.assign(plan, patch, { touchedAt: Date.now() });
  return plan;
}

/** 返回给前端的方案快照（去掉内部字段） */
export function planSnapshot(plan: OrganizePlan) {
  return {
    id: plan.id,
    status: plan.status,
    progress: plan.progress,
    items: plan.items,
    stats: plan.stats,
    error: plan.error ?? null,
    createdAt: plan.createdAt,
    appliedAt: plan.appliedAt ?? null,
  };
}
