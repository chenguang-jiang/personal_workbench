import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

// `![[name.png]]` 只给文件名时需要在整个 vault 里按名查找。
// 一篇文章可能嵌入几十张图：每次请求都同步遍历整个 vault 会阻塞事件循环，
// 这里异步建一次「文件名 → 路径」索引，短时间内复用。
const INDEX_TTL_MS = 30_000;
// 刚建好的索引不再为未命中重建，避免一页里多张缺失图片反复遍历
const MIN_REBUILD_INTERVAL_MS = 1_000;

type AssetIndex = {
  root: string;
  builtAt: number;
  byName: Map<string, string>;
};

let cached: AssetIndex | null = null;
let pending: Promise<AssetIndex> | null = null;

async function buildIndex(root: string): Promise<AssetIndex> {
  const byName = new Map<string, string>();
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(/* turbopackIgnore: true */ dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (!byName.has(entry.name)) {
        byName.set(entry.name, full);
      }
    }
  }
  return { root, builtAt: Date.now(), byName };
}

async function getIndex(root: string, forceRefresh: boolean): Promise<AssetIndex> {
  const isFresh = cached && cached.root === root && Date.now() - cached.builtAt < INDEX_TTL_MS;
  if (cached && isFresh && !forceRefresh) return cached;
  if (!pending) {
    pending = buildIndex(root)
      .then((index) => {
        cached = index;
        return index;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(/* turbopackIgnore: true */ filePath)).isFile();
  } catch {
    return false;
  }
}

/** 按文件名在 vault 内查找资源；缓存未命中或已失效时重建一次索引再查。 */
export async function findVaultAssetByName(root: string, name: string): Promise<string | null> {
  const index = await getIndex(root, false);
  const hit = index.byName.get(name);
  if (hit && (await isFile(hit))) return hit;

  // 新加入的图片或已移动的文件：缓存可能过期，刷新后再试一次
  if (Date.now() - index.builtAt < MIN_REBUILD_INTERVAL_MS) return null;
  const refreshed = await getIndex(root, true);
  return refreshed.byName.get(name) ?? null;
}
