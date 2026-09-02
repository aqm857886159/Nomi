// 自定义调用的 IPC 面（main.ts 800 行门：域逻辑住这里，main 只两行接线——同 comfyuiIpc 模式）。
// 三条通道：契约（编辑器变量表/模板）、AI 生成指令（主进程拼好给渲染层文本脑）、试跑（真调）。
import { ipcMain } from "electron";
import crypto from "node:crypto";
import { isJsonRecord, trim } from "../jsonUtils";
import {
  buildCustomCallAiInstruction,
  CUSTOM_CALL_RETURN_CONTRACT,
  CUSTOM_CALL_TEMPLATES,
  CUSTOM_CALL_VARIABLES,
} from "./customCallContract";
import { CustomCallScriptError, runCustomCallScript } from "./customCallRunner";
import {
  listModelCatalogCustomCallConfig,
  readCatalog,
  upsertModelCatalogCustomCallConfig,
} from "./catalogStore";
import { decryptApiKeyRecord, decryptCustomConfigWithLegacy } from "./secrets";
import { registerCustomCallDraftIpc } from "./customCallDraftIpc";
import type { ProfileKind } from "./types";
import { createCustomCallTestRunRegistry, type CustomCallTestRunInput, type CustomCallTestRunResult } from "./customCallTestRuns";

import { assertTrustedSender } from "../ipcSenderGuard";
import { desktopT } from "../i18n";
function resolveTarget(vendorKey: string, modelKey: string) {
  const state = readCatalog();
  const vendor = state.vendors.find((v) => v.key === vendorKey);
  if (!vendor) throw new Error(desktopT("catalog.vendorMissing", { vendor: vendorKey }));
  const model = state.models.find((m) => m.vendorKey === vendorKey && m.modelKey === modelKey);
  if (!model) throw new Error(desktopT("catalog.modelMissing", { vendor: vendorKey, model: modelKey }));
  const apiKey = decryptApiKeyRecord(state.apiKeysByVendor[vendorKey]) || "";
  const customConfig = decryptCustomConfigWithLegacy(state.apiKeysByVendor[vendorKey], vendor.meta);
  return { vendor, model, apiKey, customConfig };
}

/** 试跑用的最小 canned 请求：够上游成一次最便宜的活，不带参考素材。 */
function cannedTestInput(kind: string): { prompt: string; params: Record<string, unknown> } {
  if (kind === "video") {
    return { prompt: "a red apple rolling on a wooden table, soft daylight", params: { duration: 5, n: 1 } };
  }
  return { prompt: "a red apple on a wooden table, soft daylight, studio photo", params: { n: 1 } };
}

function cannedTaskKind(kind: string): ProfileKind {
  if (kind === "video") return "text_to_video";
  if (kind === "audio") return "text_to_audio";
  if (kind === "model3d") return "text_to_3d";
  if (kind === "text") return "prompt_refine";
  return "text_to_image";
}

/** 试跑的 saveFile 只做小结果预览，不把数据写进项目，也不让视频变成巨型 data URL。 */
const TEST_SAVE_FILE_MAX_BYTES = 4 * 1024 * 1024;
async function previewSavedFile(bytes: Buffer, contentType: string): Promise<string> {
  if (bytes.byteLength > TEST_SAVE_FILE_MAX_BYTES) {
    throw new Error(desktopT("customCall.previewFileTooLarge"));
  }
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

function testTimeoutMs(kind: string): number {
  if (kind === "video") return 5 * 60 * 1000;
  if (kind === "text") return 60 * 1000;
  return 2 * 60 * 1000;
}

async function executeCustomCallTest(
  input: CustomCallTestRunInput,
  signal: AbortSignal,
): Promise<CustomCallTestRunResult> {
  const started = Date.now();
  try {
    const { vendor, model, apiKey, customConfig } = resolveTarget(input.vendorKey, input.modelKey);
    if (!input.script.trim()) throw new Error(desktopT("customCall.emptyScript"));
    const canned = cannedTestInput(model.kind);
    const taskKind = input.taskKind || cannedTaskKind(model.kind);
    const executed = await runCustomCallScript({
      vendor,
      model,
      apiKey,
      customConfig,
      script: input.script,
      prompt: input.prompt?.trim() || canned.prompt,
      params: input.params || canned.params,
      taskKind,
      modeId: input.modeId,
      signal,
      timeoutMs: testTimeoutMs(model.kind),
      saveFile: (bytes, _ext, contentType) => previewSavedFile(bytes, contentType),
    });
    return {
      ok: true,
      assets: executed.assets,
      ...(executed.text !== undefined ? { text: executed.text } : {}),
      transcript: executed.transcript,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const transcript = error instanceof CustomCallScriptError ? error.transcript : [];
    return {
      ok: false,
      assets: [],
      errorMessage: error instanceof Error ? error.message : String(error),
      transcript,
      durationMs: Date.now() - started,
    };
  }
}

const customCallTestRuns = createCustomCallTestRunRegistry({ execute: executeCustomCallTest });

export function registerCustomCallIpc(registerSyncIpc: (channel: string, handler: (...args: never[]) => unknown) => void): void {
  registerCustomCallDraftIpc(registerSyncIpc);
  registerSyncIpc("nomi:model-catalog:custom-call:config:get", ((vendorKey: string) =>
    listModelCatalogCustomCallConfig(trim(vendorKey))) as (...args: never[]) => unknown);
  registerSyncIpc("nomi:model-catalog:custom-call:config:save", ((vendorKey: string, payload: unknown) => {
    const entries = isJsonRecord(payload) && Array.isArray(payload.entries) ? payload.entries : [];
    return upsertModelCatalogCustomCallConfig(trim(vendorKey), entries);
  }) as (...args: never[]) => unknown);
  registerSyncIpc("nomi:model-catalog:custom-call:contract", () => ({
    variables: CUSTOM_CALL_VARIABLES.map((v) => ({ name: v.name, type: v.type })),
    returnContract: CUSTOM_CALL_RETURN_CONTRACT,
    templates: CUSTOM_CALL_TEMPLATES,
  }));

  registerSyncIpc("nomi:model-catalog:custom-call:ai-instruction", ((payload: unknown) => {
    const raw = (payload || {}) as Record<string, unknown>;
    const vendorKey = trim(raw.vendorKey);
    const modelKey = trim(raw.modelKey);
    const { vendor, model } = resolveTarget(vendorKey, modelKey);
    return buildCustomCallAiInstruction({
      modelKey: model.modelAlias || model.modelKey,
      kind: model.kind,
      baseUrl: String(vendor.baseUrlHint || ""),
      material: String(raw.material || ""),
      currentScript: trim(raw.currentScript) || undefined,
      lastError: trim(raw.lastError) || undefined,
      taskKind: trim(raw.taskKind) || undefined,
      modeId: trim(raw.modeId) || undefined,
    });
  }) as (...args: never[]) => unknown);

  ipcMain.handle("nomi:model-catalog:custom-call:test-run", async (event, payload) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as Record<string, unknown>;
    const vendorKey = trim(raw.vendorKey);
    const modelKey = trim(raw.modelKey);
    const script = typeof raw.script === "string" ? raw.script : "";
    const runId = trim(raw.runId) || crypto.randomUUID();
    customCallTestRuns.start({
      runId,
      vendorKey,
      modelKey,
      script,
      taskKind: (trim(raw.taskKind) as ProfileKind) || undefined,
      modeId: trim(raw.modeId) || undefined,
      prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
      params: isJsonRecord(raw.params) ? raw.params : undefined,
    });
    return customCallTestRuns.wait(runId);
  });

  ipcMain.handle("nomi:model-catalog:custom-call:test-get", async (event, payload) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as Record<string, unknown>;
    return customCallTestRuns.get(trim(raw.runId)) || null;
  });

  ipcMain.handle("nomi:model-catalog:custom-call:test-latest", async (event, payload) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as Record<string, unknown>;
    const run = customCallTestRuns.latest({
      vendorKey: trim(raw.vendorKey),
      modelKey: trim(raw.modelKey),
      modeId: trim(raw.modeId) || undefined,
    });
    return {
      run: run || null,
      matchesScript: Boolean(run && typeof raw.script === "string" && customCallTestRuns.matchesScript(run, raw.script)),
    };
  });

  ipcMain.handle("nomi:model-catalog:custom-call:test-cancel", async (event, payload) => {
    assertTrustedSender(event);
    const raw = (payload || {}) as Record<string, unknown>;
    return customCallTestRuns.cancel(trim(raw.runId)) || null;
  });
}
