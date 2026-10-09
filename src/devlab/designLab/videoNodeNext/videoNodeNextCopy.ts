// 设计实验室 · 屏「视频节点的下一步」的文案与时间码（样张里新增的那几句；生产里已有的句子一律读生产 i18n）。
//
// 为什么文案放这里而不是塞进 `src/i18n/locales`：这一屏是拍板样张，生产还没接——往生产语言包加的键在拍板前
// 没有任何调用方，那是死键。接线那天把这几句搬进 `generationCommon.videoToolbar` / `generationCommon.clipNode`，这个文件整份删掉。
import i18n from '../../../i18n'
import { localProcessingError } from '../../../workbench/observability/localProcessingError'
import { frameTimecode } from '../../../workbench/generationCanvas/nodes/frameTimecode'

export type VnLocale = 'zh-CN' | 'en'

type Copy = {
  trim: string
  trimTitle: string
  close: string
  cancel: string
  confirm: string
  play: string
  pause: string
  tcIn: string
  tcOut: string
  keep: string
  splitInto: string
  splitImage: string
  splitVideo: string
  splitCommitImage: (count: number) => string
  splitCommitVideo: string
  trimTitleCard: (source: string, from: string, to: string) => string
  segmentTitle: (source: string, index: number) => string
  trimming: string
  trimFailed: string
  sourceTitle: string
}

export const COPY: Record<VnLocale, Copy> = {
  'zh-CN': {
    trim: '剪辑',
    trimTitle: '剪辑',
    close: '关闭',
    cancel: '取消',
    confirm: '确认',
    play: '播放预览',
    pause: '暂停',
    tcIn: '入点',
    tcOut: '出点',
    keep: '保留',
    splitInto: '拆成',
    splitImage: '图片',
    splitVideo: '视频片段',
    splitCommitImage: (count) => `加入画布（${count}）`,
    splitCommitVideo: '拆成 {{count}} 段视频',
    trimTitleCard: (source, from, to) => `${source} · 剪辑 ${from}–${to}`,
    segmentTitle: (source, index) => `${source} · 片段 ${index}`,
    trimming: '剪辑中',
    trimFailed: '剪辑失败：编码中途退出，原视频没动。',
    sourceTitle: '雨夜街口 · 长镜头',
  },
  en: {
    trim: 'Trim',
    trimTitle: 'Trim',
    close: 'Close',
    cancel: 'Cancel',
    confirm: 'Confirm',
    play: 'Play preview',
    pause: 'Pause',
    tcIn: 'In',
    tcOut: 'Out',
    keep: 'Keep',
    splitInto: 'Split into',
    splitImage: 'Images',
    splitVideo: 'Video clips',
    splitCommitImage: (count) => `Add to canvas (${count})`,
    splitCommitVideo: 'Split into {{count}} clips',
    trimTitleCard: (source, from, to) => `${source} · Trim ${from}–${to}`,
    segmentTitle: (source, index) => `${source} · Clip ${index}`,
    trimming: 'Trimming',
    trimFailed: 'Trim failed. Original untouched.',
    sourceTitle: 'Rainy street · Long take',
  },
}

/** 秒 → `m:ss.s`：就是生产的截帧时间码（样张和生产是同一个函数，不留第二份）。 */
export { frameTimecode as timecode } from '../../../workbench/generationCanvas/nodes/frameTimecode'

/** 截帧新卡的标题与失败文案：读生产词条（样张里不再写第二份）。 */
export function frameCardTitle(locale: VnLocale, source: string, seconds: number): string {
  const frame = i18n.t('generationCommon.node.extractFrame.current', { lng: locale, time: frameTimecode(seconds) })
  return i18n.t('generationCommon.node.extractFrame.nodeTitle', { lng: locale, title: source, frame })
}

export function frameFailureMessage(locale: VnLocale, seconds: number): string {
  const frame = i18n.t('generationCommon.node.extractFrame.current', { lng: locale, time: frameTimecode(seconds) })
  const detail = locale === 'en' ? 'ffmpeg exited with code 1' : 'ffmpeg 中途退出（code 1）'
  return localProcessingError(`${i18n.t('generationCommon.node.extractFrame.failed', { lng: locale, frame })}\n${detail}`)
}
