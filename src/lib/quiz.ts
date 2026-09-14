import fs from "node:fs";
import path from "node:path";
import { getVaultConfig } from "@/lib/obsidian-sync";

export const QUIZ_FOLDER =
  process.env.QUIZ_VAULT_FOLDER?.trim() || "JCG/学习资料/软考/每日题库";

export interface QuizOption {
  key: string;
  text: string;
}

export type QuizQuestionType = "single" | "multi" | "essay";

export interface QuizQuestion {
  index: number;
  title: string;
  stem: string;
  options: QuizOption[];
  answer: string;
  explanation: string;
  type: QuizQuestionType;
}

export interface QuizSet {
  day: string; // YYYY-MM-DD
  title: string;
  intro: string;
  questions: QuizQuestion[];
}

function dayFromFileName(name: string): string | null {
  const compact = name.match(/(\d{8})\.md$/);
  if (compact) {
    const [y, m, d] = [
      compact[1].slice(0, 4),
      compact[1].slice(4, 6),
      compact[1].slice(6, 8),
    ];
    return `${y}-${m}-${d}`;
  }
  const dashed = name.match(/(\d{4}-\d{2}-\d{2})\.md$/);
  return dashed ? dashed[1] : null;
}

export function listQuizDays(): { day: string; file: string }[] {
  const { available, vaultPath } = getVaultConfig();
  if (!available) return [];
  const dir = path.join(/* turbopackIgnore: true */ vaultPath, QUIZ_FOLDER);
  if (!fs.existsSync(/* turbopackIgnore: true */ dir)) return [];
  const out: { day: string; file: string }[] = [];
  for (const name of fs.readdirSync(/* turbopackIgnore: true */ dir)) {
    const day = dayFromFileName(name);
    if (day)
      out.push({ day, file: path.join(/* turbopackIgnore: true */ dir, name) });
  }
  return out.sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** 提取答案块：合并所有 <details> 内容（案例题含多个子问题）；回退到「答案：」标记之后的正文 */
function extractAnswerBlock(section: string): string {
  const blocks = [...section.matchAll(/<details[^>]*>([\s\S]*?)<\/details>/g)].map(
    (match) => match[1],
  );
  if (blocks.length > 0) return blocks.join("\n\n");
  const marker = section.match(/\*{0,2}答案[:：]/);
  if (marker && marker.index !== undefined) return section.slice(marker.index);
  return "";
}

/** 从答案块中解析标准答案字母（选择题） */
function parseAnswerLetters(block: string): string {
  const match = block.match(
    /\*{0,2}答案[:：]\*{0,2}\s*([A-Fa-f](?:\s*[，,、/\s]\s*[A-Fa-f])*)/,
  );
  if (!match) return "";
  return normalizeAnswer(match[1]);
}

/** 解析题干：截止到第一个选项行或答案标记；保留段落结构，去掉分隔线 */
function parseStem(section: string): string {
  const body = section
    .replace(/<details[\s\S]*?<\/details>/g, "")
    .split("\n")
    .slice(1)
    .join("\n");
  const cut = body.match(/\n\s*(?:[A-F][.、)）]\s|\*{0,2}答案[:：])/);
  const text =
    cut && cut.index !== undefined ? body.slice(0, cut.index) : body;
  const paragraphs: string[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const cleaned = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^(?:-{3,}|\*{3,})$/.test(line))
      .join(" ")
      .replace(/\*{0,2}(?:【题目】|题目)[:：]?\*{0,2}\s*/, "")
      .trim();
    if (cleaned) paragraphs.push(cleaned);
  }
  return paragraphs.join("\n\n");
}

/** 解析选项行：A. / A、 / A) 等 */
function parseOptions(section: string): QuizOption[] {
  const body = section.replace(/<details[\s\S]*?<\/details>/g, "");
  const options: QuizOption[] = [];
  for (const line of body.split("\n")) {
    const opt = line.trim().match(/^([A-F])[.、)）]\s*(.+)$/);
    if (opt) options.push({ key: opt[1], text: opt[2].trim() });
  }
  return options;
}

/** 清理 HTML details/summary 标签（含 summary 内容），保留 Markdown 原文 */
function cleanBlock(block: string): string {
  return block
    .replace(/<summary[^>]*>[\s\S]*?<\/summary>/g, "")
    .replace(/<\/?summary[^>]*>/g, "")
    .replace(/<\/?details[^>]*>/g, "")
    .replace(/^\s*(?:-{3,}|\*{3,})\s*$/gm, "")
    .trim();
}

/** 解析解析正文：从「解析：」标记开始；没有标记时返回整个答案块 */
function parseExplanation(block: string): string {
  const match = block.match(/\*{0,2}解析[:：]\*{0,2}\s*([\s\S]*)$/);
  return cleanBlock(match ? match[1] : block);
}

export function parseQuizSet(filePath: string, day: string): QuizSet | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const body = raw.replace(/^---[\s\S]*?---\n/, "");
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const introMatch = body.match(/^>\s*(.+)$/m);

  const sections = body
    .split(/\n(?=##\s)/)
    .filter((part) => part.startsWith("## "));
  const questions: QuizQuestion[] = [];

  for (const section of sections) {
    const heading = section
      .split("\n")[0]
      .replace(/^##\s*/, "")
      .trim();
    if (!/题目|子问题/.test(heading)) continue;

    const answerBlock = extractAnswerBlock(section);
    const options = parseOptions(section);
    const answer = parseAnswerLetters(answerBlock);
    const stem = parseStem(section);
    if (!stem) continue;

    // 有选项且有字母答案 → 选择题；否则 → 案例/问答题
    const type: QuizQuestionType =
      options.length > 0 && answer
        ? answer.length > 1
          ? "multi"
          : "single"
        : "essay";
    if (type === "essay" && !answerBlock) continue;

    questions.push({
      index: questions.length,
      title: heading,
      stem,
      options,
      answer,
      explanation:
        type === "essay" ? cleanBlock(answerBlock) : parseExplanation(answerBlock),
      type,
    });
  }

  if (questions.length === 0) return null;
  return {
    day,
    title: titleMatch?.[1]?.trim() || `每日题集 ${day}`,
    intro: introMatch?.[1]?.trim() || "",
    questions,
  };
}

export function normalizeAnswer(value: string): string {
  return [...value.replace(/[^A-F]/g, "")].sort().join("");
}

export function gradeQuiz(answer: string, correct: string): boolean {
  return normalizeAnswer(answer) === normalizeAnswer(correct);
}

// ===== 提醒升级机制：3h → 2h → 1h → 0.5h（之后每 0.5h）=====
const DAY_START_HOUR = 9;

export interface NudgeInfo {
  stage: number; // 当前应达到的提醒阶段（0 = 还未到第一次提醒）
  due: boolean; // 是否有未确认的新提醒
  message: string;
}

const NUDGE_MESSAGES = [
  "",
  "今日题集已送达 3 小时。趁脑子还清醒，先刷为敬。",
  "又过 2 小时。题不会自己做完，但拖延会自己长大。",
  "1 小时警告：昨天的题，你也是这么拖的。",
  "30 分钟。再不开始，今天的题就要和明天的题叠在一起了。",
  "最后通牒：现在不做，今晚的你会讨厌现在的你。",
];

export function computeNudge(
  day: string,
  status: string,
  acknowledgedStage: number,
  now = new Date(),
): NudgeInfo {
  if (status === "done") return { stage: 0, due: false, message: "" };
  const [y, m, d] = day.split("-").map(Number);
  const start = new Date(y, m - 1, d, DAY_START_HOUR, 0, 0);
  const elapsedMs = now.getTime() - start.getTime();
  if (elapsedMs <= 0) return { stage: 0, due: false, message: "" };

  const hours = elapsedMs / 3_600_000;
  let stage = 0;
  if (hours >= 6.5) stage = 4 + Math.floor((hours - 6.5) / 0.5);
  else if (hours >= 6) stage = 3;
  else if (hours >= 5) stage = 2;
  else if (hours >= 3) stage = 1;

  const capped = Math.min(stage, NUDGE_MESSAGES.length - 1);
  return {
    stage,
    due: stage > acknowledgedStage,
    message: NUDGE_MESSAGES[capped],
  };
}

export function todayKey(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}
