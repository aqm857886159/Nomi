// 卡顿时间线：一份只留在本机、活过重启的滚动文件（`nomi-stall-timeline.log`，日志目录里）。
// 这里是它的**唯一** owner：行怎么写（白名单 + 限频）、怎么读回（容忍坏数据）、诊断包要的三态素材。
//
// 落盘不另写：滚动、表头、吞异常全复用 `logging/logFiles.ts` 的 `createLogFileSink`（P1），
// 这里只给它换一个文件名和一个小的上限。一行是 `[写入时刻] {JSON}`，JSON 里 `t` 才是事件时刻。
//
// 写盘不堵主进程靠三条：① 无停顿 = 一次都不写；② 每种类型每 10 秒最多一行，另每分钟一行汇总，
// 所以风暴下每分钟也就几次、每次一行几十字节的追加；③ 单文件封顶 192KiB，只留一代旧的。
import fs from "node:fs";
import path from "node:path";
import { createLogFileSink, logsDir } from "../logging/logFiles";
import { parseStallRow, type StallRow } from "../shared/contracts/stallTimeline";

export const STALL_TIMELINE_FILE = "nomi-stall-timeline.log";
/** 单文件上限；滚动留一代，所以盘上总量 ≤ 2 倍。 */
export const STALL_TIMELINE_MAX_BYTES = 192 * 1024;
/** 同一种行两次写盘之间至少隔这么久；中间来的只计数，进每分钟的汇总。 */
export const STALL_KIND_MIN_GAP_MS = 10_000;
export const STALL_SUMMARY_WINDOW_MS = 60_000;
/** 一分钟里看到至少这么多行才算「风暴」，才写汇总；零星的停顿只写自己那一行。 */
export const STALL_STORM_MIN_ROWS = 4;
/** 诊断包最多带这么多行（最新的）。 */
export const STALL_READ_MAX_ROWS = 2000;
/** 单个文件最多读尾部这么多字节：正常文件不会超过 192KiB，超了说明被动过，只取尾部。 */
const READ_TAIL_MAX_BYTES = 512 * 1024;

const KEY_ORDER = ["t", "kind", "ms", "frozen", "count", "page", "nodes", "generating"] as const;

function serialize(row: StallRow): string {
  const ordered: Record<string, unknown> = {};
  for (const key of KEY_ORDER) if (row[key] !== undefined) ordered[key] = row[key];
  return JSON.stringify(ordered);
}

export type StallTimeline = {
  /** 校验 → 限频 → 写一行。返回这一行有没有真的写进盘。不合白名单的整行拒收（返回 false，计入 rejected）。 */
  record(candidate: unknown): boolean;
  /** 监视器每次读数时调用：分钟窗口到点了，风暴就补一行汇总。 */
  tick(): void;
  stats(): { written: number; suppressed: number; rejected: number };
};

export function createStallTimeline(options: { append: (line: string) => void; now: () => number }): StallTimeline {
  const lastWrittenAt = new Map<string, number>();
  let windowStart = options.now();
  let windowRows = 0;
  let windowMaxMs = 0;
  let written = 0;
  let suppressed = 0;
  let rejected = 0;

  const write = (row: StallRow): void => {
    options.append(serialize(row));
    written += 1;
  };

  const closeWindowIfDue = (nowMs: number): void => {
    if (nowMs - windowStart < STALL_SUMMARY_WINDOW_MS) return;
    if (windowRows >= STALL_STORM_MIN_ROWS) {
      const summary = parseStallRow({ t: new Date(nowMs).toISOString(), kind: "stall-summary", ms: windowMaxMs, count: windowRows });
      if (summary) write(summary);
    }
    windowStart = nowMs;
    windowRows = 0;
    windowMaxMs = 0;
  };

  return {
    record(candidate) {
      const row = parseStallRow(candidate);
      if (!row || row.kind === "stall-summary") {
        rejected += 1;
        return false;
      }
      const nowMs = options.now();
      closeWindowIfDue(nowMs);
      windowRows += 1;
      windowMaxMs = Math.max(windowMaxMs, row.ms ?? 0);
      const previous = lastWrittenAt.get(row.kind);
      if (previous !== undefined && nowMs - previous < STALL_KIND_MIN_GAP_MS) {
        suppressed += 1;
        return false;
      }
      lastWrittenAt.set(row.kind, nowMs);
      write(row);
      return true;
    },
    tick() {
      closeWindowIfDue(options.now());
    },
    stats: () => ({ written, suppressed, rejected }),
  };
}

/** 生产落盘：复用日志道的滚动写手，只换文件名和上限。 */
export function createStallTimelineAppend(resolveDir: () => string = logsDir): (line: string) => void {
  const sink = createLogFileSink({
    resolvePath: () => path.join(resolveDir(), STALL_TIMELINE_FILE),
    maxBytes: STALL_TIMELINE_MAX_BYTES,
    rotate: "archive",
  });
  return (line) => sink.append(line);
}

export type StallTimelineRead = {
  /** 通过白名单校验的行，旧的在前。 */
  rows: StallRow[];
  /** 读到但不合格的行数（坏数据 / 半行 / 别的版本写的）。表头行和空行不算。 */
  droppedLines: number;
  /** present = 至少有一个文件；absent = 没有（新装或旧版本升级上来）；unreadable = 有文件但读不了。 */
  file: "present" | "absent" | "unreadable";
};

function readTailText(file: string): string | null {
  let fd: number | null = null;
  try {
    const size = fs.statSync(file).size;
    const length = Math.min(size, READ_TAIL_MAX_BYTES);
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT" ? null : "\u0000unreadable";
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* 关不掉也不影响读到的内容 */ }
    }
  }
}

/** 读回时间线（旧的一代在前）。任何坏数据都只计数，不抛。 */
export function readStallTimeline(dir: string, maxRows: number = STALL_READ_MAX_ROWS): StallTimelineRead {
  const rows: StallRow[] = [];
  let droppedLines = 0;
  let present = false;
  let unreadable = false;
  const base = path.join(dir, STALL_TIMELINE_FILE);
  for (const file of [`${base.slice(0, -".log".length)}.1.log`, base]) {
    const text = readTailText(file);
    if (text === null) continue;
    if (text === "\u0000unreadable") {
      unreadable = true;
      continue;
    }
    present = true;
    for (const rawLine of text.split("\n")) {
      const line = rawLine.replace(/^\[[^\]]*\]\s?/, "").trim();
      if (!line || line.startsWith("--- session")) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        droppedLines += 1;
        continue;
      }
      const row = parseStallRow(parsed);
      if (row) rows.push(row);
      else droppedLines += 1;
    }
  }
  return { rows: rows.slice(-maxRows), droppedLines, file: present ? "present" : unreadable ? "unreadable" : "absent" };
}

/** 诊断包里时间线那一份的文本：校验过的行重新序列化，一行一条 JSON。外来的东西到这里就出不去了。 */
export function stallRowsToJsonl(rows: readonly StallRow[]): string {
  return rows.map((row) => `${serialize(row)}\n`).join("");
}
