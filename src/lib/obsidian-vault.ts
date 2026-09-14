import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { prisma } from "@/lib/prisma";
import { getVaultConfig, isIgnoredVaultPath } from "@/lib/obsidian-sync";

const DEFAULT_FOLDERS = ["00-Inbox", "阅读资料", "知识笔记"];

export type VaultFolder = {
  name: string;
  path: string;
  fileCount: number;
  directFileCount: number;
  childFolderCount: number;
  updatedAt: string | null;
};

export type VaultFile = {
  name: string;
  path: string;
  title: string;
  description: string;
  tags: string[];
  updatedAt: string;
  articleId: string | null;
};

function visibleEntries(directory: string) {
  return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => {
    if (entry.name.startsWith(".")) return false;
    return !isIgnoredVaultPath(path.join(directory, entry.name));
  });
}

function ensureDefaultFolders(vaultPath: string) {
  const existingFolders = visibleEntries(vaultPath).filter((entry) => entry.isDirectory());
  if (existingFolders.length > 0) return;
  for (const folder of DEFAULT_FOLDERS) {
    fs.mkdirSync(path.join(/* turbopackIgnore: true */ vaultPath, folder), { recursive: true });
  }
}

export function resolveVaultPath(relativePath = "") {
  const config = getVaultConfig();
  if (!config.configured) throw new Error("OBSIDIAN_VAULT_PATH 未配置");
  if (!config.available) throw new Error("配置的 Obsidian Vault 不存在");

  const cleanPath = relativePath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (cleanPath.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error("无效的 Vault 路径");
  }

  const absolutePath = path.resolve(config.vaultPath, cleanPath);
  const relative = path.relative(config.vaultPath, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("路径超出 Obsidian Vault");
  }

  return { ...config, absolutePath, relativePath: relative === "" ? "" : relative.split(path.sep).join("/") };
}

function folderStats(directory: string): Omit<VaultFolder, "name" | "path"> {
  let fileCount = 0;
  let directFileCount = 0;
  let childFolderCount = 0;
  let updatedAt = 0;

  for (const entry of visibleEntries(directory)) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      childFolderCount += 1;
      const child = folderStats(fullPath);
      fileCount += child.fileCount;
      if (child.updatedAt) updatedAt = Math.max(updatedAt, new Date(child.updatedAt).getTime());
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const stat = fs.statSync(fullPath);
    fileCount += 1;
    directFileCount += 1;
    updatedAt = Math.max(updatedAt, stat.mtimeMs);
  }

  return {
    fileCount,
    directFileCount,
    childFolderCount,
    updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
  };
}

function summarizeMarkdown(content: string) {
  return Array.from(
    content
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#>*_`\[\]()|-]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, 120)
    .join("");
}

export function listVaultFolders() {
  const { vaultPath } = resolveVaultPath();
  ensureDefaultFolders(vaultPath);
  const folders: VaultFolder[] = [];

  function walk(directory: string) {
    for (const entry of visibleEntries(directory)) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(vaultPath, fullPath).split(path.sep).join("/");
      folders.push({ name: entry.name, path: relativePath, ...folderStats(fullPath) });
      walk(fullPath);
    }
  }

  walk(vaultPath);
  return folders.sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
}

export async function getVaultLibrary(relativeFolder = "") {
  const resolved = resolveVaultPath(relativeFolder);
  ensureDefaultFolders(resolved.vaultPath);
  if (!fs.existsSync(resolved.absolutePath) || !fs.statSync(resolved.absolutePath).isDirectory()) {
    throw new Error("Vault 文件夹不存在");
  }

  const entries = visibleEntries(resolved.absolutePath);
  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(resolved.absolutePath, entry.name);
      const relativePath = path.relative(resolved.vaultPath, fullPath).split(path.sep).join("/");
      return { name: entry.name, path: relativePath, ...folderStats(fullPath) };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

  const markdownEntries = entries.filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
  );
  const urls = markdownEntries.map((entry) => {
    const fullPath = path.join(resolved.absolutePath, entry.name);
    return `obsidian://${path.relative(resolved.vaultPath, fullPath)}`;
  });
  const articles = urls.length
    ? await prisma.article.findMany({
        where: { source: "obsidian", url: { in: urls } },
        select: { id: true, url: true },
      })
    : [];
  const articleIds = new Map(articles.map((article) => [article.url, article.id]));

  const files: VaultFile[] = markdownEntries
    .map((entry) => {
      const fullPath = path.join(resolved.absolutePath, entry.name);
      const relativePath = path.relative(resolved.vaultPath, fullPath).split(path.sep).join("/");
      const stat = fs.statSync(fullPath);
      const parsed = matter(fs.readFileSync(fullPath, "utf-8"));
      const suppliedTags = Array.isArray(parsed.data.tags)
        ? parsed.data.tags.map(String)
        : typeof parsed.data.tags === "string"
          ? parsed.data.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
          : [];
      return {
        name: entry.name,
        path: relativePath,
        title: String(parsed.data.title || path.basename(entry.name, ".md")),
        description: String(parsed.data.description || summarizeMarkdown(parsed.content)),
        tags: suppliedTags.slice(0, 5),
        updatedAt: stat.mtime.toISOString(),
        articleId: articleIds.get(`obsidian://${path.relative(resolved.vaultPath, fullPath)}`) || null,
      };
    })
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());

  const parts = resolved.relativePath ? resolved.relativePath.split("/") : [];
  const breadcrumbs = [
    { name: resolved.vaultName || "Obsidian", path: "" },
    ...parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join("/") })),
  ];

  return {
    configured: resolved.configured,
    available: resolved.available,
    vaultName: resolved.vaultName,
    currentPath: resolved.relativePath,
    parentPath: parts.slice(0, -1).join("/"),
    breadcrumbs,
    folders,
    files,
    allFolders: listVaultFolders(),
  };
}
