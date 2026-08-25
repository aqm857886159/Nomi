// NomiImage —— 统一图片基元。**所有渲染图片的地方都该走它，不要裸 <img>**：
//  - loading="lazy" + decoding="async"：图多也不卡
//  - thumbnailSrc：缩略图优先（列表/画布只要小图，点开才用原图）
//  - draggable=false 默认：画布里的图不被浏览器原生拖拽劫持
//  - onError 兜底：失败时显示**可读占位**（不是浏览器裂图），并把失败 URL 打进控制台
//
// 预览用内联 SVG data URI 当图源（卡片是静态渲染，不能依赖网络请求）。
import { NomiImage } from 'nomi'

// 一张「黄昏海面」的示意图，内联成 data URI，保证卡片离线也能渲染真实图片形态。
const DUSK = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f6b17a"/><stop offset="55%" stop-color="#c96f5e"/>
      <stop offset="56%" stop-color="#2f4858"/><stop offset="100%" stop-color="#1d2f3c"/>
    </linearGradient></defs>
    <rect width="320" height="180" fill="url(#g)"/>
    <circle cx="205" cy="72" r="19" fill="#ffe0b0" opacity="0.95"/>
    <path d="M0 128 Q80 118 160 128 T320 126 L320 180 L0 180 Z" fill="#16242e" opacity="0.75"/>
  </svg>`,
)}`

/** 常态：画布里的一张生成图。 */
export const Rendered = (): JSX.Element => (
  <NomiImage
    src={DUSK}
    alt="第 1 镜 · 海边黄昏远景"
    className="rounded-nomi-sm border border-nomi-line"
    style={{ width: 260, height: 146, objectFit: 'cover' }}
  />
)

/** 失败兜底：这是它相对裸 <img> 最重要的差别——可读占位，不是裂图图标。 */
export const FailedFallback = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
    <NomiImage
      src="https://example.invalid/missing.png"
      className="rounded-nomi-sm border border-nomi-line"
      style={{ width: 180, height: 104 }}
    />
    <NomiImage
      src="https://example.invalid/expired.png"
      fallbackLabel="图已失效"
      fallbackTitle="这张参考图的链接过期了，重新导入一次就好"
      className="rounded-nomi-sm border border-nomi-line"
      style={{ width: 180, height: 104 }}
    />
  </div>
)

/** 空源：还没有图时（未生成的镜头位）也走同一个占位，不是空白。 */
export const NoSource = (): JSX.Element => (
  <NomiImage className="rounded-nomi-sm border border-nomi-line" style={{ width: 180, height: 104 }} />
)

/** 真实用法：镜头卡列表（缩略图优先 + 角标）。 */
export const InShotList = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
    {['第 1 镜 · 海边远景', '第 2 镜 · 推近侧脸'].map((label) => (
      <div
        key={label}
        style={{
          width: 168,
          borderRadius: 'var(--nomi-radius-sm)',
          border: '1px solid var(--nomi-line)',
          background: 'var(--nomi-paper)',
          overflow: 'hidden',
        }}
      >
        <NomiImage thumbnailSrc={DUSK} alt={label} style={{ width: '100%', height: 94, objectFit: 'cover', display: 'block' }} />
        <div style={{ padding: '6px 8px', font: '400 12px var(--nomi-font-sans)', color: 'var(--nomi-ink-80)' }}>
          {label}
        </div>
      </div>
    ))}
  </div>
)
