import type { PreviewAspectRatio } from '../workbenchTypes'

export type PreviewRatioOption = {
  value: PreviewAspectRatio
  label: string
  css: string
  width: number
  height: number
}

// 预览/导出可选画幅。css 给预览容器 aspect-ratio，width/height 给导出维度推算。
export const PREVIEW_RATIOS: PreviewRatioOption[] = [
  { value: '16:9', label: '16:9', css: '16 / 9', width: 16, height: 9 },
  { value: '9:16', label: '9:16', css: '9 / 16', width: 9, height: 16 },
  { value: '1:1', label: '1:1', css: '1 / 1', width: 1, height: 1 },
  { value: '4:5', label: '4:5', css: '4 / 5', width: 4, height: 5 },
  { value: '3:4', label: '3:4', css: '3 / 4', width: 3, height: 4 },
  { value: '4:3', label: '4:3', css: '4 / 3', width: 4, height: 3 },
  { value: '21:9', label: '21:9', css: '21 / 9', width: 21, height: 9 },
]
