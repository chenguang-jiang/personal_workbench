import { PageHeader } from "@/components/ui/PageHeader";
import { ImportHub } from "@/components/knowledge/ImportHub";

export const metadata = { title: "导入 · DawnKB" };

export default function AiImportPage() {
  return (
    <div className="page-frame page-frame--wide ai-import-page">
      <PageHeader
        eyebrow="AI IMPORT"
        title="全能智能导入"
        description="支持上传文档与图片附件、粘贴文本或网页链接，外加自定义语言要求与整理提示，AI 自动完成结构化归档与索引更新。"
      />
      <ImportHub />
    </div>
  );
}
