// TikHub connector 失败分类的**中立契约单一 owner**（electron/shared/contracts/ = renderer+main 都可合法 import，
// 见 .dependency-cruiser.mjs 的 src-no-import-electron 豁免）。
//
// 为什么在这儿：这套 kind 既被主进程 connector 用（electron/connectors/tikhubConnector.ts 的 TikhubConnectorError.kind），
// 又要跨 IPC 出现在渲染层，让失败态按 kind 给对应「下一步」（素材库贴链接、设置区 key 校验都要）。
// 同 ApiKeyDecryptStatus 的做法：立成中立 owner，两侧都从它 derive，extractor 也只有这一份
// （消掉「各处各写一遍从序列化错误里嗅 kind」的重复，R14.1 单一语义 owner）。
//
//   · missing-key         ：没配 key。
//   · auth                ：401，key 无效/过期。
//   · quota               ：403 权限不足 / **402 余额不足**（2026-09-07 补：官方文档 docs.tikhub.io
//                          明列 402，此前掉进 bad-response，用户看到的是「响应结构异常」而不是「余额不足」）。
//   · not-found           ：404，链接解析不到作品。
//   · unsupported-platform：不是抖音/TikTok 链接。
//   · no-play-url         ：拿到作品但抽不出直链。
//   · upstream            ：5xx / 风控波动 / 网络。
//   · no-route            ：两个候选域（主 api.tikhub.io + 加速 api.tikhub.dev）都探测不通。
//   · rate-limited        ：429，超了 QPS 10/秒（spec info.description 的 Rate Limit）。
//                          与 quota 分开是因为**处置不同**：quota 要充值，这个只要稍后重试。
//   · bad-response        ：非 JSON / 信封异常。

export const TIKHUB_ERROR_KINDS = [
  "missing-key",
  "auth",
  "quota",
  "not-found",
  "unsupported-platform",
  "no-play-url",
  "rate-limited",
  "upstream",
  "no-route",
  "bad-response",
] as const;

export type TikhubErrorKind = (typeof TIKHUB_ERROR_KINDS)[number];

/**
 * 机读 kind 标记前缀。为什么存在：Electron IPC **只序列化 Error.message**，自定义字段 `.kind`
 * 会被剥掉，而人话 message（中文 prose）里又不含 kind 词（如 "no-route"）——于是跨 IPC 后
 * 渲染层还原不出 kind，只能退化成通用「保存失败」。把 kind 做成 `[tikhub:<kind>] ` 前缀嵌进 message，
 * 就能稳定跨 IPC 还原。TikhubConnectorError 构造时加前缀，渲染层显示前用 stripTikhubErrorMarker 去掉。
 */
const MARKER_RE = /^\[tikhub:([a-z-]+)\]\s?/;

/** 给人话 message 加机读 kind 前缀（TikhubConnectorError 构造时用；单一 owner）。 */
export function formatTikhubErrorMessage(kind: TikhubErrorKind, message: string): string {
  return `[tikhub:${kind}] ${message}`;
}

/** 去掉机读前缀，只留人话（渲染层若要直接显示 message 时用）。 */
export function stripTikhubErrorMarker(message: string): string {
  return String(message || "").replace(MARKER_RE, "");
}

/**
 * 从桥抛出的错误里取 connector kind。三级兜底，跨 IPC 必中其一：
 *   ① 同进程（未过 IPC）：直读 `.kind` 字段；
 *   ② 跨 IPC：从 message 的机读前缀 `[tikhub:<kind>]` 解析（IPC 保留 message）；
 *   ③ 再兜底：从 message 里嗅 kind 词（老路径 / 边角情况）。
 * 取不到返回 null。这是**唯一**一份 kind 提取逻辑，渲染层各处失败态都调它，别各写各的。
 */
export function tikhubErrorKindOf(error: unknown): TikhubErrorKind | null {
  if (error && typeof error === "object") {
    const kind = (error as { kind?: unknown }).kind;
    if (typeof kind === "string" && (TIKHUB_ERROR_KINDS as readonly string[]).includes(kind)) {
      return kind as TikhubErrorKind;
    }
    const message = String((error as { message?: unknown }).message || "");
    const marked = message.match(MARKER_RE);
    if (marked && (TIKHUB_ERROR_KINDS as readonly string[]).includes(marked[1])) {
      return marked[1] as TikhubErrorKind;
    }
    for (const candidate of TIKHUB_ERROR_KINDS) {
      if (message.includes(candidate)) return candidate;
    }
  }
  return null;
}
