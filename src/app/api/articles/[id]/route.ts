import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getVaultConfig, syncObsidianFile } from "@/lib/obsidian-sync";

// GET /api/articles/[id] — 获取文章详情（含标注和笔记）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const article = await prisma.article.findUnique({
    where: { id },
    include: {
      highlights: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }

  return NextResponse.json(article);
}

// PATCH /api/articles/[id] — 更新文章（含阅读进度、正文编辑）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  // 正文编辑：vault 文章写回原文件并走同步链路（节点/关系/版本号一并更新）
  if (body.content !== undefined && typeof body.content === "string") {
    const existing = await prisma.article.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "文章不存在" }, { status: 404 });
    }

    const vault = getVaultConfig();
    const relativePath = existing.url?.startsWith("obsidian://")
      ? existing.url.slice("obsidian://".length)
      : null;
    const filePath = relativePath ? path.join(vault.vaultPath, relativePath) : null;

    if (filePath && vault.available && fs.existsSync(filePath)) {
      try {
        const parsed = matter(fs.readFileSync(filePath, "utf-8"));
        fs.writeFileSync(filePath, matter.stringify(body.content, parsed.data), "utf-8");
        await syncObsidianFile(filePath);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? `写回 Vault 失败：${error.message}` : "写回 Vault 失败" },
          { status: 500 },
        );
      }
    } else {
      await prisma.article.update({
        where: { id },
        data: { content: body.content, contentVersion: { increment: 1 } },
      });
    }

    const article = await prisma.article.findUnique({
      where: { id },
      include: {
        highlights: { orderBy: { createdAt: "asc" as const } },
        notes: { orderBy: { createdAt: "desc" as const } },
      },
    });
    return NextResponse.json(article);
  }

  const article = await prisma.article.update({
    where: { id },
    data: {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.summary !== undefined && { summary: body.summary }),
      ...(body.tags !== undefined && { tags: body.tags }),
      ...(body.readingProgress !== undefined && {
        readingProgress: body.readingProgress,
      }),
      ...(body.lastReadAt !== undefined && { lastReadAt: body.lastReadAt }),
    },
  });

  return NextResponse.json(article);
}

// DELETE /api/articles/[id] — 删除文档
// ?vault=1 时同时删除 Obsidian Vault 中的源文件（否则下次同步会重新入库）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const removeVaultFile = new URL(req.url).searchParams.get("vault") === "1";

  const article = await prisma.article.findUnique({ where: { id } });
  if (!article) {
    return NextResponse.json({ error: "文章不存在" }, { status: 404 });
  }

  // Vault 文章：按需删除源文件（路径必须仍在 vault 内，防穿越）
  const relativePath = article.url?.startsWith("obsidian://")
    ? article.url.slice("obsidian://".length)
    : null;
  if (removeVaultFile && relativePath) {
    const vault = getVaultConfig();
    if (vault.vaultPath) {
      const resolved = path.resolve(path.join(vault.vaultPath, relativePath));
      const vaultRoot = path.resolve(vault.vaultPath) + path.sep;
      if (!resolved.startsWith(vaultRoot)) {
        return NextResponse.json({ error: "非法的文件路径" }, { status: 400 });
      }
      try {
        if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? `删除 Vault 文件失败：${error.message}`
                : "删除 Vault 文件失败",
          },
          { status: 500 },
        );
      }
    }
  }

  // 删除文章（高亮/知识分片级联删除，笔记置空），并清理同步生成的同名知识节点
  await prisma.$transaction([
    prisma.article.delete({ where: { id } }),
    prisma.knowledgeNode.deleteMany({
      where: {
        userId: article.userId,
        title: article.title,
        content: article.content,
      },
    }),
  ]);

  return NextResponse.json({ success: true });
}
