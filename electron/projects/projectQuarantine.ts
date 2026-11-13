import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonFileAtomic } from "../jsonFile";
import type { IpcResult } from "../shared/contracts/ipcResult";
import { projectSaveFailure, type QuarantineWriteFailure, type QuarantineWriteOutcome } from "../shared/contracts/projectSaveFailure";

export type { QuarantineWriteFailure, QuarantineWriteOutcome };

/**
 * 存盘 / 读盘时被隔离的那一项的原样内容，落在项目自己的 `.nomi/quarantine/` 下。
 *
 * 规矩（2026-11-13 独立验收后第 2 轮）：
 *   · 原子写：先写临时文件再改名（`writeJsonFileAtomic`），写到一半被强杀不会留下半截文件；
 *   · 不截断：一次多少项都写，单项多大都写；写不成就抛，由调用方决定这次保存不覆盖项目文件；
 *   · 去重：文件名末尾是内容哈希的前 12 位。同一份内容已有**完整一致**的文件 → 不重写（fresh=false）；
 *     有同哈希但内容不完整 / 不一致的文件 → 原子替换掉；
 *   · 文件名：`<时间>-<哪类>-<哪份东西的名字>-<哈希>.json`，名字做文件名安全处理、限长。
 */
export type QuarantineItemInput = { container: string; field: string; raw: unknown };
type QuarantineFileResult = QuarantineWriteOutcome["files"][number];

export const QUARANTINE_RELATIVE_DIR = ".nomi/quarantine";
const NAME_MAX_CHARS = 40;
const HASH_CHARS = 12;

export class QuarantineWriteError extends Error {
  readonly failure: QuarantineWriteFailure;
  constructor(failure: QuarantineWriteFailure) {
    super("quarantine-write-failed");
    this.failure = failure;
  }
}

function stamp(now: Date): string {
  const two = (value: number): string => String(value).padStart(2, "0");
  return `${now.getUTCFullYear()}${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}-${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(now.getUTCSeconds())}`;
}

/** 文件名安全：去掉各平台不许的字符和控制字符，空白并成一个下划线，去掉首尾点和下划线，按字符限长。 */
export function quarantineSafeName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, "_")
    .replace(/^[._]+|[._]+$/g, "");
  return Array.from(cleaned).slice(0, NAME_MAX_CHARS).join("").replace(/[._]+$/g, "") || "item";
}

function itemName(raw: unknown, container: string): string {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  for (const key of ["title", "name", "id"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return quarantineSafeName(value.trim());
  }
  return quarantineSafeName(container);
}

function readTextOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function existingWithHash(dir: string, hash: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  return names.filter((name) => !name.startsWith(".") && name.endsWith(`-${hash}.json`)).sort();
}

function writeOne(dir: string, input: QuarantineItemInput, now: Date): QuarantineFileResult {
  const value = { container: input.container, field: input.field, raw: input.raw };
  // 与 writeJsonFileAtomic 同一种序列化：用它比对「已有文件是否完整一致」。
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, HASH_CHARS);
  const existing = existingWithHash(dir, hash);
  for (const name of existing) {
    if (readTextOrNull(path.join(dir, name)) === text) return { relativePath: `${QUARANTINE_RELATIVE_DIR}/${name}`, fresh: false };
  }
  // 同哈希但不完整（以前写一半）→ 原子替换那一份；没有 → 新起一个带时间的名字。
  const name = existing[0] ?? `${stamp(now)}-${quarantineSafeName(input.container)}-${itemName(input.raw, input.container)}-${hash}.json`;
  writeJsonFileAtomic(path.join(dir, name), value);
  return { relativePath: `${QUARANTINE_RELATIVE_DIR}/${name}`, fresh: true };
}

function isItem(item: unknown): item is QuarantineItemInput {
  return Boolean(item && typeof item === "object"
    && typeof (item as QuarantineItemInput).container === "string"
    && typeof (item as QuarantineItemInput).field === "string");
}

/** 全部写成才返回；任何一项写不成（含形状不对）抛 QuarantineWriteError，已写成的留着（下次同内容会被认出来）。 */
export function writeQuarantineItems(projectDir: string, items: unknown, now: Date = new Date()): QuarantineWriteOutcome {
  if (!projectDir || !Array.isArray(items)) {
    throw new QuarantineWriteError({ ...projectSaveFailure(new Error("invalid quarantine request"), "save-project"), item: null });
  }
  const dir = path.join(projectDir, ...QUARANTINE_RELATIVE_DIR.split("/"));
  const files: QuarantineFileResult[] = [];
  items.forEach((item, index) => {
    const where = isItem(item) ? { index, container: item.container, field: item.field } : { index, container: "", field: "" };
    try {
      if (!isItem(item)) throw new Error("invalid quarantine item");
      files.push(writeOne(dir, item, now));
    } catch (error) {
      throw new QuarantineWriteError({ ...projectSaveFailure(error, "save-project"), item: where });
    }
  });
  return { files };
}

/** IPC 包络：成功带每项文件；失败带系统错误码和「第几项 / 哪类 / 字段路径」，不带内容。项目目录找不到算 not-found。 */
export function quarantineWriteResult(projectDir: string | null, items: unknown): IpcResult<QuarantineWriteOutcome, QuarantineWriteFailure> {
  try {
    if (!projectDir) throw new QuarantineWriteError({ ...projectSaveFailure(Object.assign(new Error("project folder not found"), { code: "ENOENT" }), "save-project"), item: null });
    return { ok: true, value: writeQuarantineItems(projectDir, items) };
  } catch (error) {
    const reason = error instanceof QuarantineWriteError ? error.failure : { ...projectSaveFailure(error, "save-project"), item: null };
    return { ok: false, error: "project-quarantine-write-failed", reason };
  }
}
