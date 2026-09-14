-- Dawn Agent 与头脑风暴知识库模式。
-- 该迁移由当前数据库状态到目标 schema 的增量差异生成，不重建现有表。

ALTER TABLE "BrainstormSession" ADD COLUMN "citations" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "groundingPolicy" TEXT NOT NULL DEFAULT 'strict',
ADD COLUMN "knowledgeSpaceId" TEXT,
ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'reasoning';

CREATE TABLE "KnowledgeSpace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "scope" JSONB NOT NULL DEFAULT '{"type":"vault","folders":[],"articleIds":[]}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeSpace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "vaultPath" TEXT,
    "title" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DawnAgentProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "realPath" TEXT NOT NULL,
    "trustLevel" TEXT NOT NULL DEFAULT 'standard',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DawnAgentProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DawnAgentSession" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "piSessionFile" TEXT,
    "model" TEXT,
    "thinkingLevel" TEXT NOT NULL DEFAULT 'high',
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DawnAgentSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DawnAgentEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DawnAgentEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DawnAgentApproval" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "arguments" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DawnAgentApproval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KnowledgeSpace_isDefault_idx" ON "KnowledgeSpace"("isDefault");
CREATE INDEX "KnowledgeChunk_articleId_idx" ON "KnowledgeChunk"("articleId");
CREATE INDEX "KnowledgeChunk_vaultPath_idx" ON "KnowledgeChunk"("vaultPath");
CREATE INDEX "KnowledgeChunk_contentHash_idx" ON "KnowledgeChunk"("contentHash");
CREATE UNIQUE INDEX "KnowledgeChunk_articleId_chunkIndex_key" ON "KnowledgeChunk"("articleId", "chunkIndex");
CREATE UNIQUE INDEX "DawnAgentProject_realPath_key" ON "DawnAgentProject"("realPath");
CREATE INDEX "DawnAgentProject_lastOpenedAt_idx" ON "DawnAgentProject"("lastOpenedAt");
CREATE INDEX "DawnAgentSession_projectId_updatedAt_idx" ON "DawnAgentSession"("projectId", "updatedAt");
CREATE INDEX "DawnAgentSession_status_idx" ON "DawnAgentSession"("status");
CREATE INDEX "DawnAgentEvent_sessionId_createdAt_idx" ON "DawnAgentEvent"("sessionId", "createdAt");
CREATE UNIQUE INDEX "DawnAgentEvent_sessionId_sequence_key" ON "DawnAgentEvent"("sessionId", "sequence");
CREATE INDEX "DawnAgentApproval_sessionId_status_idx" ON "DawnAgentApproval"("sessionId", "status");
CREATE UNIQUE INDEX "DawnAgentApproval_sessionId_toolCallId_key" ON "DawnAgentApproval"("sessionId", "toolCallId");
CREATE INDEX "BrainstormSession_mode_idx" ON "BrainstormSession"("mode");
CREATE INDEX "BrainstormSession_knowledgeSpaceId_idx" ON "BrainstormSession"("knowledgeSpaceId");

ALTER TABLE "BrainstormSession" ADD CONSTRAINT "BrainstormSession_knowledgeSpaceId_fkey"
FOREIGN KEY ("knowledgeSpaceId") REFERENCES "KnowledgeSpace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_articleId_fkey"
FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DawnAgentSession" ADD CONSTRAINT "DawnAgentSession_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "DawnAgentProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DawnAgentEvent" ADD CONSTRAINT "DawnAgentEvent_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "DawnAgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DawnAgentApproval" ADD CONSTRAINT "DawnAgentApproval_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "DawnAgentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
