import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { invalidJsonResponse, readJsonObject } from "@/lib/request-body";
import { getVaultConfig, syncObsidianFile } from "@/lib/obsidian-sync";
import { invalidateVaultFolderCache } from "@/lib/obsidian-vault";
import { uniqueWorkbenchVaultPath } from "@/lib/unique-vault-path";
import { resolveOrganizeFolder } from "@/lib/vault-folders";

export const runtime = "nodejs";

const TITLE_MAX = 80;

const DEFAULT_FOLDER = "00-Inbox";

// POST /api/articles/new {title, folder?} — 新建文章：在 Vault 选定文件夹（默认 00-Inbox）
// 落一个空白 md 并入库，阅读器拿返回的 id 直接进编辑态。走文件→sync 的既有链路，
// Article/KnowledgeNode 与检索关系的维护和 Obsidian 侧新建文件完全一致。
export async function POST(req: NextRequest) {
  const body = await readJsonObject<{ title?: unknown; folder?: unknown }>(req);
  if (!body) return invalidJsonResponse();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  if (title.length > TITLE_MAX) {
    return NextResponse.json({ error: `标题不能超过 ${TITLE_MAX} 个字符` }, { status: 400 });
  }
  // 文件名安全：拒绝路径分隔符、冒号与控制字符（点号允许，同名靠 -2 后缀区分）
  if (/[\\/:]|\p{C}/u.test(title)) {
    return NextResponse.json({ error: "标题不能包含 / \\ : 或控制字符" }, { status: 400 });
  }
  // 保存文件夹：仅接受工作区内的安全相对路径（越界 / 隐藏段一律拒绝），缺省回 00-Inbox
  const folderInput = typeof body.folder === "string" && body.folder.trim() ? body.folder.trim() : DEFAULT_FOLDER;
  const folder = resolveOrganizeFolder(folderInput);
  if (!folder) {
    return NextResponse.json({ error: "保存文件夹无效" }, { status: 400 });
  }

  const config = getVaultConfig();
  if (!config.available || !config.vaultPath) {
    return NextResponse.json({ error: "Obsidian Vault 不可用" }, { status: 403 });
  }

  const relativeInFolder = folder.rel === "." ? `${title}.md` : `${folder.rel}/${title}.md`;
  const { absolutePath, relativePath } = uniqueWorkbenchVaultPath(relativeInFolder);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, matter.stringify("", { title }), "utf-8");
  try {
    const result = await syncObsidianFile(absolutePath, { relationScope: "node" });
    if (result.status === "skipped") throw new Error("新文档未能入库");
    const article = await prisma.article.findFirst({
      where: { url: `obsidian://${relativePath}` },
      select: { id: true },
    });
    if (!article) throw new Error("新文档未能入库");
    invalidateVaultFolderCache();
    return NextResponse.json({ articleId: article.id }, { status: 201 });
  } catch (error) {
    // 入库失败回滚文件，不在 Vault 里留孤儿文档
    fs.rmSync(absolutePath, { force: true });
    invalidateVaultFolderCache();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "新建文章失败" },
      { status: 500 },
    );
  }
}
