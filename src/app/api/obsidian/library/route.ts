import { NextRequest, NextResponse } from "next/server";
import { getVaultLibrary, listVaultFolders } from "@/lib/obsidian-vault";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get("mode") === "folders") {
      return NextResponse.json({ folders: listVaultFolders() });
    }
    const folder = req.nextUrl.searchParams.get("folder") || "";
    return NextResponse.json(await getVaultLibrary(folder));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法读取 Obsidian 文件夹" },
      { status: 400 },
    );
  }
}
