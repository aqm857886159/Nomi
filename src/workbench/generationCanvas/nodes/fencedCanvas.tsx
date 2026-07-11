// r3f <Canvas> 在 GL/store 初始化完成前会自我 suspend（fiber 源码 `if (block) throw block`），
// 这个 throw 落在 DOM 树里、无就地边界时冒泡到最近的 DOM Suspense。React 18 对「已提交内容再
// suspend」的处理是给整棵已上屏子树打内联 display:none（hideInstance）——fallback 若为 null，
// 用户面对的就是整面空气（2026-07-11 悬案实锤：3D 编辑器外壳冷开隐身 1.8s、慢盘长尾 10s+，
// 连带教练层「bg-nomi-ink/45 类计算值正确却不上屏」的假案）。
// 铁律：workbench 内 r3f Canvas 一律经此围栏挂载，初始化只遮自己的视口，绝不牵连宿主表面。
// fencedCanvas.invariant.test.ts 钉死「禁止裸 <Canvas>」。
import React from 'react'
import { Canvas } from '@react-three/fiber'

type FencedCanvasProps = React.ComponentProps<typeof Canvas> & {
  /** suspend 期间就地显示的占位；默认 null（空白占位，由宿主容器的框/底色兜住视觉）。 */
  fence?: React.ReactNode
}

export function FencedCanvas({ fence = null, ...props }: FencedCanvasProps): JSX.Element {
  return (
    <React.Suspense fallback={fence}>
      <Canvas {...props} />
    </React.Suspense>
  )
}
