import "server-only";

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type InlineExtension,
  type ToolCallEvent,
  type ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { prisma } from "@/lib/prisma";
import {
  inspectBashCommand,
  redactForLog,
  resolveProjectPath,
  summarizeTool,
} from "@/lib/dawn-agent-security";
import { formatRuntimeContext } from "@/lib/dawn-agent-context";
import {
  approvalArguments,
  createChangePreview,
  type DawnChangePreview,
} from "@/lib/dawn-agent-diff";

type ApprovalResolution = {
  decision: "approved" | "denied" | "expired";
  selectedHunkIds?: string[];
};

export type DawnPermissionMode = "supervised" | "full_control";

type RuntimeRecord = {
  dbSessionId: string;
  root: string;
  session: AgentSession;
  unsubscribe: () => void;
  nextSequence: number;
  writeQueue: Promise<void>;
  assistantBuffer: string;
  busy: boolean;
  permissionMode: DawnPermissionMode;
  pendingApprovals: Map<string, (resolution: ApprovalResolution) => void>;
  toolStartedAt: Map<string, number>;
};

const DAWN_SYSTEM_APPEND = [
  "你是 Dawn Agent，一个运行在 DawnKB Web 端的本地项目 Agent。",
  "先理解项目，再做最小且可验证的改动；遵守项目中的 AGENTS.md 和已发现的 skills。",
  "read/grep/find/ls 适合先建立证据。修改文件与命令是否需要人工审批由 DawnKB 当前会话权限决定；不要自行绕过权限门。",
  "不要读取 .env、凭据、私钥或 .git 内部文件；不要执行 sudo、git commit、git push、发布或部署。",
  "不要输出隐藏思维过程。向用户说明结论、改动、验证结果和仍存在的风险即可。",
].join("\n");

function hashFile(filePath: string) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile())
    return "<missing>";
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function discoverProjectSkills(root: string) {
  const result: string[] = [];
  for (const base of [".pi/skills", ".agents/skills"]) {
    const directory = path.join(/* turbopackIgnore: true */ root, base);
    if (
      !fs.existsSync(/* turbopackIgnore: true */ directory) ||
      !fs.statSync(/* turbopackIgnore: true */ directory).isDirectory()
    )
      continue;
    for (const entry of fs.readdirSync(/* turbopackIgnore: true */ directory, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const skillDirectory = path.join(
        /* turbopackIgnore: true */ directory,
        entry.name,
      );
      if (
        fs.existsSync(
          /* turbopackIgnore: true */ path.join(skillDirectory, "SKILL.md"),
        )
      ) {
        result.push(skillDirectory);
      }
    }
  }
  return result;
}

function resultText(result: unknown) {
  try {
    const value = redactForLog(result);
    const text = JSON.stringify(value);
    return text.length > 12_000 ? text.slice(0, 12_000) + "…<truncated>" : text;
  } catch {
    return String(result).slice(0, 12_000);
  }
}

class DawnAgentRuntimeManager {
  private runtimes = new Map<string, RuntimeRecord>();
  private changeListeners = new Map<string, Set<() => void>>();
  private modelRuntimePromise: Promise<ModelRuntime> | null = null;

  private notifyChange(dbSessionId: string) {
    for (const listener of this.changeListeners.get(dbSessionId) ?? []) {
      try {
        listener();
      } catch {
        // A disconnected SSE listener must never interrupt the Agent runtime.
      }
    }
  }

  onSessionChange(dbSessionId: string, listener: () => void) {
    const listeners = this.changeListeners.get(dbSessionId) ?? new Set();
    listeners.add(listener);
    this.changeListeners.set(dbSessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.changeListeners.delete(dbSessionId);
    };
  }

  private getModelRuntime() {
    this.modelRuntimePromise ??= ModelRuntime.create();
    return this.modelRuntimePromise;
  }

  private appendEvent(record: RuntimeRecord, type: string, payload: unknown) {
    const sequence = record.nextSequence++;
    record.writeQueue = record.writeQueue
      .then(async () => {
        await prisma.dawnAgentEvent.create({
          data: {
            sessionId: record.dbSessionId,
            sequence,
            type,
            payload: redactForLog(payload) as never,
          },
        });
        this.notifyChange(record.dbSessionId);
      })
      .catch(() => {});
    return record.writeQueue;
  }

  private setSessionStatus(
    record: RuntimeRecord,
    status: string,
    data: { piSessionFile?: string; model?: string | null } = {},
  ) {
    const sequence = record.nextSequence++;
    record.writeQueue = record.writeQueue
      .then(async () => {
        await prisma.dawnAgentSession.update({
          where: { id: record.dbSessionId },
          data: { status, ...data },
        });
        await prisma.dawnAgentEvent.create({
          data: {
            sessionId: record.dbSessionId,
            sequence,
            type: "status",
            payload: { status },
          },
        });
        this.notifyChange(record.dbSessionId);
      })
      .catch(() => {});
    return record.writeQueue;
  }

  private async requestApproval(
    record: RuntimeRecord,
    event: ToolCallEvent,
    reason: string,
    riskLevel: string,
  ): Promise<ToolCallEventResult | undefined> {
    const input = event.input as Record<string, unknown>;
    let beforeHash: string | undefined;
    let preview: DawnChangePreview | null = null;
    if (
      (event.toolName === "edit" || event.toolName === "write") &&
      typeof input.path === "string"
    ) {
      beforeHash = hashFile(resolveProjectPath(record.root, input.path));
      preview = createChangePreview(record.root, event.toolName, input);
    }
    const approval = await prisma.dawnAgentApproval.upsert({
      where: {
        sessionId_toolCallId: {
          sessionId: record.dbSessionId,
          toolCallId: event.toolCallId,
        },
      },
      update: {
        status: "pending",
        decidedAt: null,
        arguments: approvalArguments(
          event.toolName,
          redactForLog(input) as Record<string, unknown>,
          beforeHash,
        ) as never,
        preview: preview as never,
        selectedHunks: undefined,
      },
      create: {
        sessionId: record.dbSessionId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        riskLevel,
        arguments: approvalArguments(
          event.toolName,
          redactForLog(input) as Record<string, unknown>,
          beforeHash,
        ) as never,
        preview: preview as never,
        summary: summarizeTool(event.toolName, input, reason),
      },
    });
    await prisma.dawnAgentSession.update({
      where: { id: record.dbSessionId },
      data: { status: "awaiting_approval" },
    });
    await this.appendEvent(record, "approval_required", {
      approvalId: approval.id,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      riskLevel,
      summary: approval.summary,
    });

    const resolution = await new Promise<ApprovalResolution>((resolve) => {
      record.pendingApprovals.set(approval.id, resolve);
      const timer = setTimeout(() => {
        if (!record.pendingApprovals.delete(approval.id)) return;
        void prisma.dawnAgentApproval
          .update({
            where: { id: approval.id },
            data: { status: "expired", decidedAt: new Date() },
          })
          .then(() => this.notifyChange(record.dbSessionId));
        resolve({ decision: "expired" });
      }, 10 * 60_000);
      record.pendingApprovals.set(approval.id, (value) => {
        clearTimeout(timer);
        record.pendingApprovals.delete(approval.id);
        resolve(value);
      });
    });

    if (
      resolution.decision === "approved" &&
      beforeHash &&
      typeof input.path === "string"
    ) {
      const afterHash = hashFile(resolveProjectPath(record.root, input.path));
      if (afterHash !== beforeHash) {
        await prisma.dawnAgentApproval.update({
          where: { id: approval.id },
          data: { status: "expired", decidedAt: new Date() },
        });
        await this.appendEvent(record, "security", {
          level: "warning",
          message: "审批期间目标文件发生变化，已取消本次工具调用。",
        });
        return {
          block: true,
          reason: "目标文件在审批期间发生变化，请重新发起修改",
        };
      }
    }
    if (resolution.decision === "approved" && preview?.kind === "edit") {
      const selectedIds = resolution.selectedHunkIds?.length
        ? resolution.selectedHunkIds
        : preview.hunks.map((hunk) => hunk.id);
      const selected = new Set(selectedIds);
      const edits = Array.isArray(input.edits) ? input.edits : [];
      input.edits = edits.filter((_, index) => selected.has(`h${index + 1}`));
      if ((input.edits as unknown[]).length === 0) {
        return { block: true, reason: "没有批准任何编辑块" };
      }
      const approvedPreview = createChangePreview(
        record.root,
        event.toolName,
        input,
      );
      await prisma.dawnAgentApproval.update({
        where: { id: approval.id },
        data: {
          preview: approvedPreview as never,
          selectedHunks: selectedIds as never,
        },
      });
      preview = approvedPreview;
    }
    await prisma.dawnAgentSession.update({
      where: { id: record.dbSessionId },
      data: { status: "running" },
    });
    return resolution.decision === "approved"
      ? undefined
      : {
          block: true,
          reason:
            resolution.decision === "expired"
              ? "审批已超时"
              : "用户拒绝了本次操作",
        };
  }

  private async recordAutomaticApproval(
    record: RuntimeRecord,
    event: ToolCallEvent,
    reason: string,
    riskLevel: string,
  ) {
    const input = event.input as Record<string, unknown>;
    let beforeHash: string | undefined;
    let preview: DawnChangePreview | null = null;
    if (
      (event.toolName === "edit" || event.toolName === "write") &&
      typeof input.path === "string"
    ) {
      beforeHash = hashFile(resolveProjectPath(record.root, input.path));
      preview = createChangePreview(record.root, event.toolName, input);
    }
    const selectedHunks =
      preview?.kind === "edit"
        ? preview.hunks.map((hunk) => hunk.id)
        : undefined;
    const approval = await prisma.dawnAgentApproval.upsert({
      where: {
        sessionId_toolCallId: {
          sessionId: record.dbSessionId,
          toolCallId: event.toolCallId,
        },
      },
      update: {
        status: "auto_approved",
        decidedAt: new Date(),
        arguments: approvalArguments(
          event.toolName,
          redactForLog(input) as Record<string, unknown>,
          beforeHash,
        ) as never,
        preview: preview as never,
        selectedHunks: selectedHunks as never,
      },
      create: {
        sessionId: record.dbSessionId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        riskLevel,
        arguments: approvalArguments(
          event.toolName,
          redactForLog(input) as Record<string, unknown>,
          beforeHash,
        ) as never,
        preview: preview as never,
        selectedHunks: selectedHunks as never,
        summary: summarizeTool(event.toolName, input, reason),
        status: "auto_approved",
        decidedAt: new Date(),
      },
    });
    await this.appendEvent(record, "approval_decision", {
      approvalId: approval.id,
      decision: "auto_approved",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      permissionMode: record.permissionMode,
    });
  }

  private async gateTool(
    record: RuntimeRecord,
    event: ToolCallEvent,
  ): Promise<ToolCallEventResult | undefined> {
    const input = event.input as Record<string, unknown>;
    try {
      if (
        ["read", "grep", "find", "ls", "edit", "write"].includes(event.toolName)
      ) {
        resolveProjectPath(record.root, input.path);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "路径未授权";
      await this.appendEvent(record, "security", {
        level: "blocked",
        toolName: event.toolName,
        reason,
      });
      return { block: true, reason };
    }

    if (event.toolName === "bash") {
      const command = String(input.command ?? "");
      const inspection = inspectBashCommand(command);
      if (inspection.action === "block") {
        await this.appendEvent(record, "security", {
          level: "blocked",
          toolName: "bash",
          reason: inspection.reason,
        });
        return { block: true, reason: inspection.reason };
      }
      if (inspection.action === "approve") {
        if (record.permissionMode === "full_control") {
          await this.recordAutomaticApproval(
            record,
            event,
            inspection.reason,
            inspection.riskLevel,
          );
          return undefined;
        }
        return this.requestApproval(
          record,
          event,
          inspection.reason,
          inspection.riskLevel,
        );
      }
      return undefined;
    }
    if (event.toolName === "edit" || event.toolName === "write") {
      if (record.permissionMode === "full_control") {
        await this.recordAutomaticApproval(
          record,
          event,
          "完全控制模式：项目内文件修改自动执行",
          "medium",
        );
        return undefined;
      }
      return this.requestApproval(
        record,
        event,
        "文件内容将发生变化",
        "medium",
      );
    }
    return undefined;
  }

  private subscribe(record: RuntimeRecord) {
    return record.session.subscribe((event) => {
      if (event.type === "agent_start") {
        void this.setSessionStatus(record, "running");
      } else if (
        event.type === "message_start" &&
        event.message.role === "assistant"
      ) {
        record.assistantBuffer = "";
      } else if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        record.assistantBuffer += event.assistantMessageEvent.delta;
      } else if (
        event.type === "message_end" &&
        event.message.role === "assistant"
      ) {
        const content = record.assistantBuffer.trim();
        if (content) void this.appendEvent(record, "assistant", { content });
        else {
          const errorMessage = (event.message as { errorMessage?: string })
            .errorMessage;
          if (errorMessage)
            void this.appendEvent(record, "error", { message: errorMessage });
        }
        record.assistantBuffer = "";
      } else if (event.type === "tool_execution_start") {
        record.toolStartedAt.set(event.toolCallId, Date.now());
        void this.appendEvent(record, "tool_start", {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        });
      } else if (event.type === "tool_execution_end") {
        const startedAt = record.toolStartedAt.get(event.toolCallId);
        record.toolStartedAt.delete(event.toolCallId);
        void this.appendEvent(record, "tool_end", {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
          durationMs: startedAt ? Math.max(0, Date.now() - startedAt) : null,
          result: resultText(event.result),
        });
      } else if (event.type === "agent_end" && !event.willRetry) {
        record.busy = false;
        void this.setSessionStatus(record, "idle", {
          piSessionFile: record.session.sessionFile,
          model: record.session.model
            ? record.session.model.provider + "/" + record.session.model.id
            : null,
        });
      }
    });
  }

  async load(dbSessionId: string) {
    const active = this.runtimes.get(dbSessionId);
    if (active) return active;
    const dbSession = await prisma.dawnAgentSession.findUnique({
      where: { id: dbSessionId },
      include: { project: true },
    });
    if (!dbSession) throw new Error("Dawn Agent 会话不存在");
    if (!dbSession.project.enabled) throw new Error("项目已停用");
    const root = fs.realpathSync(dbSession.project.realPath);
    if (root !== dbSession.project.realPath)
      throw new Error("项目真实路径已变化，请重新注册");

    await prisma.dawnAgentApproval.updateMany({
      where: { sessionId: dbSessionId, status: "pending" },
      data: { status: "expired", decidedAt: new Date() },
    });
    const latest = await prisma.dawnAgentEvent.aggregate({
      where: { sessionId: dbSessionId },
      _max: { sequence: true },
    });
    // 先建立闭包，再在 Pi session 创建后填入运行时记录。
    // eslint-disable-next-line prefer-const
    let record!: RuntimeRecord;
    const permissionExtension: InlineExtension = {
      name: "dawn-permission-gate",
      factory: (pi) => {
        pi.on("tool_call", (event) => this.gateTool(record, event));
      },
    };
    const agentDir = getAgentDir();
    const settingsManager = SettingsManager.create(root, agentDir);
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      additionalSkillPaths: discoverProjectSkills(root),
      extensionFactories: [permissionExtension],
      appendSystemPrompt: [DAWN_SYSTEM_APPEND],
    });
    await loader.reload();
    const sessionManager =
      dbSession.piSessionFile && fs.existsSync(dbSession.piSessionFile)
        ? SessionManager.open(dbSession.piSessionFile)
        : SessionManager.create(root);
    const modelRuntime = await this.getModelRuntime();
    const availableModels = await modelRuntime.getAvailable();
    const preferredProvider = settingsManager.getDefaultProvider();
    const preferredModelId = settingsManager.getDefaultModel();
    const selectedModel =
      availableModels.find(
        (model) =>
          model.provider === preferredProvider && model.id === preferredModelId,
      ) ??
      availableModels.find((model) => model.provider === preferredProvider) ??
      availableModels[0];
    if (!selectedModel) {
      throw new Error("Pi 没有可用模型，请先在 ~/.pi/agent 中配置模型与凭据");
    }
    const { session } = await createAgentSession({
      cwd: root,
      agentDir,
      resourceLoader: loader,
      settingsManager,
      sessionManager,
      modelRuntime,
      model: selectedModel,
      tools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
      thinkingLevel: dbSession.thinkingLevel as
        "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
    });
    record = {
      dbSessionId,
      root,
      session,
      unsubscribe: () => {},
      nextSequence: (latest._max.sequence ?? -1) + 1,
      writeQueue: Promise.resolve(),
      assistantBuffer: "",
      busy: false,
      permissionMode:
        dbSession.permissionMode === "full_control"
          ? "full_control"
          : "supervised",
      pendingApprovals: new Map(),
      toolStartedAt: new Map(),
    };
    record.unsubscribe = this.subscribe(record);
    this.runtimes.set(dbSessionId, record);
    await prisma.dawnAgentSession.update({
      where: { id: dbSessionId },
      data: {
        piSessionFile: session.sessionFile,
        model: session.model
          ? session.model.provider + "/" + session.model.id
          : null,
        status: "idle",
      },
    });
    this.notifyChange(dbSessionId);
    return record;
  }

  async prompt(dbSessionId: string, content: string) {
    const record = await this.load(dbSessionId);
    if (record.busy || record.session.isStreaming)
      throw new Error("当前会话仍在执行，请先等待或停止");
    record.busy = true;
    await this.appendEvent(record, "user", { content });
    await prisma.dawnAgentSession.update({
      where: { id: dbSessionId },
      data: { status: "running" },
    });
    this.notifyChange(dbSessionId);
    const dbSession = await prisma.dawnAgentSession.findUnique({
      where: { id: dbSessionId },
      include: {
        project: {
          include: {
            memories: {
              where: { enabled: true },
              orderBy: { updatedAt: "desc" },
              take: 40,
            },
          },
        },
      },
    });
    const memoryBlock = dbSession?.project.memories.length
      ? [
          "以下是用户维护的项目长期记忆。把它作为偏好与既有决策；若与当前项目文件冲突，以项目文件为准并指出冲突。",
          ...dbSession.project.memories.map(
            (memory) => `- [${memory.kind}] ${memory.title}：${memory.content}`,
          ),
        ]
          .join("\n")
          .slice(0, 18_000)
      : "";
    const handoffBlock = formatRuntimeContext(dbSession?.context);
    const runtimePrompt = [
      handoffBlock ? `<dawn_handoff>\n${handoffBlock}\n</dawn_handoff>` : "",
      memoryBlock ? `<project_memory>\n${memoryBlock}\n</project_memory>` : "",
      `<user_task>\n${content}\n</user_task>`,
    ]
      .filter(Boolean)
      .join("\n\n");
    void record.session.prompt(runtimePrompt).catch(async (error) => {
      record.busy = false;
      await this.appendEvent(record, "error", {
        message: error instanceof Error ? error.message : "Dawn Agent 执行失败",
      });
      await prisma.dawnAgentSession.update({
        where: { id: dbSessionId },
        data: { status: "error" },
      });
      this.notifyChange(dbSessionId);
    });
  }

  async abort(dbSessionId: string) {
    const record = this.runtimes.get(dbSessionId);
    if (record) {
      for (const resolve of record.pendingApprovals.values())
        resolve({ decision: "denied" });
      record.pendingApprovals.clear();
      await record.session.abort();
      record.busy = false;
      await this.appendEvent(record, "status", { status: "stopped" });
    }
    await prisma.dawnAgentApproval.updateMany({
      where: { sessionId: dbSessionId, status: "pending" },
      data: { status: "denied", decidedAt: new Date() },
    });
    await prisma.dawnAgentSession.update({
      where: { id: dbSessionId },
      data: { status: "stopped" },
    });
    this.notifyChange(dbSessionId);
  }

  async setPermissionMode(
    dbSessionId: string,
    permissionMode: DawnPermissionMode,
  ) {
    const record = this.runtimes.get(dbSessionId);
    if (!record) {
      this.notifyChange(dbSessionId);
      return;
    }
    record.permissionMode = permissionMode;
    await this.appendEvent(record, "permission_mode", { permissionMode });
    if (permissionMode !== "full_control") return;

    const pending = await prisma.dawnAgentApproval.findMany({
      where: { sessionId: dbSessionId, status: "pending" },
      orderBy: { createdAt: "asc" },
    });
    for (const approval of pending) {
      const resolver = record.pendingApprovals.get(approval.id);
      if (!resolver) continue;
      const preview = approval.preview as DawnChangePreview | null;
      const selectedHunkIds =
        preview?.kind === "edit"
          ? preview.hunks.map((hunk) => hunk.id)
          : undefined;
      await prisma.dawnAgentApproval.update({
        where: { id: approval.id },
        data: {
          status: "auto_approved",
          decidedAt: new Date(),
          selectedHunks: selectedHunkIds as never,
        },
      });
      await this.appendEvent(record, "approval_decision", {
        approvalId: approval.id,
        decision: "auto_approved",
        selectedHunkIds,
        permissionMode,
      });
      resolver({ decision: "approved", selectedHunkIds });
    }
  }

  async decide(
    dbSessionId: string,
    approvalId: string,
    decision: "approved" | "denied",
    selectedHunkIds?: string[],
  ) {
    const approval = await prisma.dawnAgentApproval.findFirst({
      where: { id: approvalId, sessionId: dbSessionId },
    });
    if (!approval || approval.status !== "pending")
      throw new Error("审批不存在或已处理");
    const record = this.runtimes.get(dbSessionId);
    const resolver = record?.pendingApprovals.get(approvalId);
    if (!record || !resolver) {
      await prisma.dawnAgentApproval.update({
        where: { id: approvalId },
        data: { status: "expired", decidedAt: new Date() },
      });
      throw new Error("Agent 运行时已重启，请重新发起操作");
    }
    const preview = approval.preview as DawnChangePreview | null;
    if (
      decision === "approved" &&
      preview?.kind === "edit" &&
      selectedHunkIds
    ) {
      const allowedIds = new Set(preview.hunks.map((hunk) => hunk.id));
      if (
        selectedHunkIds.length === 0 ||
        selectedHunkIds.some((id) => !allowedIds.has(id))
      ) {
        throw new Error("所选编辑块无效，请刷新变更后重新审批");
      }
    }
    await prisma.dawnAgentApproval.update({
      where: { id: approvalId },
      data: {
        status: decision,
        decidedAt: new Date(),
        selectedHunks: selectedHunkIds as never,
      },
    });
    await this.appendEvent(record, "approval_decision", {
      approvalId,
      decision,
      selectedHunkIds,
    });
    resolver({ decision, selectedHunkIds });
  }

  dispose(dbSessionId: string) {
    const record = this.runtimes.get(dbSessionId);
    if (!record) return;
    record.unsubscribe();
    record.session.dispose();
    this.runtimes.delete(dbSessionId);
  }
}

declare global {
  var __dawnAgentRuntime: DawnAgentRuntimeManager | undefined;
}

export const dawnAgentRuntime =
  globalThis.__dawnAgentRuntime ?? new DawnAgentRuntimeManager();
globalThis.__dawnAgentRuntime = dawnAgentRuntime;
