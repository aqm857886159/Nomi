// 「生成这一组」的四扇门对同一组事实给同一个答案（设计系统 C1：可点即有效，否则置灰并说明为什么）：
// 组工具条「生成整组」、框右键「生成整组」、框头「生成全部」、列表分区头「生成全部」。
// 每扇门都挂真组件（框头、列表分区头、组工具条走它们自己的 hook 读 store），读回按钮是否置灰、外层 title 说的哪句；
// 四扇门逐项相同，并且等于共用主人那一句（groupGenerateDisabledReason）。哪扇门自己另算一份、或丢了原因，这里红。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { createGenerationNode } from '../model/graphOps'
import type { GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useProductionCanvasLandingStore } from '../../production/productionCanvasLandingStore'
import { GenerationListSectionHeader } from '../../generation/list/GenerationListSectionHeader'
import type { GenerationListSection } from '../../generation/list/generationListModel'
import { CanvasGroupToolbar } from './CanvasGroupToolbar'
import FrameContextMenu from './FrameContextMenu'
import { GroupFrameHeader } from './GroupFrameHeader'
import { groupGenerateDisabledReason } from './groupGenerate'
import { frameMenuGenerate } from './useCanvasFrameActions'
import { useCanvasGroupToolbar } from './useCanvasGroupToolbar'

type Status = GenerationCanvasNode['status']
type DoorAnswer = { disabled: boolean; title: string | undefined }

const noop = () => undefined
const GROUP_ID = 'g'

const SHAPES: ReadonlyArray<{ name: string; statuses: Status[] }> = [
  { name: 'all recoverable', statuses: ['recoverable', 'recoverable'] },
  { name: 'recoverable + generating', statuses: ['recoverable', 'running'] },
  { name: 'all generating', statuses: ['running', 'running'] },
  { name: 'one idle among recoverable', statuses: ['idle', 'recoverable'] },
  { name: 'all done (can be re-ticked)', statuses: ['success', 'success'] },
  { name: 'failed + generating', statuses: ['error', 'running'] },
  { name: 'empty group', statuses: [] },
]

function seed(statuses: readonly Status[]): NodeGroup {
  const nodes = statuses.map((status, index) => ({ ...createGenerationNode({ id: `n${index}`, kind: 'image' }), categoryId: 'shots' }))
  const group: NodeGroup = { id: GROUP_ID, name: 'G', categoryId: 'shots', nodeIds: nodes.map((node) => node.id) }
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges: [], groups: [group], selectedNodeIds: [] })
  // 载入会把「存盘时在跑」的收敛掉；这里要的是此刻的状态，直接写 store。
  // 组也直接写（载入时会把这种最小形状的组整理掉；这里要的只是「这组成员是谁」）。
  useGenerationCanvasStore.setState((state) => ({ groups: [group], nodes: state.nodes.map((node, index) => ({ ...node, status: statuses[index] })) }))
  mirrorIntoServerSnapshot()
  expect(useGenerationCanvasStore.getState().groups.map((candidate) => [candidate.id, candidate.nodeIds])).toEqual([[GROUP_ID, group.nodeIds]])
  return group
}

const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** 按 marker 找到那颗按钮，读它是否置灰、包着它那一层的 title。 */
function readDoor(html: string, marker: string): DoorAnswer {
  const at = html.indexOf(marker)
  expect(at, `door marker ${marker} rendered`).toBeGreaterThan(-1)
  const buttonStart = html.lastIndexOf('<button', at)
  const buttonTag = html.slice(buttonStart, html.indexOf('>', buttonStart) + 1)
  const wrapperStart = html.lastIndexOf('<span', buttonStart)
  const wrapperTag = html.slice(wrapperStart, html.indexOf('>', wrapperStart) + 1)
  const title = /\stitle="([^"]*)"/.exec(wrapperTag)?.[1]
  return { disabled: /\sdisabled=""/.test(buttonTag), title: title === undefined ? undefined : decode(title) }
}

function ToolbarDoor({ group }: { group: NodeGroup }) {
  const allNodes = useGenerationCanvasStore((state) => state.nodes)
  const model = useCanvasGroupToolbar({
    selectedGroup: group, allNodes, visibleNodeIds: new Set(group.nodeIds), canvasZoom: 1,
    canvasOffsetX: 0, canvasOffsetY: 0, stageWidth: 1200, stageHeight: 800, readOnly: false, runFrameAction: noop,
  })
  return model ? <CanvasGroupToolbar {...model} placement={{ side: 'above', offset: 8 }} horizontal={{ frameLeft: 0, frameWidth: 400, offsetX: 0, stageWidth: 1200 }} /> : null
}

function doors(group: NodeGroup): Record<string, DoorAnswer> {
  const answers: Record<string, DoorAnswer> = {}
  const toolbarHtml = renderToStaticMarkup(<ToolbarDoor group={group} />)
  // 空组没有组工具条（选不中成员），这扇门不在场。
  if (toolbarHtml) answers.toolbar = readDoor(toolbarHtml, `aria-label="${i18n.t('generationCommon.canvas.group.toolbarGenerate')}"`)
  answers.menu = readDoor(
    renderToStaticMarkup(<FrameContextMenu frameName="G" {...frameMenuGenerate(group.nodeIds)} canSendToTimeline onAction={noop} />),
    i18n.t('generationCommon.canvas.group.menuGenerate'),
  )
  answers.frameHeader = readDoor(renderToStaticMarkup(
    <GroupFrameHeader
      groupId={group.id} name={group.name} storyboard={false} memberCount={group.nodeIds.length} memberNodeIds={group.nodeIds}
      previewCount={null} readOnly={false} connectable={false} editing={false}
      onEditingChange={noop} onRename={noop} onDescribe={noop} onGenerate={noop}
    />,
  ), 'data-frame-generate-all="true"')
  const section: GenerationListSection = { key: `group:${group.id}`, kind: 'group', title: group.name, groupId: group.id, storyboard: null, cards: [], anchors: [], unreferencedAssetIds: [] }
  answers.listHeader = readDoor(
    renderToStaticMarkup(<GenerationListSectionHeader section={section} collapsed={false} onToggle={noop} onOpenAnchor={noop} />),
    `data-section-generate="${section.key}"`,
  )
  return answers
}

// 静态渲染里 zustand 的订阅读的是「服务端快照」= store 初值；这几扇门在真窗口里读的是现状。
// 测试期间让服务端快照就是现状，组件照真窗口那样读 store（只改测试里的读法，不改组件）。
// （zustand 4：服务端快照 = `getInitialState()` 返回的那个对象，拿不到内部 api 去换读法；这里把现状的
// nodes / groups 抄进那个对象，测完还原。runs 初值本来就是空的，和下面 setState 的一样。）
type CanvasState = ReturnType<typeof useGenerationCanvasStore.getState>
const serverSnapshot = useGenerationCanvasStore.getInitialState() as { -readonly [K in keyof CanvasState]: CanvasState[K] }
const pristine = { nodes: serverSnapshot.nodes, groups: serverSnapshot.groups }
function mirrorIntoServerSnapshot(): void {
  expect(Object.isFrozen(serverSnapshot), 'store initial state must stay writable for this test').toBe(false)
  const live = useGenerationCanvasStore.getState()
  serverSnapshot.nodes = live.nodes
  serverSnapshot.groups = live.groups
}
beforeEach(() => {
  useProductionCanvasLandingStore.setState({ runs: {} } as Partial<ReturnType<typeof useProductionCanvasLandingStore.getState>>)
})
afterEach(() => {
  serverSnapshot.nodes = pristine.nodes
  serverSnapshot.groups = pristine.groups
})

describe('four「generate this group」doors give one answer for the same facts', () => {
  for (const locale of ['zh', 'en'] as const) {
    for (const shape of SHAPES) {
      it(`${locale} · ${shape.name}: every door greys out (or not) with the owner's reason`, async () => {
        await i18n.changeLanguage(locale)
        const group = seed(shape.statuses)
        const reason = groupGenerateDisabledReason(group.nodeIds)
        const expected: DoorAnswer = { disabled: reason !== undefined, title: reason }
        const answers = doors(group)
        expect(Object.keys(answers)).toEqual(shape.statuses.length ? ['toolbar', 'menu', 'frameHeader', 'listHeader'] : ['menu', 'frameHeader', 'listHeader'])
        for (const [door, answer] of Object.entries(answers)) expect(answer, door).toEqual(expected)
      })
    }
  }

  it('the shapes cover both answers (some greyed with a reason, some clickable)', async () => {
    await i18n.changeLanguage('zh')
    const greyed = SHAPES.map((shape) => groupGenerateDisabledReason(seed(shape.statuses).nodeIds) !== undefined)
    expect(greyed).toEqual([true, true, true, false, false, false, true])
  })
})
