import fs from "node:fs";
import path from "node:path";

/**
 * Vault 内可恢复回收站。
 *
 * 删除的文档移进 `.dawnkb-trash/{日期}/{原相对路径}`。点开头目录被 watcher 的
 * `isIgnoredVaultPath` 和全量扫描双向忽略，不会被重新同步进库，Obsidian 里也看不见
 * —— 这正是安全网需要的性质。本模块只做文件系统操作，不碰数据库；调用方（API 路由）
 * 负责在移动前后调 `deleteObsidianFile` / `syncObsidianFile` 维护 Article 记录。
 *
 * 回收站路径带点段，无法用 `resolveVaultPath`（它主动拒绝点段），因此这里有一套独立的
 * 解析器：realpath 包含性校验 + 拒绝符号链接，与 `resolveImportFile` 同口径。
 */

const TRASH_DIR = ".dawnkb-trash";

// 直接读环境变量拿 Vault 根，不 import obsidian-sync：那会把 prisma 单例拉进来，
// 让本模块的纯文件系统单测被迫依赖 DATABASE_URL
function vaultRealRoot(): string {
  const vaultPath = process.env.OBSIDIAN_VAULT_PATH?.trim() || "";
  if (!vaultPath || !fs.existsSync(/* turbopackIgnore: true */ vaultPath)) throw new Error("Obsidian Vault 不可用");
  return fs.realpathSync(/* turbopackIgnore: true */ vaultPath);
}

/** 校验一个相对路径（不含点段）在 Vault 内且非符号链接，返回其绝对路径 */
function resolveSafe(root: string, relativePath: string): string {
  const clean = relativePath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (clean === "") throw new Error("路径为空");
  if (clean.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("无效的路径");
  }
  const abs = path.resolve(root, clean);
  const inside = path.relative(root, abs);
  if (inside.startsWith("..") || path.isAbsolute(inside)) throw new Error("路径超出 Obsidian Vault");
  // 拒绝符号链接：避免借 symlink 把删除/恢复动作引到 Vault 之外
  if (fs.existsSync(abs) && fs.lstatSync(abs).isSymbolicLink()) {
    throw new Error("不允许操作符号链接");
  }
  return abs;
}

function trashRoot(root: string): string {
  return path.join(root, TRASH_DIR);
}

function todayStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// 整目录删除的标记文件：回收站里目录本身没有扩展名可辨，放一个点文件声明
// 「这一层就是被删的文件夹」。点开头不会被 listTrash 当成 md 条目，也不影响恢复。
const FOLDER_MARKER = ".dawnkb-folder";

export type TrashEntry = {
  /** 回收站内相对 TRASH_DIR 的路径，如 2026-10-23/JCG/技术/foo.md */
  trashPath: string;
  /** 原始 Vault 相对路径（恢复目标），如 JCG/技术/foo.md */
  originalPath: string;
  name: string;
  deletedAt: string;
  /** 条目是文件夹（整目录删除）还是单个文档 */
  kind: "folder" | "file";
};

/** 把一个 Vault 相对路径的 Markdown 文件移入回收站，返回其在回收站内的相对路径 */
export function moveToTrash(relativePath: string): string {
  const root = vaultRealRoot();
  const source = resolveSafe(root, relativePath);
  if (!relativePath.replaceAll("\\", "/").toLowerCase().endsWith(".md")) {
    throw new Error("只能删除 Markdown 文件");
  }
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error("文件不存在");
  const sourceRel = path.relative(root, source).split(path.sep).join("/");
  if (sourceRel.startsWith(`${TRASH_DIR}/`)) throw new Error("文件已在回收站内");

  const cleanRel = sourceRel.replaceAll("\\", "/").replace(/^\/+/, "");
  const target = path.join(trashRoot(root), todayStamp(), cleanRel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // 同日同名重复删除：追加时间戳，绝不覆盖回收站里已有的副本
  let finalTarget = target;
  if (fs.existsSync(/* turbopackIgnore: true */ finalTarget)) {
    const ext = path.extname(finalTarget);
    const base = finalTarget.slice(0, finalTarget.length - ext.length);
    finalTarget = `${base}-${Date.now()}${ext}`;
  }
  fs.renameSync(source, finalTarget);
  return path.relative(trashRoot(root), finalTarget).split(path.sep).join("/");
}

/**
 * 把整个文件夹移入回收站（含子目录与非 md 文件），返回回收站内相对路径。
 * 目录内放 FOLDER_MARKER 声明层级，恢复时据此整目录搬回。
 */
export function moveFolderToTrash(relativePath: string): string {
  const root = vaultRealRoot();
  const source = resolveSafe(root, relativePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error("文件夹不存在");
  if (fs.lstatSync(source).isSymbolicLink()) throw new Error("不允许操作符号链接");
  const sourceRel = path.relative(root, source).split(path.sep).join("/");
  if (sourceRel.startsWith(`${TRASH_DIR}/`)) throw new Error("文件夹已在回收站内");

  const cleanRel = sourceRel.replaceAll("\\", "/").replace(/^\/+/, "");
  const target = path.join(trashRoot(root), todayStamp(), cleanRel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let finalTarget = target;
  if (fs.existsSync(/* turbopackIgnore: true */ finalTarget)) {
    finalTarget = `${target}-${Date.now()}`;
  }
  fs.renameSync(source, finalTarget);
  fs.writeFileSync(path.join(finalTarget, FOLDER_MARKER), `${sourceRel}\n`);
  return path.relative(trashRoot(root), finalTarget).split(path.sep).join("/");
}

/** 列出回收站内所有可恢复条目（按删除时间倒序） */
export function listTrash(): TrashEntry[] {
  const root = vaultRealRoot();
  const base = trashRoot(root);
  if (!fs.existsSync(base)) return [];
  const entries: TrashEntry[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // 带标记的目录是一个「整文件夹」条目：只列目录本身，不展开里面的 md
        if (fs.existsSync(path.join(full, FOLDER_MARKER))) {
          const trashPath = path.relative(base, full).split(path.sep).join("/");
          const segments = trashPath.split("/");
          entries.push({
            trashPath,
            originalPath: segments.slice(1).join("/"),
            name: entry.name,
            deletedAt: fs.statSync(path.join(full, FOLDER_MARKER)).ctime.toISOString(),
            kind: "folder",
          });
          continue;
        }
        walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      const trashPath = path.relative(base, full).split(path.sep).join("/");
      // 第一段是日期戳（YYYY-MM-DD），其后即原始相对路径
      const segments = trashPath.split("/");
      const originalPath = segments.slice(1).join("/");
      const stat = fs.statSync(full);
      // rename 保留 mtime（那是文件原内容时间）；ctime 在移入回收站时刷新，才是删除时间
      entries.push({
        trashPath,
        originalPath,
        name: entry.name,
        deletedAt: stat.ctime.toISOString(),
        kind: "file",
      });
    }
  }

  walk(base);
  return entries.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
}

/**
 * 把回收站条目移回原位置，返回其原始 Vault 相对路径。
 * 若原位置已被新文件占用，恢复到同目录下的 `-restored-{时间戳}` 名字，不覆盖现有内容。
 */
export function restoreFromTrash(trashPath: string): string {
  const root = vaultRealRoot();
  const base = trashRoot(root);
  const source = resolveSafe(base, trashPath);
  if (!fs.existsSync(source)) throw new Error("回收站条目不存在");
  const relInTrash = path.relative(base, source).split(path.sep).join("/");
  const segments = relInTrash.split("/");
  if (segments.length < 2) throw new Error("回收站路径格式不正确");
  const originalPath = segments.slice(1).join("/");

  // 整文件夹条目：目录带标记，整目录搬回原位置后摘掉标记
  if (fs.statSync(source).isDirectory()) {
    if (!fs.existsSync(path.join(source, FOLDER_MARKER))) throw new Error("回收站路径格式不正确");
    const target = resolveSafe(root, originalPath);
    if (fs.existsSync(target)) throw new Error("原位置已有同名文件夹，请先移走或改名后再恢复");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(source, target);
    fs.rmSync(path.join(target, FOLDER_MARKER), { force: true });
    pruneEmptyDirs(base);
    return path.relative(root, target).split(path.sep).join("/");
  }
  if (!fs.statSync(source).isFile()) throw new Error("回收站条目不存在");

  const target = resolveSafe(root, originalPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let finalTarget = target;
  if (fs.existsSync(/* turbopackIgnore: true */ finalTarget)) {
    const ext = path.extname(finalTarget);
    const baseName = finalTarget.slice(0, finalTarget.length - ext.length);
    finalTarget = `${baseName}-restored-${Date.now()}${ext}`;
  }
  fs.renameSync(source, finalTarget);
  // 恢复后清理回收站里可能空掉的日期目录
  pruneEmptyDirs(base);
  return path.relative(root, finalTarget).split(path.sep).join("/");
}

/** 清空回收站（删除 TRASH_DIR 下所有内容），返回删除的文件数 */
export function emptyTrash(): number {
  const root = vaultRealRoot();
  const base = trashRoot(root);
  if (!fs.existsSync(base)) return 0;
  let count = 0;
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        fs.unlinkSync(full);
        count += 1;
      }
    }
  }
  walk(base);
  fs.rmSync(base, { recursive: true, force: true });
  return count;
}

function pruneEmptyDirs(base: string) {
  if (!fs.existsSync(base)) return;
  const stack = [base];
  const dirs: string[] = [];
  while (stack.length) {
    const dir = stack.pop()!;
    dirs.push(dir);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
    }
  }
  // 自底向上删除空目录（保留 TRASH_DIR 根本身，下次删除会重建）
  for (const dir of dirs.reverse()) {
    if (dir === base) continue;
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      /* 目录非空或已不存在，忽略 */
    }
  }
}
