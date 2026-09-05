// 设计实验室 · 剪辑面（editing 屏）的夹具数据。
//
// 剪辑面这一族浮层/面板全部从 `useWorkbenchStore` 读真相（选中了谁、时间轴长什么样、
// 有哪些转场），所以夹具就是**一条真实形状的时间轴**灌进 store，而不是给组件喂假 props——
// 喂假 props 只能证明「组件能渲染」，证明不了「面板在这个选中态下会长成这样」。
//
// 一条时间轴要同时喂饱四种对象态，所以它必须一次性带齐：
//   · 两段相邻视频（v1/v2）→ 中间有一条接缝，才有「转场选择器」可看；
//   · 一段配乐（a1）      → 才有「配乐片段选中」这一态；
//   · 一条字幕（t1）      → 才有「字幕选中」这一态；
//   · 一条 dissolve 转场  → 才有转场右键菜单与选择器的当前值。
import type { TimelineState, TimelineTransition } from '../../../workbench/timeline/timelineTypes'

export const LAB_FPS = 30

export const LAB_VIDEO_A_ID = 'lab-clip-v1'
export const LAB_VIDEO_B_ID = 'lab-clip-v2'
export const LAB_AUDIO_ID = 'lab-clip-a1'
export const LAB_TEXT_ID = 'lab-text-1'

export const LAB_TRANSITION: TimelineTransition = {
  fromClipId: LAB_VIDEO_A_ID,
  toClipId: LAB_VIDEO_B_ID,
  type: 'dissolve',
  durationFrames: 12,
}

/** 剪辑面的固定时间轴。三轨 + 一条字幕 + 一条转场，够喂所有已登记状态。 */
export function labTimeline(): TimelineState {
  return {
    version: 1,
    fps: LAB_FPS,
    scale: 1,
    playheadFrame: 96,
    tracks: [
      { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
      {
        id: 'videoTrack',
        type: 'video',
        label: '视频轨',
        clips: [
          {
            id: LAB_VIDEO_A_ID,
            type: 'video',
            sourceNodeId: 'lab-node-1',
            label: '镜 1 雨夜街口',
            startFrame: 0,
            endFrame: 90,
            frameCount: 120,
            offsetStartFrame: 10,
            offsetEndFrame: 20,
            audio: { gainDb: -6 },
          },
          {
            id: LAB_VIDEO_B_ID,
            type: 'video',
            sourceNodeId: 'lab-node-2',
            label: '镜 2 追逐起步',
            startFrame: 90,
            endFrame: 195,
            frameCount: 105,
            offsetStartFrame: 0,
            offsetEndFrame: 0,
          },
        ],
      },
      {
        id: 'audioTrack',
        type: 'audio',
        label: '音频轨',
        clips: [
          {
            id: LAB_AUDIO_ID,
            type: 'audio',
            sourceNodeId: 'lab-node-3',
            label: '雨声底噪',
            startFrame: 0,
            endFrame: 195,
            frameCount: 195,
            offsetStartFrame: 0,
            offsetEndFrame: 0,
            audio: { gainDb: -12, fadeInFrames: 15, fadeOutFrames: 30 },
          },
        ],
      },
    ],
    textClips: [
      {
        id: LAB_TEXT_ID,
        text: '那天雨下得很实',
        style: 'caption',
        startFrame: 30,
        endFrame: 90,
      },
    ],
    transitions: [LAB_TRANSITION],
  }
}
