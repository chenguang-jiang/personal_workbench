import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncObsidianFile } from "@/lib/obsidian-sync";
import { resolveWorkbenchVaultPath } from "@/lib/vault-folders";
import { latestHandoffContext } from "@/lib/dawn-agent-context";

export const runtime = "nodejs";

function safeFileName(value: string) {
  return value
    .replace(/[\\/:*?"<>|#^\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72);
}

function quote(value: string) {
  return value.replaceAll('"', '\\"');
}

function uniquePath(relativePath: string) {
  const resolved = resolveWorkbenchVaultPath(relativePath);
  if (!fs.existsSync(resolved.absolutePath)) return resolved;
  const extension = path.extname(relativePath);
  const base = relativePath.slice(0, -extension.length);
  for (let index = 2; index < 100; index += 1) {
    const next = resolveWorkbenchVaultPath(`${base}-${index}${extension}`);
    if (!fs.existsSync(next.absolutePath)) return next;
  }
  throw new Error("同名回写记录过多，请修改会话名称后再试");
}

function localDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
    new Date(),
  );
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { eventId?: string };
    const session = await prisma.dawnAgentSession.findUnique({
      where: { id },
      include: {
        project: true,
        events: { orderBy: { sequence: "desc" }, take: 400 },
        approvals: { orderBy: { createdAt: "asc" }, take: 100 },
      },
    });
    if (!session)
      return NextResponse.json({ error: "会话不存在" }, { status: 404 });
    session.events.reverse();
    const selectedAssistant = body.eventId
      ? session.events.find(
          (event) => event.id === body.eventId && event.type === "assistant",
        )
      : null;
    if (body.eventId && !selectedAssistant) {
      return NextResponse.json(
        { error: "要回写的 Agent 结论不存在" },
        { status: 404 },
      );
    }
    const userTasks = session.events
      .filter((event) => event.type === "user")
      .map((event) =>
        String((event.payload as Record<string, unknown>).content ?? ""),
      )
      .filter(Boolean);
    const conclusions = (
      selectedAssistant
        ? [selectedAssistant]
        : session.events.filter((event) => event.type === "assistant")
    )
      .map((event) =>
        String((event.payload as Record<string, unknown>).content ?? ""),
      )
      .filter(Boolean);
    if (conclusions.length === 0) {
      return NextResponse.json(
        { error: "当前会话还没有可回写的 Agent 结论" },
        { status: 400 },
      );
    }
    const changes = session.approvals
      .filter(
        (approval) =>
          ["approved", "auto_approved"].includes(approval.status) &&
          approval.preview,
      )
      .map((approval) => {
        const preview = approval.preview as Record<string, unknown>;
        return `- \`${String(preview.path ?? approval.toolName)}\` · +${String(preview.additions ?? 0)} / -${String(preview.deletions ?? 0)}`;
      });
    const context = latestHandoffContext(session.context);
    const date = localDate();
    const title =
      safeFileName(`${session.project.name} · ${session.title}`) ||
      "Dawn Agent 会话";
    const relativePath = `DawnKB/Dawn Agent/${date}-${title}.md`;
    const target = uniquePath(relativePath);
    fs.mkdirSync(path.dirname(target.absolutePath), { recursive: true });
    const content = [
      "---",
      `title: "${quote(title)}"`,
      "tags:",
      "  - DawnKB",
      "  - Dawn-Agent",
      `created: ${date}`,
      `project: "${quote(session.project.name)}"`,
      "---",
      "",
      `# ${title}`,
      "",
      context
        ? `> [!info] 来源上下文\n> ${String(context.sourceTitle ?? "DawnKB 交接内容")}\n> ${String(context.sourcePath ?? "").replaceAll("\n", " ")}`
        : "",
      "",
      "## 任务",
      "",
      userTasks.length
        ? userTasks.map((item) => `- ${item.replaceAll("\n", " ")}`).join("\n")
        : "- 会话上下文中的任务",
      "",
      "## Dawn Agent 结论",
      "",
      conclusions.join("\n\n---\n\n"),
      "",
      "## 已批准变更",
      "",
      changes.length ? changes.join("\n") : "- 本次记录没有已批准的文件变更",
      "",
      "> [!tip] 可继续行动",
      "> 这份记录可以在知识库模式中被检索，也可以再次交给 Dawn Agent 形成下一轮项目任务。",
      "",
    ].join("\n");
    fs.writeFileSync(target.absolutePath, content, {
      encoding: "utf8",
      flag: "wx",
    });
    await syncObsidianFile(target.absolutePath);
    return NextResponse.json({ path: target.relativePath });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "回写知识库失败" },
      { status: 400 },
    );
  }
}
