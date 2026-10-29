import { NextRequest, NextResponse } from "next/server";
import { getVaultLibrary, listVaultFolders } from "@/lib/obsidian-vault";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get("mode") === "folders") {
      return NextResponse.json({ folders: listVaultFolders() });
    }
    const folder = req.nextUrl.searchParams.get("folder") || "";
    // allFolders=1 时才附带全量文件夹列表（文件夹浏览只需当前层）
    const includeAllFolders = req.nextUrl.searchParams.get("allFolders") === "1";
    return NextResponse.json(await getVaultLibrary(folder, { includeAllFolders }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法读取 Obsidian 文件夹" },
      { status: 400 },
    );
  }
}
