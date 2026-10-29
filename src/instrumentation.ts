export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    process.env.OBSIDIAN_VAULT_PATH
  ) {
    const { vaultWatcher } = await import("@/lib/vault-watcher");
    if (process.env.DAWNKB_MODE === "cloud" && process.env.DAWNKB_CLOUD_IMPORT === "1") {
      await vaultWatcher.syncNow();
    } else {
      vaultWatcher.start();
    }
  }
}
