/**
 * 运行时一族（制作 run / 任务 / 事件 / 能力核 / 技能 / Agent lane）的 preload 桥面。
 *
 * 从 electron/preload.ts 抽出来（R9：preload.ts 顶着 800 行硬上限，每加一条桥都在撞线）。
 * 这里**只搬家、不改行为**：每个键、每条频道名、每句注释都逐字保留，preload.ts 用 `...runtimeBridge` 组装，暴露给渲染层的对象形状逐字节不变。
 */
import { ipcRenderer } from "electron";
import { invokeSync } from "./ipcCall";
import { LANE_IPC_CHANNELS, type LaneWorkspaceProjection } from '../shared/agentLane/laneContracts';
import type { LaneDesktopCommand } from '../shared/agentLane/laneDesktopContracts';

export const runtimeBridge = {
  productionRuns: {
    list: (projectId: string) => ipcRenderer.invoke("nomi:production-runs:list", { projectId }),
    read: (projectId: string, runId: string) => ipcRenderer.invoke("nomi:production-runs:read", { projectId, runId }),
    createDraft: (payload: unknown) => ipcRenderer.invoke("nomi:production-runs:create-draft", payload),
    command: (projectId: string, runId: string, command: unknown) =>
      ipcRenderer.invoke("nomi:production-runs:command", { projectId, runId, command }),
    materializeStoryboard: (projectId: string, runId: string, artifactId: string, expectedVersion: number) =>
      ipcRenderer.invoke("nomi:production-runs:materialize-storyboard", { projectId, runId, artifactId, expectedVersion }),
    events: (projectId: string, runId: string, afterCursor: number) =>
      ipcRenderer.invoke("nomi:production-runs:events", { projectId, runId, afterCursor }),
    // P4 S6：返工一镜（同 Run 新 Job + 单镜确认 + 派发）；续拍已停批次（续额度还是直接接着拍，主进程照 Run 记下的停下原因定）。
    rework: (projectId: string, runId: string, shotId?: string) =>
      ipcRenderer.invoke("nomi:production-runs:rework", { projectId, runId, ...(shotId ? { shotId } : {}) }),
    resumeBatch: (projectId: string, runId: string) =>
      ipcRenderer.invoke("nomi:production-runs:resume-batch", { projectId, runId }),
    // 2026-09-11 Agent 面板付费确认卡：卡上改参数 / 丢弃草稿 / 确认并开跑。待决出价本身随对话投影推过来（2026-10-05），这里没有读口。
    reviseSpend: (payload: unknown) => ipcRenderer.invoke("nomi:production-runs:revise-spend", payload),
    discardSpend: (projectId: string, operationId: string, quoteId: string, identity?: object) =>
      ipcRenderer.invoke("nomi:production-runs:discard-spend", { projectId, operationId, quoteId, ...(identity ?? {}) }),
    confirmSpend: (projectId: string, operationId: string, quoteId: string, shotId?: string, identity?: object) =>
      ipcRenderer.invoke("nomi:production-runs:confirm-spend", { projectId, operationId, quoteId, ...(shotId === undefined ? {} : { shotId }), ...(identity ?? {}) }),
    removeSpendShot: (projectId: string, operationId: string, quoteId: string, shotId: string, identity?: object) =>
      ipcRenderer.invoke("nomi:production-runs:remove-spend-shot", { projectId, operationId, quoteId, shotId, ...(identity ?? {}) }),
    confirmSpendRemaining: (projectId: string, operationId: string, quoteId: string, shotIds: readonly string[], identity?: object) =>
      ipcRenderer.invoke("nomi:production-runs:confirm-spend-remaining", { projectId, operationId, quoteId, shotIds: [...shotIds], ...(identity ?? {}) }),
  },
  tasks: {
    cancel: (taskId: string) => ipcRenderer.invoke("nomi:tasks:cancel", taskId) as Promise<{ ok: boolean }>,
    run: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:run", payload),
    result: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:result", payload),
    canvasSubmit: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:canvas-submit", payload),
    canvasPoll: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:canvas-poll", payload),
    canvasRelease: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:canvas-release", payload),
    canvasConsent: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:canvas-consent", payload) as Promise<{ runIds: string[] }>,
    canvasWithdraw: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:canvas-withdraw", payload),
    runComfyCandidateTest: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:comfy-candidate-test", payload),
    cancelComfyCandidateTest: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:comfy-candidate-cancel", payload),
    // 付费守卫令牌：只剩附属付费口（新手页工作流试生成）在用；画布不再铸令牌。
    grantSpend: (payload: unknown) =>
      ipcRenderer.invoke("nomi:tasks:grant-spend", payload) as Promise<{ grantId: string }>,
    // 文本任务流式（逐 token）：start 返回 streamId，onTextEvent 收 delta/done/error。
    runTextStream: (payload: unknown) =>
      ipcRenderer.invoke("nomi:tasks:text:stream", payload) as Promise<{ streamId: string }>,
    cancelTextStream: (streamId: string) => ipcRenderer.invoke("nomi:tasks:text:cancel", { streamId }),
    onTextEvent: (streamId: string, callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: { streamId: string; event: unknown }) => {
        if (payload && payload.streamId === streamId) callback(payload.event);
      };
      ipcRenderer.on("nomi:tasks:text:event", listener as never);
      return () => {
        ipcRenderer.removeListener("nomi:tasks:text:event", listener as never);
      };
    },
    // ComfyUI ws 进度桥（P 轨）：watch 登记 → 主进程推 progress/preview/queue/done；interrupt=安全定向取消。
    comfyuiWatch: (payload: unknown) => ipcRenderer.invoke("nomi:tasks:comfyui:watch", payload),
    comfyuiUnwatch: (promptId: string) => ipcRenderer.invoke("nomi:tasks:comfyui:unwatch", promptId),
    comfyuiInterrupt: (promptId: string) => ipcRenderer.invoke("nomi:tasks:comfyui:interrupt", promptId),
    onComfyuiProgress: (callback: (event: unknown) => void) => {
      const listener = (_event: unknown, payload: unknown) => callback(payload);
      ipcRenderer.on("nomi:tasks:comfyui:progress", listener as never);
      return () => {
        ipcRenderer.removeListener("nomi:tasks:comfyui:progress", listener as never);
      };
    },
  },
  events: {
    append: (projectId: string, events: unknown[]) =>
      ipcRenderer.invoke("nomi:events:append", { projectId, events }) as Promise<{
        ok: boolean;
        count: number;
        lastSeq: number;
      }>,
    read: (projectId: string, fromSeq: number) =>
      ipcRenderer.invoke("nomi:events:read", { projectId, fromSeq }) as Promise<{ ok: boolean; events: unknown[] }>,
    generationEtaStats: (projectId: string) =>
      ipcRenderer.sendSync('nomi:events:generation-eta-stats', { projectId }) as { ok: boolean; stats: unknown[] },
  },
  capability: {
    // 「接入 AI 编程助手」卡：读状态/配置 + 一键写入/撤销 ~/.claude.json。
    mcpInfo: () => invokeSync("nomi:capability:mcp-info"),
    installMcp: (client?: string) => invokeSync("nomi:capability:mcp-install", client),
    uninstallMcp: (client?: string) => invokeSync("nomi:capability:mcp-uninstall", client),
    mcpMigrationState: () => ipcRenderer.invoke("nomi:capability:mcp-migration-state"),
    migrateMcpHosts: (consent: string, clients: string[]) => ipcRenderer.invoke("nomi:capability:mcp-migrate", { consent, clients }),
    // 自定义 MCP 客户端 profile（方案 A：任意支持 MCP stdio 的工具接入）。
    listCustomMcpProfiles: () => ipcRenderer.invoke("nomi:capability:mcp-custom-profiles"),
    registerCustomMcpProfile: (profile: unknown) => ipcRenderer.invoke("nomi:capability:mcp-custom-profile-register", profile),
    removeCustomMcpProfile: (key: string) => ipcRenderer.invoke("nomi:capability:mcp-custom-profile-remove", key),
    // 自定义客户端列表变化的实时回流：外部进程（mcpNodeLauncher）检测写入文件后，主进程 watch 到变化广播到这里。
    onMcpProfilesChanged: (cb: () => void) => {
      const listener = () => cb()
      ipcRenderer.on("nomi:mcp:profiles-changed", listener)
      return () => ipcRenderer.removeListener("nomi:mcp:profiles-changed", listener)
    },
    // 实连验证（异步）：真起一次配置里那条命令握手，用来分辨「配置里有这行字」和「还真连得上」。
    verifyMcp: (client?: string) => ipcRenderer.invoke("nomi:capability:mcp-verify", client),
    // A 模式实时桥：主进程把外部 MCP 的画布读/写/付费确认转发到这里，渲染层处理后回结果（按 id 配对）。
    onApply: (handler: (op: string, payload: unknown) => unknown | Promise<unknown>) => {
      const listener = (_event: unknown, message: { id?: number; op?: string; payload?: unknown }) => {
        const id = message?.id;
        void (async () => {
          try {
            const result = await handler(String(message?.op || ""), message?.payload);
            ipcRenderer.send("nomi:capability:apply-reply", { id, ok: true, result });
          } catch (error) {
            ipcRenderer.send("nomi:capability:apply-reply", {
              id,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })();
      };
      ipcRenderer.on("nomi:capability:apply", listener);
      return () => ipcRenderer.removeListener("nomi:capability:apply", listener);
    },
  },
  skill: {
    // 读目录的两条走 invoke：目录由 pi 的加载器给（async）。改盘的两条仍是 invokeSync，渲染层拿到 {ok,…} 不是 Promise。
    // 每条通道两侧协议必须一致（`check:skill-ipc-coverage`）。
    list: () => ipcRenderer.invoke("nomi:skill:list"),
    exportPackage: (dirName: string) => ipcRenderer.invoke("nomi:skill:export", dirName),
    importPackage: (payload: unknown) => invokeSync("nomi:skill:import", payload),
    deleteByDir: (dirName: string) => invokeSync("nomi:skill:delete", dirName),
    /** 技能盘变了（导入/删除/Agent 写完落盘）。范式与 modelCatalog.onChanged 一致。 */
    onChanged: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on("nomi:skill-library:changed", listener);
      return () => { ipcRenderer.removeListener("nomi:skill-library:changed", listener); };
    },
  },
  agentLane: {
    send: (command: LaneDesktopCommand) => ipcRenderer.invoke(LANE_IPC_CHANNELS.command, command),
    onProjection: (handler: (projection: LaneWorkspaceProjection) => void) => {
      const listener = (_event: unknown, projection: LaneWorkspaceProjection) => handler(projection);
      ipcRenderer.on(LANE_IPC_CHANNELS.projection, listener);
      return () => ipcRenderer.removeListener(LANE_IPC_CHANNELS.projection, listener);
    },
  },
};
