import type { PreviewAspectRatio } from '../workbenchTypes'

export type PreviewRatioOption = {
  value: PreviewAspectRatio
  label: string
  title: string
  css: string
  width: number
  height: number
}

// 预览/导出可选画幅。css 给预览容器 aspect-ratio，width/height 给导出维度推算。
export const PREVIEW_RATIOS: PreviewRatioOption[] = [
  { value: '16:9', label: '16:9', title: '横屏 / YouTube / B站', css: '16 / 9', width: 16, height: 9 },
  { value: '9:16', label: '9:16', title: '竖屏 / 短视频', css: '9 / 16', width: 9, height: 16 },
  { value: '1:1', label: '1:1', title: '方形 / 信息流', css: '1 / 1', width: 1, height: 1 },
  { value: '4:5', label: '4:5', title: '社媒竖图 / Feed', css: '4 / 5', width: 4, height: 5 },
  { value: '3:4', label: '3:4', title: '竖版海报 / 封面', css: '3 / 4', width: 3, height: 4 },
  { value: '4:3', label: '4:3', title: '传统横屏', css: '4 / 3', width: 4, height: 3 },
  { value: '21:9', label: '21:9', title: '电影宽屏', css: '21 / 9', width: 21, height: 9 },
]
