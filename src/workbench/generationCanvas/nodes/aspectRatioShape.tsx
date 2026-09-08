// 比例分段选择器的**图形语言**：小宽高比矩形 + 组级双行 label。
//
// 这两个函数原本是 `InlineParameterBar.tsx` 的模块私有函数（2026-07-17 用户拍板的参数面板形态）。
// 2026-09-07 提到这里，是因为设计实验室的分段陈列格（`pf-06`）必须渲染**这一份**、
// 而不是照着截图另画一个「大空框配文字」——那正是把一个从不存在的形态钉成基线的路子。
// 提取是**移动**不是复制：`InlineParameterBar` 从这里 import，全仓只此一份定义。
//
// 两个都是纯函数、无副作用、不读 store，所以搬家不改任何视觉行为。
import React from 'react'
import { IconAspectRatio } from '@tabler/icons-react'

/** 比例文本（"16:9"）→ 宽高比小图形（描边矩形，最长边 18px）。
 *  value 和 label 都试（图片模型 size 值常是像素 "1024x1024"，label 才是 "16:9"——只看 value 会漏画）。 */
export function ratioShape(isAuto: boolean, ...candidates: string[]): JSX.Element | null {
  if (isAuto) return <IconAspectRatio aria-hidden size={18} stroke={1.6} />
  for (const candidate of candidates) {
    const m = /^(\d{1,3}):(\d{1,3})$/.exec(String(candidate || '').trim())
    if (!m) continue
    const w = Number(m[1])
    const h = Number(m[2])
    if (!w || !h) continue
    const scale = 18 / Math.max(w, h)
    return (
      <span
        aria-hidden
        className="block"
        // 描边用 inline style 而非 Tailwind 任意值类（border-[1.4px]）：dev 的 tailwind 生成缓存
        // 可能缺新任意值类 → 描边宽 0 图形隐身（2026-07-17 用户 dev 实况）。inline 不依赖生成。
        style={{
          width: Math.max(6, Math.round(w * scale)),
          height: Math.max(6, Math.round(h * scale)),
          border: '1.4px solid currentColor',
        }}
      />
    )
  }
  return null
}

/** 组级双行 label：图形槽（固定 18px 高，无图形项留空占位）+ 文字——跨项等高，文字基线对齐。
 *  只要组内任一项画得出图形，整组统一双行（此前有/无图形混排 → 项目高低参差，2026-07-17 用户截图）。
 *  槽高 inline style（不用 h-[18px] 任意值类——dev tailwind 缓存缺类会静默塌）。 */
export function shapedGroupLabel(text: string, shape: JSX.Element | null): React.ReactNode {
  return (
    <>
      <span className="flex items-center justify-center" style={{ height: 18 }} aria-hidden>
        {shape}
      </span>
      <span className="leading-none">{text}</span>
    </>
  )
}
