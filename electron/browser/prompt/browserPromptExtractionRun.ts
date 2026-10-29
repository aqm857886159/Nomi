// 浏览器「提取提示词」的主进程那一端（2026-10-27，设计卡 docs/plan/2026-10-27-browser-extract-grant.md）。
//
// 修之前：渲染层直接经 `nomi:tasks:run` 发读图任务，没人铸令牌，每次都在 runtime 的付费闸被拒（供应商 0 次、库里 0 条）。
// 现在整次提取住在这里，照拆解（electron/video/deconstructSpend.ts）的先例走那条唯一的链：
//   报价身份 = 执行身份（findExecutableModel）→ confirmSpendAndMintGrant 弹卡问人、铸令牌 → 带令牌发这一次调用。
// 令牌不出主进程；温度、maxTokens、任务种类只在这里定。
//
// **每次都问**（不传 askWhenCallsAbove）：页内图片上的「提取」是注入在远端网页里的按钮，网页自己就能伪造那一下点击，
// 所以「点了就算确认」在这个入口上不成立。卡写清来源页（主进程拿到的真实地址）、哪张图、哪个读图模型。
// 工具栏的「截图提取」也经这里：两个入口一条规则。
//
// 同一时刻只挂一张提取卡：卡开着时再来的请求直接回 busy（不排队、不弹第二张），网页刷不出一叠卡。
import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import { assertTrustedSender } from "../../ipcSenderGuard";
import { confirmSpendAndMintGrant } from "../../spendConfirmGrant";
import { findExecutableModel } from "../../catalog/executableModel";
import { runTaskIpcGuard } from "../../tasks/taskIpcGuard";
import { logWarn } from "../../logging/logger";
import { registerBrowserPromptExtractionSettingsIpc } from "../settings/browserPromptExtractionSettings";
import {
  PROMPT_EXTRACTION_SPEND_INTENT,
  encodePromptExtractionSubject,
  promptExtractionSubjectOf,
  type BrowserPromptExtractionMode,
  type BrowserPromptExtractionRunOutcome,
  type BrowserPromptExtractionRunRequest,
} from "../../shared/contracts/browserPromptExtraction";

type RunTask = (payload: unknown) => Promise<unknown>;
type RuntimeLoader = () => Promise<{ runTask: RunTask }>;

/** 两种提取方式的读图参数（原写在渲染层，挪过来后只在这一处定；报价与真实调用用同一份）。 */
const EXTRACTION_PARAMETERS: Record<BrowserPromptExtractionMode, { temperature: number; maxTokens: number }> = {
  replicate: { temperature: 0.35, maxTokens: 1600 },
  style: { temperature: 0.2, maxTokens: 1800 },
};

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** 窄 payload：缺模型、缺指令、缺图一律整次拒（这几样渲染层在发起前就该备齐）。 */
export function parseBrowserPromptExtractionRunRequest(payload: unknown): BrowserPromptExtractionRunRequest {
  const raw = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const request: BrowserPromptExtractionRunRequest = {
    vendor: str(raw.vendor),
    modelKey: str(raw.modelKey),
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    imageUrl: str(raw.imageUrl),
    mode: raw.mode === "style" ? "style" : "replicate",
    projectId: str(raw.projectId) || null,
    pageUrl: str(raw.pageUrl),
    imageSourceUrl: str(raw.imageSourceUrl),
  };
  if (!request.vendor || !request.modelKey || !request.prompt.trim() || !request.imageUrl) {
    throw new Error("browser prompt extraction request is invalid");
  }
  return request;
}

let confirming = false;

/**
 * 问一次人 → 铸一颗令牌 → 发一次读图调用。没确认（含卡没弹出来就收了）→ not-confirmed，什么都不发；
 * 渲染层没了 → 抛 RendererUnavailableError（不铸、不发）。失败照 `nomi:tasks:run` 的编码抛出（runTaskIpcGuard）。
 */
export async function runBrowserPromptExtraction(
  request: BrowserPromptExtractionRunRequest,
  runTask: RunTask,
): Promise<BrowserPromptExtractionRunOutcome> {
  const nodeId = `browser-prompt-extraction-${randomUUID()}`;
  const parameters: Record<string, unknown> = {
    modelKey: request.modelKey,
    referenceImages: [request.imageUrl],
    ...EXTRACTION_PARAMETERS[request.mode],
    ...(request.projectId ? { projectId: request.projectId } : {}),
  };
  return runTaskIpcGuard({ request: { extras: { ...parameters, nodeId } } }, async (): Promise<BrowserPromptExtractionRunOutcome> => {
    if (confirming) {
      logWarn("browser", "prompt-extraction.busy", { mode: request.mode });
      return { outcome: "busy" };
    }
    confirming = true;
    let grantId: string | null;
    try {
      // 报价身份必须是 runTask 真会解出来的那一行（别名一漂，闸上就会再弹第二张卡）。
      const executable = findExecutableModel(request.vendor, request.modelKey, "text");
      const vendorKey = executable.vendor.key;
      const modelKey = executable.model.modelKey;
      grantId = await confirmSpendAndMintGrant({
        nodeId,
        ...(request.projectId ? { projectId: request.projectId } : {}),
        intent: PROMPT_EXTRACTION_SPEND_INTENT,
        vendor: vendorKey,
        modelKey,
        prompt: encodePromptExtractionSubject(promptExtractionSubjectOf(request)),
        legs: [{ role: "vision", vendor: vendorKey, modelKey }],
        lines: [{ vendorKey, modelKey, parameters }],
      });
    } finally {
      confirming = false;
    }
    if (!grantId) return { outcome: "not-confirmed" };
    const result = await runTask({
      vendor: request.vendor,
      request: {
        kind: "image_to_prompt",
        prompt: request.prompt,
        // 付费闸的授权：这颗令牌刚由用户在卡上确认过，只覆盖这一次读图。
        extras: { ...parameters, nodeId, grantId },
      },
    });
    return { outcome: "done", result };
  });
}

/**
 * 浏览器「提取提示词」在主进程的两扇门一起注册：模板设置读写（settings 模块，浮层窗也能调）+ 整次提取（本模块）。
 * 整次提取这扇只认 Nomi 主窗口的主帧：浏览视图里的网页、子帧、浮层窗都调不到。
 */
export function registerBrowserPromptExtractionIpc(loadRuntimeModule: RuntimeLoader): void {
  registerBrowserPromptExtractionSettingsIpc();
  ipcMain.handle("browser:prompt-extraction:run", async (event, payload) => {
    assertTrustedSender(event);
    const request = parseBrowserPromptExtractionRunRequest(payload);
    const { runTask } = await loadRuntimeModule();
    return runBrowserPromptExtraction(request, runTask);
  });
}
