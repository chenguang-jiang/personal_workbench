"use client";

import { useState } from "react";
import { FileText, Link2, Sparkles, UploadCloud } from "lucide-react";
import { AiImportChat } from "./AiImportChat";
import { ClassicImport, type ClassicImportMode } from "./ClassicImport";

type ImportTab = "chat" | ClassicImportMode;

const TABS: { id: ImportTab; label: string; icon: typeof Sparkles }[] = [
  { id: "chat", label: "对话导入", icon: Sparkles },
  { id: "file", label: "上传文档", icon: UploadCloud },
  { id: "text", label: "粘贴内容", icon: FileText },
  { id: "link", label: "链接导入", icon: Link2 },
];

/**
 * 统一导入入口：四种方式共用一个页面。
 * 两个面板始终保持挂载（用 hidden 隐藏），切换 tab 不丢失对话进度与未提交的草稿。
 */
export function ImportHub() {
  const [tab, setTab] = useState<ImportTab>("chat");

  return (
    <div className="import-hub">
      <div className="import-hub-tabs" role="tablist" aria-label="导入方式">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`import-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`import-panel-${id === "chat" ? "chat" : "classic"}`}
            onClick={() => setTab(id)}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <div
        className="import-hub-panel"
        role="tabpanel"
        id="import-panel-chat"
        aria-labelledby="import-tab-chat"
        hidden={tab !== "chat"}
      >
        <AiImportChat />
      </div>
      <div
        className="import-hub-panel"
        role="tabpanel"
        id="import-panel-classic"
        aria-labelledby={tab === "chat" ? undefined : `import-tab-${tab}`}
        hidden={tab === "chat"}
      >
        <ClassicImport mode={tab === "chat" ? "file" : tab} />
      </div>
    </div>
  );
}
