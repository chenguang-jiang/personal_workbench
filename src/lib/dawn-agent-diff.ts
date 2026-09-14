import "server-only";

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveProjectPath } from "@/lib/dawn-agent-security";

const MAX_FILE_BYTES = 1_500_000;
const MAX_HUNK_TEXT = 18_000;

export type DawnDiffHunk = {
  id: string;
  index: number;
  oldStart: number;
  newStart: number;
  oldText: string;
  newText: string;
  additions: number;
  deletions: number;
  truncated: boolean;
};

export type DawnChangePreview = {
  kind: "edit" | "write";
  path: string;
  state: "create" | "modify";
  beforeHash: string;
  proposedHash: string;
  additions: number;
  deletions: number;
  hunks: DawnDiffHunk[];
  warning?: string;
};

function contentHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function lineNumberAt(value: string, offset: number) {
  return value.slice(0, Math.max(0, offset)).split("\n").length;
}

function changedLineCount(value: string) {
  if (!value) return 0;
  return value.split("\n").length;
}

function clip(value: string) {
  if (value.length <= MAX_HUNK_TEXT) return { value, truncated: false };
  return { value: value.slice(0, MAX_HUNK_TEXT) + "\n…<内容已截断>", truncated: true };
}

function readText(filePath: string) {
  if (!fs.existsSync(filePath)) return "";
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("修改目标不是普通文件");
  if (stat.size > MAX_FILE_BYTES) throw new Error("文件超过 1.5 MB，无法在 Web 审批中安全预览");
  const value = fs.readFileSync(filePath);
  if (value.includes(0)) throw new Error("二进制文件不能通过文本审批修改");
  return value.toString("utf8");
}

function applyEditSet(
  source: string,
  edits: Array<{ oldText: string; newText: string }>,
) {
  const matches = edits.map((edit, index) => {
    const offset = source.indexOf(edit.oldText);
    if (offset < 0) throw new Error(`第 ${index + 1} 个编辑块在文件中没有精确匹配`);
    if (source.indexOf(edit.oldText, offset + Math.max(1, edit.oldText.length)) >= 0) {
      throw new Error(`第 ${index + 1} 个编辑块不是唯一匹配，无法安全预览`);
    }
    return { ...edit, offset, index };
  });
  const byOffset = [...matches].sort((left, right) => right.offset - left.offset);
  let result = source;
  for (const edit of byOffset) {
    result = result.slice(0, edit.offset) + edit.newText + result.slice(edit.offset + edit.oldText.length);
  }
  return { result, matches };
}

function writeHunk(before: string, after: string): DawnDiffHunk {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1;
  const oldText = oldLines.slice(prefix, oldLines.length - suffix).join("\n");
  const newText = newLines.slice(prefix, newLines.length - suffix).join("\n");
  const oldClip = clip(oldText);
  const newClip = clip(newText);
  return {
    id: "h1",
    index: 0,
    oldStart: prefix + 1,
    newStart: prefix + 1,
    oldText: oldClip.value,
    newText: newClip.value,
    additions: changedLineCount(newText),
    deletions: changedLineCount(oldText),
    truncated: oldClip.truncated || newClip.truncated,
  };
}

export function createChangePreview(
  root: string,
  toolName: string,
  input: Record<string, unknown>,
): DawnChangePreview | null {
  if (toolName !== "edit" && toolName !== "write") return null;
  if (typeof input.path !== "string") throw new Error("修改工具缺少文件路径");
  const absolutePath = resolveProjectPath(root, input.path);
  const existed = fs.existsSync(absolutePath);
  const before = readText(absolutePath);
  const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");

  if (toolName === "write") {
    if (typeof input.content !== "string") throw new Error("write 工具缺少文件内容");
    if (Buffer.byteLength(input.content, "utf8") > MAX_FILE_BYTES) {
      throw new Error("拟写入内容超过 1.5 MB，不能通过 Web 审批");
    }
    const hunk = writeHunk(before, input.content);
    return {
      kind: "write",
      path: relativePath,
      state: existed ? "modify" : "create",
      beforeHash: contentHash(before),
      proposedHash: contentHash(input.content),
      additions: hunk.additions,
      deletions: hunk.deletions,
      hunks: [hunk],
      warning: "完整文件写入必须整体批准；需要局部修改时请让 Agent 改用 edit。",
    };
  }

  const edits = Array.isArray(input.edits)
    ? input.edits.filter(
        (item): item is { oldText: string; newText: string } =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as { oldText?: unknown }).oldText === "string" &&
          typeof (item as { newText?: unknown }).newText === "string",
      )
    : [];
  if (edits.length === 0) throw new Error("edit 工具没有可审批的编辑块");
  if (edits.length > 40) throw new Error("单次编辑超过 40 个修改块，请拆分任务");
  const { result, matches } = applyEditSet(before, edits);
  const hunks = matches.map((edit) => {
    const oldClip = clip(edit.oldText);
    const newClip = clip(edit.newText);
    return {
      id: `h${edit.index + 1}`,
      index: edit.index,
      oldStart: lineNumberAt(before, edit.offset),
      newStart: lineNumberAt(result, Math.min(edit.offset, result.length)),
      oldText: oldClip.value,
      newText: newClip.value,
      additions: changedLineCount(edit.newText),
      deletions: changedLineCount(edit.oldText),
      truncated: oldClip.truncated || newClip.truncated,
    } satisfies DawnDiffHunk;
  });
  return {
    kind: "edit",
    path: relativePath,
    state: existed ? "modify" : "create",
    beforeHash: contentHash(before),
    proposedHash: contentHash(result),
    additions: hunks.reduce((sum, hunk) => sum + hunk.additions, 0),
    deletions: hunks.reduce((sum, hunk) => sum + hunk.deletions, 0),
    hunks,
  };
}

export function approvalArguments(
  toolName: string,
  input: Record<string, unknown>,
  beforeHash?: string,
) {
  if (toolName === "edit") {
    return {
      path: input.path,
      editBlocks: Array.isArray(input.edits) ? input.edits.length : 0,
      beforeHash,
    };
  }
  if (toolName === "write") {
    return {
      path: input.path,
      bytes: typeof input.content === "string" ? Buffer.byteLength(input.content, "utf8") : 0,
      beforeHash,
    };
  }
  return { ...input, beforeHash };
}
