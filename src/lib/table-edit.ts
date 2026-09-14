/**
 * 编辑态下的表格增删改 DOM 工具。
 * 直接操作 .reader-prose 内渲染出的 <table>，保存时由 serializeProse 反向序列化回 Markdown。
 * 注入的工具栏（.reader-table-toolbar）位于 .reader-table-wrap 内部，
 * serializeBlock 只读取其中的 <table>，因此不会被写回正文。
 */

/** 触发 input 事件，让编辑器标记 dirty（未保存修改） */
export function markDirty(prose: HTMLElement) {
  prose.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 表格最大列数（以所有行中最长的为准） */
export function getTableColumnCount(table: HTMLTableElement): number {
  let max = 0;
  for (const row of Array.from(table.rows)) {
    max = Math.max(max, row.cells.length);
  }
  return max;
}

/** 空单元格放一个 <br>：可点击聚焦、可输入；序列化时 <br> 会被还原为空白 */
function makeCell(tag: "th" | "td"): HTMLTableCellElement {
  const cell = document.createElement(tag);
  cell.appendChild(document.createElement("br"));
  return cell;
}

/**
 * 插入一行。anchorRow 为空时追加到表尾。
 * 返回新行（供聚焦首个单元格）。
 */
export function insertRow(
  table: HTMLTableElement,
  anchorRow: HTMLTableRowElement | null,
  position: "above" | "below",
): HTMLTableRowElement {
  const cols = Math.max(1, getTableColumnCount(table));
  const row = document.createElement("tr");
  for (let index = 0; index < cols; index += 1) row.appendChild(makeCell("td"));

  if (anchorRow?.parentNode) {
    if (position === "above") anchorRow.parentNode.insertBefore(row, anchorRow);
    else anchorRow.parentNode.insertBefore(row, anchorRow.nextSibling);
  } else {
    const tbody =
      table.tBodies[0] ?? table.appendChild(document.createElement("tbody"));
    tbody.appendChild(row);
  }
  return row;
}

/**
 * 插入一列。index 为插入位置（0 起），越界或为 -1 时追加到最右。
 * 表头行的单元格保持 th，其余为 td。
 */
export function insertColumn(table: HTMLTableElement, index: number) {
  for (const row of Array.from(table.rows)) {
    const isHead = row.parentElement?.tagName === "THEAD";
    const cell = makeCell(isHead ? "th" : "td");
    const ref =
      index >= 0 && index < row.cells.length ? row.cells[index] : null;
    if (ref) row.insertBefore(cell, ref);
    else row.appendChild(cell);
  }
}

/**
 * 删除一行。表格只剩一行时拒绝（整表删除走「删除表格」）。
 * 若删掉的是表头行，把第一行正文升为表头，保证序列化后的 Markdown 表格仍合法。
 */
export function deleteRow(
  table: HTMLTableElement,
  row: HTMLTableRowElement,
): boolean {
  if (table.rows.length <= 1) return false;
  const wasHeadRow = row.parentElement?.tagName === "THEAD";
  row.remove();

  if (wasHeadRow) {
    const thead = table.querySelector("thead");
    const firstBodyRow = table.querySelector<HTMLTableRowElement>("tbody tr");
    if (thead && firstBodyRow) {
      thead.appendChild(firstBodyRow);
      for (const cell of Array.from(firstBodyRow.cells)) {
        const th = document.createElement("th");
        th.innerHTML = cell.innerHTML;
        cell.replaceWith(th);
      }
    } else if (thead && !thead.querySelector("tr")) {
      thead.remove();
    }
  }
  return true;
}

/** 删除一列（所有行的第 index 个单元格）。只剩一列时拒绝。 */
export function deleteColumn(table: HTMLTableElement, index: number): boolean {
  const cols = getTableColumnCount(table);
  if (cols <= 1 || index < 0 || index >= cols) return false;
  for (const row of Array.from(table.rows)) {
    row.cells[index]?.remove();
  }
  return true;
}

/** 创建空白表格（表头 1 行 + rows 行正文，cols 列） */
export function createTable(rows = 2, cols = 3): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "reader-table-wrap";

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (let index = 0; index < cols; index += 1) headRow.appendChild(makeCell("th"));
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  for (let r = 0; r < rows; r += 1) {
    const row = document.createElement("tr");
    for (let c = 0; c < cols; c += 1) row.appendChild(makeCell("td"));
    tbody.appendChild(row);
  }

  table.append(thead, tbody);
  wrap.appendChild(table);
  return wrap;
}

/** 找到光标所在的块级元素（prose 直接子级或 markdown fragment 的直接子级） */
function findInsertionBlock(prose: HTMLElement): Element | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  let node: Node | null = selection.getRangeAt(0).commonAncestorContainer;
  while (node && node !== prose) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) return null;
    if (parent === prose) return node as Element;
    if (parent.classList.contains("reader-markdown-fragment")) {
      return node as Element;
    }
    node = parent;
  }
  return null;
}

/**
 * 在光标所在块之后插入新表格；没有光标时追加到文末。
 * 插入后聚焦首个单元格并标记 dirty。
 */
export function insertTableAtSelection(prose: HTMLElement) {
  const wrap = createTable(2, 3);
  const block = findInsertionBlock(prose);

  if (block && prose.contains(block)) {
    if (block.parentElement === prose) block.after(wrap);
    else block.after(wrap);
  } else {
    const fragments = prose.querySelectorAll(".reader-markdown-fragment");
    const last = fragments[fragments.length - 1];
    if (last) last.appendChild(wrap);
    else prose.appendChild(wrap);
  }

  const firstCell = wrap.querySelector<HTMLElement>("th, td");
  firstCell?.focus();
  markDirty(prose);
}

export type TableNotice = (message: string, isError?: boolean) => void;

const ROW_SEL = "table-row-selected";
const COL_SEL = "table-col-selected";

/** 清除正文内所有行/列选中样式 */
function clearSelection(prose: HTMLElement) {
  prose
    .querySelectorAll(`.${ROW_SEL}, .${COL_SEL}`)
    .forEach((el) => el.classList.remove(ROW_SEL, COL_SEL));
}

/** 点选单元格：高亮整行与整列，让「删选中行/列」的目标一目了然 */
function applySelection(prose: HTMLElement, cell: HTMLTableCellElement) {
  clearSelection(prose);
  const table = cell.closest("table");
  if (!table) return;
  (cell.parentElement as HTMLTableRowElement | null)?.classList.add(ROW_SEL);
  const colIndex = cell.cellIndex;
  for (const row of Array.from(table.rows)) {
    row.cells[colIndex]?.classList.add(COL_SEL);
  }
}

interface TableTool {
  action: string;
  label: string;
  title: string;
  danger?: boolean;
}

const TABLE_TOOLS: TableTool[] = [
  { action: "row-above", label: "+行上", title: "在当前行上方插入一行" },
  { action: "row-below", label: "+行下", title: "在当前行下方插入一行" },
  { action: "col-left", label: "+列左", title: "在当前列左侧插入一列" },
  { action: "col-right", label: "+列右", title: "在当前列右侧插入一列" },
  { action: "row-delete", label: "删选中行", title: "删除选中行（先点击该行任一单元格）", danger: true },
  { action: "col-delete", label: "删选中列", title: "删除选中列（先点击该列任一单元格）", danger: true },
  { action: "table-delete", label: "删表格", title: "删除整个表格", danger: true },
];

/**
 * 编辑态：为每个表格注入操作工具栏，并接管点击。
 * 返回清理函数（退出编辑态时调用）。
 */
export function injectTableToolbars(
  prose: HTMLElement,
  notify: TableNotice,
): () => void {
  let activeCell: HTMLTableCellElement | null = null;

  // contentEditable 里单元格不是独立可聚焦元素（activeElement 始终是 prose），
  // 只能从当前选区 anchor 反推光标所在单元格
  function cellFromSelection(): HTMLTableCellElement | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const node = sel.anchorNode;
    if (!node || !prose.contains(node)) return null;
    const el =
      node.nodeType === Node.TEXT_NODE
        ? node.parentElement
        : (node as Element | null);
    const cell = el && "closest" in el ? el.closest("td, th") : null;
    return (cell as HTMLTableCellElement | null) ?? null;
  }

  function refreshSelectionFromCaret() {
    const cell = cellFromSelection();
    if (cell) {
      activeCell = cell;
      applySelection(prose, cell);
    } else {
      // 光标已移出表格：清掉残留的选中样式与目标
      activeCell = null;
      clearSelection(prose);
    }
  }

  function handleFocusIn() {
    refreshSelectionFromCaret();
  }

  // 焦点离开 prose 后清除选中样式（延迟一拍，避免切换时闪烁）
  function handleFocusOut() {
    window.setTimeout(() => {
      const active = document.activeElement;
      const stillInside =
        active instanceof HTMLElement && prose.contains(active);
      if (!stillInside) {
        clearSelection(prose);
      }
    }, 0);
  }

  // mousedown 阶段拦截，避免按钮抢走单元格焦点（activeCell 得以保留）
  function handleMouseDown(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(".reader-table-toolbar")) event.preventDefault();
  }

  function handleClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    const button = target?.closest?.(".table-tool") as HTMLButtonElement | null;
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();

    const wrap = button.closest(".reader-table-wrap");
    const table = wrap?.querySelector("table");
    if (!table) return;

    // 优先用跟踪到的选中单元格，其次回退到当前选区
    const cell =
      activeCell && table.contains(activeCell)
        ? activeCell
        : cellFromSelection();
    const row = (cell?.parentElement ?? null) as HTMLTableRowElement | null;
    const colIndex = cell ? cell.cellIndex : -1;

    switch (button.dataset.action) {
      case "row-above":
      case "row-below": {
        const inserted = insertRow(
          table,
          row,
          button.dataset.action === "row-above" ? "above" : "below",
        );
        inserted.cells[0]?.focus();
        notify(
          button.dataset.action === "row-above" ? "已在上方插入一行" : "已在下方插入一行",
        );
        break;
      }
      case "col-left":
      case "col-right": {
        const at =
          colIndex < 0
            ? -1
            : button.dataset.action === "col-left"
              ? colIndex
              : colIndex + 1;
        insertColumn(table, at);
        notify(
          button.dataset.action === "col-left" ? "已在左侧插入一列" : "已在右侧插入一列",
        );
        break;
      }
      case "row-delete": {
        if (!row) {
          notify("请先点击要删除的行", true);
          return;
        }
        if (!deleteRow(table, row)) {
          notify("表格至少保留一行，可点「删表格」移除整表", true);
          return;
        }
        activeCell = null;
        clearSelection(prose);
        notify("已删除选中行");
        break;
      }
      case "col-delete": {
        if (colIndex < 0) {
          notify("请先点击要删除的列", true);
          return;
        }
        if (!deleteColumn(table, colIndex)) {
          notify("表格至少保留一列，可点「删表格」移除整表", true);
          return;
        }
        activeCell = null;
        clearSelection(prose);
        notify("已删除选中列");
        break;
      }
      case "table-delete": {
        if (!window.confirm("删除整个表格？保存后不可恢复。")) return;
        wrap?.remove();
        activeCell = null;
        notify("已删除表格");
        break;
      }
      default:
        return;
    }
    markDirty(prose);
  }

  prose.addEventListener("focusin", handleFocusIn);
  prose.addEventListener("focusout", handleFocusOut);
  prose.addEventListener("mouseup", refreshSelectionFromCaret);
  prose.addEventListener("keyup", refreshSelectionFromCaret);
  prose.addEventListener("mousedown", handleMouseDown);
  prose.addEventListener("click", handleClick);

  for (const wrap of Array.from(
    prose.querySelectorAll<HTMLElement>(".reader-table-wrap"),
  )) {
    if (wrap.querySelector(".reader-table-toolbar")) continue;
    const toolbar = document.createElement("div");
    toolbar.className = "reader-table-toolbar";
    toolbar.contentEditable = "false";
    for (const tool of TABLE_TOOLS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = tool.danger
        ? "table-tool table-tool--danger"
        : "table-tool";
      button.dataset.action = tool.action;
      button.textContent = tool.label;
      button.title = tool.title;
      toolbar.appendChild(button);
    }
    wrap.prepend(toolbar);
  }

  return () => {
    prose.removeEventListener("focusin", handleFocusIn);
    prose.removeEventListener("focusout", handleFocusOut);
    prose.removeEventListener("mouseup", refreshSelectionFromCaret);
    prose.removeEventListener("keyup", refreshSelectionFromCaret);
    prose.removeEventListener("mousedown", handleMouseDown);
    prose.removeEventListener("click", handleClick);
    prose
      .querySelectorAll(".reader-table-toolbar")
      .forEach((toolbar) => toolbar.remove());
  };
}
