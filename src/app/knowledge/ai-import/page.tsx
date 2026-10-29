import { PageHeader } from "@/components/ui/PageHeader";
import { ImportHub } from "@/components/knowledge/ImportHub";

export const metadata = { title: "导入 · DawnKB" };

export default function AiImportPage() {
  return (
    <div className="page-frame page-frame--wide ai-import-page">
      <PageHeader
        eyebrow="IMPORT"
        title="把内容收进知识库"
        description="四种方式随你挑：和 AI 聊着归档，或直接上传文档、粘贴正文、给出链接——归档后搜索、知识关系和索引页都会同步更新。"
      />
      <ImportHub />
    </div>
  );
}
