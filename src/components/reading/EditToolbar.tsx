"use client";

import { useEffect, useState, type RefObject } from "react";
import {
  Bold,
  Braces,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Strikethrough,
  Table,
  TextQuote,
  Workflow,
} from "lucide-react";
import { insertBlockAtSelection, markDirty } from "@/lib/table-edit";

/**
 * 编辑态格式工具栏（对标钉钉文档）：在渲染后的正文上直接套格式，
 * 保存时由 serializeProse 反序列化回 Markdown。所有按钮在 mousedown
 * 阶段阻止默认行为，保住正文里的选区/光标。
 */
export function EditToolbar({
  containerRef,
  onInsertTable,
  onInsertMermaid,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  onInsertTable: () => void;
  onInsertMermaid: () => void;
}) {
  const [active, setActive] = useState<Record<string, boolean>>({});

  function proseEl() {
    return containerRef.current?.querySelector<HTMLElement>(".reader-prose");
  }

  // 光标是否落在正文里；工具栏操作前必须确认，否则格式会打不到任何地方
  function selectionInProse(): { prose: HTMLElement; node: Element | null } | null {
    const prose = proseEl();
    if (!prose) return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const anchor = selection.anchorNode;
    const el =
      anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
    if (!el || !prose.contains(el)) return null;
    return { prose, node: el };
  }

  function exec(command: string, value?: string) {
    const found = selectionInProse();
    if (!found) return;
    found.prose.focus();
    document.execCommand(command, false, value);
    markDirty(found.prose);
  }

  // 块级格式切换：已在目标块里则退回段落
  function toggleBlock(tag: "h2" | "h3" | "blockquote") {
    const found = selectionInProse();
    if (!found) return;
    const inside = found.node?.closest(tag);
    exec("formatBlock", inside ? "<p>" : `<${tag}>`);
  }

  // 行内包裹（删除线/行内码等 execCommand 产出不可控的格式）：
  // 抽出选区包进目标元素；无选区时插入占位文本并把光标放进元素里
  function wrapInline(tag: "del" | "code", placeholder: string) {
    const found = selectionInProse();
    if (!found) return;
    const { prose } = found;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const element = document.createElement(tag);
    if (range.collapsed) {
      element.textContent = placeholder;
      range.insertNode(element);
      // 光标移到占位文本末尾，方便直接续打
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      element.appendChild(range.extractContents());
      range.insertNode(element);
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    prose.focus();
    markDirty(prose);
  }

  function insertLink() {
    const found = selectionInProse();
    if (!found) return;
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() ?? "";
    const input = window.prompt(
      "链接地址：填 https://… 为外链，填 vault 路径（如 锦浪/VPP/某文档）为文内链接",
      "",
    );
    if (!input) return;
    const target = input.trim();
    if (!target) return;
    if (/^https?:\/\//i.test(target)) {
      exec("createLink", target);
      return;
    }
    // vault 目标：serializeProse 会把带 data-resolve 的 <a> 还原成 [[链接]]
    wrapInlineAnchor(target, selectedText || target.split("/").pop() || target);
  }

  function wrapInlineAnchor(target: string, label: string) {
    const found = selectionInProse();
    if (!found) return;
    const { prose } = found;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const anchor = document.createElement("a");
    anchor.className = "reader-wikilink";
    anchor.dataset.resolve = target;
    anchor.textContent = label;
    if (range.collapsed) {
      range.insertNode(anchor);
      range.setStartAfter(anchor);
      range.collapse(true);
    } else {
      anchor.appendChild(range.extractContents());
      range.insertNode(anchor);
      range.setStartAfter(anchor);
      range.collapse(true);
    }
    selection.removeAllRanges();
    selection.addRange(range);
    prose.focus();
    markDirty(prose);
  }

  function insertCodeBlock() {
    const found = selectionInProse();
    if (!found) return;
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = "代码块";
    pre.appendChild(code);
    insertBlockAtSelection(found.prose, pre);
    code.focus();
    markDirty(found.prose);
  }

  // 选区变化时同步按钮激活态，给用户“当前在哪类格式里”的反馈
  useEffect(() => {
    function sync() {
      const found = selectionInProse();
      if (!found) {
        setActive({});
        return;
      }
      const el = found.node;
      setActive({
        bold: safeQueryState("bold"),
        italic: safeQueryState("italic"),
        strike: safeQueryState("strikeThrough"),
        ul: safeQueryState("insertUnorderedList"),
        ol: safeQueryState("insertOrderedList"),
        h2: Boolean(el?.closest("h2")),
        h3: Boolean(el?.closest("h3")),
        quote: Boolean(el?.closest("blockquote")),
      });
    }
    document.addEventListener("selectionchange", sync);
    return () => document.removeEventListener("selectionchange", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="reader-edit-toolbar" role="toolbar" aria-label="格式工具栏">
      <div className="reader-edit-toolbar__group">
        <button
          type="button"
          data-active={active.h2 || undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggleBlock("h2")}
          title="标题（大）"
          aria-label="二级标题"
        >
          <Heading2 aria-hidden="true" />
        </button>
        <button
          type="button"
          data-active={active.h3 || undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggleBlock("h3")}
          title="标题（小）"
          aria-label="三级标题"
        >
          <Heading3 aria-hidden="true" />
        </button>
      </div>
      <div className="reader-edit-toolbar__group">
        <button
          type="button"
          data-active={active.bold || undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => exec("bold")}
          title="加粗（⌘B）"
          aria-label="加粗"
        >
          <Bold aria-hidden="true" />
        </button>
        <button
          type="button"
          data-active={active.italic || undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => exec("italic")}
          title="斜体（⌘I）"
          aria-label="斜体"
        >
          <Italic aria-hidden="true" />
        </button>
        <button
          type="button"
          data-active={active.strike || undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => exec("strikeThrough")}
          title="删除线"
          aria-label="删除线"
        >
          <Strikethrough aria-hidden="true" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => wrapInline("code", "行内代码")}
          title="行内代码"
          aria-label="行内代码"
        >
          <Code aria-hidden="true" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={insertLink}
          title="链接（外链或文内链接）"
          aria-label="链接"
        >
          <Link2 aria-hidden="true" />
        </button>
      </div>
      <div className="reader-edit-toolbar__group">
        <button
          type="button"
          data-active={active.ul || undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => exec("insertUnorderedList")}
          title="无序列表"
          aria-label="无序列表"
        >
          <List aria-hidden="true" />
        </button>
        <button
          type="button"
          data-active={active.ol || undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => exec("insertOrderedList")}
          title="有序列表"
          aria-label="有序列表"
        >
          <ListOrdered aria-hidden="true" />
        </button>
        <button
          type="button"
          data-active={active.quote || undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggleBlock("blockquote")}
          title="引用"
          aria-label="引用"
        >
          <TextQuote aria-hidden="true" />
        </button>
      </div>
      <div className="reader-edit-toolbar__group">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={insertCodeBlock}
          title="代码块"
          aria-label="代码块"
        >
          <Braces aria-hidden="true" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => exec("insertHorizontalRule")}
          title="分割线"
          aria-label="分割线"
        >
          <Minus aria-hidden="true" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onInsertTable}
          title="插入表格"
          aria-label="插入表格"
        >
          <Table aria-hidden="true" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onInsertMermaid}
          title="插入流程图（Mermaid）"
          aria-label="插入流程图"
        >
          <Workflow aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function safeQueryState(command: string) {
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}
