import { describe, expect, it } from 'vitest'
import {
  scene3dStatusSentence,
  scene3dTaskCta,
  scene3dViewIdentityLabel,
  templateGroupSegments,
  type Scene3DStatusInput,
} from './scene3dTaskMode'

const base: Scene3DStatusInput = {
  recording: false,
  recordingSeconds: 0,
  countdownRemaining: null,
  possessedName: null,
  possessedCameraName: null,
  cameraViewEditName: null,
  trajectoryMode: false,
  isPlaying: false,
  selectionName: null,
  selectionKind: null,
}

describe('scene3dStatusSentence（任一时刻只显示一句，优先级钉死）', () => {
  it('录制压倒一切，并写明键盘归属', () => {
    expect(scene3dStatusSentence({ ...base, recording: true, possessedName: '角色A', cameraViewEditName: '相机1' }))
      .toBe('正在录制：角色A · 键盘归角色')
    expect(scene3dStatusSentence({ ...base, recording: true, possessedCameraName: '相机1' }))
      .toBe('正在录制：相机1 · 键盘归镜头')
  })
  it('倒计时 > 操控 > 取景 > 播放 > 轨迹 > 选中 > 空', () => {
    expect(scene3dStatusSentence({ ...base, countdownRemaining: 3, possessedName: '角色A' })).toContain('3 秒后开录')
    expect(scene3dStatusSentence({ ...base, possessedName: '角色A' })).toContain('正在操控：角色A')
    expect(scene3dStatusSentence({ ...base, possessedCameraName: '相机1' })).toContain('正在操控镜头：相机1')
    expect(scene3dStatusSentence({ ...base, cameraViewEditName: '相机1' })).toBe('正在取景：相机1 · 这就是最终画面')
    expect(scene3dStatusSentence({ ...base, isPlaying: true })).toBe('正在预览最终镜头')
    expect(scene3dStatusSentence({ ...base, trajectoryMode: true })).toContain('正在编辑轨迹')
    expect(scene3dStatusSentence({ ...base, selectionName: '角色A', selectionKind: 'object' })).toBe('正在移动：角色A')
    expect(scene3dStatusSentence({ ...base, selectionName: '相机1', selectionKind: 'camera' })).toBe('已选中镜头：相机1')
    expect(scene3dStatusSentence(base)).toBe('点左侧或画面里的对象开始')
  })
})

describe('scene3dTaskCta', () => {
  it('三任务三 CTA；act 录制中变完成', () => {
    expect(scene3dTaskCta('compose', false)).toBe('使用这张构图')
    expect(scene3dTaskCta('move', false)).toBe('生成参考视频')
    expect(scene3dTaskCta('act', false)).toBe('开始录制')
    expect(scene3dTaskCta('act', true)).toBe('完成这段动作')
  })
})

describe('scene3dViewIdentityLabel（主视图身份必须明说，不靠小预览暗示）', () => {
  it('取景态=输出画面；否则=工作视图·不会出片', () => {
    expect(scene3dViewIdentityLabel('相机1', '16:9')).toEqual({ label: '相机1 · 16:9 · 输出画面', isOutput: true })
    expect(scene3dViewIdentityLabel(null, null)).toEqual({ label: '工作视图 · 不会出片', isOutput: false })
  })
})

describe('templateGroupSegments（场景树按模板组折叠）', () => {
  it('同组聚在首个成员位置，散件保持原序', () => {
    const items = [
      { id: 'a', templateGroup: '城市街道' },
      { id: 'b', templateGroup: '城市街道' },
      { id: 'c' },
      { id: 'd', templateGroup: '室内房间' },
      { id: 'e' },
    ]
    expect(templateGroupSegments(items)).toEqual([
      { group: '城市街道', items: [items[0], items[1]] },
      { group: null, items: [items[2]] },
      { group: '室内房间', items: [items[3]] },
      { group: null, items: [items[4]] },
    ])
  })
  it('无组时单段透传', () => {
    const items = [{ id: 'a' }, { id: 'b' }]
    expect(templateGroupSegments(items)).toEqual([{ group: null, items }])
  })
})
