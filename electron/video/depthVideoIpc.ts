/**
 * 深度视频节点 —— IPC 边界。
 *
 * 五个 renderer→main 的 invoke（prepare / readFrames / writeFrames / finish / cancel）
 * 加一条 main→renderer 的进度推送（prepare 期间的下载与抽帧，那两段渲染层看不见）。
 * 每个 handler 第一句都是 `assertTrustedSender`，重活模块用动态 import 留在启动路径之外
 * ——与 videoIpc.ts 同一套约定。
 */
import { app, ipcMain, type WebContents } from "electron";
import { assertTrustedSender } from "../ipcSenderGuard";

/**
 * 作业模块是**按需加载**的（重活不进启动路径），但退出清理必须是同步的：
 * 那一刻再 `await import` 已经来不及，app 不会等。所以这里记住「有没有真的加载过」——
 * 从没开过任务就没有编码器、没有临时目录，什么都不用做；开过就直接用手上这份同步收摊。
 */
let jobModule: typeof import("./depthVideoJob") | null = null;

async function jobs(): Promise<typeof import("./depthVideoJob")> {
  jobModule ??= await import("./depthVideoJob");
  return jobModule;
}

export const VIDEO_DEPTH_EVENT_CHANNEL = "nomi:video-depth:event";

function forward(sender: WebContents, payload: unknown): void {
  if (sender.isDestroyed()) return;
  sender.send(VIDEO_DEPTH_EVENT_CHANNEL, payload);
}

export function registerVideoDepthIpc(): void {
  ipcMain.handle("nomi:video-depth:prepare", async (event, payload) => {
    assertTrustedSender(event);
    const { prepareVideoDepthJob } = await jobs();
    const sender = event.sender;
    return prepareVideoDepthJob(payload, (progress) => forward(sender, progress));
  });

  ipcMain.handle("nomi:video-depth:read-frames", async (event, payload) => {
    assertTrustedSender(event);
    const { readVideoDepthFrames } = await jobs();
    return { frames: readVideoDepthFrames(payload) };
  });

  ipcMain.handle("nomi:video-depth:write-frames", async (event, payload) => {
    assertTrustedSender(event);
    const { writeVideoDepthFrames } = await jobs();
    await writeVideoDepthFrames(payload);
    return { ok: true };
  });

  ipcMain.handle("nomi:video-depth:finish", async (event, payload) => {
    assertTrustedSender(event);
    const { finishVideoDepthJob } = await jobs();
    return finishVideoDepthJob(payload);
  });

  ipcMain.handle("nomi:video-depth:cancel", async (event, payload) => {
    assertTrustedSender(event);
    const { cancelVideoDepthJob } = await jobs();
    return cancelVideoDepthJob(payload);
  });

  // 退出时收摊：ffmpeg 编码器是子进程，临时目录里躺着这次抽出来的整批帧。
  // 挂在这里而不是 main.ts——那是已登记的巨壳，每个子系统往里塞两行正是它长成那样的原因。
  app.on("before-quit", () => {
    jobModule?.disposeAllVideoDepthJobs();
  });
}
