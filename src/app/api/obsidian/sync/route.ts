import { NextResponse } from "next/server";
import { vaultWatcher } from "@/lib/vault-watcher";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(vaultWatcher.getStatus());
}

export async function POST() {
  try {
    const summary = await vaultWatcher.syncNow();
    return NextResponse.json({ status: vaultWatcher.getStatus(), summary });
  } catch (error) {
    return NextResponse.json(
      {
        status: vaultWatcher.getStatus(),
        error: error instanceof Error ? error.message : "Obsidian 同步失败",
      },
      { status: 500 },
    );
  }
}
