/**
 * 渲染层 → 主进程日志的报文（渲染层只依赖这里，不伸手进主进程实现）。
 *
 * 为什么是结构体而不是一句话：主进程日志的隐私约定是「API 形状先拦、脱敏兜底」
 * （见 `electron/logging/logger.ts` 头注释）。收自由文本就等于在渲染层开一个口子，
 * 让提示词、素材路径被拼进一句话里带过来——所以这里只有**短事件名 + 摊平的错误 + 标量字段**。
 *
 * 渲染层只负责摊平，**脱敏只在主进程做一次**（`electron/logging/rendererLog.ts` 复用 `redact.ts`）：
 * 两边各脱一遍，就会有一边先漂移。
 */

/** `crash` 进崩溃文件 + 通用日志；`warn` / `error` 只进通用日志。 */
export type RendererLogLevel = "warn" | "error" | "crash";

/** 错误摊平后的样子。IPC 的结构化克隆会丢掉 Error 的原型与自定义字段，所以先摊平再发。 */
export type RendererLogError = {
  name: string;
  message: string;
  /** Node 风格错误码（`EACCES` / `workspace_manifest_busy`…），有才带。 */
  code?: string;
  stack?: string;
};

export type RendererLogFieldValue = string | number | boolean | null;

export type RendererLogEntry = {
  level: RendererLogLevel;
  /** 短标识（`project-save-failed`），不是句子——主进程按形状校验，不合格整条拒收。 */
  event: string;
  error?: RendererLogError;
  fields?: Record<string, RendererLogFieldValue>;
};

/** 事件名形状：小写 kebab，≤64。和主进程日志 `event` 的写法一致，grep 时不必记两套拼法。 */
export const RENDERER_LOG_EVENT_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
/** 字段名形状：驼峰或下划线，≤40。 */
export const RENDERER_LOG_FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
export const RENDERER_LOG_MAX_FIELDS = 12;
/** 报文里单个字符串的上限（主进程落盘时还会再按 200 字截一次）；只为给 IPC 报文封顶。 */
export const RENDERER_LOG_MAX_TEXT_CHARS = 4000;
