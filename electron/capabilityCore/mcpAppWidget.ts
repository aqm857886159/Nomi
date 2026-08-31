// 能力核 · MCP Apps 活生成 widget（GUI 宿主内嵌的 Nomi 活面板）。
//
// 协议依据（R5 实查 2026-08-02，来源 modelcontextprotocol/ext-apps `specification/2026-01-26/apps.mdx`
// = MCP Apps 扩展 SEP-1865，扩展 id `io.modelcontextprotocol/ui`，Stable 2026-01-26）：
//  - 工具经 `_meta.ui.resourceUri` 指向一个 `ui://` 资源（预声明，非塞进 tool result）。
//  - 该资源经 `resources/read` 返回，mimeType 必须是 `text/html;profile=mcp-app`，text=自包含 HTML。
//  - 宿主把 tool 的 `structuredContent` 经 `ui/notifications/tool-result` postMessage 注入 iframe。
//  - iframe 作为 MCP 客户端，用 JSON-RPC over window.parent.postMessage 与宿主通信
//    （ui/initialize → ui/notifications/initialized；ui/notifications/size-changed；ui/open-link…）。
//
// 本 widget = 「Nomi 活生成」：把外部 agent 驱动的这次生成，在宿主对话里内嵌一张 Nomi 风格活面板——
// 标题 + 逐镜缩略图（带状态徽标）+「在 Nomi 中打开」。宿主不支持该扩展时 tool 仍回文本兜底（不裸奔）。
// 纯字符串（无 electron/DOM 依赖）→ 可裸 node 单测 serving，也可独立浏览器渲染截图验。

/** widget 资源的 ui:// uri（预声明；tool 的 _meta.ui.resourceUri 指向它）。 */
export const NOMI_LIVE_DRAFT_UI_URI = 'ui://nomi/live-draft.html'
/** MCP Apps 规范锁定的 widget mimeType（唯一合法值，2026-01-26）。 */
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app'
/** 客户端/宿主在 initialize 声明的 UI 扩展 id（据此判断宿主是否会渲染 widget）。 */
export const MCP_UI_EXTENSION_ID = 'io.modelcontextprotocol/ui'

/**
 * widget 要渲染的数据形状（tool 经 structuredContent.nomiDraft 下发；widget 读它渲染）。
 * kind：generation=逐镜出图｜reference=参考图（定妆/场景）｜plan=方案预览。
 */
export type NomiDraftShot = {
  index?: number
  title?: string
  /** queued=排队｜running=生成中｜success=已出｜error=失败。 */
  status?: 'queued' | 'running' | 'success' | 'error'
  kind?: 'image' | 'video'
  /** 缩略图 URL（可能被宿主 CSP 拦；widget onerror 优雅降级为占位）。 */
  thumbnailUrl?: string
}
export type NomiDraftState = {
  kind?: 'generation' | 'reference' | 'plan' | 'production'
  title?: string
  status?: 'running' | 'succeeded' | 'failed' | 'available' | 'unknown'
  message?: string
  shots?: NomiDraftShot[]
  projectId?: string
  projectName?: string
  /** 深链：宿主支持 ui/open-link 时「在 Nomi 中打开」跳这里。 */
  deepLink?: string
  runId?: string
}

/** Convert a safe MCP production projection into the same compact widget state used by generation. */
export function buildNomiRunFromProjection(args: {
  projectId?: string
  runId?: string
  result: unknown
}): NomiDraftState {
  const value = (args.result && typeof args.result === 'object' && !Array.isArray(args.result))
    ? args.result as Record<string, unknown>
    : {}
  const rawStatus = String(value.status || '')
  const isArtifactProjection = typeof value.artifactId === 'string'
  const status: NomiDraftState['status'] = rawStatus === 'completed' || rawStatus === 'succeeded'
    ? 'succeeded'
    : rawStatus === 'cancelled' || rawStatus === 'failed' || rawStatus === 'needs_attention'
      ? 'failed'
      : ['running', 'exporting', 'pausing'].includes(rawStatus) || (rawStatus === 'ready' && !isArtifactProjection)
        ? 'running'
        : ['candidate', 'ready', 'adopted'].includes(rawStatus)
          ? 'available'
          : rawStatus.startsWith('awaiting_') || rawStatus === 'draft' || rawStatus === 'paused'
            ? 'available'
            : 'unknown'
  const projectId = typeof value.projectId === 'string' ? value.projectId : args.projectId
  const runId = typeof value.runId === 'string' ? value.runId : args.runId
  const playbook = value.playbook && typeof value.playbook === 'object' ? value.playbook as Record<string, unknown> : {}
  const artifacts = Array.isArray(value.artifacts) ? value.artifacts as Array<Record<string, unknown>> : []
  const safePreviewUrl = (candidate: unknown): string | undefined => {
    if (typeof candidate !== 'string') return undefined
    if (candidate.startsWith('nomi-local://')) return candidate
    try {
      const parsed = new URL(candidate)
      return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.pathname === '/production-preview' && parsed.searchParams.has('preview')
        ? candidate
        : undefined
    } catch {
      return undefined
    }
  }
  const previewArtifacts = artifacts
    .filter((artifact) => {
      const preview = artifact.preview && typeof artifact.preview === 'object' ? artifact.preview as Record<string, unknown> : {}
      return Boolean(safePreviewUrl(preview.url))
    })
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 1)
  const shots = previewArtifacts.map((artifact, index) => {
    const preview = artifact.preview && typeof artifact.preview === 'object' ? artifact.preview as Record<string, unknown> : {}
    const previewUrl = safePreviewUrl(preview.url)
    return {
      index: index + 1,
      title: typeof artifact.kind === 'string' ? artifact.kind : `产物 ${index + 1}`,
      status: artifact.status === 'ready' || artifact.status === 'adopted' ? 'success' as const : 'queued' as const,
      kind: artifact.kind === 'video' ? 'video' as const : 'image' as const,
      ...(previewUrl ? { thumbnailUrl: previewUrl } : {}),
    }
  })
  const ownPreview = value.preview && typeof value.preview === 'object' ? value.preview as Record<string, unknown> : undefined
  if (shots.length === 0 && ownPreview?.url && typeof value.kind === 'string') {
    const previewUrl = safePreviewUrl(ownPreview.url)
    if (previewUrl) shots.push({ index: 1, title: String(value.kind), status: value.status === 'ready' || value.status === 'adopted' ? 'success' as const : 'queued' as const, kind: value.kind === 'video' ? 'video' as const : 'image' as const, thumbnailUrl: previewUrl })
  }
  const latestEvent = Array.isArray(value.events) ? (value.events as Array<Record<string, unknown>>).at(-1) : undefined
  const candidateDeepLink = typeof value.openInNomi === 'string' ? value.openInNomi : ''
  const deepLink = /^nomi:\/\/project\/[A-Za-z0-9._-]+\/run\/[A-Za-z0-9._-]+(?:\?artifact=[A-Za-z0-9._-]+)?$/.test(candidateDeepLink)
    ? candidateDeepLink
    : (projectId && runId ? `nomi://project/${encodeURIComponent(projectId)}/run/${encodeURIComponent(runId)}` : undefined)
  const fallbackMessage = status === 'unknown'
    ? '已查询 Nomi，当前结果未提供运行状态。'
    : status === 'available'
      ? 'Nomi 已准备好当前结果，未自动批准付费或导出。'
      : undefined
  return {
    kind: 'production',
    title: `Nomi · ${typeof playbook.name === 'string' ? playbook.name : '制作 Run'}`,
    status,
    ...(typeof latestEvent?.message === 'string' && latestEvent.message
      ? { message: latestEvent.message }
      : fallbackMessage ? { message: fallbackMessage } : {}),
    shots,
    ...(projectId ? { projectId } : {}),
    ...(runId ? { runId } : {}),
    ...(deepLink ? { deepLink } : {}),
  }
}

/**
 * 把一次 nomi_generate 的结果整理成 widget 数据（tool result 的 structuredContent.nomiDraft）。
 * result 形状来自 core.generateOnProject（{ status, assets:[{url,type}], ... }）——尽量宽松取值。
 */
export function buildNomiDraftFromGenerate(args: {
  intent?: string
  prompt?: string
  projectId?: string
  vendor?: string
  modelKey?: string
  result: unknown
}): NomiDraftState {
  const r = (args.result && typeof args.result === 'object' ? args.result : {}) as Record<string, unknown>
  const rawStatus = String(r.status || '')
  const status: NomiDraftState['status'] = rawStatus === 'succeeded' ? 'succeeded' : rawStatus === 'failed' ? 'failed' : 'running'
  const assets = Array.isArray(r.assets) ? (r.assets as Array<Record<string, unknown>>) : []
  const firstUrl = (assets[0]?.url as string) || (r.url as string) || ((r.result as Record<string, unknown>)?.url as string) || undefined
  const isVideo = String(args.intent || assets[0]?.type || '') === 'video'
  const title = (args.prompt || '').trim().slice(0, 40) || (isVideo ? '一段视频' : '一张画面')
  return {
    kind: 'generation',
    title: `Nomi · ${title}`,
    status,
    ...(typeof r.error === 'string' && r.error ? { message: r.error } : {}),
    shots: [
      {
        index: 1,
        title,
        status: status === 'succeeded' ? 'success' : status === 'failed' ? 'error' : 'running',
        kind: isVideo ? 'video' : 'image',
        ...(firstUrl ? { thumbnailUrl: firstUrl } : {}),
      },
    ],
    ...(args.projectId ? { projectId: args.projectId } : {}),
  }
}

/**
 * 自包含 widget HTML（inline CSS/JS，CSP 下无外部依赖）。Nomi 调色板经 oklch + prefers-color-scheme
 * 光/暗双模（与 tailwind.config 一致），亦响应宿主 ui/notifications/host-context-changed 的主题。
 */
export const NOMI_LIVE_DRAFT_WIDGET_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Nomi 活生成</title>
<style>
  :root {
    --paper: oklch(1 0 0);
    --ink: oklch(0.22 0.01 80);
    --ink-80: oklch(0.32 0.01 80);
    --ink-60: oklch(0.50 0.01 80);
    --ink-40: oklch(0.68 0.01 80);
    --line: oklch(0.90 0.005 80);
    --soft: oklch(0.97 0.003 80);
    --accent: oklch(0.55 0.13 250);
    /* ⚠️ 语义色 × paper 的混合一律 in srgb，别改回 in oklch：oklch 对色相走最短弧插值，而 --paper 显式钉了
       色相（浅 h=0 / 暗 h=80）→ 混出来的是 paper 的色相不是语义色的。实测 accent(h250) 浅色落 h≈347(粉)、
       暗色落 h≈124(橄榄绿)；ok(h150) 浅色落 h≈24(橙) —— 成功徽章变橙、失败徽章暗色落 h≈71(橄榄)。
       完整原委见 tailwind.config.ts 的 --nomi-accent-soft（同一 bug 的主 App 侧）。 */
    --accent-soft: color-mix(in srgb, var(--accent) 12%, var(--paper));
    --ok: oklch(0.60 0.13 150);
    --err: oklch(0.58 0.18 25);
    --radius: 12px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: oklch(0.235 0.007 80);
      --ink: oklch(0.93 0.006 85);
      --ink-80: oklch(0.84 0.006 85);
      --ink-60: oklch(0.70 0.006 85);
      --ink-40: oklch(0.62 0.006 85);
      --line: oklch(0.34 0.006 85);
      --soft: oklch(0.30 0.006 85);
      --accent: oklch(0.70 0.13 250);
      --accent-soft: color-mix(in srgb, var(--accent) 26%, var(--paper));
    }
  }
  html.nomi-dark {
    --paper: oklch(0.235 0.007 80); --ink: oklch(0.93 0.006 85); --ink-80: oklch(0.84 0.006 85);
    --ink-60: oklch(0.70 0.006 85); --ink-40: oklch(0.62 0.006 85); --line: oklch(0.34 0.006 85);
    --soft: oklch(0.30 0.006 85); --accent: oklch(0.70 0.13 250);
    --accent-soft: color-mix(in srgb, var(--accent) 26%, var(--paper));
  }
  html.nomi-light {
    --paper: oklch(1 0 0); --ink: oklch(0.22 0.01 80); --ink-80: oklch(0.32 0.01 80);
    --ink-60: oklch(0.50 0.01 80); --ink-40: oklch(0.68 0.01 80); --line: oklch(0.90 0.005 80);
    --soft: oklch(0.97 0.003 80); --accent: oklch(0.55 0.13 250);
    --accent-soft: color-mix(in srgb, var(--accent) 12%, var(--paper));
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 12px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: var(--paper); color: var(--ink);
    -webkit-font-smoothing: antialiased;
  }
  .card { border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper); overflow: hidden; }
  .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
  .mark { width: 22px; height: 22px; border-radius: 6px; background: var(--ink); color: var(--paper); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; flex: none; }
  .title { font-size: 13px; font-weight: 600; color: var(--ink); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { margin-left: auto; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--soft); color: var(--ink-60); flex: none; }
  .badge.running { background: var(--accent-soft); color: var(--accent); }
  .badge.succeeded { background: color-mix(in srgb, var(--ok) 16%, var(--paper)); color: var(--ok); }
  .badge.failed { background: color-mix(in srgb, var(--err) 16%, var(--paper)); color: var(--err); }
  .body { padding: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
  .shot { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--soft); }
  .thumb { position: relative; aspect-ratio: 16 / 10; background: var(--soft); display: flex; align-items: center; justify-content: center; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb .ph { font-size: 11px; color: var(--ink-40); padding: 6px; text-align: center; }
  .dot { position: absolute; top: 6px; left: 6px; width: 8px; height: 8px; border-radius: 999px; box-shadow: 0 0 0 2px var(--paper); }
  .dot.queued { background: var(--ink-40); }
  .dot.running { background: var(--accent); animation: pulse 1.1s ease-in-out infinite; }
  .dot.success { background: var(--ok); }
  .dot.error { background: var(--err); }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
  .cap { padding: 5px 7px; font-size: 11px; color: var(--ink-60); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .msg { margin: 0 0 10px; font-size: 12px; color: var(--ink-60); line-height: 1.5; }
  .empty { padding: 20px 12px; text-align: center; color: var(--ink-40); font-size: 12px; }
  .foot { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--line); }
  .btn { font: inherit; font-size: 12px; cursor: pointer; border-radius: 8px; padding: 6px 12px; border: 1px solid var(--line); background: var(--paper); color: var(--ink-80); }
  .btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .btn:hover { border-color: var(--accent); }
  .hint { margin-left: auto; font-size: 11px; color: var(--ink-40); }
</style>
</head>
<body>
<div class="card" id="root">
  <div class="head">
    <span class="mark">N</span>
    <span class="title" id="title">Nomi 活生成</span>
    <span class="badge" id="badge">等待中</span>
  </div>
  <div class="body" id="bodyWrap">
  <div class="empty" id="empty">等待 Nomi 传入生成或制作 Run…</div>
    <p class="msg" id="msg" hidden></p>
    <div class="grid" id="grid"></div>
  </div>
  <div class="foot" id="foot" hidden>
    <button class="btn primary" id="openBtn" type="button">在 Nomi 打开</button>
    <span class="hint" id="hint"></span>
  </div>
</div>
<script>
(function () {
  "use strict";
  var STATUS_LABEL = { running: "进行中", succeeded: "已完成", failed: "需要处理", available: "可查看", unknown: "状态未知" };
  var SHOT_LABEL = { queued: "排队", running: "生成中", success: "已出", error: "失败" };
  var state = null;
  var rpcId = 0;

  function post(msg) { try { window.parent.postMessage(msg, "*"); } catch (e) {} }
  function notify(method, params) { post({ jsonrpc: "2.0", method: method, params: params || {} }); }
  function request(method, params) { rpcId += 1; post({ jsonrpc: "2.0", id: "view-" + rpcId, method: method, params: params || {} }); }

  function reportSize() {
    var h = document.getElementById("root").getBoundingClientRect().height;
    notify("ui/notifications/size-changed", { height: Math.ceil(h) });
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  function applyTheme(theme) {
    var el = document.documentElement;
    el.classList.remove("nomi-dark", "nomi-light");
    if (theme === "dark") el.classList.add("nomi-dark");
    else if (theme === "light") el.classList.add("nomi-light");
  }

  function render() {
    var title = document.getElementById("title");
    var badge = document.getElementById("badge");
    var empty = document.getElementById("empty");
    var grid = document.getElementById("grid");
    var msg = document.getElementById("msg");
    var foot = document.getElementById("foot");
    var hint = document.getElementById("hint");
    if (!state) { empty.hidden = false; grid.innerHTML = ""; foot.hidden = true; reportSize(); return; }
    empty.hidden = true;
    title.textContent = state.title || (state.kind === "production" ? "Nomi 制作 Run" : "Nomi 活生成");
    var st = state.status || "unknown";
    badge.textContent = STATUS_LABEL[st] || st;
    badge.className = "badge " + st;
    if (state.message) { msg.hidden = false; msg.textContent = state.message; } else { msg.hidden = true; }
    var shots = Array.isArray(state.shots) ? state.shots : [];
    grid.innerHTML = shots.map(function (s) {
      var sst = s.status || "queued";
      var cap = (s.index != null ? "镜 " + s.index + " · " : "") + (SHOT_LABEL[sst] || sst);
      var thumb = s.thumbnailUrl
        ? '<img src="' + esc(s.thumbnailUrl) + '" alt="" onerror="this.style.display=&quot;none&quot;;this.nextElementSibling.style.display=&quot;block&quot;" /><span class="ph" style="display:none">缩略图无法在此加载</span>'
        : '<span class="ph">' + (s.kind === "video" ? "视频" : "画面") + "</span>";
      return '<div class="shot"><div class="thumb"><span class="dot ' + sst + '"></span>' + thumb + '</div><div class="cap">' + esc(cap) + "</div></div>";
    }).join("");
    var canOpen = Boolean(state.deepLink);
    foot.hidden = !canOpen && !state.projectName;
    hint.textContent = state.projectName ? "项目：" + state.projectName : "";
    document.getElementById("openBtn").style.display = canOpen ? "" : "none";
    reportSize();
  }

  function ingest(sc) {
    // 宿主注入的 tool result / tool input：生成读 nomiDraft，Production Run 读 nomiRun。
    if (sc && typeof sc === "object") {
      var draft = sc.nomiRun || sc.nomiDraft || (sc.structuredContent && (sc.structuredContent.nomiRun || sc.structuredContent.nomiDraft));
      if (draft) { state = draft; render(); }
    }
  }

  window.addEventListener("message", function (ev) {
    var m = ev && ev.data;
    if (!m || typeof m !== "object") return;
    switch (m.method) {
      case "ui/notifications/tool-result":
      case "ui/notifications/tool-input":
        // params 可能是 CallToolResult（含 structuredContent）或直接就是数据。
        ingest(m.params && (m.params.structuredContent || m.params));
        break;
      case "ui/notifications/host-context-changed":
        if (m.params && m.params.theme) applyTheme(m.params.theme);
        break;
      default:
        // ui/initialize 的响应（带 id）——目前不需读宿主能力，忽略。
        break;
    }
  });

  document.getElementById("openBtn").addEventListener("click", function () {
    if (state && state.deepLink) request("ui/open-link", { url: state.deepLink });
  });

  // ChatGPT（OpenAI Apps SDK）桥：数据不走标准 postMessage，而是 window.openai.toolOutput（= structuredContent）
  // + openai:set_globals 事件下发。双桥并存 → 同一份 widget 在 Claude/参考宿主(postMessage)与 ChatGPT(window.openai)都活（P4 通用）。
  try { if (window.openai && window.openai.toolOutput) ingest(window.openai.toolOutput); } catch (e) {}
  window.addEventListener("openai:set_globals", function (ev) {
    var o = ev && ev.detail && ev.detail.globals && ev.detail.globals.toolOutput;
    if (o) ingest(o);
  }, { passive: true });

  // 视图↔宿主握手：先 ui/initialize，再 initialized 通知（规范 2026-01-26）。
  request("ui/initialize", { appInfo: { name: "nomi-live-draft", version: "1.0.0" } });
  notify("ui/notifications/initialized", {});
  render();
  window.addEventListener("resize", reportSize);
})();
</script>
</body>
</html>`
