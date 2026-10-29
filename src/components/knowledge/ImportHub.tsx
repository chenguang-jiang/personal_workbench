"use client";

import { AiImportChat } from "./AiImportChat";

/**
 * 统一智能导入：
 * 整合原「对话导入、上传文档、粘贴内容、链接导入」四个功能为单一全能工作台。
 * 支持同时上传文档附件与图片、输入正文或网页链接，外加自定义语言要求与整理指令。
 */
export function ImportHub() {
  return (
    <div className="import-hub">
      <AiImportChat />
    </div>
  );
}
