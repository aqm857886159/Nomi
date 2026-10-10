// 时间轴 / 剪辑节点的指针手势只许经过 timelineGesture.ts 的会话：不许再手写 capture + window 监听。
//
// 起因（2026-10-09 用户：剪辑节点和时间轴拖动不灵、有时卡在拖动中）：5 处手势各写了一遍「capture + window 监听 + 收尾」，
// 补全的只有一处，其余只摘了 pointerup——系统打断（pointercancel / 失焦 / 丢 capture）后卡在拖动态。
// 这条测试把「再抄一份」变成当场红：新手势要么用 beginPointerSession / usePointerSession，要么在下面登记并写理由。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}
const rel = (file: string): string => path.relative(process.cwd(), file).split(path.sep).join('/')
const read = (file: string): string => stripComments(fs.readFileSync(file, 'utf8'))

const timelineRoot = path.join(process.cwd(), 'src/workbench/timeline')
const nodesRoot = path.join(process.cwd(), 'src/workbench/generationCanvas/nodes')
const previewRoot = path.join(process.cwd(), 'src/workbench/preview')
const scanned = [
  ...walk(timelineRoot),
  ...['OverlaySelectionBox.tsx', 'TimelinePreview.tsx'].map((name) => path.join(previewRoot, name)),
  ...fs.readdirSync(nodesRoot).filter((name) => /^ClipNode.*\.tsx$/.test(name)).map((name) => path.join(nodesRoot, name)),
].map((file) => ({ file: rel(file), source: read(file) }))

/** 例外：自己挂在元素上的 React 指针处理（带 onPointerCancel），生命周期不经过 window。 */
const ALLOWED_RAW_POINTER_CAPTURE = new Set([
  'src/workbench/timeline/timelineGesture.ts',
  'src/workbench/timeline/TimelineResizeHandle.tsx', // 面板高度分隔条：onPointerMove/Up/Cancel 都在元素上
])

describe('timeline gestures go through one pointer session', () => {
  it('scans the timeline and the clip node files', () => {
    const files = scanned.map(({ file }) => file)
    expect(files).toContain('src/workbench/timeline/TimelineClip.tsx')
    expect(files).toContain('src/workbench/generationCanvas/nodes/ClipNodeTimeline.tsx')
  })

  it('does not hand-roll capture or window pointer listeners outside timelineGesture.ts', () => {
    const offenders = scanned
      .filter(({ file }) => !ALLOWED_RAW_POINTER_CAPTURE.has(file))
      .filter(({ source }) => /\.setPointerCapture\??\.?\(/.test(source) || /addEventListener\(\s*['"]pointer(?:up|cancel)['"]/.test(source))
      .map(({ file }) => file)
    expect(offenders, '手写 capture / pointerup 监听 → 改用 timelineGesture 的 beginPointerSession / usePointerSession').toEqual([])
  })

  it('every gesture owner in the clip node timeline starts a session', () => {
    const source = scanned.find(({ file }) => file.endsWith('ClipNodeTimeline.tsx'))!.source
    expect(source).toContain('usePointerSession')
    // 移动、裁剪、拖播放头三条手势各开一次会话。
    expect(source.match(/startSession\(/g)?.length).toBeGreaterThanOrEqual(3)
    // 手势所在的轴必须带 nodrag / nopan / nowheel：React Flow 的节点拖动、画布平移与滚轮缩放都不许接管它。
    expect(source).toContain('NODE_SCROLL_REGION_CLASS_NAME')
  })

  it('the preview overlay and framing drags use the same session', () => {
    for (const name of ['OverlaySelectionBox.tsx', 'TimelinePreview.tsx']) {
      const source = scanned.find(({ file }) => file.endsWith(`preview/${name}`))!.source
      expect(source, name).toContain('usePointerSession')
      expect(source, name).toContain('onCancel')
    }
  })

  it('the global timeline clips and text clips revert on interruption', () => {
    for (const name of ['TimelineClip.tsx', 'TimelineTextTrack.tsx']) {
      const source = scanned.find(({ file }) => file.endsWith(`timeline/${name}`))!.source
      expect(source, name).toContain('usePointerSession')
      expect(source, name).toContain('revertCapturedTimelineEdit')
    }
  })
})
