/**
 * Electron IPC 失败的唯一结构化契约入口（方向检查 docs/audit/2026-10-24-ipc-error-class-name-direction.md）。
 *
 * 主进程 `ipcMain.handle` 里抛的错，Electron 只把 `error.toString()` 送回渲染层，渲染层拿到的是
 *   new Error(`Error invoking remote method '<通道>': <主进程那个错误的 toString()>`)
 * name 恒为 `Error`，类、`code`、`cause`、自定义字段全丢（Electron 文档 ipc-main.md `handle` 一节 #24427；
 * 经 contextBridge 跨世界的 Error 也只拷 message，context-bridge.md #25596）。主进程错误的类名**只**在这句话里。
 * 结构化通道返回 `IpcResult` / `StructuredIpcFailure`；其余 `invoke` 报错也全部统一从这里解码：
 * 优先读结构化 `IpcInvokeFailure` / `IpcResult` / `NomiErrorCode`，再回退到唯一一次 Electron 外壳拆解，
 * 不在渲染层各模块再写私有拆串副本。
 *
 * 零 electron/node 依赖：渲染层、主进程日志（含 pi 那一侧的编译岛）都引它。
 */

import { matchNomiErrorCode, type NomiErrorCode } from "../nomiErrorCodes";

const CLASS_NAME = "[A-Z][A-Za-z0-9_]{0,63}";

/**
 * 代码里定义的错误类名的形状：大写字母开头的标识符（JS 类名的写法，库的命名空间前缀如 `AI_APICallError` 也在内），≤64 字。
 * 判据是结构上的，不是名单：带空格 / 标点 / 汉字 / 路径分隔符的、小写开头的（`sk_live_…`、`ghp_…` 这类凭据形状）都不是类名。
 * 全仓代码里写下的错误类名都过这一条，由 ipcInvokeFailure.test.ts 普查钉住。
 */
export const CODE_CLASS_NAME = new RegExp(`^${CLASS_NAME}$`);

export function isCodeClassName(value: unknown): value is string {
  return typeof value === "string" && CODE_CLASS_NAME.test(value);
}

const ENVELOPE = /^Error invoking remote method '([^']*)':\s*/;
/** 主进程错误 `toString()` 的头：`类名: `；Node 内部错误是 `类名 [ERR_码]: `；消息为空时只有类名。 */
const HEAD = new RegExp(`^(${CLASS_NAME})(?: \\[([A-Z][A-Z0-9_]{0,63})\\])?(?::[ \\t]*|$)`);

export type IpcInvokeFailure = Readonly<{
  /** 失败的那条通道（`nomi:projects:save-async`）。 */
  channel: string;
  /** 主进程那个错误的类名；那边抛的不是 Error（一句字符串、一个普通对象）时没有。 */
  name?: string;
  /** Node 内部错误 `toString()` 里自带的码（`RangeError [ERR_OUT_OF_RANGE]: …`）或结构化通道错误码。 */
  code?: string;
  /** 嵌在报错里的 Nomi 自有机器可读错误码（`NOMI_ERR::<code>::`）。 */
  errorCode?: NomiErrorCode;
  /** 主进程那个错误自己的 message（外壳与类名都已去掉）。 */
  message: string;
}>;

export type StructuredIpcFailure = IpcInvokeFailure & Readonly<{
  kind: "nomi-ipc-failure";
}>;

export function createStructuredIpcFailure(failure: Omit<StructuredIpcFailure, "kind">): StructuredIpcFailure {
  const errorCode = failure.errorCode ?? (matchNomiErrorCode(failure.message) ?? undefined);
  return {
    kind: "nomi-ipc-failure",
    channel: failure.channel,
    ...(failure.name ? { name: failure.name } : {}),
    ...(failure.code ? { code: failure.code } : {}),
    ...(errorCode ? { errorCode } : {}),
    message: failure.message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** invoke 拒绝的那句话 → 通道、类名、码、消息；不是这句话（渲染层自己的错误、不是字符串）返回 null。不抛。 */
export function ipcInvokeFailure(text: unknown): IpcInvokeFailure | null {
  if (typeof text !== "string") return null;
  const envelope = ENVELOPE.exec(text);
  if (!envelope) return null;
  const channel = envelope[1] ?? "";
  const rest = text.slice(envelope[0].length);
  const head = HEAD.exec(rest);
  if (!head) {
    const errorCode = matchNomiErrorCode(rest);
    return { channel, ...(errorCode ? { errorCode } : {}), message: rest };
  }
  const message = rest.slice(head[0].length);
  const errorCode = matchNomiErrorCode(message);
  return {
    channel,
    name: head[1],
    ...(head[2] ? { code: head[2] } : {}),
    ...(errorCode ? { errorCode } : {}),
    message,
  };
}

function fromReasonCarrier(errorOrMessage: string, reasonValue: unknown, channel: string): IpcInvokeFailure {
  const reason = isRecord(reasonValue) ? reasonValue : null;
  const code =
    (typeof reason?.code === "string" && reason.code) ||
    (typeof reason?.kind === "string" && reason.kind) ||
    errorOrMessage;
  const rawMessage = typeof reason?.message === "string" ? reason.message : errorOrMessage;
  const message = withoutIpcInvokeWrapper(rawMessage);
  const errorCode = matchNomiErrorCode(message);
  const name = typeof reason?.name === "string" && reason.name ? reason.name : "IpcResultError";
  return {
    channel,
    name,
    code,
    ...(errorCode ? { errorCode } : {}),
    message,
  };
}

/**
 * 统一跨 IPC 失败解码入口（结构化优先，文本外壳兜底）：
 * 1) 显式 `StructuredIpcFailure`（`kind: "nomi-ipc-failure"`）
 * 2) `IpcResult` / `IpcResultError` 失败载体（`ok: false, error, reason` 或带 `reason` 的 Error）
 * 3) 带结构化 `.code` / 非泛化 `.name` 的 Error / 错误对象
 * 4) Electron `ipcInvokeFailure` 字符串外壳 或 内嵌 `NomiErrorCode`
 */
export function readStructuredIpcFailure(input: unknown): IpcInvokeFailure | null {
  if (typeof input === "string") {
    const wrapped = ipcInvokeFailure(input);
    if (wrapped) return wrapped;
    const errorCode = matchNomiErrorCode(input);
    return errorCode ? { channel: "", errorCode, message: input } : null;
  }
  if (!isRecord(input)) return null;

  if (input.kind === "nomi-ipc-failure" && typeof input.channel === "string" && typeof input.message === "string") {
    const errorCode = typeof input.errorCode === "string" ? (input.errorCode as NomiErrorCode) : matchNomiErrorCode(input.message);
    return {
      channel: input.channel,
      ...(typeof input.name === "string" && input.name ? { name: input.name } : {}),
      ...(typeof input.code === "string" && input.code ? { code: input.code } : {}),
      ...(errorCode ? { errorCode } : {}),
      message: input.message,
    };
  }

  const channel = typeof input.channel === "string" ? input.channel : "";
  if (input.ok === false && typeof input.error === "string") {
    return fromReasonCarrier(input.error, input.reason, channel);
  }

  const rawMessage = typeof input.message === "string" ? input.message : "";
  if ("reason" in input && rawMessage && input.reason !== undefined) {
    return fromReasonCarrier(rawMessage, input.reason, channel);
  }

  const wrapped = rawMessage ? ipcInvokeFailure(rawMessage) : null;
  const structuredError = typeof input.error === "string" && input.error ? input.error : undefined;
  const structuredCode = typeof input.code === "string" && input.code ? input.code : structuredError;
  const structuredName = typeof input.name === "string" && input.name && input.name !== "Error" ? input.name : undefined;
  if (wrapped) {
    return {
      channel: channel || wrapped.channel,
      ...(structuredName ?? wrapped.name ? { name: structuredName ?? wrapped.name } : {}),
      ...(structuredCode ?? wrapped.code ? { code: structuredCode ?? wrapped.code } : {}),
      ...(wrapped.errorCode ? { errorCode: wrapped.errorCode } : {}),
      message: wrapped.message,
    };
  }
  if (!rawMessage && !structuredCode && !structuredName) return null;
  const errorCode = rawMessage ? matchNomiErrorCode(rawMessage) : null;
  if (!structuredCode && !structuredName && !errorCode) return null;
  return {
    channel,
    ...(structuredName ? { name: structuredName } : {}),
    ...(structuredCode ? { code: structuredCode } : {}),
    ...(errorCode ? { errorCode } : {}),
    message: rawMessage || structuredCode || structuredName || "",
  };
}

/** 从字符串或结构化 IPC 失败对象取出人可读的内部报错正文（去掉外壳与泛化 `Error:`）。 */
export function readIpcFailureMessage(input: unknown): string {
  if (typeof input === "string") return withoutIpcInvokeWrapper(input);
  const structured = readStructuredIpcFailure(input);
  if (structured) return structured.message;
  if (isRecord(input) && typeof input.message === "string") return withoutIpcInvokeWrapper(input.message);
  return String(input ?? "");
}

/**
 * 给人看的那一行：去掉 IPC 外壳和泛泛的 `Error:`（对用户零信息）；具体的类名留着（`ProjectTrashFailedError[…]`
 * 一类本身就是排查线索）。不是 invoke 的那句话就原样返回。
 */
export function withoutIpcInvokeWrapper(text: string): string {
  const envelope = ENVELOPE.exec(text);
  if (!envelope) return text;
  return text.slice(envelope[0].length).replace(/^Error:\s*/, "");
}
