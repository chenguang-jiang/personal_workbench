import fs from "node:fs";
import path from "node:path";
import { getVaultConfig, deleteObsidianFile, relocateObsidianFile } from "@/lib/obsidian-sync";
import { invalidateVaultFolderCache } from "@/lib/obsidian-vault";
import { moveToTrash } from "@/lib/vault-trash";
import { cloudImportEnabled } from "@/lib/cloud/knowledge-import";
import { isCloudMode } from "@/lib/cloud/config";
import { CLASSIFY_BUDGET, classifyWithAi } from "./ai-classify";
import { scanOrganizeCandidates } from "./scan";
import { createOrganizePlan, updateOrganizePlan } from "./store";
import type { OrganizeApplyResult, OrganizeItem, OrganizePlan } from "./types";

/** 功能可用性：Vault 可用，且（本地模式 或 云端导入开关打开），与导入功能同一口径 */
export function organizeAvailable(): boolean {
  return getVaultConfig().available && (!isCloudMode() || cloudImportEnabled());
}

/**
 * 整理任务的后台执行与应用。
 *
 * 扫描 + 多批 AI 归类会跑几十秒到几分钟，绝不能在同步 HTTP 请求里做
 * （反代理会掐断）。`startOrganizePlan` 立即建方案并返回，真正的工作由
 * 调用方用 next/server 的 `after()` 脱离请求执行；`organizeQueue` 串行化，
 * 同一时刻只跑一个整理任务，避免并发扫描/AI 调用互相踩踏。
 */

let organizeQueue: Promise<unknown> = Promise.resolve();

/** 把一次整理工作排到串行队列尾部执行，返回工作本身的结果 */
export function enqueueOrganize<T>(work: () => Promise<T>): Promise<T> {
  const result = organizeQueue.then(work);
  organizeQueue = result.catch(() => undefined);
  return result;
}

/** 新建一条方案记录（running），立即返回给前端轮询 */
export function startOrganizePlan(): OrganizePlan {
  return createOrganizePlan();
}

/** 后台执行：确定性扫描 → AI 归类 → 写入方案。供 after() 调用 */
export async function runOrganizePlan(planId: string): Promise<void> {
  try {
    updateOrganizePlan(planId, { progress: 5 });
    const scan = await scanOrganizeCandidates();

    const duplicates = scan.items.filter((item) => item.kind === "duplicate").length;
    const useless = scan.items.filter((item) => item.kind === "useless").length;
    updateOrganizePlan(planId, {
      progress: 40,
      stats: {
        scanned: scan.scanned,
        duplicates,
        useless,
        reclassify: 0,
        remaining: Math.max(0, scan.classifyCandidates.length - CLASSIFY_BUDGET),
      },
    });

    // AI 归类是"锦上添花"：不可用时确定性结果照常返回
    const classifyItems = await classifyWithAi(scan.classifyCandidates, (done) => {
      updateOrganizePlan(planId, { progress: 40 + Math.round((done / Math.max(1, scan.classifyCandidates.length)) * 55) });
    });

    const items = [...scan.items, ...classifyItems];
    updateOrganizePlan(planId, {
      status: "ready",
      progress: 100,
      items,
      stats: {
        scanned: scan.scanned,
        duplicates,
        useless,
        reclassify: classifyItems.length,
        remaining: Math.max(0, scan.classifyCandidates.length - CLASSIFY_BUDGET),
      },
    });
  } catch (error) {
    console.error("[organize] 扫描失败:", error);
    updateOrganizePlan(planId, {
      status: "error",
      progress: 100,
      error: error instanceof Error ? error.message : "整理扫描失败",
    });
  }
}

function vaultAbs(relativePath: string): string {
  const config = getVaultConfig();
  if (!config.available || !config.vaultPath) throw new Error("Obsidian Vault 不可用");
  const root = fs.realpathSync(/* turbopackIgnore: true */ config.vaultPath);
  const abs = path.resolve(root, relativePath);
  const inside = path.relative(root, abs);
  if (inside.startsWith("..") || path.isAbsolute(inside)) throw new Error("路径超出 Obsidian Vault");
  return abs;
}

/**
 * 应用勾选的条目。真实路径一律从服务端存的方案里读（items 参数是完整条目，
 * 由路由按客户端传来的 id 从方案中取出），绝不接受客户端传路径 ——
 * 这是云端暴露下最关键的一道防线。
 *
 * - delete：移入回收站 → deleteObsidianFile 清 Article（级联标注/笔记/分片）
 * - move：relocateObsidianFile（DB 先行保 Article id）
 */
export async function applyOrganizeItems(items: OrganizeItem[]): Promise<OrganizeApplyResult[]> {
  const results: OrganizeApplyResult[] = [];
  for (const item of items) {
    try {
      if (item.action === "delete") {
        const abs = vaultAbs(item.vaultPath);
        moveToTrash(item.vaultPath);
        // 文件已进回收站；deleteObsidianFile 只按路径算 url 清记录，传原路径即可。
        // watcher 随后收到 unlink 时记录已不在，返回 false，无害。
        await deleteObsidianFile(abs);
      } else if (item.action === "move") {
        if (!item.targetPath) throw new Error("缺少目标路径");
        await relocateObsidianFile(vaultAbs(item.vaultPath), vaultAbs(item.targetPath));
      } else {
        throw new Error("未知的整理动作");
      }
      results.push({ id: item.id, ok: true });
    } catch (error) {
      results.push({
        id: item.id,
        ok: false,
        error: error instanceof Error ? error.message : "应用失败",
      });
    }
  }
  invalidateVaultFolderCache();
  return results;
}
