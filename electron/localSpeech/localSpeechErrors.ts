/**
 * 本地转写的**错误分类**——硬约束「任何失败明说原因 + 给『改用云端』出口」的落点。
 *
 * 为什么要一个专门的错误族：本地转写的失败面比云端多一整类（下载、校验、解包、起进程、
 * 某一段跑挂），而这几类的**用户动作完全不同**——磁盘满要去腾空间、校验不过要报给我们、
 * 网络断了可以重试、平台不支持只能改用云端。全归成一句「转写失败」等于把用户丢在原地。
 *
 * 两条纪律：
 *  · `reason` 是**机器可读的枚举**，UI 按它决定给哪个按钮；文案走 `desktopT`，不在这里拼中文
 *    （`check:i18n` 对 electron/ 的新增中文字面量是硬红）。
 *  · `retryable` 与「能不能改用云端」是两件事：任何一条都能改用云端（那是另一个 provider），
 *    但只有网络类适合原地重试。**不许**任何一条在代码里自动切云端——那是静默兜底（P1）。
 */
import { desktopT } from "../i18n";

export type LocalSpeechFailureReason =
  | "unsupported-platform"
  | "download-failed"
  | "checksum-mismatch"
  | "disk-full"
  | "extract-failed"
  | "engine-start-failed"
  | "chunk-failed"
  | "empty-result"
  | "audio-unreadable"
  | "cancelled";

export class LocalSpeechError extends Error {
  readonly reason: LocalSpeechFailureReason;
  readonly retryable: boolean;

  constructor(reason: LocalSpeechFailureReason, message: string, retryable: boolean) {
    super(message);
    this.name = "LocalSpeechError";
    this.reason = reason;
    this.retryable = retryable;
  }
}

const RETRYABLE: ReadonlySet<LocalSpeechFailureReason> = new Set<LocalSpeechFailureReason>([
  "download-failed",
  "engine-start-failed",
  "chunk-failed",
]);

/** 建一个带人话文案的失败。`detail` 是给用户看的那半句（上游 stderr / 缺的文件名 / 段号）。 */
export function localSpeechFailure(reason: LocalSpeechFailureReason, detail: string): LocalSpeechError {
  // 键名与 reason 一一对应，TS 由模板字面量类型直接证明它们都存在于 electron/i18n.ts —— 少一条就编译不过。
  const message = desktopT(`localSpeech.${reason}`, { detail });
  return new LocalSpeechError(reason, message, RETRYABLE.has(reason));
}
