// 即梦官方 dreamina CLI 输出的纯解析逻辑（无 electron/IO 依赖 → 可裸 Node 单测，仿 doubaoTtsCodec.ts）。
// processOperation 的 spawn 分支调用这里把 CLI stdout 归一成稳定形状，喂给现有 buildProfileTaskResult。
//
// 契约来源：官方 dreamina CLI v1.4.8 的 `-h` + SKILL.md + 真机 user_credit/错误信封（2026-06-24 实测），
// 以及参考实现 Infinite-Canvas(hero8152) main.py 的实战解析逻辑——仅借「dreamina 输出长什么样」这层
// **事实性契约知识**（字段名/结构不受版权保护），全部 TS 重写，不抄其代码（该项目禁止商用）。
//
// dreamina 输出的两个坑（都来自实战契约）：
//  ① 输出常是「人类可读文本 + JSON」混合，不是干净 JSON → 要从文本里抠出最像结果的那个 JSON 对象。
//  ② 结果媒体藏在不固定的嵌套层级里（video_url / download_url / results[].* …）→ 递归宽容收集，
//     对层级不敏感 = 抗上游结构变动。

/** dreamina 任务异步态：querying（云端排队/生成中）/ success / fail。 */
export type DreaminaGenStatus = "querying" | "success" | "fail" | "";

export type DreaminaQueueInfo = {
  queue_idx?: number;
  queue_length?: number;
  queue_status?: string;
};

/** CLI 输出归一后的稳定形状。processOperation 据此组装「类 HTTP 响应」给状态机。 */
export type DreaminaNormalized = {
  /** 异步任务 id（v1.4.2+ 为 UUID，旧版 16-hex）。 */
  submitId: string;
  /** 原始 gen_status（小写）。 */
  genStatus: DreaminaGenStatus;
  /** 失败原因（gen_status=fail 时）。 */
  failReason: string;
  /** 云端排队信息（轮询超时但任务未丢时显示「排队中」）。 */
  queueInfo: DreaminaQueueInfo | null;
  /** 结果媒体的公网 http(s) URL（若 CLI 输出里带）。 */
  remoteUrls: string[];
  /** 结果媒体的本地文件路径（`--download_dir` 下载到本地的产物）。 */
  localPaths: string[];
  /** 账户积分（user_credit / 部分响应带）。 */
  totalCredit: number | null;
  /** 解析出的原始 JSON 对象（留底，便于排错）。 */
  raw: unknown;
};

const MEDIA_EXT = /\.(png|jpe?g|webp|gif|bmp|mp4|webm|mov|m4v|avi|mkv)(\?|#|$)/i;
const SCORE_KEYS = ["submit_id", "gen_status", "result_json", "images", "videos", "data", "total_credit"];
const SUBMIT_ID_KEYS = new Set(["submit_id", "submitid", "task_id", "taskid"]);
const MEDIA_CONTAINER_KEYS = [
  "url", "urls", "image", "images", "image_url", "image_urls",
  "video", "videos", "video_url", "video_urls", "output", "outputs",
  "result", "results", "file", "files", "path", "paths",
  "download_url", "download_urls", "downloadurl", "file_path", "filepath",
  "cover_image", "transcoded_video", "origin_video", "resulturi",
];

/**
 * 从一段「文本 + JSON 混合」里抠出最像结果的 JSON 值。
 * 扫每个 `{`/`[` 起点，尝试括号配平地切出一段并 JSON.parse；多个候选时按是否含
 * submit_id/gen_status/videos… 打分取最高（仿 Infinite-Canvas jimeng_extract_json，TS 重写）。
 * 全文本就是干净 JSON 时直接返回；一个都解析不出时返回 { text }。
 */
export function extractDreaminaJson(text: string): unknown {
  const source = String(text || "").trim();
  if (!source) return {};
  // 先试整体就是 JSON（最常见的干净路径）。
  try {
    return JSON.parse(source);
  } catch {
    /* 落到逐段扫描 */
  }
  const candidates: unknown[] = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch !== "{" && ch !== "[") continue;
    const end = matchBalancedEnd(source, i);
    if (end < 0) continue;
    try {
      candidates.push(JSON.parse(source.slice(i, end + 1)));
      i = end; // 跳过已消费段，避免嵌套重复解析
    } catch {
      /* 这个起点配不平/非法，继续找下一个 */
    }
  }
  if (candidates.length === 0) return { text: source };
  return candidates.reduce((best, cur) => (scoreCandidate(cur) > scoreCandidate(best) ? cur : best));
}

/** 从 `open` 处（`{` 或 `[`）找括号配平的结束下标；尊重字符串与转义。找不到返回 -1。 */
function matchBalancedEnd(text: string, open: number): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      const top = stack.pop();
      if ((ch === "}" && top !== "{") || (ch === "]" && top !== "[")) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

function scoreCandidate(value: unknown): number {
  if (!isRecord(value)) return Array.isArray(value) ? 1 : 0;
  const keys = new Set(Object.keys(value).map((k) => k.toLowerCase()));
  return SCORE_KEYS.reduce((w, k) => (keys.has(k) ? w + 10 : w), 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 递归找第一个 submit_id / task_id（不限层级）。 */
export function findSubmitId(raw: unknown): string {
  let found = "";
  const visit = (value: unknown): void => {
    if (found) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (found) return;
      if (SUBMIT_ID_KEYS.has(key.toLowerCase()) && item) {
        found = String(item);
        return;
      }
      visit(item);
    }
  };
  visit(raw);
  return found;
}

/** 递归找 gen_status / status（小写）。 */
export function findGenStatus(raw: unknown): DreaminaGenStatus {
  let found = "";
  const visit = (value: unknown): void => {
    if (found) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    const status = String(value.gen_status ?? value.status ?? "").trim().toLowerCase();
    if (status) {
      found = status;
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(raw);
  return (found as DreaminaGenStatus) || "";
}

/** 递归取失败原因：状态属失败类、或 reason 文本含 fail/invalid param 时命中。 */
export function findFailReason(raw: unknown): string {
  let found = "";
  const visit = (value: unknown): void => {
    if (found) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    const status = String(value.gen_status ?? value.status ?? "").trim().toLowerCase();
    const reason = value.fail_reason ?? value.failReason ?? value.error ?? value.message ?? value.msg;
    if (reason) {
      const text = String(reason);
      if (["fail", "failed", "error"].includes(status) || /fail|invalid param/i.test(text)) {
        found = text;
        return;
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(raw);
  return found;
}

/** 递归就近取出 queue_info（含 queue_idx/queue_length/queue_status）。 */
export function findQueueInfo(raw: unknown): DreaminaQueueInfo | null {
  let found: DreaminaQueueInfo | null = null;
  const visit = (value: unknown): void => {
    if (found) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    if (isRecord(value.queue_info)) {
      found = value.queue_info as DreaminaQueueInfo;
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(raw);
  return found;
}

/** 递归取账户积分（user_credit 等响应带 total_credit）。 */
export function findTotalCredit(raw: unknown): number | null {
  let found: number | null = null;
  const visit = (value: unknown): void => {
    if (found !== null) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    if (typeof value.total_credit === "number") {
      found = value.total_credit;
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(raw);
  return found;
}

/**
 * 递归收集结果媒体，分成「公网 http(s) URL」和「本地文件路径」两类（对嵌套层级不敏感）。
 * 命中条件：字符串是 http(s)/file:// 链接，或带媒体后缀的本地/data 路径；优先沿媒体容器键下钻，
 * 同时也遍历所有子值兜底。去重保序。
 */
export function collectDreaminaMedia(raw: unknown): { remoteUrls: string[]; localPaths: string[] } {
  const remote: string[] = [];
  const local: string[] = [];
  const pushValue = (text: string): void => {
    const t = text.trim();
    if (!t) return;
    if (/^https?:\/\//i.test(t)) {
      if (!remote.includes(t)) remote.push(t);
      return;
    }
    if (t.startsWith("file://")) {
      const p = decodeFileUrl(t);
      if (p && !local.includes(p)) local.push(p);
      return;
    }
    // 本地绝对路径（unix / windows 盘符）或带媒体后缀的相对路径 → 本地文件
    const looksLocal = t.startsWith("/") || /^[A-Za-z]:[\\/]/.test(t) || MEDIA_EXT.test(t);
    if (looksLocal && !/^[a-z]+:\/\//i.test(t)) {
      if (!local.includes(t)) local.push(t);
    }
  };
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      pushValue(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    // 优先沿已知媒体键
    for (const key of Object.keys(value)) {
      if (MEDIA_CONTAINER_KEYS.includes(key.toLowerCase())) visit(value[key]);
    }
    // 再兜底遍历其余子结构
    for (const item of Object.values(value)) {
      if (isRecord(item) || Array.isArray(item)) visit(item);
    }
  };
  visit(raw);
  return { remoteUrls: remote, localPaths: local };
}

function decodeFileUrl(value: string): string {
  try {
    const u = new URL(value);
    let p = decodeURIComponent(u.pathname);
    // windows file:///C:/... → /C:/... 去掉前导斜杠
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
    return p;
  } catch {
    return "";
  }
}

/** 把 CLI 的 stdout(+stderr) 归一成稳定形状。 */
export function normalizeDreaminaOutput(stdout: string, stderr = ""): DreaminaNormalized {
  const merged = `${String(stdout || "")}\n${String(stderr || "")}`.trim();
  const raw = extractDreaminaJson(merged);
  const media = collectDreaminaMedia(raw);
  return {
    submitId: findSubmitId(raw),
    genStatus: findGenStatus(raw),
    failReason: findFailReason(raw),
    queueInfo: findQueueInfo(raw),
    remoteUrls: media.remoteUrls,
    localPaths: media.localPaths,
    totalCredit: findTotalCredit(raw),
    raw,
  };
}

// ── 命令参数的纯校验/归一（官方 -h 的「supported combinations」，按模型 derive，不 hardcode 钉死）──

export const DREAMINA_VIDEO_RATIOS = ["1:1", "3:4", "16:9", "4:3", "9:16", "21:9"] as const;

/** 时长按模型区间夹取（seedance 4-15s；缺省 5）。非法输入回落区间内默认。 */
export function clampDreaminaDuration(duration: unknown, low = 4, high = 15): number {
  const fallback = Math.max(low, Math.min(high, 5));
  const n = typeof duration === "number" ? duration : parseInt(String(duration ?? "").trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(low, Math.min(high, Math.trunc(n)));
}

/** 校验比例；非法回落空串（让 CLI 用模型默认）。 */
export function normalizeDreaminaRatio(ratio: unknown): string {
  const v = String(ratio ?? "").trim();
  return (DREAMINA_VIDEO_RATIOS as readonly string[]).includes(v) ? v : "";
}

/** 1080p 仅 vip 档支持，其余一律 720p。 */
export function normalizeDreaminaVideoResolution(model: string, resolution: unknown): string {
  const requested = String(resolution ?? "").trim().toUpperCase();
  const isVip = /vip/i.test(String(model || ""));
  if (requested === "1080P" && isVip) return "1080p";
  return "720p";
}

/** 把多行文本按行拆成非空过渡描述列表。 */
export function splitTransitionLines(text: unknown): string[] {
  return String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

/**
 * multiframe2video 的**按图数变形**参数构建（纯函数）。官方 -h：
 *  - 2 图：`--images a,b --prompt <主提示> [--duration <秒>]`（shorthand）
 *  - 3+ 图：`--images a,b,c --transition-prompt <P1> --transition-prompt <P2> …`（N 图要 N-1 句；此时不发 --prompt）
 * 过渡行不足 N-1 时用「最后一句 / 主提示」补齐；多出则截断。3+ 时长走后端默认每段 3s（不发 --duration）。
 */
export function buildMultiframeArgs(input: {
  imagePaths: string[];
  prompt: string;
  transitionLines: string[];
  duration?: unknown;
}): string[] {
  const images = input.imagePaths.filter(Boolean);
  const args = ["multiframe2video", `--images=${images.join(",")}`];
  if (images.length <= 2) {
    const prompt = String(input.prompt || "").trim();
    if (prompt) args.push(`--prompt=${prompt}`);
    const dur = clampDreaminaDuration(input.duration, 1, 8); // 段时长 [0.5,8]，整数化夹取
    args.push(`--duration=${dur}`);
  } else {
    const need = images.length - 1;
    const lines = input.transitionLines.map((l) => l.trim()).filter(Boolean);
    const filler = lines[lines.length - 1] || String(input.prompt || "").trim();
    const finalLines = Array.from({ length: need }, (_, i) => lines[i] || filler);
    for (const line of finalLines) {
      if (line) args.push(`--transition-prompt=${line}`);
    }
  }
  args.push("--poll=30");
  return args;
}

// ── 登录 / 账户状态解析（设备码 OAuth + user_credit；供登录 IPC 用，纯函数可测）──

export type DreaminaDeviceFlow = {
  verificationUri: string;
  userCode: string;
  deviceCode: string;
  expiresAt: string;
};

/** 解析 `dreamina login --headless` 输出的设备码材料。缺关键字段返回 null。 */
export function parseDeviceFlow(stdout: string): DreaminaDeviceFlow | null {
  const text = String(stdout || "");
  const pick = (label: string): string => {
    const m = text.match(new RegExp(`${label}\\s*[:：]\\s*(\\S+)`, "i"));
    return m ? m[1].trim() : "";
  };
  const verificationUri = pick("verification_uri");
  const userCode = pick("user_code");
  const deviceCode = pick("device_code");
  if (!verificationUri || !userCode || !deviceCode) return null;
  return { verificationUri, userCode, deviceCode, expiresAt: pick("expires_at") };
}

export type DreaminaAccountStatus = {
  /** 是否已登录（user_credit 拿到 user_id / 积分即视为已登录）。 */
  loggedIn: boolean;
  totalCredit: number | null;
  vipLevel: string;
  userId: string;
};

/**
 * 解析 `dreamina user_credit` 的账户状态。
 * 真实输出：`{ total_credit, user_id, user_name, vip_level }`（已登录）；
 * 未登录则纯文本「未检测到有效登录态…」→ loggedIn=false。
 */
export function parseAccountStatus(stdout: string, stderr = ""): DreaminaAccountStatus {
  const raw = extractDreaminaJson(`${String(stdout || "")}\n${String(stderr || "")}`.trim());
  const rec = isRecord(raw) ? raw : {};
  const userId = rec.user_id != null ? String(rec.user_id) : "";
  const totalCredit = typeof rec.total_credit === "number" ? rec.total_credit : findTotalCredit(raw);
  const vipLevel = typeof rec.vip_level === "string" ? rec.vip_level : "";
  return {
    loggedIn: Boolean(userId) || totalCredit !== null,
    totalCredit,
    vipLevel,
    userId,
  };
}

/** dreamina CLI 在已有登录态时可能直接复用本地 OAuth，不再返回设备码。 */
export function isReusingLogin(text: string): boolean {
  return /已复用.*登录态|already logged in|already authenticated|reusing.*login/i.test(String(text || ""));
}

/** dreamina 输出/报错里是否含网络超时类错误（Go context deadline / ETIMEDOUT / fetch failed）。 */
export function isNetworkTimeout(text: string): boolean {
  return /context deadline exceeded|etimedout|eai_again|econnreset|und_err_headers_timeout|und_err_connect_timeout|headers timeout|connect timeout|timeout exceeded|fetch failed|request timeout|network timeout|i\/o timeout|执行超时/i.test(String(text || ""));
}

/** dreamina 输出/报错里是否含「非高级会员」闸（生成被拒的诚实信号）。 */
export function isNotMaestroVip(text: string): boolean {
  return /not maestro vip|maestro vip|没有 dreamina_cli 使用权限|会员|membership|subscrib/i.test(String(text || ""));
}

/**
 * 是否命中「首次使用需在 Dreamina Web 端完成内容安全授权」闸。
 * 现役 CLI（build 2026-06-18）每个生成子命令的 -h 都警告：部分高内容安全风险模型首次使用前，
 * 需先在 Dreamina Web 端授权；若返回 AigcComplianceConfirmationRequired，请先完成授权后重试。
 */
export function isComplianceConfirmationRequired(text: string): boolean {
  return /AigcComplianceConfirmationRequired|ComplianceConfirmationRequired|内容安全.*授权|授权确认/i.test(String(text || ""));
}

/** 是否命中「登录态失效/未登录」签名。实测（2026-07-06）：token 刷新失败时 CLI **exit=0** 只打
 *  `authsdk: refresh failed: protocol transport: do request` 一行——必须按文本识别，不能靠退出码。 */
export function isLoginExpired(text: string): boolean {
  return /authsdk|refresh failed|not logged in|please login|login required|未登录|登录已过期|token (expired|invalid)/i.test(String(text || ""));
}

/**
 * 把 dreamina CLI 的「调用失败」翻译成一句给用户看的人话（治「用不了」黑洞）。
 *
 * 真机实测（2026-06-30，CLI build 2026-06-18）：账号已登录、有积分(66)、但非会员时，generation 子命令
 * **静默失败**——exit=1、stdout/stderr/日志全空、连任务记录都不建。旧 CLI 会打印 "not maestro vip"，
 * 现役 CLI 什么都不打印。所以单看输出无从归因，必须按「最可能原因」给出可执行指引，而不是甩 "exit=1"。
 *
 * 试用期已于 2026-05-01 结束 → 生成现在需开通即梦会员（光登录/光充积分不够）。
 */
export function describeDreaminaFailure(code: number, stdout: string, stderr: string): string {
  const text = `${String(stdout || "")}\n${String(stderr || "")}`.trim();
  if (isComplianceConfirmationRequired(text)) {
    return "即梦该模型首次使用需先在网页端完成一次性内容安全授权。请打开 jimeng.jianying.com 用同一账号生成一次（完成授权确认）后，再回 Nomi 重试。";
  }
  if (isNetworkTimeout(text)) {
    return "即梦服务端响应超时，任务可能仍在即梦侧继续处理。请稍后刷新任务结果，或去即梦网页端的生成记录确认；如果没有结果，再重试该任务。";
  }
  if (isNotMaestroVip(text)) {
    return "当前即梦账号不是高级会员，无法生成。即梦免费试用已于 2026-05-01 结束——请在即梦开通会员后重试（光登录、光充积分不够）。";
  }
  if (isLoginExpired(text)) {
    return "即梦登录态失效或未登录：请到「模型接入 · 即梦会员」卡重新登录（或终端运行 dreamina login），完成后重试。";
  }
  if (!text) {
    // 静默失败：CLI 给不出原因。保留会员/授权两条高频指引，同时补上参数组合与服务端异常的排查方向。
    return `即梦生成被拒，但 CLI 未返回任何原因（exit=${code}）。常见原因：① 当前即梦账号不是高级会员（免费试用 2026-05-01 已结束，需开通即梦会员）；② model_version / resolution 等参数组合不被当前模型支持；③ 该模型首次使用需先在 jimeng.jianying.com 网页端授权一次；④ 即梦服务端临时异常。请按以上顺序排查后重试。`;
  }
  return `即梦 CLI 调用失败：${text.slice(0, 600)}`;
}
