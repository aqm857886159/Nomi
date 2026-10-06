// 真实测试 ④：3D-BOX 补丁覆盖了用户在镜头 2 的手调，DeepSeek 回复里一句没提（C5）。
// 现在这句话由宿主确定性给出：收据授权 host-note（toolCallId ↔ 提议 id）× 计划 meta 上的 patchNotes。
import { describe, expect, it } from 'vitest'
import { LANE_RECEIPT_AUTHORITY_NOTE } from '../../../../electron/shared/agentLane/laneReceiptAuthority'
import type { LanePart } from '../../../../electron/shared/agentLane/laneContracts'
import { DIRECTOR_NODE_KIND, DIRECTOR_PLAN_META_KEY } from '../../generationCanvas/nodes/director/model/directorNodeMeta'
import { directorPatchNoteTargets, readDirectorPatchNotes, recordDirectorPatchNote } from '../../generationCanvas/nodes/director/model/directorPatchNotes'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import type { ToolReceipt, V4FlowItem } from './agentPanelV4Types'
import { directorPatchNoticeText, directorPatchNoticesFor, flowItemNotices } from './useDirectorPatchNotices'

const t = (key: string, options?: Record<string, unknown>): string => {
  if (key === 'director.view.focusListSeparator') return '、'
  if (key === 'director.agent.focusShot') return `镜头 ${String(options?.index)}`
  if (key === 'director.view.patchOverrode') return `这次改动覆盖了你在${String(options?.targets)} 的手调，可撤销`
  return key
}

const plan = {
  actors: [{ id: 'librarian', desc: '管理员' }, { id: 'student', desc: '学生' }],
  scene: { setPieces: [{ id: 'desk-1', kind: '书桌' }] },
  shots: [{ id: 'establishing' }, { id: 'over_shoulder' }, { id: 'student_closeup' }],
}

const directorNode = (patchNotes: Record<string, string[]>) => ({
  kind: DIRECTOR_NODE_KIND,
  meta: { [DIRECTOR_PLAN_META_KEY]: { plan, revision: 'dplan-1', issueCount: 0, compiledBase: {}, patchNotes } },
}) as unknown as Pick<GenerationCanvasNode, 'kind' | 'meta'>

const authority = (toolCallId: string, receiptProposalId: string): LanePart => ({
  kind: 'host-note', noteType: LANE_RECEIPT_AUTHORITY_NOTE, sequence: 1, entrySeq: 1, contentIndex: 0,
  data: { receiptProposalId, approvalId: 'approval-1', actionHash: 'hash-1', toolCallId },
}) as LanePart

const receipt = (toolCallId: string): ToolReceipt => ({ toolCallId, label: '3D 预演', action: 'canvas', status: 'output-available' })

describe('被覆盖的手调 → 用户认得的对象', () => {
  it('机位按计划镜头顺序叫「镜头 N」，角色 / 携带分组叫描述，场景件叫种类，认不出的原样', () => {
    expect(directorPatchNoteTargets(plan, [
      'shot:over_shoulder/camera.fov', 'shot:over_shoulder/camera.motionTrajectory', 'carry:actor:student',
      'actor:librarian.name', 'setPiece:desk-1', 'object:user-lamp', 'shot:establishing/camera',
    ])).toEqual([
      { kind: 'shot', index: 1 }, { kind: 'shot', index: 2 },
      { kind: 'named', name: '学生' }, { kind: 'named', name: '管理员' }, { kind: 'named', name: '书桌' }, { kind: 'named', name: 'object:user-lamp' },
    ])
  })

  it('只在丢了手调时记一笔；同一笔重记不重复；最多留最近 20 笔', () => {
    expect(recordDirectorPatchNote({}, 'p1', [])).toEqual({})
    expect(recordDirectorPatchNote({}, undefined, ['x'])).toEqual({})
    expect(recordDirectorPatchNote({ p1: ['a'] }, 'p1', ['b'])).toEqual({ p1: ['b'] })
    let notes = {}
    for (let index = 0; index < 25; index += 1) notes = recordDirectorPatchNote(notes, 'p' + index, ['x'])
    expect(Object.keys(notes)).toHaveLength(20)
    expect(Object.keys(notes)[0]).toBe('p5')
    expect(Object.keys(notes).at(-1)).toBe('p24')
  })

  it('读 patchNotes 只认字符串数组，坏数据当没有', () => {
    expect(readDirectorPatchNotes({ patchNotes: { a: ['x', 3], b: 'nope' } })).toEqual({ a: ['x'] })
    expect(readDirectorPatchNotes({ patchNotes: ['x'] })).toEqual({})
    expect(readDirectorPatchNotes(undefined)).toEqual({})
  })
})

describe('面板上那句提示', () => {
  it('文案：镜头在前、多项用顿号', () => {
    expect(directorPatchNoticeText([{ kind: 'shot', index: 2 }, { kind: 'named', name: '学生' }], t)).toBe('这次改动覆盖了你在镜头 2、学生 的手调，可撤销')
  })

  it('只给收据授权 host-note 指名、且计划 meta 记着覆盖了手调的那一笔', () => {
    const nodes = [directorNode({ 'receipt-2': ['shot:over_shoulder/camera.fov'] })]
    const notices = directorPatchNoticesFor([authority('call-1', 'receipt-1'), authority('call-2', 'receipt-2')], nodes, t)
    expect([...notices]).toEqual([['call-2', '这次改动覆盖了你在镜头 2 的手调，可撤销']])
  })

  it('撤销后计划 meta 放回去、记录没了 → 不再出现', () => {
    expect(directorPatchNoticesFor([authority('call-2', 'receipt-2')], [directorNode({})], t).size).toBe(0)
  })

  it('坏的 host-note 跳过，不拖垮整条流水', () => {
    const broken = { ...authority('call-2', 'receipt-2'), data: { receiptProposalId: 'receipt-2' } } as LanePart
    expect(directorPatchNoticesFor([broken], [directorNode({ 'receipt-2': ['shot:over_shoulder/camera.fov'] })], t).size).toBe(0)
  })

  it('收起的过程行、折叠的工具组里的提示也露在外面', () => {
    const noted = { ...receipt('call-2'), notice: '覆盖了镜头 2' }
    const items: V4FlowItem[] = [
      { kind: 'tool', receipt: noted },
      { kind: 'tool-group', label: 'g', action: 'canvas', status: 'output-available', count: 2, trailing: '', receipts: [receipt('call-1'), noted] },
      { kind: 'process', label: 'p', segments: [], details: [{ index: 0, item: { kind: 'tool', receipt: noted } }] } as V4FlowItem,
      { kind: 'user', text: 'hi' },
    ]
    expect(items.map(flowItemNotices)).toEqual([['覆盖了镜头 2'], ['覆盖了镜头 2'], ['覆盖了镜头 2'], []])
  })
})
