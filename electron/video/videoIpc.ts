// 视频相关 IPC 的注册收口（从 main.ts 抽出——规则 12 巨壳门岗：main.ts 逼近 800 行硬上限，
// 视频这几个 handler 自成一族，照既有 registerScreenshotIpc / registerExportJobIpc 同款模式外置）。
//
// 全部 handler 一律先过 assertTrustedSender（R20 IPC 来源绑定：主窗口专用通道，拒非可信 sender），
// 与 main.ts 里其余 nomi:video:* handler 语义完全一致。重活模块用动态 import()，避免加载期把
// ffmpeg/模型编排链一并拉进启动路径。
import { ipcMain } from "electron";
import { assertTrustedSender } from "../ipcSenderGuard";
import { registerVideoDepthIpc } from "./depthVideoIpc";

export function registerVideoIpc(): void {
  ipcMain.handle("nomi:video:extract-frame", async (event, payload) => {
    assertTrustedSender(event);
    const { extractVideoFrameToAsset } = await import("./extractVideoFrame");
    return extractVideoFrameToAsset(payload);
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
    return deconstructVideo(payload, (phase) => {
      if (!event.sender.isDestroyed() && typeof payload?.requestId === "string") {
        event.sender.send("nomi:video:deconstruction-progress", { requestId: payload.requestId, projectId: payload.projectId, phase });
      }
    });
  });

  // 深度视频处理节点的五个原语同属 video 家族，挂在这里而不是 main.ts —— main.ts 是已登记的
  // 巨壳（828 行封顶），每加一个子系统就往里塞两行，正是它长成这样的原因。
  registerVideoDepthIpc();
}
