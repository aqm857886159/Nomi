// 列表视图 / 自动引用样张的占位画面：纯图形、不带任何文字（画面里的字会在中英两轨里混语言）。
// 内联 SVG，不碰网络；候选与 chip 只收本地 / 内联 / http 地址，这里是内联。

export type ArtRatio = '16:9' | '9:16' | '1:1'

function encode(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function frame(ratio: ArtRatio): [number, number] {
  return ratio === '16:9' ? [320, 180] : ratio === '9:16' ? [180, 320] : [240, 240]
}

/** 镜头画面：冷暖渐变 + 远景地平线 + 一盏光，按种子微调，保证相邻卡不雷同。 */
export function shotArt(seed: number, ratio: ArtRatio, tone: string): string {
  const [from, to] = tone.split('|')
  const [w, h] = frame(ratio)
  const sunX = w * (0.62 + ((seed * 7) % 5) * 0.05)
  const sunY = h * (0.22 + ((seed * 3) % 4) * 0.04)
  return encode(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${sunX}" cy="${sunY}" r="${Math.min(w, h) * 0.15}" fill="rgba(255,235,192,.28)"/><path d="M0 ${h * 0.78} Q ${w * 0.28} ${h * 0.58}, ${w * 0.54} ${h * 0.78} T ${w} ${h * 0.7} V ${h} H0Z" fill="rgba(16,20,27,.42)"/></svg>`,
  )
}

/** 人物定妆：暖底 + 半身剪影（红色风衣）。 */
export const ART_LIN_WEI = encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#e9d8c4"/><stop offset="1" stop-color="#c9a98a"/></linearGradient></defs><rect width="240" height="240" fill="url(#g)"/><circle cx="120" cy="92" r="38" fill="#3a2a24"/><circle cx="120" cy="100" r="30" fill="#e8c1a4"/><path d="M58 240 Q 64 150 120 146 Q 176 150 182 240Z" fill="#9b2f2a"/><path d="M92 76 Q 120 44 150 78 L 150 120 Q 138 86 120 84 Q 102 86 92 120Z" fill="#2b1f1b"/></svg>',
)

/** 人物另一张：同一人侧脸。 */
export const ART_LIN_WEI_SIDE = encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="#2f3646"/><circle cx="196" cy="54" r="26" fill="rgba(255,120,170,.35)"/><path d="M96 70 Q 150 60 156 116 Q 158 150 132 160 L 120 200 L 84 200 L 90 150 Q 70 120 96 70Z" fill="#e3b597"/><path d="M90 66 Q 150 40 166 108 Q 140 80 112 84 L 96 140 Q 70 100 90 66Z" fill="#1d1715"/><path d="M40 240 Q 60 186 120 182 Q 180 186 200 240Z" fill="#8a2c28"/></svg>',
)

/** 场景：雨夜便利店霓虹招牌。 */
export const ART_STORE_NEON = encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="#141b2b"/><rect x="34" y="88" width="172" height="112" fill="#1f2a3e"/><rect x="48" y="104" width="64" height="80" fill="#f6e7b8" opacity=".75"/><rect x="128" y="104" width="64" height="80" fill="#f6e7b8" opacity=".55"/><rect x="30" y="58" width="180" height="22" rx="4" fill="none" stroke="#5ee0ff" stroke-width="4"/><rect x="30" y="58" width="180" height="22" rx="4" fill="#5ee0ff" opacity=".18"/><path d="M0 212 H240 V240 H0Z" fill="#0b1220"/><path d="M40 222 H200" stroke="#5ee0ff" stroke-width="2" opacity=".5"/></svg>',
)

/** 场景：同一家店白天。 */
export const ART_STORE_DAY = encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="#bcd3e4"/><rect x="34" y="88" width="172" height="112" fill="#e9e2d4"/><rect x="48" y="104" width="64" height="80" fill="#9fb8c9"/><rect x="128" y="104" width="64" height="80" fill="#9fb8c9"/><rect x="30" y="58" width="180" height="22" rx="4" fill="#3c8f6e"/><path d="M0 200 H240 V240 H0Z" fill="#8c8f93"/></svg>',
)

/** 道具：怀表（金色）。 */
export const ART_WATCH = encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="#1c1a17"/><path d="M120 30 Q 150 40 140 74" stroke="#c9a24a" stroke-width="5" fill="none"/><circle cx="120" cy="140" r="66" fill="#c9a24a"/><circle cx="120" cy="140" r="54" fill="#efe4c8"/><path d="M120 140 L120 100 M120 140 L148 152" stroke="#2b2620" stroke-width="5" stroke-linecap="round"/><circle cx="120" cy="140" r="5" fill="#2b2620"/></svg>',
)

/** 道具：另一只旧怀表（银色，别名命中「怀表」的那条候选）。 */
export const ART_WATCH_SILVER = encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="#2e3238"/><path d="M120 34 Q 92 44 102 76" stroke="#b9c0c8" stroke-width="5" fill="none"/><circle cx="120" cy="142" r="64" fill="#b9c0c8"/><circle cx="120" cy="142" r="52" fill="#f2efe6"/><path d="M120 142 L104 108 M120 142 L152 132" stroke="#3a3f46" stroke-width="5" stroke-linecap="round"/><circle cx="120" cy="142" r="5" fill="#3a3f46"/><path d="M84 104 L 156 180" stroke="#8d949c" stroke-width="2" opacity=".6"/></svg>',
)

/** 道具特写：表链。 */
export const ART_WATCH_CHAIN = encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="#2a2620"/><g fill="none" stroke="#d6b25e" stroke-width="7"><ellipse cx="60" cy="70" rx="16" ry="10"/><ellipse cx="92" cy="96" rx="16" ry="10"/><ellipse cx="124" cy="122" rx="16" ry="10"/><ellipse cx="156" cy="148" rx="16" ry="10"/><ellipse cx="188" cy="174" rx="16" ry="10"/></g></svg>',
)

/** 妆造（等定妆，没有结果图时用的灰占位）。 */
export const ART_PENDING = encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="#d9d6d0"/><circle cx="120" cy="96" r="34" fill="#c4c0b8"/><path d="M60 240 Q 66 150 120 146 Q 174 150 180 240Z" fill="#c4c0b8"/></svg>',
)
