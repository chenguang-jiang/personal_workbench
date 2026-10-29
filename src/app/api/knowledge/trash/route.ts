import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getVaultConfig, syncObsidianFile } from "@/lib/obsidian-sync";
import { invalidateVaultFolderCache } from "@/lib/obsidian-vault";
import { emptyTrash, listTrash, restoreFromTrash } from "@/lib/vault-trash";
import { invalidJsonResponse, readJsonObject } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function vaultUnavailable() {
  return NextResponse.json({ error: "Obsidian Vault 不可用" }, { status: 403 });
}

// GET /api/knowledge/trash — 列出回收站条目
export async function GET() {
  if (!getVaultConfig().available) return vaultUnavailable();
  try {
    return NextResponse.json({ entries: listTrash() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取回收站失败" },
      { status: 500 },
    );
  }
}

// POST /api/knowledge/trash {trashPath} — 恢复单个条目：移回原位置并重新入库
export async function POST(req: NextRequest) {
  if (!getVaultConfig().available) return vaultUnavailable();
  const body = await readJsonObject<{ trashPath?: unknown }>(req);
  if (!body || typeof body.trashPath !== "string" || !body.trashPath) return invalidJsonResponse();
  try {
    const restoredRel = restoreFromTrash(body.trashPath);
    const config = getVaultConfig();
    const abs = path.join(config.vaultPath!, restoredRel);
    // 内容已回到 Vault 可见路径，重新入库（Article 是删除时清掉的，这里会新建）；
    // 整文件夹恢复时把目录内所有 Markdown 逐个入库
    if (fs.existsSync(abs)) {
      const markdowns: string[] = fs.statSync(abs).isDirectory() ? [] : [abs];
      const stack = markdowns.length ? [] : [abs];
      while (stack.length > 0) {
        const dir = stack.pop() as string;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) markdowns.push(full);
        }
      }
      for (const file of markdowns) await syncObsidianFile(file, { relationScope: "node" });
    }
    invalidateVaultFolderCache();
    return NextResponse.json({ success: true, path: restoredRel });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "恢复失败" },
      { status: 400 },
    );
  }
}

// DELETE /api/knowledge/trash — 清空回收站（不可恢复，前端需二次确认）
export async function DELETE() {
  if (!getVaultConfig().available) return vaultUnavailable();
  try {
    return NextResponse.json({ success: true, removed: emptyTrash() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "清空回收站失败" },
      { status: 500 },
    );
  }
}
