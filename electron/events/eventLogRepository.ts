// per-project append-only 事件日志 —— 全仓唯一写者(harness 总方案 §1)。
// 布局:<projectDir>/.nomi/events/log-<seg>.jsonl(+ sidecar/ 大 payload 全文)。
// 语义:
//  - seq 由本仓库统一编号(全局顺序唯一权威);重启后从最新段的最后完整行恢复;
//  - 撕裂尾行容忍:最后一行 parse 失败即视为不存在(JSONL 标配);
//  - 单事件 ≤4KB:超限的 payload 字段截断为 {truncated, head, sha256, sidecarRef};
//  - 分段:每段 5000 事件或 5MB rotation;
//  - 落盘前 redactDeep(评测安全铁律)。
// 失败策略:事件落盘是旁路观察,任何 IO 失败只 console.error,绝不打断产品主流程。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getWorkspaceRepositoryDeps } from "../runtimePaths";
import { resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";
import { redactDeep } from "./redact";
import type { NewNomiEvent, NomiEvent, TruncatedPayloadField } from "./types";

const MAX_EVENT_BYTES = 4096;
const SEGMENT_MAX_EVENTS = 5000;
const SEGMENT_MAX_BYTES = 5 * 1024 * 1024;
const HEAD_CHARS = 256;

type LogState = {
  dir: string;
  seq: number;
  segIndex: number;
  segEvents: number;
  segBytes: number;
};

const states = new Map<string, LogState>();
let secretsProvider: () => readonly string[] = () => [];
let projectDirResolver: (projectId: string) => string | null = (projectId) =>
  resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps());

/** 测试用:覆盖 projectId→目录 解析(指向临时目录),并清内存态。 */
export function setEventLogProjectDirResolverForTests(resolver: (projectId: string) => string | null): void {
  projectDirResolver = resolver;
  states.clear();
}

/** 注入"已知密钥清单"提供者(catalog secrets);测试与启动时配置。 */
export function setEventLogSecretsProvider(provider: () => readonly string[]): void {
  secretsProvider = provider;
}

/**
 * 从 sessionKey 解析 projectId;local/空 → null(不落盘)。
 * sessionKey 形如 `nomi:workbench:<projectId>[:<area>]`,area ∈ {creation, generation}(cdc433c 起按 area 隔离)。
 * 必须先剥 area 后缀再取 projectId——否则贪婪匹配会把 `proj:creation` 整体当 id,致 trace 全线丢盘(I1/I2)。
 * 全仓唯一的 sessionKey→projectId 解析点(agentSessionStore 等消费者一律 import 此函数,不另写正则)。
 */
export function projectIdFromSessionKey(sessionKey: string | undefined): string | null {
  const key = String(sessionKey || "").trim();
  const withArea = /^nomi:workbench:(.+):(?:creation|generation)$/.exec(key);
  const id = (withArea ? withArea[1] : /^nomi:workbench:(.+)$/.exec(key)?.[1])?.trim() || "";
  return id && id !== "local" ? id : null;
}

function segmentPath(dir: string, segIndex: number): string {
  return path.join(dir, `log-${segIndex}.jsonl`);
}

function listSegments(dir: string): number[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => /^log-(\d+)\.jsonl$/.exec(name)?.[1])
    .filter((seg): seg is string => seg !== undefined)
    .map((seg) => Number(seg))
    .sort((a, b) => a - b);
}

function parseLines(filePath: string): NomiEvent[] {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const events: NomiEvent[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line) as NomiEvent);
    } catch {
      // 撕裂尾行容忍:只允许最后一个非空行损坏;中间行损坏也跳过但记录告警。
      if (i < lines.length - 2) console.error(`[events] 损坏行被跳过: ${filePath}:${i + 1}`);
    }
  }
  return events;
}

function initState(projectId: string): LogState | null {
  const cached = states.get(projectId);
  if (cached) return cached;
  const rootPath = projectDirResolver(projectId);
  if (!rootPath) return null;
  const dir = path.join(rootPath, ".nomi", "events");
  fs.mkdirSync(dir, { recursive: true });
  const segments = listSegments(dir);
  const segIndex = segments.length > 0 ? segments[segments.length - 1] : 0;
  sealTornTail(segmentPath(dir, segIndex));
  const existing = parseLines(segmentPath(dir, segIndex));
  const state: LogState = {
    dir,
    seq: existing.length > 0 ? existing[existing.length - 1].seq : recoverSeqHighWater(dir, segments),
    segIndex,
    segEvents: existing.length,
    segBytes: fs.existsSync(segmentPath(dir, segIndex)) ? fs.statSync(segmentPath(dir, segIndex)).size : 0,
  };
  states.set(projectId, state);
  return state;
}

/** 崩溃撕裂的尾行没有换行符——补一个 \n 让残行自成一行(读取时被跳过),防止下次 append 粘连报废。 */
function sealTornTail(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const stat = fs.statSync(filePath);
  if (stat.size === 0) return;
  const fd = fs.openSync(filePath, "r");
  try {
    const tail = Buffer.alloc(1);
    fs.readSync(fd, tail, 0, 1, stat.size - 1);
    if (tail.toString("utf8") !== "\n") fs.appendFileSync(filePath, "\n");
  } finally {
    fs.closeSync(fd);
  }
}

// seq 高水位恢复:扫所有段的**原始文本**取最大 "seq":N——连 JSON 解析失败的损坏行也能救回 seq 号,
// 防「最新段全损(或仅一段且全损)→ seq 回退 0 → 与历史重号」(破坏 seq 全局唯一顺序权威)。
// 返回已存在的最大 seq(append 时 +1);确实无任何可救的 seq 时才 0。seq 单调,故多段场景等价于
// 旧的"最近非空段末事件 seq",且额外覆盖当前段损坏的情形。
function recoverSeqHighWater(dir: string, segments: number[]): number {
  let maxSeq = 0;
  for (const seg of segments) {
    const filePath = segmentPath(dir, seg);
    if (!fs.existsSync(filePath)) continue;
    for (const match of fs.readFileSync(filePath, "utf8").matchAll(/"seq"\s*:\s*(\d+)/g)) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  return maxSeq;
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/** 超限 payload 逐字段截断;全文落 sidecar(失败则只截断不留引用)。 */
function capPayload(dir: string, seq: number, payload: Record<string, unknown>): Record<string, unknown> {
  if (JSON.stringify(payload).length <= MAX_EVENT_BYTES) return payload;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
    if (text.length <= 512) {
      out[key] = value;
      continue;
    }
    const field: TruncatedPayloadField = { truncated: true, head: text.slice(0, HEAD_CHARS), byteSize: Buffer.byteLength(text), sha256: sha256(text), valueKind: typeof value === "string" ? "string" : "json" };
    try {
      const sidecarDir = path.join(dir, "sidecar");
      fs.mkdirSync(sidecarDir, { recursive: true });
      const ref = `sidecar/${seq}-${key}.json`;
      fs.writeFileSync(path.join(dir, ref), text, "utf8");
      field.sidecarRef = ref;
    } catch (error) {
      console.error(`[events] sidecar 写入失败(只截断): ${error instanceof Error ? error.message : String(error)}`);
    }
    out[key] = field;
  }
  return out;
}

/** 追加事件(批量)。返回写入的完整事件;项目不可解析或 IO 失败时返回 [](绝不 throw)。 */
export function appendEvents(projectId: string, newEvents: readonly NewNomiEvent[]): NomiEvent[] {
  try {
    const state = initState(projectId);
    if (!state || newEvents.length === 0) return [];
    const secrets = secretsProvider();
    const written: NomiEvent[] = [];
    let buffer = "";
    for (const raw of newEvents) {
      state.seq += 1;
      const payload = capPayload(state.dir, state.seq, redactDeep(raw.payload, secrets));
      const event: NomiEvent = { v: 1, ...raw, payload, seq: state.seq, ts: new Date().toISOString() };
      const line = `${JSON.stringify(event)}\n`;
      buffer += line;
      state.segEvents += 1;
      state.segBytes += Buffer.byteLength(line);
      written.push(event);
      if (state.segEvents >= SEGMENT_MAX_EVENTS || state.segBytes >= SEGMENT_MAX_BYTES) {
        fs.appendFileSync(segmentPath(state.dir, state.segIndex), buffer, "utf8");
        buffer = "";
        state.segIndex += 1;
        state.segEvents = 0;
        state.segBytes = 0;
      }
    }
    if (buffer) fs.appendFileSync(segmentPath(state.dir, state.segIndex), buffer, "utf8");
    return written;
  } catch (error) {
    console.error(`[events] append 失败(旁路忽略): ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** sidecar 回读:被截断的字段还原全文(S5-a3——否则 >4KB 的 canvas 事件重放会拿到残值)。 */
function rehydratePayload(dir: string, payload: Record<string, unknown>): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(payload)) {
    const field = value as Partial<TruncatedPayloadField> | null;
    if (!field || typeof field !== "object" || field.truncated !== true || !field.sidecarRef) continue;
    try {
      const text = fs.readFileSync(path.join(dir, field.sidecarRef), "utf8");
      if (!out) out = { ...payload };
      out[key] = field.valueKind === "json" ? (JSON.parse(text) as unknown) : text;
    } catch {
      // sidecar 丢失:保留截断形态(head/sha256 仍可审计),不抛错
    }
  }
  return out ?? payload;
}

/** 读事件(全部段按 seq 升序,截断字段经 sidecar 还原),供轨迹查看/重放/评测消费。 */
export function readEvents(projectId: string, opts: { fromSeq?: number } = {}): NomiEvent[] {
  try {
    const state = initState(projectId);
    if (!state) return [];
    const fromSeq = opts.fromSeq ?? 0;
    const events: NomiEvent[] = [];
    for (const segIndex of listSegments(state.dir)) {
      for (const event of parseLines(segmentPath(state.dir, segIndex))) {
        if (event.seq > fromSeq) events.push({ ...event, payload: rehydratePayload(state.dir, event.payload) });
      }
    }
    return events;
  } catch {
    return [];
  }
}

/** 测试用:清掉内存态(不动磁盘)。 */
export function resetEventLogStateForTests(): void {
  states.clear();
}
