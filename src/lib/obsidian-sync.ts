import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { prisma } from "@/lib/prisma";

const DEFAULT_USER_EMAIL = "creator@workbench.local";
const SKIP_DIRS = [
  "templates",
  "90-归档",
  "04-Resources/GitHub-Repos",
  ".obsidian",
  "obsidian-style-settings-main",
  "导出PDF",
  "_archive",
];

export type FileSyncResult = {
  status: "created" | "updated" | "unchanged" | "skipped";
  title: string;
  relativePath: string;
};

export type VaultSyncSummary = {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  failed: number;
  finishedAt: string;
  relations?: { created: number; removed: number };
};

export function getVaultConfig() {
  const vaultPath = process.env.OBSIDIAN_VAULT_PATH?.trim() || "";
  return {
    vaultPath,
    vaultName: vaultPath ? path.basename(vaultPath) : "",
    configured: Boolean(vaultPath),
    available: Boolean(vaultPath && fs.existsSync(/* turbopackIgnore: true */ vaultPath)),
  };
}

export function isIgnoredVaultPath(candidatePath: string) {
  const { vaultPath } = getVaultConfig();
  if (!vaultPath) return true;
  const relativePath = path.relative(vaultPath, candidatePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return true;
  const parts = relativePath.split(path.sep);
  return parts.some((part) => part.startsWith(".")) || SKIP_DIRS.some((skip) => relativePath.includes(skip));
}

async function getDefaultUserId() {
  const user = await prisma.user.upsert({
    where: { email: DEFAULT_USER_EMAIL },
    update: {},
    create: { email: DEFAULT_USER_EMAIL, name: "创作者" },
  });
  return user.id;
}

function normalizeTags(filePath: string, frontmatterTags: unknown) {
  const { vaultPath } = getVaultConfig();
  const relativePath = path.relative(vaultPath, filePath);
  const directoryTags = relativePath
    .split(path.sep)
    .filter((part) => !part.endsWith(".md") && part && !/^\d{2}[-_]/.test(part));
  const suppliedTags = Array.isArray(frontmatterTags)
    ? frontmatterTags.map(String)
    : typeof frontmatterTags === "string"
      ? frontmatterTags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
      : [];
  return [...new Set([...directoryTags, ...suppliedTags])].slice(0, 8);
}

function inferType(filePath: string, frontmatter: Record<string, unknown>) {
  if (frontmatter.type) return String(frontmatter.type);
  const relativePath = path.relative(getVaultConfig().vaultPath, filePath).toLowerCase();
  if (relativePath.includes("concept") || relativePath.includes("02-concepts")) return "concept";
  if (relativePath.includes("clipping") || relativePath.includes("article")) return "article";
  if (relativePath.includes("tool") || relativePath.includes("工具")) return "material";
  return "note";
}

function summarize(content: string, description: unknown) {
  if (description) return String(description);
  const normalized = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`\[\]()|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(normalized).slice(0, 160).join("");
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

// 提取正文中的 [[wikilink]] 目标（去掉别名 |、标题 #、.md 后缀），作为真实关系来源
export function extractWikilinkTargets(content: string): string[] {
  const targets = new Set<string>();
  for (const match of content.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = match[1]
      .split("|")[0]
      .split("#")[0]
      .replace(/\.md$/i, "")
      .trim();
    if (target) targets.add(target);
  }
  return [...targets];
}

// 提取指向 vault 内 .md 的 Markdown 链接（[label](path.md) / [label](<path.md>)），排除外部 URL
export function extractMarkdownFileTargets(content: string): string[] {
  const targets = new Set<string>();
  for (const match of content.matchAll(/\]\(<?([^()<>]+\.md)(?:#[^)\s]*)?>?\)/gi)) {
    const target = match[1]
      .trim()
      .replace(/^<|>$/g, "")
      .split("#")[0]
      .replace(/\.md$/i, "")
      .trim();
    if (!target || /^https?:/i.test(target)) continue;
    targets.add(target);
  }
  return [...targets];
}

// 根据正文 wikilink 重建 KnowledgeRelation（type=references），只增删 references 类型，不碰其他类型
export async function rebuildKnowledgeRelations(): Promise<{ created: number; removed: number }> {
  const userId = await getDefaultUserId();
  const [nodes, obsidianArticles] = await Promise.all([
    prisma.knowledgeNode.findMany({
      where: { userId },
      select: { id: true, title: true, content: true },
    }),
    prisma.article.findMany({
      where: { userId, source: "obsidian" },
      select: { title: true, url: true },
    }),
  ]);

  const pathByTitle = new Map<string, string>();
  for (const article of obsidianArticles) {
    if (!article.url?.startsWith("obsidian://")) continue;
    pathByTitle.set(article.title, article.url.slice("obsidian://".length).replace(/\.md$/i, ""));
  }

  const nodeByTitle = new Map<string, string>();
  const nodeByPath = new Map<string, string>();
  const nodesByBasename = new Map<string, string[]>();
  const pathByNodeId = new Map<string, string>();
  for (const node of nodes) {
    nodeByTitle.set(node.title, node.id);
    const relativePath = pathByTitle.get(node.title);
    if (!relativePath) continue;
    pathByNodeId.set(node.id, relativePath);
    nodeByPath.set(relativePath, node.id);
    const basename = relativePath.split("/").pop() || relativePath;
    nodesByBasename.set(basename, [...(nodesByBasename.get(basename) ?? []), node.id]);
  }

  function directoryOf(relativePath: string) {
    const parts = relativePath.split("/");
    parts.pop();
    return parts.join("/");
  }

  function resolveTarget(rawTarget: string, sourceId: string): string | null {
    let target = rawTarget;
    if (target.includes("/")) {
      const direct = nodeByPath.get(target);
      if (direct) return direct;
      for (const [relativePath, nodeId] of nodeByPath) {
        if (relativePath.endsWith(`/${target}`)) return nodeId;
      }
      target = target.split("/").pop() || target;
    }
    const byTitle = nodeByTitle.get(target);
    if (byTitle) return byTitle;
    const candidates = nodesByBasename.get(target) ?? [];
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      // 重名时优先同目录（贴近 Obsidian 的解析行为），否则放弃猜测避免脏边
      const sourcePath = pathByNodeId.get(sourceId);
      if (sourcePath) {
        const sourceDir = directoryOf(sourcePath);
        const sameFolder = candidates.find((candidate) => {
          const candidatePath = pathByNodeId.get(candidate);
          return candidatePath ? directoryOf(candidatePath) === sourceDir : false;
        });
        if (sameFolder) return sameFolder;
      }
    }
    return null;
  }

  function resolveMarkdownTarget(rawTarget: string, sourceId: string): string | null {
    const { vaultPath } = getVaultConfig();
    let target = rawTarget;
    if (vaultPath && target.startsWith(vaultPath)) {
      target = target.slice(vaultPath.length).replace(/^\//, "");
    }
    const direct = nodeByPath.get(target);
    if (direct) return direct;
    const sourcePath = pathByNodeId.get(sourceId);
    if (sourcePath && !target.startsWith("/")) {
      // 相对链接按 Obsidian 规则相对源文件目录解析
      const parts = sourcePath.split("/");
      parts.pop();
      for (const segment of target.split("/")) {
        if (segment === "." || segment === "") continue;
        if (segment === "..") parts.pop();
        else parts.push(segment);
      }
      const relative = nodeByPath.get(parts.join("/"));
      if (relative) return relative;
    }
    for (const [relativePath, nodeId] of nodeByPath) {
      if (relativePath.endsWith(`/${target}`)) return nodeId;
    }
    const basename = target.split("/").pop() || target;
    const candidates = nodesByBasename.get(basename);
    return candidates && candidates.length === 1 ? candidates[0] : null;
  }

  const desired = new Map<string, { fromId: string; toId: string }>();
  for (const node of nodes) {
    if (!node.content) continue;
    const targets = [
      ...extractWikilinkTargets(node.content).map((target) => ({ kind: "wiki" as const, target })),
      ...extractMarkdownFileTargets(node.content).map((target) => ({ kind: "md" as const, target })),
    ];
    for (const { kind, target } of targets) {
      const resolved = kind === "wiki" ? resolveTarget(target, node.id) : resolveMarkdownTarget(target, node.id);
      if (!resolved || resolved === node.id) continue;
      desired.set(`${node.id}::${resolved}`, { fromId: node.id, toId: resolved });
    }
  }

  const existing = await prisma.knowledgeRelation.findMany({
    where: { type: "references" },
    select: { id: true, fromId: true, toId: true },
  });
  const desiredKeys = new Set(desired.keys());
  const toDelete = existing
    .filter((relation) => !desiredKeys.has(`${relation.fromId}::${relation.toId}`))
    .map((relation) => relation.id);
  const existingKeys = new Set(existing.map((relation) => `${relation.fromId}::${relation.toId}`));
  const toCreate = [...desired.values()]
    .filter((pair) => !existingKeys.has(`${pair.fromId}::${pair.toId}`))
    .map((pair) => ({ fromId: pair.fromId, toId: pair.toId, type: "references" }));

  if (toDelete.length > 0) {
    await prisma.knowledgeRelation.deleteMany({ where: { id: { in: toDelete } } });
  }
  if (toCreate.length > 0) {
    await prisma.knowledgeRelation.createMany({ data: toCreate, skipDuplicates: true });
  }
  console.log(`[ObsidianSync] 关系重建：${toCreate.length} 新增 · ${toDelete.length} 移除`);
  return { created: toCreate.length, removed: toDelete.length };
}

export async function syncObsidianFile(
  filePath: string,
  options: { rebuildRelations?: boolean } = {},
): Promise<FileSyncResult> {
  const config = getVaultConfig();
  const relativePath = config.vaultPath ? path.relative(config.vaultPath, filePath) : "";
  if (!config.available || !filePath.endsWith(".md") || isIgnoredVaultPath(filePath) || !fs.existsSync(filePath)) {
    return { status: "skipped", title: path.basename(filePath, ".md"), relativePath };
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data: frontmatter, content } = matter(raw);
  const title = String(frontmatter.title || path.basename(filePath, ".md"));
  const tags = normalizeTags(filePath, frontmatter.tags);
  const description = summarize(content, frontmatter.description);
  const type = inferType(filePath, frontmatter);
  const url = `obsidian://${relativePath}`;
  const userId = await getDefaultUserId();
  const existing = await prisma.article.findUnique({ where: { userId_url: { userId, url } } });
  const changeReasons = existing
    ? [
        existing.title !== title && "title",
        existing.content !== content && "content",
        existing.summary !== description && "summary",
        !sameStringArray(existing.tags, tags) && "tags",
      ].filter(Boolean)
    : [];
  const changed = changeReasons.length > 0;
  if (changed) console.log(`[ObsidianSync] 内容变化：${relativePath} (${changeReasons.join(", ")})`);

  const article = existing
    ? changed
      ? await prisma.article.update({
          where: { id: existing.id },
          data: {
            title,
            content,
            summary: description,
            tags,
            source: "obsidian",
            contentVersion: { increment: 1 },
          },
        })
      : existing
    : await prisma.article.create({
        data: { title, content, summary: description, url, tags, source: "obsidian", userId },
      });

  const existingNode = await prisma.knowledgeNode.findFirst({
    where: {
      userId,
      title: existing?.title || title,
    },
  });

  if (existingNode) {
    if (
      existingNode.title !== article.title ||
      existingNode.content !== article.content ||
      existingNode.description !== description ||
      existingNode.type !== type ||
      !sameStringArray(existingNode.tags, tags)
    ) {
      await prisma.knowledgeNode.update({
        where: { id: existingNode.id },
        data: { title: article.title, content: article.content, description, type, tags },
      });
    }
  } else {
    await prisma.knowledgeNode.create({
      data: { title: article.title, content: article.content, description, type, tags, userId },
    });
  }

  const status = existing ? (changed ? "updated" : "unchanged") : "created";
  if (options.rebuildRelations !== false && status !== "unchanged") {
    await rebuildKnowledgeRelations();
  }

  return { status, title, relativePath };
}

export async function deleteObsidianFile(filePath: string) {
  const config = getVaultConfig();
  if (!config.vaultPath || !filePath.endsWith(".md")) return false;
  const relativePath = path.relative(config.vaultPath, filePath);
  const url = `obsidian://${relativePath}`;
  const userId = await getDefaultUserId();
  const article = await prisma.article.findUnique({ where: { userId_url: { userId, url } } });
  if (!article) return false;

  await prisma.$transaction([
    prisma.article.delete({ where: { id: article.id } }),
    prisma.knowledgeNode.deleteMany({
      where: { userId, title: article.title, content: article.content },
    }),
  ]);
  return true;
}

function scanMarkdownFiles(directory: string, base = directory): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    const relativePath = path.relative(base, fullPath);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || SKIP_DIRS.some((skip) => relativePath.includes(skip))) continue;
      results.push(...scanMarkdownFiles(fullPath, base));
    } else if (entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

export async function syncObsidianVault(): Promise<VaultSyncSummary> {
  const config = getVaultConfig();
  if (!config.configured) throw new Error("OBSIDIAN_VAULT_PATH 未配置");
  if (!config.available) throw new Error("配置的 Obsidian Vault 不存在");

  const files = scanMarkdownFiles(config.vaultPath);
  const liveUrls = new Set(files.map((filePath) => `obsidian://${path.relative(config.vaultPath, filePath)}`));
  const summary: VaultSyncSummary = {
    total: files.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    deleted: 0,
    failed: 0,
    finishedAt: "",
  };

  for (const filePath of files) {
    try {
      const result = await syncObsidianFile(filePath, { rebuildRelations: false });
      if (result.status !== "skipped") summary[result.status] += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(`[ObsidianSync] 同步失败 ${filePath}:`, error);
    }
  }

  const userId = await getDefaultUserId();
  const staleArticles = await prisma.article.findMany({
    where: { userId, source: "obsidian" },
    select: { id: true, title: true, content: true, url: true },
  });
  for (const article of staleArticles) {
    if (!article.url || liveUrls.has(article.url)) continue;
    await prisma.$transaction([
      prisma.article.delete({ where: { id: article.id } }),
      prisma.knowledgeNode.deleteMany({ where: { userId, title: article.title, content: article.content } }),
    ]);
    summary.deleted += 1;
  }

  summary.relations = await rebuildKnowledgeRelations();
  summary.finishedAt = new Date().toISOString();
  return summary;
}
