// 设计实验室 · 屏「视频节点的下一步」的文案与时间码（样张里新增的那几句；生产里已有的句子一律读生产 i18n）。
//
// 为什么文案放这里而不是塞进 `src/i18n/locales`：这一屏是拍板样张，生产还没接——往生产语言包加的键在拍板前
// 没有任何调用方，那是死键。接线那天把这几句搬进 `generationCommon.videoToolbar` / `generationCommon.clipNode`，这个文件整份删掉。
export type VnLocale = 'zh-CN' | 'en'

type Copy = {
  captureFrame: string
  currentFrame: string
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
  splitCommitVideo: (count: number) => string
  frameTitle: (source: string, time: string) => string
  trimTitleCard: (source: string, from: string, to: string) => string
  segmentTitle: (source: string, index: number) => string
  trimming: string
  frameFailed: string
  trimFailed: string
  sourceTitle: string
}

export const COPY: Record<VnLocale, Copy> = {
  'zh-CN': {
    captureFrame: '截帧',
    currentFrame: '当前帧',
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
    splitCommitVideo: (count) => `拆成 ${count} 段视频`,
    frameTitle: (source, time) => `${source} · 当前帧 ${time}`,
    trimTitleCard: (source, from, to) => `${source} · 剪辑 ${from}–${to}`,
    segmentTitle: (source, index) => `${source} · 片段 ${index}`,
    trimming: '剪辑中',
    frameFailed: '截帧失败：读不出这一帧，原视频没动。',
    trimFailed: '剪辑失败：编码中途退出，原视频没动。',
    sourceTitle: '雨夜街口 · 长镜头',
  },
  en: {
    captureFrame: 'Capture frame',
    currentFrame: 'Current frame',
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
    splitCommitVideo: (count) => `Split into ${count} clips`,
    frameTitle: (source, time) => `${source} · Frame ${time}`,
    trimTitleCard: (source, from, to) => `${source} · Trim ${from}–${to}`,
    segmentTitle: (source, index) => `${source} · Clip ${index}`,
    trimming: 'Trimming',
    frameFailed: 'Frame capture failed. Original untouched.',
    trimFailed: 'Trim failed. Original untouched.',
    sourceTitle: 'Rainy street · Long take',
  },
}

/** 秒 → `m:ss.s`（样张里的时间码；剪辑要的是十分之一秒，四舍五入到 0.1 秒，读数之间不会差一格）。 */
export function timecode(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10)
  const whole = Math.floor(tenths / 10)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${tenths % 10}`
}
