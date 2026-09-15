// 一批本地路径 → 项目素材（Finder 拖入 / 粘贴素材库走这条）。
//
// 2026-09-14 之前这里是**第二份落盘实现**：自己 stat、自己判类型（`assetKindFromContentType(ct)
// !== "image"` 直接 throw）、不读文件头、不做视频可播放归一化。于是「上传」按钮收得下的视频和音频，
// 从 Finder 拖进来或粘贴进来一律「已跳过 1 个不支持的文件」——同一个素材库，两套准入。
//
// 现在它只剩一个批量壳：逐个交给唯一的落盘路 importLocalFile（魔数嗅探 + 准入闸 + 视频归一化都在
// 那一层），把每个文件的结果聚合回来。准入判断一个字都不在这里（P1：不留第二份）。
// MCP / Agent 的素材导入（capabilityCore/core.ts）走的是同一条路，不在这里另开一扇（2026-09-15）。
import path from "node:path";

import {
  MediaImportRejectedError,
  importLocalFile,
} from "./localFileImport";
import { resolveContentType } from "./mediaTypes";
import type { MediaImportRejection, MediaImportSurfaceId } from "../shared/contracts/mediaImportPolicy";

export type LocalFileImportBatchResult = {
  created: unknown[];
  /** 被准入闸挡下的文件：带机器可读原因与数字，渲染层据此说人话（「过大」不可行动）。 */
  rejected: Array<{ fileName: string; rejection: MediaImportRejection }>;
  failedCount: number;
};

export async function importLocalFilePaths(
  projectId: string,
  sourcePaths: readonly string[],
  surface: MediaImportSurfaceId = "asset-library",
): Promise<LocalFileImportBatchResult> {
  const result: LocalFileImportBatchResult = { created: [], rejected: [], failedCount: 0 };
  for (const sourcePath of sourcePaths) {
    const fileName = path.basename(sourcePath);
    try {
      result.created.push(await importLocalFile(
        { projectId, sourcePath, fileName, contentType: resolveContentType(fileName), kind: "upload", surface },
        { allowSourcePath: true },
      ));
    } catch (error) {
      if (error instanceof MediaImportRejectedError) result.rejected.push({ fileName, rejection: error.rejection });
      else result.failedCount += 1;
    }
  }
  return result;
}
