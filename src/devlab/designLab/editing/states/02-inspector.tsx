// 设计实验室 · 剪辑面 · 属性面板的四种对象态
//
// 顺序有意义：`labStates.mjs` 按本屏目录（screens/editing/）里 `NN-*.tsx` 的文件名排序解析，
// 同目录的 `index.tsx` 按同样顺序拼接，走查再拿活页面的 `window.__designLabStates`
// 与解析结果逐项比对——三者对不上当场红。加状态时别打乱文件名的数字前缀。
//
// 对象态**不是** props，是选中态：`selectedTimelineClipIds` / `selectedTextClipId`
// 决定面板显示整片、片段、字幕还是配乐（PreviewInspector.tsx:56-58）。
// 所以夹具灌的是 store，而不是给组件喂四套假 props——喂假 props 只能证明组件会渲染，
// 证明不了「选中这段之后面板真的会长成这样」。
import React from 'react'
import PreviewInspector from '../../../../workbench/preview/inspector/PreviewInspector'
import { LAB_AUDIO_ID, LAB_TEXT_ID, LAB_VIDEO_A_ID } from '../editingFixtures'
import { INSPECTOR_CLIP_HEIGHT, InspectorStage, NOOP, useLabTimeline } from '../editingLabKit'
import type { LabState } from '../../labScreen'

function InspectorCell({ clipId, textClipId, height }: { clipId?: string; textClipId?: string; height?: number }): JSX.Element {
  const timeline = useLabTimeline(clipId ?? '', textClipId ?? '')
  return (
    <InspectorStage height={height}>
      <PreviewInspector timeline={timeline} collapsed={false} onToggleCollapsed={NOOP} />
    </InspectorStage>
  )
}

export const INSPECTOR_STATES: readonly LabState[] = [
  {
    id: 'inspector-01-film',
    name: '属性面板 · 整片（没选中任何东西）',
    source: '现役 PreviewInspector.tsx：objectType=null → 画幅 / 导出 / 配乐音量三组',
    coverage: 'shell',
    render: () => <InspectorCell />,
  },
  {
    id: 'inspector-02-clip',
    name: '属性面板 · 片段（选中一段视频）',
    source: '现役 PreviewInspector.tsx：clip.type="video" → 显示 / 时间 / 声音 / 转场四组',
    coverage: 'shell',
    // 四组字段（显示 / 时间 / 声音 / 转场）是全屏最高的一格，560 的默认框会把
    // 「转场 · 入场」齐腰切掉，而且切得不留痕迹。取景高按实测内容走。
    render: () => <InspectorCell clipId={LAB_VIDEO_A_ID} height={INSPECTOR_CLIP_HEIGHT} />,
  },
  {
    id: 'inspector-03-text',
    name: '属性面板 · 字幕（选中一条字幕）',
    source: '现役 PreviewInspector.tsx：textClip → 文字 / 时间两组',
    coverage: 'shell',
    render: () => <InspectorCell textClipId={LAB_TEXT_ID} />,
  },
  // 这一格拍板时要看的就是这件事：选中的是**一段**配乐，头部也写着它的名字和时长，
  // 但下面给的仍是整片那三组（画幅 / 导出 / 全轨配乐音量）——因为 objectType 只认
  // video / image / text，audio 落到 null 分支去了（PreviewInspector.tsx:58）。
  // 面板确实能走到这一态，所以 coverage 是 shell；「该给什么字段」是设计问题，留给拍板。
  //
  // 注释写在注册项**外面**：`labStates.mjs` 那把正则要求 id → name → source → coverage
  // 四行相邻，夹一行注释进去这一条就会被静默漏解析（少截一张图、少比一条基线），
  // 2026-09-06 就是走查的「活页面 12 个 / 源码解析 11 个」把它逼出来的。
  {
    id: 'inspector-04-music',
    name: '属性面板 · 配乐（选中一段配乐）',
    source: '现役 PreviewInspector.tsx:58 —— audio clip 落 objectType=null，正文仍是整片那三组',
    coverage: 'shell',
    render: () => <InspectorCell clipId={LAB_AUDIO_ID} />,
  },
]
