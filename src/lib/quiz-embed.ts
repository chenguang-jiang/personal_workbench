/**
 * 阅读器内嵌题块：把「A. xxx B. xxx C. xxx D. xxx」挤在一行的选项段落
 * 拆成逐行可勾选的选项（checkbox 记录我的选择，存 localStorage）。
 */

/** 从文件名/标题中提取题集日期（20260813 或 2026-08-13） */
export function quizDayFromName(name: string): string | null {
  const compact = name.match(/(\d{4})(\d{2})(\d{2})(?=\.md|$)/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const dashed = name.match(/(\d{4}-\d{2}-\d{2})(?=\.md|$)/);
  return dashed ? dashed[1] : null;
}

export interface QuizEmbedOption {
  key: string;
  text: string;
}

const OPTION_PATTERN = /([A-F])[.、]\s*/g;

/** 识别并拆分连排选项段落：必须以 A 开头且字母连续 */
export function splitQuizOptions(text: string): QuizEmbedOption[] | null {
  const matches = [...text.matchAll(OPTION_PATTERN)];
  if (matches.length < 3) return null;
  const first = matches[0];
  if (first[1] !== "A" || (first.index ?? 0) > 0) return null;
  for (let i = 0; i < matches.length; i += 1) {
    if (matches[i][1] !== String.fromCharCode(65 + i)) return null;
  }
  return matches.map((match, i) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? text.length : text.length;
    return { key: match[1], text: text.slice(start, end).trim() };
  });
}

function storageKey(articleId: string, index: number): string {
  return `quiz-embed-picks:${articleId}:${index}`;
}

export function loadPicks(articleId: string | null, index: number): string[] {
  if (!articleId || typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(articleId, index));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function savePicks(
  articleId: string | null,
  index: number,
  keys: string[],
): void {
  if (!articleId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(articleId, index), JSON.stringify(keys));
  } catch {
    // 忽略存储失败
  }
}

/** 扫描 prose 内的选项段落，替换为可勾选选项列表 */
export function enhanceQuizSections(root: HTMLElement, articleId: string | null) {
  const paragraphs = Array.from(root.querySelectorAll<HTMLElement>("p"));
  let index = 0;
  for (const p of paragraphs) {
    if (p.closest(".quiz-embed-options")) continue;
    const text = (p.textContent ?? "").trim();
    const options = splitQuizOptions(text);
    if (!options) continue;
    const blockIndex = index;
    index += 1;

    const wrap = document.createElement("div");
    wrap.className = "quiz-embed-options";
    wrap.dataset.quizIndex = String(blockIndex);
    const picks = loadPicks(articleId, blockIndex);
    for (const option of options) {
      const label = document.createElement("label");
      label.className = "quiz-embed-option";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "quiz-embed-check";
      box.dataset.key = option.key;
      box.checked = picks.includes(option.key);
      const key = document.createElement("span");
      key.className = "quiz-embed-key";
      key.textContent = `${option.key}.`;
      const body = document.createElement("span");
      body.className = "quiz-embed-text";
      // 保留选项间空格，保证 textContent 与原文一致（高亮定位依赖）
      body.textContent = `${option.text} `;
      label.append(box, key, body);
      wrap.appendChild(label);
    }
    p.replaceWith(wrap);
  }
}

/** 勾选变化时持久化当前选项块的选择 */
export function handleQuizCheckChange(
  target: EventTarget | null,
  articleId: string | null,
): void {
  const input = target as HTMLInputElement | null;
  if (!input || !input.classList?.contains("quiz-embed-check")) return;
  const wrap = input.closest<HTMLElement>(".quiz-embed-options");
  if (!wrap) return;
  const index = Number(wrap.dataset.quizIndex ?? "0");
  const keys = Array.from(wrap.querySelectorAll<HTMLInputElement>("input:checked"))
    .map((box) => box.dataset.key ?? "")
    .filter(Boolean);
  savePicks(articleId, index, keys);
}

// ===== 内嵌题块 ↔ 题库题目 对齐（错题本收录用）=====

/** 签名归一：去掉空白与 markdown 标记，比较纯文本 */
export function normalizeSigText(text: string): string {
  return text.replace(/[\s*`_~]/g, "");
}

export function optionsSignature(options: { text: string }[]): string {
  return options.map((option) => normalizeSigText(option.text)).join("|");
}

export function domOptionsSignature(block: HTMLElement): string {
  const texts = Array.from(
    block.querySelectorAll<HTMLElement>(".quiz-embed-text"),
  ).map((el) => (el.textContent ?? "").trim());
  return texts.map(normalizeSigText).join("|");
}

export function createWrongButton(on: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = on
    ? "quiz-embed-wrong-btn quiz-embed-wrong-btn--on"
    : "quiz-embed-wrong-btn";
  // 文案走 CSS attr()，避免污染 prose textContent（高亮定位依赖纯文本）
  button.dataset.label = on ? "已收录错题" : "收录错题";
  return button;
}
