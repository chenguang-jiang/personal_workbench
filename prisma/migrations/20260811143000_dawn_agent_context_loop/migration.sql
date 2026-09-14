-- Dawn Agent 上下文交接、可审查 Diff 与项目长期记忆。

ALTER TABLE "DawnAgentSession"
ADD COLUMN "context" JSONB;

ALTER TABLE "DawnAgentApproval"
ADD COLUMN "preview" JSONB,
ADD COLUMN "selectedHunks" JSONB;

CREATE TABLE "DawnAgentMemory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'fact',
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "sourceRef" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DawnAgentMemory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DawnAgentHandoff" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "sourcePath" TEXT,
    "sourceRef" TEXT,
    "selectedText" TEXT,
    "context" TEXT,
    "instruction" TEXT,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "projectId" TEXT,
    "sessionId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DawnAgentHandoff_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DawnAgentMemory_projectId_enabled_updatedAt_idx"
ON "DawnAgentMemory"("projectId", "enabled", "updatedAt");

CREATE INDEX "DawnAgentHandoff_status_createdAt_idx"
ON "DawnAgentHandoff"("status", "createdAt");

CREATE INDEX "DawnAgentHandoff_projectId_createdAt_idx"
ON "DawnAgentHandoff"("projectId", "createdAt");

CREATE INDEX "DawnAgentHandoff_sessionId_idx"
ON "DawnAgentHandoff"("sessionId");

ALTER TABLE "DawnAgentMemory"
ADD CONSTRAINT "DawnAgentMemory_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "DawnAgentProject"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DawnAgentHandoff"
ADD CONSTRAINT "DawnAgentHandoff_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "DawnAgentProject"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DawnAgentHandoff"
ADD CONSTRAINT "DawnAgentHandoff_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "DawnAgentSession"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
