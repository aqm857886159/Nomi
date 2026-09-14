import fs from "node:fs";
import { isJsonRecord, type JsonRecord } from "../jsonUtils";

// 落盘素材的 sidecar（`<file>.meta`）读写。单一实现：projectAssetStore（写入者）与 assetPreview（预览回填）共用。

export function readAssetSidecarMeta(absolutePath: string): JsonRecord {
  try {
    const parsed = JSON.parse(fs.readFileSync(`${absolutePath}.meta`, "utf8"));
    return isJsonRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeAssetSidecarMeta(absolutePath: string, meta: JsonRecord): void {
  const sidecar: JsonRecord = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined) sidecar[key] = value;
  }
  if (Object.keys(sidecar).length === 0) return;
  try {
    fs.writeFileSync(`${absolutePath}.meta`, JSON.stringify(sidecar));
  } catch {
    /* non-fatal */
  }
}

/** 只补字段、不覆盖已有 sidecar（预览回填在源文件落盘之后跑，绝不能吃掉落盘时写的 originalUrl 等证据）。 */
export function mergeAssetSidecarMeta(absolutePath: string, patch: JsonRecord): JsonRecord {
  const merged = { ...readAssetSidecarMeta(absolutePath), ...patch };
  writeAssetSidecarMeta(absolutePath, merged);
  return merged;
}
