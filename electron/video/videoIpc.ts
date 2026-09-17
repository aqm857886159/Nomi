// 视频相关 IPC 的注册收口（从 main.ts 抽出——规则 12 巨壳门岗：main.ts 逼近 800 行硬上限，
// 视频这几个 handler 自成一族，照既有 registerScreenshotIpc / registerExportJobIpc 同款模式外置）。
//
// 全部 handler 一律先过 assertTrustedSender（R20 IPC 来源绑定：主窗口专用通道，拒非可信 sender），
// 与 main.ts 里其余 nomi:video:* handler 语义完全一致。重活模块用动态 import()，避免加载期把
// ffmpeg/模型编排链一并拉进启动路径。
import { ipcMain } from "electron";
import { assertTrustedSender } from "../ipcSenderGuard";
import { registerVideoDepthIpc } from "./depthVideoIpc";
import type { ProjectInteractionCapture } from "../assets/projectInteractionCapture";

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
  ipcMain.handle("nomi:video:deconstruct", async (event, payload) => {
    assertTrustedSender(event);
    const { deconstructVideo } = await import("./deconstructVideo");
    const { authorizeDeconstructSpend } = await import("./deconstructSpend");
    return deconstructVideo(payload, {
      // 钱的闸：切点/抽帧跑完、镜数已知之后，一次报价、一次确认、一颗令牌覆盖整批
      // （`spendConfirmGrant.ts` 是「问人 + 铸令牌」的唯一那条链，与外部 agent 生成同源）。
      authorizeSpend: (plan) => authorizeDeconstructSpend(plan),
      onPhase: (phase, detail) => {
        if (!event.sender.isDestroyed() && typeof payload?.requestId === "string") {
          event.sender.send("nomi:video:deconstruction-progress", { requestId: payload.requestId, projectId: payload.projectId, phase, ...(detail ? { detail } : {}) });
        }
      },
    });
  });

  // 深度视频处理节点的五个原语同属 video 家族，挂在这里而不是 main.ts —— main.ts 是已登记的
  // 巨壳（828 行封顶），每加一个子系统就往里塞两行，正是它长成这样的原因。
  registerVideoDepthIpc();
}
