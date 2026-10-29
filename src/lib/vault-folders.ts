import fs from "node:fs";
import path from "node:path";
import { deleteObsidianFile, getVaultConfig, isIgnoredVaultPath } from "@/lib/obsidian-sync";
import { DEFAULT_FOLDERS, invalidateVaultFolderCache, resolveVaultPath } from "@/lib/obsidian-vault";
import { moveFolderToTrash } from "@/lib/vault-trash";

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
  // 拒绝 . / .. 与隐藏段（如 .obsidian），避免写入 Obsidian 配置目录
  if (cleanPath.split("/").some((part) => part.startsWith("."))) {
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
  // walk 已产出 00-Inbox 时不重复前置
  if (!result.includes("00-Inbox")) result.unshift("00-Inbox");
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
    .filter(Boolean)
    .join("/");
  // 含 . / .. 或隐藏段（.obsidian 等）的建议一律拒绝，而不是静默改写
  if (cleaned.split("/").some((part) => part.startsWith("."))) return null;
  const abs = path.resolve(root, cleaned || "00-Inbox");
  if (!abs.startsWith(root + path.sep) && abs !== root) return null;
  return { rel: path.relative(root, abs) || ".", abs };
}

// ---------- 素材层文件夹管理（新建 / 删除） ----------

const FOLDER_NAME_MAX = 60;

// 系统约定目录不允许删除：默认三件套、JCG 工作区根、云端导入收件箱、
// 附件（随手记图片上传目录与 vault 配图目录，删了会弄坏笔记里的图）
const PROTECTED_FOLDERS = new Set([...DEFAULT_FOLDERS, "JCG", "JCG/00-Inbox", "JCG/附件"]);

function assertSafeFolderName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("文件夹名不能为空");
  if (trimmed.length > FOLDER_NAME_MAX) throw new Error(`文件夹名不能超过 ${FOLDER_NAME_MAX} 个字符`);
  // 拒绝路径分隔符、点（含 .. 穿越与隐藏目录）与控制字符
  if (/[\\/.]|\p{C}/u.test(trimmed)) throw new Error("文件夹名不能包含 / \\ . 或控制字符");
  return trimmed;
}

/** Vault 根的真实路径（解析符号链接后），用于包含性校验 */
function vaultRealRoot(): string {
  const { vaultPath, available } = getVaultConfig();
  if (!available || !vaultPath) throw new Error("Obsidian Vault 不可用");
  return fs.realpathSync(/* turbopackIgnore: true */ vaultPath);
}

/** realpath 后校验目标仍在 Vault 内，拒绝借符号链接逃逸 */
function assertInsideVault(absolutePath: string, rootReal: string): string {
  const real = fs.realpathSync(absolutePath);
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw new Error("路径超出 Obsidian Vault");
  }
  return real;
}

/** 在素材层新建文件夹。parentRel 为相对 Vault 根的路径（"" 表示根目录），返回新文件夹相对路径 */
export function createVaultFolder(parentRel: string, name: string): string {
  const safeName = assertSafeFolderName(name);
  const parent = resolveVaultPath(parentRel);
  const rootReal = vaultRealRoot();
  if (!fs.existsSync(parent.absolutePath) || !fs.statSync(parent.absolutePath).isDirectory()) {
    throw new Error("上级文件夹不存在");
  }
  assertInsideVault(parent.absolutePath, rootReal);
  const target = path.join(parent.absolutePath, safeName);
  if (fs.existsSync(target)) throw new Error("文件夹已存在");
  try {
    fs.mkdirSync(target);
  } catch (error) {
    // 悬空符号链接等场景 existsSync 为 false 但 mkdir 仍报 EEXIST
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("文件夹已存在");
    throw error;
  }
  invalidateVaultFolderCache();
  return parent.relativePath ? `${parent.relativePath}/${safeName}` : safeName;
}

export type DeleteFolderResult = {
  /** 空目录直接移除；非空目录整目录进回收站，可在回收站恢复 */
  trashed: boolean;
  /** 随目录进回收站、并从知识库清掉记录的 Markdown 文件数 */
  articleCount: number;
  /** 整目录入站时在回收站内的相对路径；空目录直接移除时为 null */
  trashPath: string | null;
};

/**
 * 删除素材层文件夹。空目录直接移除；非空目录整目录移入回收站（.dawnkb-trash，
 * 可恢复），目录内的 Markdown 同步清掉 Article 记录（级联标注/笔记/检索分片）。
 * Vault 根、系统约定目录、含隐藏或被忽略内容（templates、90-归档 等）的一律拒绝。
 */
export async function deleteVaultFolder(relativePath: string): Promise<DeleteFolderResult> {
  const resolved = resolveVaultPath(relativePath);
  if (!resolved.relativePath) throw new Error("不能删除 Vault 根目录");
  if (PROTECTED_FOLDERS.has(resolved.relativePath)) {
    throw new Error("该文件夹是系统约定目录，不能删除");
  }
  if (!fs.existsSync(resolved.absolutePath)) throw new Error("文件夹不存在");
  const stat = fs.lstatSync(resolved.absolutePath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("目标不是文件夹");
  const target = assertInsideVault(resolved.absolutePath, vaultRealRoot());

  const entries = fs.readdirSync(target, { withFileTypes: true });
  // 可见条目之外只容忍 .DS_Store 之类的隐藏杂项文件；隐藏目录、被忽略目录一律视为非空且
  // 拒绝删除（里面可能是用户在 Obsidian 里维护的归档或模板）
  if (entries.some((entry) => entry.name.startsWith(".") || isIgnoredVaultPath(path.join(target, entry.name)))) {
    throw new Error("文件夹内还有隐藏或被忽略的内容，无法安全删除");
  }

  const visible = entries.filter((entry) => !entry.name.startsWith("."));
  if (visible.length === 0) {
    for (const entry of entries) fs.unlinkSync(path.join(target, entry.name));
    fs.rmdirSync(target);
    invalidateVaultFolderCache();
    return { trashed: false, articleCount: 0, trashPath: null };
  }

  // 先收集 md 再移动：moveFolderToTrash 之后原路径已不存在
  const markdowns = collectMarkdown(target);
  const trashPath = moveFolderToTrash(resolved.relativePath);
  // 文件已在回收站（watcher 忽略该目录）；deleteObsidianFile 只按路径算 url 清记录
  for (const rel of markdowns) {
    await deleteObsidianFile(path.join(resolved.vaultPath, rel));
  }
  invalidateVaultFolderCache();
  return { trashed: true, articleCount: markdowns.length, trashPath };
}

/** 目录下（含子目录）所有 Markdown 的 Vault 相对路径 */
function collectMarkdown(directory: string): string[] {
  const { vaultPath } = getVaultConfig();
  const result: string[] = [];
  const stack = [directory];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        result.push(path.relative(vaultPath, full).split(path.sep).join("/"));
      }
    }
  }
  return result;
}
