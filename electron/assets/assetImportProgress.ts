import fs from "node:fs";
import { pipeline } from "node:stream/promises";

import { broadcastAssetImportProgress } from "./assetEvents";

/** 拷贝流每几十 KB 就回调一次；广播按这个间隔节流（末帧无条件发，保证一定收到 100%）。 */
const PROGRESS_BROADCAST_INTERVAL_MS = 80;

export type AssetCopyProgress = (copiedBytes: number, totalBytes: number) => void;

/**
 * 带进度的文件拷贝：导入中节点的渐显是「已拷贝字节 / 总字节」驱动的，进度只能从真正搬字节的那一层来。
 * 没有 onProgress 的调用方（跨项目复制、生成结果落盘……）走原来的 fs.copyFile，不为它们多绕一次流。
 */
export async function copyFileWithProgress(sourcePath: string, destinationPath: string, onProgress?: AssetCopyProgress): Promise<void> {
  if (!onProgress) {
    await fs.promises.copyFile(sourcePath, destinationPath);
    return;
  }
  const totalBytes = (await fs.promises.stat(sourcePath)).size;
  let copiedBytes = 0;
  const source = fs.createReadStream(sourcePath);
  source.on("data", (chunk) => {
    copiedBytes += (chunk as Buffer).length;
    onProgress(copiedBytes, totalBytes);
  });
  await pipeline(source, fs.createWriteStream(destinationPath));
  onProgress(totalBytes, totalBytes);
}

/**
 * 一次导入的进度上报器（渲染层按 nodeId 认领）。
 *
 * 为什么先广播一次 0：**在派生预览之前**就要让卡片有话说（4K 源 ffprobe + 缩放要好几秒，
 * 挡在前面就是一张五秒钟的空卡）。预览好了再补一条带 URL 的，渲染层从那时起往上盖格子；
 * 格子数始终由「已拷贝 / 总字节」决定，拷完刚好长满，不再切一次图。
 */
export function createAssetImportProgressReporter(input: {
  projectId: string
  nodeId: string
  totalBytes: number
  previewUrl?: string
}): { announce: () => void; report: AssetCopyProgress; finish: () => void; setPreviewUrl: (url: string) => void } {
  let lastSentAt = 0;
  let previewUrl = input.previewUrl;
  // 显示给用户的永远是**他选的那个文件**的大小。视频先归一化再拷贝时，拷的是转码产物
  // （325.7 MB 的源会变成 68.1 MB 的中间件），让那个数字跳到标签上等于换了个文件在讲。
  const sourceBytes = input.totalBytes;
  let lastRatio = 0;
  const send = (ratio: number) => {
    lastSentAt = Date.now();
    lastRatio = ratio;
    void broadcastAssetImportProgress({
      projectId: input.projectId,
      nodeId: input.nodeId,
      copiedBytes: Math.round(ratio * sourceBytes),
      totalBytes: sourceBytes,
      ...(previewUrl ? { previewUrl } : {}),
    });
  };
  return {
    announce: () => send(0),
    report: (copiedBytes, totalBytes) => {
      const ratio = totalBytes > 0 ? Math.min(1, copiedBytes / totalBytes) : 0;
      const now = Date.now();
      if (ratio < 1 && now - lastSentAt < PROGRESS_BROADCAST_INTERVAL_MS) return;
      send(ratio);
    },
    // 拷贝之后还有哈希/落库/预览认领；比例已经满了，这里只补一条「字节已就位」。
    finish: () => { if (lastRatio < 1) send(1); },
    // 预览是和拷贝并行派生的（ffprobe+缩放对 4K 源要好几秒，绝不能挡在拷贝前面）：
    // 它什么时候好，就什么时候补一条带 URL 的进度，渲染层据此开始往上盖格子。
    setPreviewUrl: (url: string) => { previewUrl = url; if (url) send(lastRatio); },
  };
}
