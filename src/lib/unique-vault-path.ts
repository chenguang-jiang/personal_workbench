import fs from "node:fs";
import path from "node:path";
import { resolveWorkbenchVaultPath } from "@/lib/vault-folders";

const MAX_SUFFIX = 100;

/** 文件已存在时依次尝试 name-2.md、name-3.md…，返回第一个未被占用的绝对路径。 */
export function uniqueAbsolutePath(absolutePath: string): string {
  if (!fs.existsSync(absolutePath)) return absolutePath;
  const extension = path.extname(absolutePath);
  const base = absolutePath.slice(0, absolutePath.length - extension.length);
  for (let index = 2; index < MAX_SUFFIX; index += 1) {
    const next = `${base}-${index}${extension}`;
    if (!fs.existsSync(next)) return next;
  }
  throw new Error("同名文件过多，请修改名称后再试");
}

/** 在 JCG 工作区内解析一个尚未被占用的路径（同名时追加 -2、-3…）。 */
export function uniqueWorkbenchVaultPath(relativePath: string): {
  absolutePath: string;
  relativePath: string;
} {
  const resolved = resolveWorkbenchVaultPath(relativePath);
  if (!fs.existsSync(resolved.absolutePath)) return resolved;
  const extension = path.extname(relativePath);
  const base = relativePath.slice(0, relativePath.length - extension.length);
  for (let index = 2; index < MAX_SUFFIX; index += 1) {
    const next = resolveWorkbenchVaultPath(`${base}-${index}${extension}`);
    if (!fs.existsSync(next.absolutePath)) return next;
  }
  throw new Error("同名回写记录过多，请修改会话名称后再试");
}
