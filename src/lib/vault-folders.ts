import fs from "node:fs";
import path from "node:path";
import { getVaultConfig } from "@/lib/obsidian-sync";

/** 随手记内容根目录（vault 内的 JCG 工作区） */
export function getWorkbenchRoot(): string | null {
  const { vaultPath, available } = getVaultConfig();
  if (!available || !vaultPath) return null;
  const root = path.join(vaultPath, "JCG");
  return fs.existsSync(root) ? root : vaultPath;
}

/** 把相对工作区路径解析到真实 JCG Vault，并返回相对总配置根的路径。 */
export function resolveWorkbenchVaultPath(relativePath: string) {
  const root = getWorkbenchRoot();
  const { vaultPath } = getVaultConfig();
  if (!root || !vaultPath) throw new Error("Obsidian JCG 工作区不可用");
  const cleanPath = relativePath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (cleanPath.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("无效的工作区路径");
  }
  const absolutePath = path.resolve(root, cleanPath);
  const inside = path.relative(root, absolutePath);
  if (inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new Error("路径超出 JCG 工作区");
  }
  return {
    absolutePath,
    relativePath: path.relative(vaultPath, absolutePath).split(path.sep).join("/"),
  };
}

const SKIP_FOLDERS = new Set(["附件", "templates", "90-归档", "_archive", "node_modules"]);

/** 递归列出可归档文件夹（相对 JCG 根，深度 ≤ 2），供 AI 建议与归档写入使用 */
export function listOrganizeFolders(): string[] {
  const detected = getWorkbenchRoot();
  if (!detected) return ["00-Inbox"];
  const root: string = detected;
  const result: string[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 2) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_FOLDERS.has(entry.name)) continue;
      const rel = path.relative(root, path.join(dir, entry.name));
      result.push(rel);
      walk(path.join(dir, entry.name), depth + 1);
    }
  }

  walk(root, 1);
  result.unshift("00-Inbox");
  return result;
}

/** 把 AI 建议的 folder 字符串安全地解析为根目录下的真实子路径 */
export function resolveOrganizeFolder(folder: string): { rel: string; abs: string } | null {
  const root = getWorkbenchRoot();
  if (!root) return null;
  const cleaned = folder
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  const abs = path.resolve(root, cleaned || "00-Inbox");
  if (!abs.startsWith(root + path.sep) && abs !== root) return null;
  return { rel: path.relative(root, abs) || ".", abs };
}
