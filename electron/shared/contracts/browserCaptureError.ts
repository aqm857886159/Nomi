import { readIpcFailureMessage } from "./ipcInvokeFailure";

/** 浏览器媒体采集的结构化错误码——主进程抛出、渲染层展示共读这一份协议。 */
export type BrowserCaptureErrorCode =
  | "forbidden" // 401/403/防盗链——网站拒绝，可能要登录
  | "not-found" // 404/410——链接失效
  | "html-not-media" // 返回 HTML 冒充媒体（防盗链页/人机验证页）
  | "too-large" // 超 200MB 限额
  | "timeout" // 下载超时
  | "blocked-by-client" // 客户端安全策略拦截
  | "mse-stream" // MediaSource 流媒体——没有可下载原件
  | "black-frame" // 当前帧是黑屏/无画面——不落假成功卡，提示先播放到有效画面
  | "network" // 连接层失败（DNS/断网/重置/中断）
  | "unknown";

const CAPTURE_ERROR_STRIP_PATTERN = /^\[nomi-capture:([a-z-]+)\]\s*/i;
const CAPTURE_ERROR_FIND_PATTERN = /\[nomi-capture:([a-z-]+)\]/i;

/** 结构化捕捞错误：`[nomi-capture:<code>] 人话`。code 经 IPC 存活在 message 里，渲染层经同一份合同读取。 */
export function captureError(code: BrowserCaptureErrorCode, message: string, cause?: unknown): Error {
  const clean = String(message || "").replace(CAPTURE_ERROR_STRIP_PATTERN, "");
  const error = new Error(`[nomi-capture:${code}] ${clean}`);
  if (cause !== undefined) Object.assign(error, { cause });
  return error;
}

/** 唯一读取 `[nomi-capture:<code>]` 的入口：先走统一 IPC 外壳剥离，再提取结构化采集码。 */
export function captureErrorCode(reason: unknown): BrowserCaptureErrorCode | null {
  const unwrapped = readIpcFailureMessage(reason);
  const match = CAPTURE_ERROR_FIND_PATTERN.exec(unwrapped);
  return match ? (match[1]!.toLowerCase() as BrowserCaptureErrorCode) : null;
}
