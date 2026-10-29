import { redirect } from "next/navigation";

// 传统导入已并入统一导入入口（对话 / 上传 / 粘贴 / 链接四种方式）。
export default function KnowledgeImportPage() {
  redirect("/knowledge/ai-import");
}
