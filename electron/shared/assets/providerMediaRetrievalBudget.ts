/**
 * 供应商产物（生成出的图 / 视频 / 音频）从远端取回的**时间与大小预算——全仓只有这一份数字**。
 *
 * 几边读同一份：
 * - 主进程 `electron/assets/providerMediaFetch.ts` 照它给每次取回设「空闲时限 + 随大小放宽的总上限」；
 * - 主进程 `electron/vendor/vendorHttp.ts` 的文件响应（鉴权视频字节，流式写盘）拿到响应头后照同一份设同样两个时限，
 *   只是字节上限是 2GiB 那一档（见 PROVIDER_MEDIA_FILE_BYTE_CAP）；
 * - 渲染层 `src/workbench/generationCanvas/runner/generationPhaseDeadline.ts` 照它算节点「正在存到你电脑上」
 *   最长能停多久。渲染层的时限必须**不短于**主进程一次合法下载的最长时间：短了就会在主进程还在正常下载时
 *   把节点判成「可找回」，用户一点「重新拉取」又从头下一遍。所以这里是中立契约层，不是某一边的私有常量。
 *
 * 为什么不再是一个 60 秒墙钟（2026-09-28「生成完了却一直停在『正在存到你电脑上』」调查的第二候选）：
 * 墙钟对所有文件一视同仁——一张 2MB 的图和一段 150MB 的视频拿同样的 60 秒，慢线路上的大视频注定超时、
 * 每次重试都一样。真正要拦的是两件不同的事，拆开各管一件：
 *  ① 线路死了（一个字节都不再来）→ 空闲时限，很快放弃；
 *  ② 线路活着但太慢 → 总上限，按响应头声明的大小放宽：小文件和以前一样 60 秒，大文件按「最慢可接受的速度」多给时间。
 */

/** 单个产物的字节上限（沿用素材导入原来那一个数；取回与「已在内存里的 data: 产物」都问它）。 */
export const PROVIDER_MEDIA_BYTE_CAP = 200 * 1024 * 1024

/**
 * 空闲时限：连续这么久一个字节都没来（含等响应头），就认定这条线路断了。
 *
 * 依据：TCP 丢包重传的退避序列（初始 RTO 1s、逐次翻倍：1+2+4+8+16 ≈ 31s）——五次重传都等不到一个字节，
 * 已经不是「慢」而是「断」。常见 CDN / 反代的空闲断连（nginx `send_timeout` / `proxy_read_timeout` 缺省 60s）
 * 比它长：我们先于服务端放弃，不陪一条死连接干等到对面想起来断开。
 */
export const PROVIDER_MEDIA_IDLE_TIMEOUT_MS = 30_000

/** 总上限的底：小文件沿用旧的 60 秒墙钟——对图片与短视频，这次改动不改变任何行为。 */
export const PROVIDER_MEDIA_BASE_TIMEOUT_MS = 60_000

/**
 * 「最慢可接受的平均速度」：256 KiB/s ≈ 2 Mbit/s。低于它，一段 30MB 的成片要两分多钟，用户已经在盯着转圈；
 * 更慢的线路我们不陪到底，但只要它还在按这个速度稳定出字节，就不在半路掐断它。
 */
export const PROVIDER_MEDIA_FLOOR_BYTES_PER_SECOND = 256 * 1024

/**
 * 鉴权视频文件响应（流式写盘、不进内存）的字节上限：2GiB。上面 200MiB 那一档约束的是整段读进内存的 URL 缓冲路——
 * 两种角色的字节上限不同，空闲时限、最慢可接受速度、总上限的底是同一份，所以公式只有一个（retrievalTotalMs）。
 */
export const PROVIDER_MEDIA_FILE_BYTE_CAP = 2 * 1024 * 1024 * 1024

function retrievalTotalMs(declaredBytes: number | null, byteCap: number): number {
  const bytes = declaredBytes !== null && Number.isFinite(declaredBytes) && declaredBytes >= 0
    ? Math.min(declaredBytes, byteCap)
    : byteCap
  return PROVIDER_MEDIA_BASE_TIMEOUT_MS + Math.ceil((bytes / PROVIDER_MEDIA_FLOOR_BYTES_PER_SECOND) * 1000)
}

/**
 * 一次取回的总上限（毫秒，从发请求算起）= 60s + 大小 ÷ 最慢可接受速度。
 * `declaredBytes` 是响应头声明的 Content-Length；没声明（分块传输）时按字节上限算——
 * 不知道多大时宁可多给，也不掐断一次可能合法的大文件（空闲时限照样兜住「断了」）。
 * 给 `timeoutForDeclaredSize` 这类回调直接用，也能 `.map` 它，所以只收一个参数；2GiB 那一档是下面的兄弟函数。
 */
export function providerMediaRetrievalTotalMs(declaredBytes: number | null): number {
  return retrievalTotalMs(declaredBytes, PROVIDER_MEDIA_BYTE_CAP)
}

/**
 * 文件响应那一档的总上限：同一个公式，字节上限换成 2GiB。拿到响应头之后才算（响应头自己的等待另有 vendor 超时管着）：
 * 不知道多大按 2GiB 算 = 60s + 2GiB ÷ 256KiB/s = 8252s；声明了多大就按多大。
 */
export function providerMediaFileRetrievalTotalMs(declaredBytes: number | null): number {
  return retrievalTotalMs(declaredBytes, PROVIDER_MEDIA_FILE_BYTE_CAP)
}

/** 任何一次取回最长能走多久（字节上限那一档）：60s + 200MiB ÷ 256KiB/s = 860s。 */
export const PROVIDER_MEDIA_RETRIEVAL_MAX_MS = providerMediaRetrievalTotalMs(null)
