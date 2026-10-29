/**
 * 解析并应用大模型返回的 SEARCH / REPLACE 补丁块。
 * 格式与 Aider / standard diff patch 一致：
 *
 * <<<<<<< SEARCH
 * 原文中待替换或删除的文本片段
 * =======
 * 替换后的新文本（若删除则留空）
 * >>>>>>> REPLACE
 */
export function applySearchReplaceBlocks(
  source: string,
  patchText: string,
): { content: string; count: number } {
  const regex =
    /<{5,9}\s*SEARCH\r?\n([\s\S]*?)\r?\n={5,9}\r?\n([\s\S]*?)\r?\n?>{5,9}\s*REPLACE/g;
  let match: RegExpExecArray | null;
  let modified = source;
  let count = 0;

  while ((match = regex.exec(patchText)) !== null) {
    const search = match[1];
    const replace = match[2];
    if (search === undefined || replace === undefined) continue;

    // 1. 精确匹配
    if (search && modified.includes(search)) {
      modified = modified.replace(search, () => replace);
      count++;
      continue;
    }

    // 2. 修剪两端首尾空白匹配
    if (search) {
      const trimmed = search.trim();
      if (trimmed && modified.includes(trimmed)) {
        modified = modified.replace(trimmed, () => replace.trim());
        count++;
        continue;
      }
    }

    // 3. 换行符归一化匹配（处理 Windows \r\n 与 Unix \n 差异）
    if (search) {
      const normalizedSource = modified.replace(/\r\n/g, "\n");
      const normalizedSearch = search.replace(/\r\n/g, "\n");
      if (normalizedSource.includes(normalizedSearch)) {
        modified = normalizedSource.replace(normalizedSearch, () =>
          replace.replace(/\r\n/g, "\n"),
        );
        count++;
      }
    }
  }

  return { content: modified, count };
}
