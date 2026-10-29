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
  titleChanged?: boolean;
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

// 只读环境变量，不触碰文件系统；高频路径（遍历过滤、监听器 ignored 回调）用它代替 getVaultConfig
function getVaultRoot() {
  return process.env.OBSIDIAN_VAULT_PATH?.trim() || "";
}

export function getVaultConfig() {
  const vaultPath = getVaultRoot();
  return {
    vaultPath,
    vaultName: vaultPath ? path.basename(vaultPath) : "",
    configured: Boolean(vaultPath),
    available: Boolean(vaultPath && fs.existsSync(/* turbopackIgnore: true */ vaultPath)),
  };
}

export function isIgnoredVaultPath(candidatePath: string) {
  const vaultPath = getVaultRoot();
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
  const vaultPath = getVaultRoot();
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
  const relativePath = path.relative(getVaultRoot(), filePath).toLowerCase();
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

type RelationResolver = (content: string, sourceId: string) => Map<string, { fromId: string; toId: string }>;

// 载入全部节点标题 + Obsidian 文章路径（不含正文），构造 wikilink / Markdown 链接解析器
async function buildRelationResolver(userId: string): Promise<RelationResolver> {
  const [nodes, obsidianArticles] = await Promise.all([
    prisma.knowledgeNode.findMany({
      where: { userId },
      select: { id: true, title: true },
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

  const vaultPath = getVaultRoot();
  function resolveMarkdownTarget(rawTarget: string, sourceId: string): string | null {
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

  return (content, sourceId) => {
    const desired = new Map<string, { fromId: string; toId: string }>();
    const targets = [
      ...extractWikilinkTargets(content).map((target) => ({ kind: "wiki" as const, target })),
      ...extractMarkdownFileTargets(content).map((target) => ({ kind: "md" as const, target })),
    ];
    for (const { kind, target } of targets) {
      const resolved = kind === "wiki" ? resolveTarget(target, sourceId) : resolveMarkdownTarget(target, sourceId);
      if (!resolved || resolved === sourceId) continue;
      desired.set(`${sourceId}::${resolved}`, { fromId: sourceId, toId: resolved });
    }
    return desired;
  };
}

// 按期望集合与现有 references 边做增删（只动 references 类型）
async function applyReferenceDiff(
  existing: Array<{ id: string; fromId: string; toId: string }>,
  desired: Map<string, { fromId: string; toId: string }>,
) {
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
  return { created: toCreate.length, removed: toDelete.length };
}

// 根据正文 wikilink 重建 KnowledgeRelation（type=references），只增删 references 类型，不碰其他类型
export async function rebuildKnowledgeRelations(): Promise<{ created: number; removed: number }> {
  const userId = await getDefaultUserId();
  const [resolve, nodes] = await Promise.all([
    buildRelationResolver(userId),
    prisma.knowledgeNode.findMany({
      where: { userId },
      select: { id: true, content: true },
    }),
  ]);

  const desired = new Map<string, { fromId: string; toId: string }>();
  for (const node of nodes) {
    if (!node.content) continue;
    for (const [key, pair] of resolve(node.content, node.id)) desired.set(key, pair);
  }

  const existing = await prisma.knowledgeRelation.findMany({
    where: { type: "references" },
    select: { id: true, fromId: true, toId: true },
  });
  const result = await applyReferenceDiff(existing, desired);
  console.log(`[ObsidianSync] 关系重建：${result.created} 新增 · ${result.removed} 移除`);
  return result;
}

// 单文件保存时只重算该节点的出边（不加载其他节点正文）；入边由新增/删除/改名时的完整重建负责
export async function rebuildNodeOutgoingRelations(
  nodeId: string,
  content: string | null,
): Promise<{ created: number; removed: number }> {
  const userId = await getDefaultUserId();
  const [resolve, existing] = await Promise.all([
    buildRelationResolver(userId),
    prisma.knowledgeRelation.findMany({
      where: { type: "references", fromId: nodeId },
      select: { id: true, fromId: true, toId: true },
    }),
  ]);
  const desired = content ? resolve(content, nodeId) : new Map<string, { fromId: string; toId: string }>();
  return applyReferenceDiff(existing, desired);
}

export async function syncObsidianFile(
  filePath: string,
  // rebuildRelations=false 跳过关系维护；relationScope="node" 只更新本文件出边（监听器保存场景）
  options: { rebuildRelations?: boolean; relationScope?: "full" | "node" } = {},
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

  let nodeId: string;
  if (existingNode) {
    nodeId = existingNode.id;
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
    const createdNode = await prisma.knowledgeNode.create({
      data: { title: article.title, content: article.content, description, type, tags, userId },
      select: { id: true },
    });
    nodeId = createdNode.id;
  }

  const status = existing ? (changed ? "updated" : "unchanged") : "created";
  // 标题变化/新建会影响其他文件指向本节点的入边：node 模式下只更新出边，由调用方（监听器）安排完整重建
  const titleChanged = Boolean(existing && existing.title !== title);
  if (options.rebuildRelations !== false && status !== "unchanged") {
    if (options.relationScope === "node") {
      await rebuildNodeOutgoingRelations(nodeId, article.content);
    } else {
      await rebuildKnowledgeRelations();
    }
  }

  return { status, title, relativePath, titleChanged };
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

/**
 * 把 Vault 内的 Markdown 文件移动到新位置，并保住 Article id。
 *
 * 必须 DB 先行：chokidar 会把 rename 看成 unlink + add，如果先动文件，
 * unlink 触发 deleteObsidianFile 按旧 url 删掉文章，add 再按新 url 建一条
 * 新记录 —— 新 id，标注/笔记/检索分片全部丢失。反过来先把 url 改成新路径，
 * watcher 收到 unlink 时旧 url 已查不到文章（无害），收到 add 时新 url 命中
 * 同一条记录且内容未变（unchanged），id 与关联数据原地不动。
 */
export async function relocateObsidianFile(oldAbs: string, newAbs: string) {
  const config = getVaultConfig();
  if (!config.available || !config.vaultPath) throw new Error("Obsidian Vault 不可用");
  if (!oldAbs.endsWith(".md") || !newAbs.endsWith(".md")) throw new Error("只能移动 Markdown 文件");
  if (isIgnoredVaultPath(oldAbs)) throw new Error("源文件在被忽略的路径中");
  if (isIgnoredVaultPath(newAbs)) throw new Error("目标位置在被忽略的路径中");
  const vaultReal = fs.realpathSync(/* turbopackIgnore: true */ config.vaultPath);
  for (const candidate of [oldAbs, newAbs]) {
    const inside = path.relative(vaultReal, fs.realpathSync(path.dirname(candidate)));
    if (inside.startsWith("..") || path.isAbsolute(inside)) throw new Error("路径超出 Obsidian Vault");
  }
  if (!fs.existsSync(oldAbs)) throw new Error("源文件不存在");
  if (fs.existsSync(newAbs)) throw new Error("目标位置已存在同名文件");

  const toRel = (abs: string) => path.relative(config.vaultPath!, abs).split(path.sep).join("/");
  const oldRel = toRel(oldAbs);
  const newRel = toRel(newAbs);
  const userId = await getDefaultUserId();
  const oldUrl = `obsidian://${oldRel}`;
  const newUrl = `obsidian://${newRel}`;
  const article = await prisma.article.findUnique({ where: { userId_url: { userId, url: oldUrl } } });
  const occupant = await prisma.article.findUnique({
    where: { userId_url: { userId, url: newUrl } },
    select: { id: true },
  });
  if (occupant && occupant.id !== article?.id) {
    throw new Error("目标路径已有另一篇文章的记录，请换个位置");
  }

  const relink = () =>
    prisma.$transaction([
      prisma.article.update({ where: { id: article!.id }, data: { url: newUrl } }),
      prisma.knowledgeChunk.updateMany({ where: { articleId: article!.id }, data: { vaultPath: newRel } }),
    ]);
  if (article) await relink();

  try {
    fs.mkdirSync(path.dirname(newAbs), { recursive: true });
    fs.renameSync(oldAbs, newAbs);
  } catch (error) {
    // 文件没动成，把数据库改回去，避免 url 指向不存在的路径
    if (article) {
      await prisma.$transaction([
        prisma.article.update({ where: { id: article.id }, data: { url: oldUrl } }),
        prisma.knowledgeChunk.updateMany({ where: { articleId: article.id }, data: { vaultPath: oldRel } }),
      ]);
    }
    throw error;
  }
  return { articleId: article?.id ?? null, oldRel, newRel };
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
