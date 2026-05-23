import fs from "node:fs";
import path from "node:path";

import type { ExportJobSnapshot } from "./exportJobManager";

export type ExportTempInputChunk = ArrayBuffer | ArrayBufferView | number[] | { chunk?: unknown };

export type ExportTempInputWriteResult = { ok: true; size: number };
export type ExportTempInputFinishResult = { inputPath: string; size: number };

export const EXPORT_TEMP_INPUT_MAX_CHUNK_BYTES = 1024 * 1024;
export const EXPORT_TEMP_INPUT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

function chunkToBuffer(input: ExportTempInputChunk): Buffer {
  const value = typeof input === "object" && input !== null && "chunk" in input ? (input as { chunk?: unknown }).chunk : input;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Buffer.from(value);
  throw new Error("Export temp input chunk is required");
}

function assertInsideJobDir(job: ExportJobSnapshot, filePath: string): string {
  const resolvedJobDir = path.resolve(job.jobDir);
  const resolved = path.resolve(filePath);
  if (resolved !== resolvedJobDir && !resolved.startsWith(`${resolvedJobDir}${path.sep}`)) {
    throw new Error("Export temp input path escapes job directory");
  }
  return resolved;
}

export function resolveExportTempInputPath(job: ExportJobSnapshot): string {
  return assertInsideJobDir(job, path.join(job.jobDir, "input.webm"));
}

export function appendExportTempInputChunk(job: ExportJobSnapshot, chunk: ExportTempInputChunk): ExportTempInputWriteResult {
  const bytes = chunkToBuffer(chunk);
  if (bytes.byteLength <= 0) throw new Error("Export temp input chunk must not be empty");
  if (bytes.byteLength > EXPORT_TEMP_INPUT_MAX_CHUNK_BYTES) {
    throw new Error(`Export temp input chunk is too large; max ${EXPORT_TEMP_INPUT_MAX_CHUNK_BYTES} bytes`);
  }
  const inputPath = resolveExportTempInputPath(job);
  const currentSize = fs.existsSync(inputPath) ? fs.statSync(inputPath).size : 0;
  if (currentSize + bytes.byteLength > EXPORT_TEMP_INPUT_MAX_TOTAL_BYTES) {
    throw new Error(`Export temp input exceeds max total size of ${EXPORT_TEMP_INPUT_MAX_TOTAL_BYTES} bytes`);
  }
  fs.mkdirSync(path.dirname(inputPath), { recursive: true });
  fs.appendFileSync(inputPath, bytes);
  return { ok: true, size: fs.statSync(inputPath).size };
}

export function finishExportTempInput(job: ExportJobSnapshot): ExportTempInputFinishResult {
  const inputPath = resolveExportTempInputPath(job);
  if (!fs.existsSync(inputPath)) throw new Error("Export temp input is missing");
  const stat = fs.statSync(inputPath);
  if (!stat.isFile() || stat.size <= 0) throw new Error("Export temp input is empty");
  return { inputPath, size: stat.size };
}

export function removeExportTempInput(job: ExportJobSnapshot): void {
  fs.rmSync(resolveExportTempInputPath(job), { force: true });
}
