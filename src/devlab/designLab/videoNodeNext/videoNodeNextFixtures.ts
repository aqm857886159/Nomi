// 设计实验室 · 屏「视频节点的下一步」的素材。
//
// 一条 24 秒、五个镜头的真视频（`fixtures/street.webm`，VP9，92KB，由五张手绘场景图 + 缓慢推近合成）：
// 播放头、截帧、剪辑预览都得是**真会动的 <video>**，不然「播放头停在哪」没东西可看。
// 镜头切点在 4.83 / 9.67 / 14.50 / 19.33 秒；各个 jpg 是从这条视频里用 ffmpeg 真抽出来的帧。
const streetVideo = new URL('./fixtures/street.webm', import.meta.url).href
const frameFirst = new URL('./fixtures/frame-first.jpg', import.meta.url).href
const frameCurrent = new URL('./fixtures/frame-current.jpg', import.meta.url).href
const frameLast = new URL('./fixtures/frame-last.jpg', import.meta.url).href
const frameIn = new URL('./fixtures/frame-in.jpg', import.meta.url).href
const filmstrip = new URL('./fixtures/filmstrip.jpg', import.meta.url).href
const filmstripTrim = new URL('./fixtures/filmstrip-trim.jpg', import.meta.url).href
const sheet = new URL('./fixtures/sheet.jpg', import.meta.url).href
const seg1 = new URL('./fixtures/seg1.jpg', import.meta.url).href
const seg2 = new URL('./fixtures/seg2.jpg', import.meta.url).href
const seg3 = new URL('./fixtures/seg3.jpg', import.meta.url).href
const seg4 = new URL('./fixtures/seg4.jpg', import.meta.url).href
const seg5 = new URL('./fixtures/seg5.jpg', import.meta.url).href

export const VIDEO = streetVideo
export const FRAME = { first: frameFirst, current: frameCurrent, last: frameLast, trimIn: frameIn } as const
export const FILMSTRIP = filmstrip
export const FILMSTRIP_TRIM = filmstripTrim
export const SHEET = sheet
export const SEGMENT_POSTERS = [seg1, seg2, seg3, seg4, seg5] as const

export const DURATION_SECONDS = 24.167
export const FPS = 24
export const TOTAL_FRAMES = Math.round(DURATION_SECONDS * FPS)
/** 播放头停在这儿（落在第二个镜头里，和首帧一眼分得开）。 */
export const PLAYHEAD_SECONDS = 7.2
/** 剪辑演示：保留 6.0 → 18.0 秒。 */
export const TRIM_IN_SECONDS = 6.0
export const TRIM_OUT_SECONDS = 18.0
export const CUT_SECONDS = [4.83, 9.67, 14.5, 19.33] as const
