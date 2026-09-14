// 本机到底能播哪些视频 codec —— **问出来的事实**，不是猜出来的常量。
//
// 为什么（2026-09-14）：videoImportNormalize 原本拿一张 hardcode 白名单判「要不要转码」，
// HEVC 被刻意排除，理由是「按最差平台归一：macOS 部分硬解、Windows 默认不行」。
// 代价是本机明明 55–110ms 就能 loadedmetadata 的 10-bit HEVC，我们还要把 527s / 1.38GB
// 整段转成 H.264（0.75× 实时 ≈ 十几分钟、无进度、不可取消）。
//
// 「这台机器能不能解这个 codec」是渲染层一句 MediaSource.isTypeSupported 就能问到的事实。
// 渲染层启动时探一次送进来，主进程据此决定转不转。没送进来（探测前的窗口期、非 Electron 宿主）
// 就回落到保守白名单——保守回落只会多转一次，不会让人播不了。

/** Chromium 跨平台稳解的保守集：探测结果到达前的回落值。 */
const FALLBACK_VIDEO_CODECS: readonly string[] = ["h264", "vp8", "vp9", "av1"];

let probed: ReadonlySet<string> | null = null;

/**
 * 渲染层探测结果入库。`codecs` 是本机 `MediaSource.isTypeSupported` / `canPlayType`
 * 判为可播的 codec 短名（h264 / hevc / vp9 / av1 …），小写。
 */
export function setProbedVideoCodecs(codecs: readonly string[]): void {
  const normalized = codecs.map((c) => String(c || "").trim().toLowerCase()).filter(Boolean);
  // 探测结果必须至少包含 h264，否则多半是探测本身坏了（Chromium 没有不支持 h264 的构建），
  // 这种结果不能拿来放宽任何东西。
  probed = normalized.includes("h264") ? new Set(normalized) : null;
}

/** 本机可播的视频 codec 集合。没探到 → 保守回落集。 */
export function playableVideoCodecs(): ReadonlySet<string> {
  return probed ?? new Set(FALLBACK_VIDEO_CODECS);
}

/** 测试/重启用。 */
export function clearProbedVideoCodecs(): void {
  probed = null;
}

/** 这台机器有没有真探过（走查与 PR 正文要能证明「不是回落值」）。 */
export function hasProbedVideoCodecs(): boolean {
  return probed !== null;
}
