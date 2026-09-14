import { syncObsidianVault } from "@/lib/obsidian-sync";

syncObsidianVault()
  .then((summary) => {
    console.log("Obsidian 同步完成", summary);
    process.exit(0);
  })
  .catch((e) => {
    console.error("同步失败:", e);
    process.exit(1);
  });
