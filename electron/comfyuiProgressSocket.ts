// ComfyUI ws 进度桥（P 轨 · 2026-08-01 拍板：进度环 + 活预览 + 遮罩取消）。
//
// 为什么在主进程：渲染层 CSP connect-src 不含 ws://（dev 只放 Vite 5273、prod 无 ws），直连必被拦；
// 主进程用 undici 自带 WebSocket，与 appFetch 显式共用应用路由；本机/私网始终直连。
// 事件面（实查 ComfyUI server.py / protocol.py HEAD 2026-08-01）：
//   text: {type:'progress',data:{value,max,prompt_id,node}} / {type:'executing',data:{node|null,prompt_id}}
//         {type:'execution_cached',data:{nodes[],prompt_id}} / {type:'status',...}
//   binary: [>I event][payload]；event 1=PREVIEW_IMAGE → [>I 1=JPEG|2=PNG][图字节]
// 推送渠道：webContents.send("nomi:tasks:comfyui:progress")（镜像 textStreamIpc 单向事件范式；
// 高频瞬态，刻意不进 EventLog、不进持久化 result）。
// prompt_id→node 注册表是本模块唯一的数据结构缺口补齐：渲染层提交拿到 prompt_id 后经 watch IPC 登记。
import { webContents } from "electron";
import { WebSocket } from "undici";
import { appFetch } from "./appFetch";
import { getAppDispatcher } from "./systemProxy";
import { readCatalog } from "./catalog/catalogStore";
import { COMFYUI_VENDOR_KEY, isComfyuiVendor } from "./catalog/types";
import { COMFYUI_CLIENT_FEATURE_FLAGS, getComfyuiClientId } from "./comfyui/clientSession";
import { comfyuiEndpoint, comfyuiJobCancelEndpoint, comfyuiWebSocketUrl } from "./comfyui/endpointResolver";

export const COMFYUI_PROGRESS_CHANNEL = "nomi:tasks:comfyui:progress";

export type ComfyuiProgressEvent = {
  promptId: string;
  nodeId: string;
  projectId: string;
  kind: "progress" | "preview" | "queue" | "done";
  /** 0-100（kind=progress）。 */
  percent?: number;
  /** 当前执行节点 class（人话进度用）。 */
  currentClass?: string;
  startedNodes?: number;
  totalNodes?: number;
  /** kind=queue：前面还有几个任务。 */
  queueAhead?: number;
  /** kind=preview：jpeg/png data URL。 */
  previewDataUrl?: string;
};

type WatchEntry = {
  promptId: string;
  nodeId: string;
  projectId: string;
  webContentsId: number;
  baseUrl: string;
  totalNodes: number;
  classById: Record<string, string>;
  started: Set<string>;
  currentNode: string | null;
  lastPreviewAt: number;
  lastQueueProbeAt: number;
  createdAt: number;
};

const registry = new Map<string, WatchEntry>();
type SocketHolder = {
  ws: WebSocket;
  alive: boolean;
  ready: Promise<boolean>;
  settleReady: (value: boolean) => void;
};
const socketsByBase = new Map<string, SocketHolder>();
/** 该 server 当前正在执行的 prompt（binary 预览帧不带 prompt_id，归属按此判）。 */
const currentPromptByBase = new Map<string, string>();

const ENTRY_TTL_MS = 30 * 60 * 1000; // 慢道硬超时 20min 之上留余量
const PREVIEW_MIN_INTERVAL_MS = 450;
const PREVIEW_MAX_BYTES = 1_500_000;
const QUEUE_PROBE_MIN_INTERVAL_MS = 2_000;

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 任务终态事件名（导出供单测钉死）。口径**照抄 ComfyUI 官方**——它自己的 jobs 视图就是按这三件事
 * 判 execution_end（comfy_execution/jobs.py:231，HEAD 2026-08-01）。别只认 executing(node=null)：
 * 真服务器实测过「全缓存命中那一轮压根不发 executing」，只认它会让注册表/ws 一路泄漏到 TTL。
 */
export const COMFYUI_TERMINAL_EVENTS = ["execution_success", "execution_error", "execution_interrupted"] as const;

export function isComfyuiTerminalEvent(type: unknown): boolean {
  return typeof type === "string" && (COMFYUI_TERMINAL_EVENTS as readonly string[]).includes(type);
}

/** 纯函数：event 1 旧帧；event 4 = metadata 长度 + JSON(prompt/node/image_type) + 图字节。 */
export function parsePreviewFrame(buf: Buffer): { mime: string; bytes: Buffer; promptId?: string; nodeId?: string } | null {
  if (buf.length < 8) return null;
  const event = buf.readUInt32BE(0);
  if (event === 1) {
    const format = buf.readUInt32BE(4);
    const mime = format === 2 ? "image/png" : "image/jpeg";
    const bytes = buf.subarray(8);
    return bytes.length > 0 && bytes.length <= PREVIEW_MAX_BYTES ? { mime, bytes } : null;
  }
  if (event !== 4) return null;
  const metadataLength = buf.readUInt32BE(4);
  if (metadataLength <= 0 || metadataLength > 64 * 1024 || buf.length <= 8 + metadataLength) return null;
  try {
    const metadata = JSON.parse(buf.subarray(8, 8 + metadataLength).toString("utf8")) as Record<string, unknown>;
    const bytes = buf.subarray(8 + metadataLength);
    if (bytes.length === 0 || bytes.length > PREVIEW_MAX_BYTES) return null;
    return {
      mime: metadata.image_type === "image/png" ? "image/png" : "image/jpeg",
      bytes,
      ...(typeof metadata.prompt_id === "string" ? { promptId: metadata.prompt_id } : {}),
      ...(typeof metadata.node_id === "string" ? { nodeId: metadata.node_id } : {}),
    };
  } catch {
    return null;
  }
}

/** 纯函数（可单测）：整体进度 =（已开跑节点数-1 + 当前节点比率）/ 总节点数。 */
export function computeOverallPercent(startedCount: number, currentRatio: number, totalNodes: number): number {
  if (totalNodes <= 0) return 0;
  const done = Math.max(0, startedCount - 1) + Math.max(0, Math.min(1, currentRatio));
  return Math.max(0, Math.min(100, Math.round((done / totalNodes) * 100)));
}

function send(entry: WatchEntry, event: Omit<ComfyuiProgressEvent, "promptId" | "nodeId" | "projectId">): void {
  const target = webContents.fromId(entry.webContentsId);
  if (!target || target.isDestroyed()) return;
  target.send(COMFYUI_PROGRESS_CHANNEL, {
    promptId: entry.promptId,
    nodeId: entry.nodeId,
    projectId: entry.projectId,
    ...event,
  } satisfies ComfyuiProgressEvent);
}

/** 多实例：连**这一台**的 ws（各机器各连各的；socketsByBase 本就按地址分池，天然隔离）。 */
function comfyuiBaseUrl(vendorKey?: string): string {
  const key = vendorKey && isComfyuiVendor({ key: vendorKey }) ? vendorKey : COMFYUI_VENDOR_KEY;
  const vendor = readCatalog().vendors.find((v) => v.key === key);
  return String(vendor?.baseUrlHint || "http://127.0.0.1:8188").replace(/\/+$/, "");
}

function sweepExpired(now = Date.now()): void {
  for (const [promptId, entry] of registry) {
    if (now - entry.createdAt > ENTRY_TTL_MS) registry.delete(promptId);
  }
}

function closeSocketIfIdle(baseUrl: string): void {
  const hasWatcher = [...registry.values()].some((e) => e.baseUrl === baseUrl);
  if (hasWatcher) return;
  const holder = socketsByBase.get(baseUrl);
  socketsByBase.delete(baseUrl);
  currentPromptByBase.delete(baseUrl);
  try { holder?.ws.close(); } catch { /* 已断开 */ }
}

function handleTextMessage(baseUrl: string, raw: string): void {
  let msg: unknown;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!isRec(msg) || typeof msg.type !== "string") return;
  const data = isRec(msg.data) ? msg.data : {};
  const promptId = typeof data.prompt_id === "string" ? data.prompt_id : "";

  // 终态：按 ComfyUI **官方口径**（comfy_execution/jobs.py:231 把这三件事当 execution_end）收口，
  // 外加老版本的 executing(node=null)。实测教训（真服务器 0.29.0）：同一张图再跑一次会**全缓存命中**，
  // 此时根本不发 executing，只发 execution_success——只认 executing(null) 会让注册表与 ws 连接在
  // 「全缓存 / 报错 / 被取消」三条路径上一路泄漏到 30min TTL。幂等：重复终态信号安全。
  if (isComfyuiTerminalEvent(msg.type)) {
    const entry = promptId ? registry.get(promptId) : undefined;
    if (!entry) return;
    send(entry, { kind: "done" });
    registry.delete(promptId);
    if (currentPromptByBase.get(baseUrl) === promptId) currentPromptByBase.delete(baseUrl);
    closeSocketIfIdle(baseUrl);
    return;
  }

  if (msg.type === "executing") {
    if (promptId) currentPromptByBase.set(baseUrl, promptId);
    const entry = promptId ? registry.get(promptId) : undefined;
    if (!entry) return;
    const node = typeof data.node === "string" ? data.node : null;
    if (node === null) {
      send(entry, { kind: "done" });
      registry.delete(promptId);
      currentPromptByBase.delete(baseUrl);
      closeSocketIfIdle(baseUrl);
      return;
    }
    entry.currentNode = node;
    entry.started.add(node);
    send(entry, {
      kind: "progress",
      percent: computeOverallPercent(entry.started.size, 0, entry.totalNodes),
      currentClass: entry.classById[node] || node,
      startedNodes: entry.started.size,
      totalNodes: entry.totalNodes,
    });
    return;
  }

  if (msg.type === "progress") {
    const entry = promptId ? registry.get(promptId) : undefined;
    if (!entry) return;
    if (promptId) currentPromptByBase.set(baseUrl, promptId);
    const value = Number(data.value);
    const max = Number(data.max);
    const ratio = Number.isFinite(value) && Number.isFinite(max) && max > 0 ? value / max : 0;
    const node = typeof data.node === "string" ? data.node : entry.currentNode;
    if (node) entry.started.add(node);
    send(entry, {
      kind: "progress",
      percent: computeOverallPercent(entry.started.size, ratio, entry.totalNodes),
      currentClass: node ? entry.classById[node] || node : undefined,
      startedNodes: entry.started.size,
      totalNodes: entry.totalNodes,
    });
    return;
  }

  if (msg.type === "execution_cached") {
    const entry = promptId ? registry.get(promptId) : undefined;
    if (!entry || !Array.isArray(data.nodes)) return;
    for (const node of data.nodes) if (typeof node === "string") entry.started.add(node);
    send(entry, {
      kind: "progress",
      percent: computeOverallPercent(entry.started.size, 1, entry.totalNodes),
      startedNodes: entry.started.size,
      totalNodes: entry.totalNodes,
    });
    return;
  }

  if (msg.type === "status") {
    // 排队位次：还没开始执行的 watcher 才关心；节流问 /queue（status 无 per-prompt 位次）。
    for (const entry of registry.values()) {
      if (entry.baseUrl !== baseUrl || entry.started.size > 0) continue;
      void probeQueuePosition(entry);
    }
  }
}

async function probeQueuePosition(entry: WatchEntry): Promise<void> {
  const now = Date.now();
  if (now - entry.lastQueueProbeAt < QUEUE_PROBE_MIN_INTERVAL_MS) return;
  entry.lastQueueProbeAt = now;
  try {
    const res = await appFetch(comfyuiEndpoint(entry.baseUrl, "queue"), { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const data = (await res.json()) as { queue_pending?: unknown[] };
    const pending = Array.isArray(data.queue_pending) ? data.queue_pending : [];
    const index = pending.findIndex((item) => Array.isArray(item) && item[1] === entry.promptId);
    if (index >= 0) send(entry, { kind: "queue", queueAhead: index });
  } catch { /* 排队位次是锦上添花，失败静默 */ }
}

function handleBinaryMessage(baseUrl: string, buf: Buffer): void {
  const frame = parsePreviewFrame(buf);
  if (!frame) return;
  // event 4 用官方 metadata 精确归属；event 1 仅给旧服串行场景回落到当前执行任务。
  const promptId = frame.promptId || currentPromptByBase.get(baseUrl);
  const entry = promptId ? registry.get(promptId) : undefined;
  if (!entry) return;
  const now = Date.now();
  if (now - entry.lastPreviewAt < PREVIEW_MIN_INTERVAL_MS) return; // 节流：IPC 别被 20fps 预览刷爆
  entry.lastPreviewAt = now;
  send(entry, { kind: "preview", previewDataUrl: `data:${frame.mime};base64,${frame.bytes.toString("base64")}` });
}

async function ensureSocket(baseUrl: string): Promise<boolean> {
  const existing = socketsByBase.get(baseUrl);
  if (existing?.alive) return Promise.resolve(true);
  if (existing) return existing.ready;
  let ws: WebSocket;
  try {
    const url = comfyuiWebSocketUrl(baseUrl, getComfyuiClientId());
    const dispatcher = await getAppDispatcher(AbortSignal.timeout(800), url);
    if (![...registry.values()].some((entry) => entry.baseUrl === baseUrl)) return false;
    // Another watch may have completed initialization during the route wait.
    const readySocket = socketsByBase.get(baseUrl);
    if (readySocket) return readySocket.alive ? true : readySocket.ready;
    ws = new WebSocket(url, { dispatcher });
  } catch {
    return Promise.resolve(false); // 起不来就没有进度（轮询照常兜底），不炸任务
  }
  let settled = false;
  let resolveReady: (value: boolean) => void = () => undefined;
  const ready = new Promise<boolean>((resolve) => { resolveReady = resolve; });
  const settleReady = (value: boolean): void => {
    if (settled) return;
    settled = true;
    resolveReady(value);
  };
  const holder: SocketHolder = { ws, alive: false, ready, settleReady };
  socketsByBase.set(baseUrl, holder);
  ws.binaryType = "arraybuffer";
  const readyTimer = setTimeout(() => settleReady(false), 800);
  readyTimer.unref?.();
  ws.addEventListener("open", () => {
    holder.alive = true;
    clearTimeout(readyTimer);
    // 官方约定：feature_flags 必须是客户端发出的第一条 WS 消息。
    try { ws.send(JSON.stringify({ type: "feature_flags", data: COMFYUI_CLIENT_FEATURE_FLAGS })); } catch { /* 实时层失败不炸提交 */ }
    settleReady(true);
  });
  ws.addEventListener("message", (event) => {
    const payload = (event as { data?: unknown }).data;
    if (typeof payload === "string") handleTextMessage(baseUrl, payload);
    else if (payload instanceof ArrayBuffer) handleBinaryMessage(baseUrl, Buffer.from(payload));
  });
  const drop = () => {
    clearTimeout(readyTimer);
    settleReady(false);
    holder.alive = false;
    if (socketsByBase.get(baseUrl) === holder) socketsByBase.delete(baseUrl);
    // 还有 watcher（任务在跑但 ws 断了，如 ComfyUI 重启）→ 3s 后重连一次；轮询始终是终态真相源。
    if ([...registry.values()].some((e) => e.baseUrl === baseUrl)) {
      setTimeout(() => ensureSocket(baseUrl), 3000).unref?.();
    }
  };
  ws.addEventListener("close", drop);
  ws.addEventListener("error", drop);
  return ready;
}

/** 渲染层提交拿到 prompt_id 后登记（comfyuiIpc: nomi:tasks:comfyui:watch）。 */
export async function watchComfyuiTask(
  payload: { promptId?: unknown; nodeId?: unknown; projectId?: unknown; taskKind?: unknown; modelKey?: unknown; vendorKey?: unknown },
  webContentsId: number,
): Promise<{ ok: boolean }> {
  sweepExpired();
  const promptId = String(payload.promptId || "").trim();
  const nodeId = String(payload.nodeId || "").trim();
  if (!promptId || !nodeId) return { ok: false };
  const rawVendorKey = String(payload.vendorKey || "").trim();
  const vendorKey = rawVendorKey && isComfyuiVendor({ key: rawVendorKey }) ? rawVendorKey : COMFYUI_VENDOR_KEY;
  const baseUrl = comfyuiBaseUrl(vendorKey);
  // 从 mapping 的 workflow 图取总节点数 + class 名（进度分母与人话标签）。多实例：只找这一台名下的。
  const mapping = readCatalog().mappings.find(
    (m) => m.vendorKey === vendorKey && m.taskKind === payload.taskKind && (!payload.modelKey || m.modelKey === payload.modelKey),
  );
  const body = isRec(mapping?.create) ? (mapping.create as { body?: unknown }).body : null;
  const graph = isRec(body) && isRec(body.prompt) ? (body.prompt as Record<string, unknown>) : {};
  const classById: Record<string, string> = {};
  for (const [id, node] of Object.entries(graph)) {
    if (isRec(node) && typeof node.class_type === "string") classById[id] = node.class_type;
  }
  registry.set(promptId, {
    promptId,
    nodeId,
    projectId: String(payload.projectId || "").trim(),
    webContentsId,
    baseUrl,
    totalNodes: Object.keys(classById).length,
    classById,
    started: new Set(),
    currentNode: null,
    lastPreviewAt: 0,
    lastQueueProbeAt: 0,
    createdAt: Date.now(),
  });
  // 等 open/feature negotiation 后 renderer 才提交，极快任务不会漏掉首批事件；超时仍由 history 兜底。
  await ensureSocket(baseUrl);
  return { ok: true };
}

export function unwatchComfyuiTask(promptId: unknown): void {
  const id = String(promptId || "").trim();
  const entry = registry.get(id);
  if (!entry) return;
  registry.delete(id);
  closeSocketIfIdle(entry.baseUrl);
}

/**
 * 取消。优先走官方原子定向 POST /api/jobs/{id}/cancel（运行中走 interrupt_if_running、
 * 排队中走 delete_queue_item，state-agnostic）。
 *
 * 两处按官方源码实查修正（2026-08-20 对账 comfyanonymous/ComfyUI master server.py）：
 *
 * ① **这条恒 200，必须读 body 里的 `cancelled`**。官方注释写明：取消一个已结束或不认识的 id
 *    「returns 200 with {"cancelled": false} rather than an error」。只看 res.ok 会把
 *    「什么都没取消」当成功报上去——用户点了取消、GPU 还在转，界面却说取消了（D4 不糊弄）。
 *
 * ② **旧服兜底原来停不掉正在跑的任务**。`POST /queue {delete:[id]}` 走的是 delete_queue_item，
 *    只摘**排队**项，对当前正在执行的那个毫无作用。原先绕开 /interrupt 是怕误伤同实例上
 *    别人的任务——**这个顾虑已经过期**：官方 /interrupt 现在收 `prompt_id`，只在「它正好是
 *    当前运行的那个」时才打断（`if item[1] == prompt_id: should_interrupt = True`），否则跳过。
 *    所以旧服兜底改成**两条都发**：/interrupt 管运行中、/queue delete 管排队中，
 *    各自不适用时都是 no-op，谁成了都算取消成功。
 */
export type ComfyuiCancelResult = { ok: boolean; mode: "targeted" | "nothing-to-cancel" | "legacy" | "failed" };

export async function cancelComfyuiPrompt(
  baseUrl: string,
  promptId: string,
  fetchImpl: typeof fetch = appFetch,
): Promise<ComfyuiCancelResult> {
  const postJson = (url: string, body?: unknown) =>
    fetchImpl(url, {
      method: "POST",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);

  const targeted = await postJson(comfyuiJobCancelEndpoint(baseUrl, promptId));
  if (targeted?.ok) {
    const cancelled = await targeted
      .json()
      .then((body) => (isRec(body) ? body.cancelled === true : false))
      .catch(() => false);
    return cancelled ? { ok: true, mode: "targeted" } : { ok: true, mode: "nothing-to-cancel" };
  }
  // 404/405 = 老服务端没有 jobs 命名空间；其余状态码是真出错，别再拿老路径试一遍把它盖过去。
  if (targeted && targeted.status !== 404 && targeted.status !== 405) return { ok: false, mode: "failed" };

  const [interrupted, dequeued] = await Promise.all([
    postJson(comfyuiEndpoint(baseUrl, "interrupt"), { prompt_id: promptId }),
    postJson(comfyuiEndpoint(baseUrl, "queue"), { delete: [promptId] }),
  ]);
  const ok = Boolean(interrupted?.ok) || Boolean(dequeued?.ok);
  return { ok, mode: ok ? "legacy" : "failed" };
}

export async function interruptComfyuiTask(promptId: unknown): Promise<ComfyuiCancelResult> {
  const id = String(promptId || "").trim();
  if (!id) return { ok: false, mode: "failed" };
  const baseUrl = registry.get(id)?.baseUrl || comfyuiBaseUrl();
  return cancelComfyuiPrompt(baseUrl, id);
}

/** 测试钩子。 */
export function _resetComfyuiProgressForTest(): void {
  registry.clear();
  for (const [base] of socketsByBase) closeSocketIfIdle(base);
  socketsByBase.clear();
  currentPromptByBase.clear();
}
export function _registrySizeForTest(): number {
  return registry.size;
}
