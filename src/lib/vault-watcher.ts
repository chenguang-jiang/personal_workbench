import chokidar, { type FSWatcher } from "chokidar";
import {
  deleteObsidianFile,
  getVaultConfig,
  isIgnoredVaultPath,
  rebuildKnowledgeRelations,
  syncObsidianFile,
  syncObsidianVault,
  type VaultSyncSummary,
} from "@/lib/obsidian-sync";
import { invalidateVaultFolderCache } from "@/lib/obsidian-vault";

// 新增/删除/改名后完整重建关系的防抖窗口（尾触发）
const RELATION_REBUILD_DEBOUNCE_MS = 2000;

export type VaultWatcherState = "disabled" | "missing" | "starting" | "syncing" | "ready" | "error";

export type VaultWatcherStatus = {
  configured: boolean;
  available: boolean;
  vaultName: string;
  state: VaultWatcherState;
  watching: boolean;
  lastSyncAt: string | null;
  lastEvent: string | null;
  error: string | null;
};

class VaultWatcher {
  private watcher: FSWatcher | null = null;
  private state: VaultWatcherState = "disabled";
  private lastSyncAt: string | null = null;
  private lastEvent: string | null = null;
  private error: string | null = null;
  private syncPromise: Promise<VaultSyncSummary> | null = null;
  // 以下字段不带初始化器：热更新时旧实例只换原型、不重跑构造函数，需按需惰性创建
  private pathQueues?: Map<string, Promise<void>>;
  private rebuildTimer?: ReturnType<typeof setTimeout> | null;
  private rebuildPromise?: Promise<void> | null;
  private rebuildPending?: boolean;

  start() {
    if (this.watcher) return;
    const config = getVaultConfig();
    if (!config.configured) {
      this.state = "disabled";
      return;
    }
    if (!config.available) {
      this.state = "missing";
      this.error = "配置的 Vault 路径不存在";
      return;
    }

    this.state = "starting";
    this.error = null;
    this.watcher = chokidar.watch(config.vaultPath, {
      ignored: (candidatePath) => isIgnoredVaultPath(candidatePath),
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher
      .on("ready", () => {
        if (this.state === "starting") this.state = "ready";
      })
      .on("add", (filePath) => void this.handleChange(filePath, "新增"))
      .on("change", (filePath) => void this.handleChange(filePath, "更新"))
      .on("unlink", (filePath) => void this.handleDelete(filePath))
      .on("addDir", () => invalidateVaultFolderCache())
      .on("unlinkDir", () => invalidateVaultFolderCache())
      .on("error", (watchError) => {
        this.state = "error";
        this.error = watchError instanceof Error ? watchError.message : String(watchError);
        console.error("[VaultWatcher] 监听失败:", watchError);
      });

    console.log(`[VaultWatcher] 正在监听 ${config.vaultName}`);
    void this.syncNow().catch((syncError) => {
      console.error("[VaultWatcher] 首次同步失败:", syncError);
    });
  }

  getStatus(): VaultWatcherStatus {
    const config = getVaultConfig();
    return {
      configured: config.configured,
      available: config.available,
      vaultName: config.vaultName,
      state: config.configured ? (config.available ? this.state : "missing") : "disabled",
      watching: Boolean(this.watcher),
      lastSyncAt: this.lastSyncAt,
      lastEvent: this.lastEvent,
      error: this.error,
    };
  }

  async syncNow() {
    if (this.syncPromise) return this.syncPromise;
    this.state = "syncing";
    this.error = null;
    this.syncPromise = syncObsidianVault()
      .then((summary) => {
        this.state = "ready";
        this.lastSyncAt = summary.finishedAt;
        this.lastEvent = `完整同步：${summary.created} 新增 · ${summary.updated} 更新 · ${summary.deleted} 删除`;
        return summary;
      })
      .catch((syncError) => {
        this.state = "error";
        this.error = syncError instanceof Error ? syncError.message : String(syncError);
        throw syncError;
      })
      .finally(() => {
        this.syncPromise = null;
      });
    return this.syncPromise;
  }

  // 同一路径的事件串行处理，避免快速连续保存时读写交错
  private enqueue(filePath: string, task: () => Promise<void>) {
    const queues = (this.pathQueues ??= new Map());
    const previous = queues.get(filePath) ?? Promise.resolve();
    const next = previous.then(task, task);
    queues.set(filePath, next);
    void next.finally(() => {
      if (queues.get(filePath) === next) queues.delete(filePath);
    });
    return next;
  }

  // 尾触发防抖 + 单飞：窗口内多次新增/删除只重建一次；重建进行中再有请求则结束后补一次
  private scheduleRelationRebuild() {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      void this.runRelationRebuild();
    }, RELATION_REBUILD_DEBOUNCE_MS);
  }

  private async runRelationRebuild() {
    if (this.rebuildPromise) {
      this.rebuildPending = true;
      return this.rebuildPromise;
    }
    this.rebuildPromise = rebuildKnowledgeRelations()
      .then(() => undefined)
      .catch((rebuildError) => {
        this.error = rebuildError instanceof Error ? rebuildError.message : String(rebuildError);
        console.error("[VaultWatcher] 关系重建失败:", rebuildError);
      })
      .finally(() => {
        this.rebuildPromise = null;
        if (this.rebuildPending) {
          this.rebuildPending = false;
          this.scheduleRelationRebuild();
        }
      });
    return this.rebuildPromise;
  }

  private handleChange(filePath: string, event: string) {
    if (!filePath.endsWith(".md")) return Promise.resolve();
    invalidateVaultFolderCache();
    const isAdd = event === "新增";
    return this.enqueue(filePath, async () => {
      try {
        // 新增：不在单文件里重建关系，统一走防抖的完整重建；更新：只重算本文件出边
        const result = await syncObsidianFile(
          filePath,
          isAdd ? { rebuildRelations: false } : { relationScope: "node" },
        );
        if (result.status === "skipped") return;
        if (isAdd || result.status === "created" || result.titleChanged) {
          this.scheduleRelationRebuild();
        }
        this.state = "ready";
        this.lastSyncAt = new Date().toISOString();
        this.lastEvent = `${event}：${result.title}`;
        this.error = null;
        console.log(`[VaultWatcher] ${this.lastEvent}`);
      } catch (syncError) {
        this.state = "error";
        this.error = syncError instanceof Error ? syncError.message : String(syncError);
        console.error(`[VaultWatcher] 同步失败 ${filePath}:`, syncError);
      }
    });
  }

  private handleDelete(filePath: string) {
    invalidateVaultFolderCache();
    return this.enqueue(filePath, async () => {
      try {
        const deleted = await deleteObsidianFile(filePath);
        if (!deleted) return;
        // 删除节点会级联删边；其他文件的同名链接可能改指向别的节点，需完整重建
        this.scheduleRelationRebuild();
        this.state = "ready";
        this.lastSyncAt = new Date().toISOString();
        this.lastEvent = `删除：${filePath.split("/").pop()}`;
        this.error = null;
        console.log(`[VaultWatcher] ${this.lastEvent}`);
      } catch (deleteError) {
        this.state = "error";
        this.error = deleteError instanceof Error ? deleteError.message : String(deleteError);
        console.error(`[VaultWatcher] 删除同步失败 ${filePath}:`, deleteError);
      }
    });
  }

  async stop() {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = null;
    await this.watcher?.close();
    this.watcher = null;
    this.state = "disabled";
  }
}

const globalForVaultWatcher = globalThis as typeof globalThis & {
  __dawnkbVaultWatcher?: VaultWatcher;
};

const existingWatcher = globalForVaultWatcher.__dawnkbVaultWatcher;
if (existingWatcher) {
  // 热更新后旧实例的原型方法仍指向旧模块闭包，挂到新原型上才能用到新代码
  Object.setPrototypeOf(existingWatcher, VaultWatcher.prototype);
}

export const vaultWatcher = existingWatcher ?? new VaultWatcher();
globalForVaultWatcher.__dawnkbVaultWatcher = vaultWatcher;
