-- 移除 Dawn Agent 功能：删除其全部数据表（先子表后父表）
DROP TABLE IF EXISTS "DawnAgentEvent" CASCADE;
DROP TABLE IF EXISTS "DawnAgentApproval" CASCADE;
DROP TABLE IF EXISTS "DawnAgentHandoff" CASCADE;
DROP TABLE IF EXISTS "DawnAgentSession" CASCADE;
DROP TABLE IF EXISTS "DawnAgentMemory" CASCADE;
DROP TABLE IF EXISTS "DawnAgentProject" CASCADE;
