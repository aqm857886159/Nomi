// 视频相关 IPC 的注册收口（从 main.ts 抽出——规则 12 巨壳门岗：main.ts 逼近 800 行硬上限，
// 视频这几个 handler 自成一族，照既有 registerScreenshotIpc / registerExportJobIpc 同款模式外置）。
//
// 全部 handler 一律先过 assertTrustedSender（R20 IPC 来源绑定：主窗口专用通道，拒非可信 sender），
// 与 main.ts 里其余 nomi:video:* handler 语义完全一致。重活模块用动态 import()，避免加载期把
// ffmpeg/模型编排链一并拉进启动路径。
import { ipcMain } from "electron";
import { assertTrustedSender } from "../ipcSenderGuard";
import { createIpcRequestRegistry } from "../ipcRequestRegistry";
import { registerQuitDrain } from "../quitTeardown";
import { registerVideoDepthIpc } from "./depthVideoIpc";
import type { ProjectInteractionCapture } from "../assets/projectInteractionCapture";

/**
 * 拆解请求的入口校验（2026-10-27 拆解取消第一刀）：requestId 是取消口寻址用的，projectBinding 是这次拆解归哪个项目会话的凭据。
 * 缺一样就是一条停不下来、也不知道归谁的拆解——直接拒，不兜底（渲染层与主进程同一个包发版，不存在旧调用方）。
 */
function deconstructRequestId(raw: Record<string, unknown>): string {
  const requestId = typeof raw.requestId === "string" ? raw.requestId.trim() : "";
  if (!requestId) throw new Error("nomi:video:deconstruct requires a requestId so the run can be cancelled");
  const binding = raw.projectBinding;
  const bindingProjectId = binding && typeof binding === "object" ? (binding as { projectId?: unknown }).projectId : undefined;
  if (typeof raw.projectId !== "string" || !raw.projectId || bindingProjectId !== raw.projectId) {
    throw new Error("nomi:video:deconstruct requires the projectBinding of its projectId");
  }
  return requestId;
}

export function registerVideoIpc(captureInteraction: ProjectInteractionCapture): void {
  ipcMain.handle("nomi:video:extract-frame", async (event, payload) => {
    assertTrustedSender(event);
    // 交互抽帧带着动作起点签发的原项目绑定：在任何 await 之前固定会话，落盘前复验，换项目即不发布。
    const assertCurrent = captureInteraction(event, payload);
    const { extractVideoFrameToAsset } = await import("./extractVideoFrame");
    return extractVideoFrameToAsset(payload, { assertCurrent });
  });
  // 导演台出片（帧序列 → mp4）：同一族视频原语，同样在 await 前按发起动作的绑定加入可信会话。
  ipcMain.handle("nomi:scene3d:frames-to-video", async (event, payload) => {
    assertTrustedSender(event);
    const assertCurrent = captureInteraction(event, payload);
    const { framesToVideoAsset } = await import("./framesToVideo");
    return framesToVideoAsset(payload, { assertCurrent });
  });
  // 直接剪辑（入点—出点 → 新素材 mp4）：长任务，进度按 jobId 推回发起窗口，取消按 jobId 杀 ffmpeg。
  ipcMain.handle("nomi:video:trim", async (event, payload) => {
    assertTrustedSender(event);
    const assertCurrent = captureInteraction(event, payload);
    const { trimVideoToAsset } = await import("./trimVideo");
    return trimVideoToAsset(payload, {
      assertCurrent,
      onProgress: (ratio) => {
        if (!event.sender.isDestroyed()) event.sender.send("nomi:video:trim-progress", { jobId: payload.jobId, ratio });
      },
    });
  });
  ipcMain.handle("nomi:video:trim-cancel", async (event, payload) => {
    assertTrustedSender(event);
    const { cancelTrimJob } = await import("./trimVideo");
    return { ok: cancelTrimJob(String(payload?.jobId ?? "")) };
  });
  ipcMain.handle("nomi:video:extract-filmstrip", async (event, payload) => {
    assertTrustedSender(event);
    const { extractVideoFilmstripToAsset } = await import("./extractVideoFrame");
    return extractVideoFilmstripToAsset(payload);
  });
  ipcMain.handle("nomi:video:detect-shot-cuts", async (event, payload) => {
    assertTrustedSender(event);
    const { detectShotCuts } = await import("./detectShotCuts");
    return detectShotCuts(payload);
  });
  // 视频拆解：切镜 + 每镜多帧读图 + 音轨转写 → 结构化分镜表（docs/plan/2026-08-13-…）。
  // 比 detect-shot-cuts 慢得多（要调模型），渲染层自己给进度态，别当同步调用用。
  //
  // 停止（docs/plan/2026-10-27-deconstruct-cancel.md）：每次拆解按「发送方:requestId」进请求登记，渲染层撤回 /
  // 发起窗口销毁 / 项目会话失效 / 退出汇成一个 signal 交给编排——已取消就不再起新的本机子进程、不再进付费闸。
  // 停下回 null（不是失败）。登记在第一个 await 之前，动态 import 期间到达的取消也找得到它。
  const deconstructRequests = createIpcRequestRegistry();
  ipcMain.handle("nomi:video:deconstruct", async (event, payload) => {
    assertTrustedSender(event);
    const raw = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
    const requestId = deconstructRequestId(raw);
    // 在任何 await 之前按发起动作的绑定加入窗口的项目会话：已经不是这个窗口的项目 = 已停。
    let assertCurrent: (() => void) | undefined;
    try { assertCurrent = captureInteraction(event, raw); } catch { return null; }
    return deconstructRequests.run(event.sender, requestId, assertCurrent, async (signal) => {
      const { deconstructVideo } = await import("./deconstructVideo");
      const { authorizeDeconstructSpend } = await import("./deconstructSpend");
      return deconstructVideo(payload, {
        signal,
        // 钱的闸：切点/抽帧跑完、镜数已知之后，一次报价、一次确认、一颗令牌覆盖整批
        // （`spendConfirmGrant.ts` 是「问人 + 铸令牌」的唯一那条链，与外部 agent 生成同源）。
        authorizeSpend: (plan) => authorizeDeconstructSpend(plan),
        onPhase: (phase, detail) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("nomi:video:deconstruction-progress", { requestId, projectId: raw.projectId, phase, ...(detail ? { detail } : {}) });
          }
        },
      });
    });
  });
  // 取消口：同一个窗口按 requestId 撤自己那次拆解（别的窗口撤不动）。撤了之后编排不再起新的一步、不再进付费闸；
  // 已经过了付费闸的那一次照常结算（在途断开是第二刀）。
  ipcMain.handle("nomi:video:deconstruct-cancel", async (event, payload) => {
    assertTrustedSender(event);
    const requestId = typeof (payload as { requestId?: unknown } | null)?.requestId === "string" ? String((payload as { requestId: string }).requestId).trim() : "";
    return { ok: deconstructRequests.cancel(event.sender.id, requestId) };
  });
  // 退出收摊：在跑的拆解全撤、此后不再接新拆解（drain 立刻生效），退出那几秒里不再发新的付费调用；只中止、不等落定。
  // 挂在这里而不是 main.ts（同 depthVideoIpc）。
  registerQuitDrain("video-deconstruct-requests", () => { void deconstructRequests.drain(); }, { required: true, timeoutMs: 250 });

  // 深度视频处理节点的五个原语同属 video 家族，挂在这里而不是 main.ts —— main.ts 是已登记的
  // 巨壳（828 行封顶），每加一个子系统就往里塞两行，正是它长成这样的原因。
  registerVideoDepthIpc();
}
