import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { zhCN, en } from '../../i18n/resources'
import { IconLayoutRows, IconMovie } from '@tabler/icons-react'
import { SELECTION_ACTIONS, canRunSelectionAction, runSelectionAction, selectionActionsIn, type SelectionActionPorts } from './selectionActions'

// 2026-11-08 用户：「我在文本区域点击了，滑中句子，点击视频icon，然后为什么发送了文字」。
// 合同：浮条上把句子交出去的每颗钮只做它表里写的那一件事——建图片节点 / 建视频节点 / 交给 Agent 拆镜头，
// 去处之外的端口一个都不碰。分派只有 runSelectionAction 一处，浮条只按表出钮。
const SENTENCE = '雨夜的街头，女孩撑着红伞穿过霓虹闪烁的夜市。'

function fakePorts(withLauncher = true) {
  const addGenerationNode = vi.fn((input: { kind: 'image' | 'video'; title: string; prompt: string }) =>
    ({ id: `node-${input.kind}`, ...input }) as unknown as GenerationCanvasNode)
  const setWorkspaceMode = vi.fn()
  const launchStoryboard = withLauncher ? vi.fn() : null
  const ports: SelectionActionPorts = { addGenerationNode, setWorkspaceMode, launchStoryboard }
  return { ports, addGenerationNode, setWorkspaceMode, launchStoryboard }
}

const action = (id: string) => {
  const found = SELECTION_ACTIONS.find((item) => item.id === id)
  if (!found) throw new Error(`动作表里没有 ${id}`)
  return found
}

describe('选区浮条：每颗生成钮只做它自己那件事', () => {
  it('用户那次：选中一句点「生成视频」→ 建视频节点、切到画布，不往 Agent 对话发文字', () => {
    const { ports, addGenerationNode, setWorkspaceMode, launchStoryboard } = fakePorts()
    expect(runSelectionAction(action('video').target, `  ${SENTENCE}\n`, ports)).toBe(true)
    expect(addGenerationNode).toHaveBeenCalledTimes(1)
    expect(addGenerationNode.mock.calls[0][0]).toMatchObject({ kind: 'video', prompt: SENTENCE })
    expect(setWorkspaceMode).toHaveBeenCalledWith('generation')
    expect(launchStoryboard).not.toHaveBeenCalled()
  })

  it('「生成图片」→ 建图片节点，不发对话', () => {
    const { ports, addGenerationNode, launchStoryboard } = fakePorts()
    expect(runSelectionAction(action('image').target, SENTENCE, ports)).toBe(true)
    expect(addGenerationNode).toHaveBeenCalledTimes(1)
    expect(addGenerationNode.mock.calls[0][0]).toMatchObject({ kind: 'image', prompt: SENTENCE })
    expect(launchStoryboard).not.toHaveBeenCalled()
  })

  it('「拆成镜头」→ 只交给 Agent 的分镜启动器，不建画布节点、不切面', () => {
    const { ports, addGenerationNode, setWorkspaceMode, launchStoryboard } = fakePorts()
    expect(runSelectionAction(action('storyboard').target, SENTENCE, ports)).toBe(true)
    expect(launchStoryboard).toHaveBeenCalledTimes(1)
    expect(launchStoryboard).toHaveBeenCalledWith(SENTENCE)
    expect(addGenerationNode).not.toHaveBeenCalled()
    expect(setWorkspaceMode).not.toHaveBeenCalled()
  })

  it('这一类：表里每颗钮按下去碰且只碰它去处的端口', () => {
    for (const item of SELECTION_ACTIONS) {
      const { ports, addGenerationNode, setWorkspaceMode, launchStoryboard } = fakePorts()
      expect(runSelectionAction(item.target, SENTENCE, ports), item.id).toBe(true)
      if (item.target.kind === 'canvas-node') {
        expect(addGenerationNode.mock.calls.map((call) => call[0].kind), item.id).toEqual([item.target.nodeKind])
        expect(setWorkspaceMode.mock.calls, item.id).toEqual([['generation']])
        expect(launchStoryboard, item.id).not.toHaveBeenCalled()
      } else {
        expect(launchStoryboard?.mock.calls, item.id).toEqual([[SENTENCE]])
        expect(addGenerationNode, item.id).not.toHaveBeenCalled()
        expect(setWorkspaceMode, item.id).not.toHaveBeenCalled()
      }
    }
  })

  it('空选区 / 只选了空白：哪颗都不交出去', () => {
    for (const item of SELECTION_ACTIONS) {
      for (const text of ['', '   \n\t']) {
        const { ports, addGenerationNode, setWorkspaceMode, launchStoryboard } = fakePorts()
        expect(runSelectionAction(item.target, text, ports), item.id).toBe(false)
        expect(addGenerationNode).not.toHaveBeenCalled()
        expect(setWorkspaceMode).not.toHaveBeenCalled()
        expect(launchStoryboard).not.toHaveBeenCalled()
      }
    }
  })

  it('没有分镜启动器（不在创作面）：「拆成镜头」灰、按了也不交出去；建节点的两颗不受影响', () => {
    const { ports } = fakePorts(false)
    expect(canRunSelectionAction(action('storyboard').target, ports)).toBe(false)
    expect(runSelectionAction(action('storyboard').target, SENTENCE, ports)).toBe(false)
    expect(canRunSelectionAction(action('image').target, ports)).toBe(true)
    expect(canRunSelectionAction(action('video').target, ports)).toBe(true)
  })

  it('动作表：id 与图标各不重复，名字中英都有词条', () => {
    const ids = SELECTION_ACTIONS.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    const icons = SELECTION_ACTIONS.map((item) => item.Icon)
    expect(new Set(icons).size).toBe(icons.length)
    const lookup = (tree: unknown, key: string) => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree)
    for (const item of SELECTION_ACTIONS) {
      expect(typeof lookup(zhCN, item.labelKey), `${item.labelKey} zh`).toBe('string')
      expect(typeof lookup(en, item.labelKey), `${item.labelKey} en`).toBe('string')
    }
  })
})

describe('「拆成镜头」长相与位置（用户 2026-11-12 拍板样张 B）', () => {
  it('图标是设计系统登记的分镜 IconLayoutRows，不是读作「视频」的胶片', () => {
    expect(action('storyboard').Icon).toBe(IconLayoutRows)
    expect(SELECTION_ACTIONS.some((item) => item.Icon === IconMovie)).toBe(false)
  })

  it('住「AI 编辑」右边那一簇；「生成」组只剩图片、视频两颗', () => {
    expect(selectionActionsIn('beside-ai-edit').map((item) => item.id)).toEqual(['storyboard'])
    expect(selectionActionsIn('generate').map((item) => item.id)).toEqual(['image', 'video'])
  })

  it('「生成」组里的每一颗都是建画布节点；不建节点的不许进「生成」组', () => {
    for (const item of selectionActionsIn('generate')) expect(item.target.kind, item.id).toBe('canvas-node')
  })
})

describe('选区浮条只按动作表出钮（结构）', () => {
  const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const popover = stripComments(readFileSync(resolve(process.cwd(), 'src/workbench/creation/SelectionGeneratePopover.tsx'), 'utf8'))

  it('钮由动作表按簇出、点击只走 runSelectionAction', () => {
    expect(popover).toMatch(/selectionActionsIn\('beside-ai-edit'\)\.map\(/)
    expect(popover).toMatch(/selectionActionsIn\('generate'\)\.map\(/)
    expect(popover.match(/runSelectionAction\(/g)?.length).toBe(1)
  })

  it('浮条里没有绕开动作表的去处：不直接建节点、不直接调分镜启动器', () => {
    expect(popover).not.toMatch(/addGenerationNode\(/)
    expect(popover).not.toMatch(/launchStoryboard\(/)
    expect(popover).not.toMatch(/setWorkspaceMode\(/)
    expect(popover).not.toMatch(/\bIcon(Photo|Video|Movie|LayoutRows)\b/)
  })
})
