import { NextRequest, NextResponse } from "next/server";
import { invalidJsonResponse, readJsonObject } from "@/lib/request-body";
import { createVaultFolder, deleteVaultFolder, listOrganizeFolders } from "@/lib/vault-folders";

export const runtime = "nodejs";

// GET /api/obsidian/folders — 可归档文件夹清单（相对 JCG 工作区根，00-Inbox 在前），
// 供新建文章选择保存位置等场景复用
export async function GET() {
  return NextResponse.json({ folders: listOrganizeFolders() });
}

// POST /api/obsidian/folders {parent, name} — 在素材层指定目录下新建文件夹
export async function POST(req: NextRequest) {
  const body = await readJsonObject<{ parent?: unknown; name?: unknown }>(req);
  if (!body) return invalidJsonResponse();
  const parent = typeof body.parent === "string" ? body.parent : "";
  const name = typeof body.name === "string" ? body.name : "";
  try {
    const created = createVaultFolder(parent, name);
    return NextResponse.json({ success: true, path: created });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "新建文件夹失败" },
      { status: 400 },
    );
  }
}

// DELETE /api/obsidian/folders?path= — 删除素材层文件夹（非空时整目录进回收站）
export async function DELETE(req: NextRequest) {
  const relativePath = req.nextUrl.searchParams.get("path") || "";
  if (!relativePath) {
    return NextResponse.json({ error: "缺少文件夹路径" }, { status: 400 });
  }
  try {
    const result = await deleteVaultFolder(relativePath);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除文件夹失败" },
      { status: 400 },
    );
  }
}
