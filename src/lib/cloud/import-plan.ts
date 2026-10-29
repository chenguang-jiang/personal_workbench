export const IMPORT_MAX_BYTES = 1024 * 1024;
export const IMPORT_INBOX = "JCG/00-Inbox";

export type ImportCandidate = { id: string; title: string; folder: string; path: string };
export type ImportPlan = {
  title: string; folder: string; tags: string[]; reason: string;
  action: "create" | "update"; targetId: string | null; pending: boolean;
};

export function normalizedTitle(value: string) {
  return value.normalize("NFC").replace(/\.md$/i, "").trim().toLocaleLowerCase();
}

export function importFilename(title: string) {
  let name = title.normalize("NFC").replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "-")
    .replace(/^\.+|\.+$/g, "").trim().slice(0, 100);
  while (Buffer.byteLength(name, "utf8") > 200) name = name.slice(0, -1);
  return `${name || "未命名文档"}.md`;
}

export function safeImportRelativePath(value: string) {
  if (!value || value.includes("\\") || value.startsWith("/") || /[\x00-\x1f\x7f]/.test(value)) return false;
  return value.split("/").every((part) => part.length > 0 && !part.startsWith(".") && part.trim() === part);
}

export function validateImportPlan(value: unknown, folders: string[], candidates: ImportCandidate[], fallbackTitle: string, generateTitle = false): ImportPlan {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;
  const folderValid = typeof raw.folder === "string" && folders.includes(raw.folder) && safeImportRelativePath(raw.folder);
  const pending = !folderValid || confidence < 0.72;
  const folder = pending ? IMPORT_INBOX : raw.folder as string;
  // 仅在用户未填标题的粘贴/链接入口使用 AI 标题；明确标题与上传文件标题保持稳定。
  const generatedTitle = typeof raw.title === "string" ? raw.title.replace(/[\x00-\x1f\x7f]/g, " ").replace(/^#+\s*|\.md$/gi, "").trim().slice(0, 120) : "";
  const title = generateTitle && generatedTitle ? generatedTitle : fallbackTitle;
  const candidate = candidates.find((item) => item.id === raw.targetId);
  // AI 只能更新预先筛选出的同名文档，不能凭任意 ID 覆盖其他文档。
  const update = !pending && raw.action === "update" && confidence >= 0.9 && candidate &&
    candidate.folder === folder && normalizedTitle(candidate.title) === normalizedTitle(fallbackTitle) &&
    normalizedTitle(title) === normalizedTitle(candidate.title);
  return {
    title, folder, action: update ? "update" : "create", targetId: update ? candidate.id : null, pending,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((v): v is string => typeof v === "string").map((v) => v.trim().slice(0, 40)).filter(Boolean).slice(0, 8) : [],
    reason: pending ? "未能确定合适目录，已放入待整理" : typeof raw.reason === "string" ? raw.reason.slice(0, 250) : "依据文档主题归档",
  };
}
