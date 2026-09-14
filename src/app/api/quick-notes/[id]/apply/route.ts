import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrganizeFolder } from "@/lib/vault-folders";

function stamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** POST：采纳 AI 建议，把便签真正写成 vault 笔记放进建议文件夹 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const note = await prisma.quickNote.findUnique({ where: { id } });
  if (!note) return NextResponse.json({ error: "便签不存在" }, { status: 404 });

  let suggestion: { summary?: string; tags?: string[]; folder?: string } = {};
  if (note.aiMeta) {
    try {
      suggestion = JSON.parse(note.aiMeta);
    } catch {
      suggestion = {};
    }
  }

  const resolved = resolveOrganizeFolder(suggestion.folder ?? "00-Inbox");
  if (!resolved) return NextResponse.json({ error: "建议文件夹不合法" }, { status: 400 });
  fs.mkdirSync(resolved.abs, { recursive: true });

  const now = new Date();
  const title = (suggestion.summary ?? "").trim().slice(0, 24).replace(/[\\/:*?"<>|\n]/g, "") || "随手记";
  const fileName = `随手记-${stamp(now)}-${title}.md`;
  const filePath = path.join(resolved.abs, fileName);

  const tags = suggestion.tags ?? note.tags;
  const lines: string[] = [
    "---",
    `tags: [${tags.map((tag) => `"${tag.replace(/"/g, "")}"`).join(", ")}]`,
    `created: ${now.toISOString().slice(0, 10)}`,
    "source: quick-note",
    "---",
    "",
    `# ${title}`,
    "",
    note.content,
    "",
  ];
  if (note.images.length > 0) {
    for (const image of note.images) {
      lines.push(`![[${path.basename(image)}]]`);
    }
    lines.push("");
  }
  if (suggestion.summary) {
    lines.push(`> AI 摘要：${suggestion.summary}`, "");
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");

  const rel = path.relative(path.join(resolved.abs, "..", ".."), filePath);
  const updated = await prisma.quickNote.update({
    where: { id },
    data: {
      status: "organized",
      tags,
      vaultPath: rel,
      aiMeta: null,
    },
  });
  return NextResponse.json({ note: updated, vaultPath: rel });
}
