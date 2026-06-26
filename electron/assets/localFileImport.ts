// 本地文件 → 项目素材的导入（从 runtime.ts 抽出：它是素材 IO，不是任务执行，放这更内聚，
// 也给 runtime 这个已知巨壳腾出空间）。writeAsset 仍在 runtime（单向依赖，无循环）。
import { writeAsset } from "../runtime";
import { extensionFromMime } from "./assetPaths";
import type { JsonRecord } from "../jsonUtils";

function bytesFromPayload(value: unknown): Buffer {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Buffer.from(value);
  throw new Error("bytes must be an ArrayBuffer");
}

export async function importLocalFile(payload: unknown): Promise<unknown> {
  const raw = payload as JsonRecord;
  const projectId = String(raw.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const bytes = bytesFromPayload(raw.bytes);
  const contentType = String(raw.contentType || "application/octet-stream");
  const ext = extensionFromMime(contentType, "bin");
  const fileName = String(raw.fileName || `asset-${Date.now()}.${ext}`);
  return writeAsset(projectId, bytes, fileName, contentType, {
    kind: raw.kind || "upload",
    originalName: raw.fileName || null,
  });
}
