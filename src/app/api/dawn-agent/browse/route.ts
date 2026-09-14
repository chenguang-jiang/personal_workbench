import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { isInsideRoot } from "@/lib/dawn-agent-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const home = fs.realpathSync(os.homedir());
    const requested = req.nextUrl.searchParams.get("path") || path.join(home, "Documents");
    const absolute = fs.realpathSync(path.resolve(requested.replace(/^~(?=\/|$)/, home)));
    if (!isInsideRoot(home, absolute)) throw new Error("只能浏览当前用户目录");
    if (!fs.statSync(absolute).isDirectory()) throw new Error("目标不是文件夹");
    const folders = fs
      .readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .slice(0, 120)
      .map((entry) => ({
        name: entry.name,
        path: path.join(absolute, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    return NextResponse.json({
      path: absolute,
      parentPath: absolute === home ? null : path.dirname(absolute),
      folders,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "文件夹不可用" },
      { status: 400 },
    );
  }
}
