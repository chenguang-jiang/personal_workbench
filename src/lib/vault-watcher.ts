import chokidar, { type FSWatcher } from "chokidar";
import {
  deleteObsidianFile,
  getVaultConfig,
  isIgnoredVaultPath,
  syncObsidianFile,
  syncObsidianVault,
  type VaultSyncSummary,
} from "@/lib/obsidian-sync";

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

  private async handleChange(filePath: string, event: string) {
    if (!filePath.endsWith(".md")) return;
    try {
      const result = await syncObsidianFile(filePath);
      if (result.status === "skipped") return;
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
  }

  private async handleDelete(filePath: string) {
    try {
      const deleted = await deleteObsidianFile(filePath);
      if (!deleted) return;
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
  }

  async stop() {
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
