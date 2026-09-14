export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    process.env.OBSIDIAN_VAULT_PATH
  ) {
    const { vaultWatcher } = await import("@/lib/vault-watcher");
    vaultWatcher.start();
  }
}
