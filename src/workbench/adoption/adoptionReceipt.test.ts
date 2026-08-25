import type { NotificationData } from '@mantine/notifications'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 回执层的两条用户可见回归（都来自 PR#176 走查截图的人眼判读，
 * 当时**没有任何断言**盖得住它们）：
 *  · 缺陷 1：拖到指定位置，回执却说「已加入时间轴末尾」——回执在说假话。
 *  · 缺陷 2：采纳已被别的途径撤掉之后，残留回执的「撤销」仍然可点，
 *            一点就弹掉**上一笔无关编辑**，静默毁掉用户没要求撤的东西。
 *
 * 这里走的是**真实生产路径**（真 showUndoToast → 真 toast store），
 * 只把最外层的 @mantine/notifications 换成 spy——不给生产代码开测试专用后门。
 */

const notificationMocks = vi.hoisted(() => ({
  show: vi.fn(),
  update: vi.fn(),
  hide: vi.fn(),
}))
vi.mock('@mantine/notifications', () => ({ notifications: notificationMocks }))

import i18n from '../../i18n'
import { createDefaultTimeline } from '../timeline/timelineMath'
import type { TimelineClip, TimelineState } from '../timeline/timelineTypes'
import { useWorkbenchStore } from '../workbenchStore'
import { adoptGenerationNode } from './adoptGenerationNode'
import { reportAdoptionOutcome } from './adoptionReceipt'
import { resetAdoptionRegistry } from './adoptionProposalRegistry'

type ToastActionProps = { actionLabel?: string; onAction?: () => void }

/** 取最后一张 toast 的可见文字。 */
function lastToastMessage(): string {
  const call = notificationMocks.show.mock.calls.at(-1)
  const notification = call?.[0] as NotificationData | undefined
  const element = notification?.message as { props?: { message?: unknown } } | undefined
  return String(element?.props?.message ?? '')
}

/** 取最后一张 toast 的动作（撤销按钮）。 */
function lastToastAction(): ToastActionProps {
  const call = notificationMocks.show.mock.calls.at(-1)
  const notification = call?.[0] as NotificationData | undefined
  const element = notification?.message as { props?: ToastActionProps } | undefined
  return element?.props ?? {}
}

function clip(id: string, startFrame: number, frameCount = 24): TimelineClip {
  return {
    id,
    type: 'video',
    sourceNodeId: `node-${id}`,
    label: id,
    startFrame,
    endFrame: startFrame + frameCount,
    frameCount,
    offsetStartFrame: 0,
    offsetEndFrame: 0,
    url: `https://example.test/${id}.mp4`,
  }
}

function imageNode(id: string, artifactId: string): never {
  return {
    id, kind: 'image', title: id, status: 'success',
    position: { x: 0, y: 0 },
    result: { id: artifactId, type: 'image', url: 'data:image/svg+xml,ok', createdAt: 1 },
  } as never
}

/** 直连 store 的 ports：撤销栈行为要真，缺陷 2 测的就是它。 */
const storePorts = {
  readTimeline: () => useWorkbenchStore.getState().timeline,
  commitTimeline: (next: TimelineState) => {
    useWorkbenchStore.getState().captureTimelineUndo()
    useWorkbenchStore.setState({ timeline: next })
  },
  restoreTimeline: (old: TimelineState) => {
    useWorkbenchStore.setState({ timeline: old })
    return true
  },
}

describe('P5 E1 采纳回执', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAdoptionRegistry()
    useWorkbenchStore.setState({
      timeline: createDefaultTimeline(),
      timelineUndoStack: [],
      timelineRedoStack: [],
    })
  })

  // ── 缺陷 1 ──────────────────────────────────────────────────────
  it('拖到指定位置的回执说的是落点，不是「末尾」', async () => {
    const outcome = await adoptGenerationNode(imageNode('node-drag', 'artifact-drag'), {
      placement: { kind: 'frame', startFrame: 120 },
      ports: storePorts,
    })
    expect(outcome.status).toBe('applied')
    expect(outcome.status === 'applied' ? outcome.proposal.placementKind : '').toBe('frame')

    reportAdoptionOutcome(outcome, { revealTimeline: false })
    expect(lastToastMessage()).toBe(i18n.t('timelineEditor.addedAtPosition'))
    expect(lastToastMessage()).not.toBe(i18n.t('timelineEditor.addedToEnd'))
  })

  it('点击贴尾的回执仍然说「末尾」', async () => {
    const outcome = await adoptGenerationNode(imageNode('node-append', 'artifact-append'), {
      placement: { kind: 'append' },
      ports: storePorts,
    })
    reportAdoptionOutcome(outcome, { revealTimeline: false })
    expect(lastToastMessage()).toBe(i18n.t('timelineEditor.addedToEnd'))
  })

  // ── 缺陷 2 ──────────────────────────────────────────────────────
  // 这条是「会毁数据」的那条：采纳已被别的途径撤掉后，残留 toast 的撤销
  // 必须变成 no-op，绝不能再弹一层栈把**上一笔无关编辑**干掉。
  it('采纳已被别的途径撤掉后，残留回执的撤销不再弹掉无关编辑', async () => {
    // 一笔与采纳无关的在先编辑：它是这次要保护的东西。
    const earlier = createDefaultTimeline()
    const unrelated: TimelineState = {
      ...earlier,
      tracks: earlier.tracks.map((track) => track.type === 'video'
        ? { ...track, clips: [clip('unrelated-edit', 0)] }
        : track),
    }
    useWorkbenchStore.setState({ timeline: unrelated, timelineUndoStack: [earlier], timelineRedoStack: [] })

    const outcome = await adoptGenerationNode(imageNode('node-stale', 'artifact-stale'), {
      placement: { kind: 'frame', startFrame: 240 },
      ports: storePorts,
    })
    expect(outcome.status).toBe('applied')
    reportAdoptionOutcome(outcome, { revealTimeline: false })
    const action = lastToastAction()
    expect(action.actionLabel).toBe(i18n.t('common.undo'))

    // 用户走**别的途径**撤掉了这次采纳（时间轴撤销按钮 / Cmd⁠Z）。
    useWorkbenchStore.getState().undoTimeline()
    expect(useWorkbenchStore.getState().timeline).toEqual(unrelated)

    // 此刻再点那张还没消失的回执上的「撤销」。
    action.onAction?.()

    // 轴必须停在「无关编辑」上——被撤掉就说明它弹了别人的栈。
    expect(useWorkbenchStore.getState().timeline).toEqual(unrelated)
    expect(
      useWorkbenchStore.getState().timeline.tracks.find((track) => track.type === 'video')?.clips.map((item) => item.id),
    ).toEqual(['unrelated-edit'])
    // 而且这张失效的回执应该被收掉，不留哑巴按钮。
    expect(notificationMocks.hide).toHaveBeenCalled()
  })

  // 走查截图里正是**两张**回执叠着，各带一个可点的撤销 = 两次无关撤销的机会。
  // 这里的保证不是「两张都能撤」（撤完第二张后，第一张已不在栈顶，撤不了才是对的），
  // 而是**无论怎么点，都绝不伤及那笔无关编辑**——宁可不作为，也不动别人的成果。
  it('两张回执叠着时，怎么点都不会弹掉无关编辑', async () => {
    const earlier = createDefaultTimeline()
    const unrelated: TimelineState = {
      ...earlier,
      tracks: earlier.tracks.map((track) => track.type === 'video'
        ? { ...track, clips: [clip('unrelated-edit', 0)] }
        : track),
    }
    useWorkbenchStore.setState({ timeline: unrelated, timelineUndoStack: [earlier], timelineRedoStack: [] })

    const first = await adoptGenerationNode(imageNode('node-a', 'artifact-a'), {
      placement: { kind: 'frame', startFrame: 240 }, ports: storePorts,
    })
    reportAdoptionOutcome(first, { revealTimeline: false })
    const firstAction = lastToastAction()

    const second = await adoptGenerationNode(imageNode('node-b', 'artifact-b'), {
      placement: { kind: 'frame', startFrame: 480 }, ports: storePorts,
    })
    reportAdoptionOutcome(second, { revealTimeline: false })
    const secondAction = lastToastAction()

    // 从最上面一张开始撤，两张都点一遍。
    secondAction.onAction?.()
    firstAction.onAction?.()

    // 那笔无关编辑必须原封不动——这是本条的核心保证。
    const videoClips = useWorkbenchStore.getState().timeline.tracks
      .find((track) => track.type === 'video')?.clips.map((item) => item.id)
    expect(videoClips).toEqual(['unrelated-edit'])
    // 撤销栈没被越撤越深：栈底那笔「无关编辑之前」的状态仍在，
    // 用户自己的 Cmd⁠Z 还能一步步退回去（回执撤销不该替他消费历史）。
    expect(useWorkbenchStore.getState().timelineUndoStack[0]).toEqual(earlier)
  })
})
