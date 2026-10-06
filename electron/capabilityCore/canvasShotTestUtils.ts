import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 画布付费口（appIntegrationCanvasShot）的测试装配：真仓库、真 Run 服务、真收据机构、真提交出口、真派发闸；
// 只有画布那台的传输（runtime.runTask(…, RUN_APPROVED_ADMISSION) / fetchTaskResult）换成进程内的假供应商。
// 单节点 ↑、批量卡、双扣地图的端到端测试共用这一份，免得每份测试各搭一套、各漏一处真实边界。

import { createApprovalReceiptAuthority } from "./approvalReceipt";
import { canvasLocalArtifactReceipt, createCanvasShotRuns, type CanvasConsentShot, type CanvasShotRequest } from "./appIntegrationCanvasShot";
import { createCanvasTransportProvider, type CanvasTaskResult, type CanvasTransport } from "./canvasTransportProvider";
import { createProductionGenerationSubmission } from "../productionRun/productionGenerationSubmission";
import { createProductionRunRepository } from "../productionRun/productionRunRepository";
import { createProductionRunService } from "../productionRun/productionRunService";
import { createProductionShotDispatchGuard } from "../productionRun/productionShotDispatchGuard";
import type { WorkspaceProjectRecordV2 } from "../workspace/workspaceTypes";

export const CANVAS_TEST_PROJECT = "project-1";

export type CanvasTestVendor = {
  executes: Array<{ vendor: string; request: CanvasShotRequest }>;
  fetches: string[];
  answer: (call: number) => Promise<CanvasTaskResult>;
  poll: (taskId: string, call: number) => CanvasTaskResult;
};

export function canvasTestRequest(nodeId: string, prompt = "a red cube", extras: Record<string, unknown> = {}): CanvasShotRequest {
  return { kind: "text_to_image", prompt, extras: { nodeId, projectId: CANVAS_TEST_PROJECT, modelKey: "img-model", idempotencyKey: "k", ...extras } };
}

export function setupCanvasShots(options: {
  previewBlock?: "rendering" | "failed" | null;
  root?: string;
  repository?: ReturnType<typeof createProductionRunRepository>;
  now?: () => string;
  observe?: (submission: unknown, projectId: string, runId: string) => void;
  /** 换掉画布那台的传输（缺省 = 进程内假供应商）。「没发出去」矩阵用它接真的 vendorHttp → appFetch。 */
  transport?: CanvasTransport;
} = {}) {
  const root = options.root ?? fs.mkdtempSync(path.join(os.tmpdir(), "nomi-canvas-shot-"));
  const imagePath = path.join(root, "assets", "out.png");
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, "png-bytes");
  const asset = { type: "image", url: `nomi-local://asset/${CANVAS_TEST_PROJECT}/assets/out.png` };
  const vendor: CanvasTestVendor = {
    executes: [], fetches: [],
    answer: async () => ({ id: `task-sync-${vendor.executes.length}`, kind: "text_to_image", status: "succeeded", assets: [asset], raw: {} }),
    poll: (taskId) => ({ id: taskId, kind: "text_to_image", status: "succeeded", assets: [asset], raw: {} }),
  };
  const transport: CanvasTransport = {
    execute: async (payload) => { vendor.executes.push(structuredClone(payload) as CanvasTestVendor["executes"][number]); return vendor.answer(vendor.executes.length); },
    fetchResult: async (payload) => { vendor.fetches.push(String(payload.taskId)); return { result: vendor.poll(String(payload.taskId), vendor.fetches.length) }; },
  };
  const repository = options.repository ?? createProductionRunRepository({ projectDirResolver: (id) => (id === CANVAS_TEST_PROJECT ? root : null), ...(options.now ? { now: options.now } : {}) });
  const receipts = createApprovalReceiptAuthority({ filePath: path.join(root, "receipts.json"), macKey: "k", storeMacKey: "s", keyId: "v1", ...(options.now ? { now: options.now } : {}) });
  const service = createProductionRunService({
    repository, projectRootResolver: () => root, requestRenderer: async () => { throw new Error("no renderer"); },
    approvalReceiptAuthority: receipts, projectRevisionResolver: () => 0,
  });
  const providers = [createCanvasTransportProvider("acme", options.transport ?? transport)];
  const observed: Array<[string, string]> = [];
  const previewCalls: string[] = [];
  const runs = createCanvasShotRuns({
    service,
    readProject: () => ({ id: CANVAS_TEST_PROJECT, immutableProjectUuid: "uuid-1", projectGeneration: 1, revision: 3 }) as unknown as WorkspaceProjectRecordV2,
    resolveProjectRoot: () => root,
    receipts,
    providers: () => providers,
    buildSubmission: (input) => createProductionGenerationSubmission({
      repository, projectRoot: input.projectRoot, immutableProjectUuid: input.immutableProjectUuid, projectGeneration: input.projectGeneration,
      intentMacKey: "intent-key", providers: input.providers,
      beforeDispatch: createProductionShotDispatchGuard({ readRun: (projectId, runId) => repository.read(projectId, runId) ?? undefined }),
      materializeOutput: async ({ projectId, providerTaskId, output }) => canvasLocalArtifactReceipt({ projectId, projectRoot: root, providerTaskId, output })!,
      ...(options.now ? { now: options.now } : {}),
    }),
    previewBlock: async (_projectId, nodeId) => { previewCalls.push(nodeId); return options.previewBlock ?? null; },
    quote: () => ({ known: false }),
    observe: (submission, projectId, runId) => { observed.push([projectId, runId]); options.observe?.(submission, projectId, runId); },
    ...(options.now ? { now: options.now } : {}),
  });
  const gesture = { webContentsId: 7, frameId: 1, origin: "app://nomi" };
  /** 单节点 ↑ 或批量卡上轮到的那一镜：渲染层「交」。 */
  const submit = (nodeId: string, runRecordId: string, prompt?: string, extras?: Record<string, unknown>) => runs.submit({
    projectId: CANVAS_TEST_PROJECT, nodeId, runRecordId, vendor: "acme", request: canvasTestRequest(nodeId, prompt, extras), gesture, senderId: 7,
  });
  /** 批量卡上点了确认：卡上列出的这几个节点各开一份出价。 */
  const consent = (shots: Array<Pick<CanvasConsentShot, "nodeId" | "runRecordId">>, senderId = 7) => runs.consent({
    projectId: CANVAS_TEST_PROJECT, senderId,
    shots: shots.map((shot) => ({ ...shot, vendor: "acme", modelKey: "img-model", kind: "image" })),
  });
  const withdraw = (runRecordIds: string[], by: "removed" | "user_closed" | "stopped") => runs.withdraw({ projectId: CANVAS_TEST_PROJECT, runRecordIds, by });
  return { root, repository, runs, vendor, observed, previewCalls, submit, consent, withdraw, receipts };
}
