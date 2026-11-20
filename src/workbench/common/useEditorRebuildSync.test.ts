import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import { history, undoDepth } from '@tiptap/pm/history'
import { createControlledEditorSync } from './controlledEditorSync'
import { hydrateIfStale } from './useEditorRebuildSync'
import { contentToPrompt, promptToContent } from '../assets/promptEditorContent'
import { historySnapshots, replayHistory } from '../creation/storyboard/shotRow/promptHistoryCarry'

/**
 * 分镜提示词「切走再回来变空」的形状：创作区被 React <Activity> 藏起来再放出来，TipTap 用创建那一刻的选项
 * 重建编辑器——首次挂载时提示词还是空，新实例文档就是空，而同步账早已认为 value 就是当前文档。
 * 这里用与生产同一份 StarterKit schema 的 EditorState 当「刚重建的编辑器」，走真的灌入判与写（hydrateIfStale）。
 */
const schema = getSchema([StarterKit])
const docOf = (text: string) => schema.nodeFromJSON(promptToContent(text))
const rebuilt = (text: string) => {
  let state = EditorState.create({ schema, doc: docOf(text), plugins: [history()] })
  const dispatched: Transaction[] = []
  return {
    get state() { return state },
    view: { dispatch: (tr: Transaction) => { dispatched.push(tr); state = state.apply(tr) } },
    getJSON: () => state.doc.toJSON(),
    dispatched,
  }
}
const hydrate = (editor: ReturnType<typeof rebuilt>, value: string) =>
  hydrateIfStale(editor, { text: value, doc: () => promptToContent(value) }, contentToPrompt)
const textOf = (editor: ReturnType<typeof rebuilt>) => contentToPrompt(editor.getJSON())

describe('受控编辑器实例重建：文档等于 owner 当前的值', () => {
  it('新实例是空的（首次挂载时冻住的空内容）、owner 已有字 → 灌成这一镜的字', () => {
    const editor = rebuilt('')
    expect(hydrate(editor, 'FAKE_VENDOR_storyboard: 海边的白色灯塔')).toBe(true)
    expect(textOf(editor)).toBe('FAKE_VENDOR_storyboard: 海边的白色灯塔')
  })

  it('灌入不进撤销历史、不发 update：Ctrl+Z 不会退回空框', () => {
    const editor = rebuilt('')
    hydrate(editor, '灯塔')
    expect(undoDepth(editor.state)).toBe(0)
    expect(editor.dispatched.every((tr) => tr.getMeta('preventUpdate') === true && tr.getMeta('addToHistory') === false)).toBe(true)
  })

  it('另一镜的字不串入：灌的只是传进来的这一镜的值', () => {
    const shot1 = rebuilt('')
    const shot2 = rebuilt('')
    hydrate(shot1, '镜一：灯塔')
    hydrate(shot2, '镜二：雨夜街道')
    expect([textOf(shot1), textOf(shot2)]).toEqual(['镜一：灯塔', '镜二：雨夜街道'])
  })

  it('已删的旧提示词不复活：owner 现在是空，旧实例里残留的字被清掉', () => {
    const editor = rebuilt('已经删掉的旧提示词')
    expect(hydrate(editor, '')).toBe(true)
    expect(textOf(editor)).toBe('')
  })

  it('文档已经等于 value 时什么都不写（首次挂载、没变的重建都不多一个事务）', () => {
    const editor = rebuilt('灯塔')
    expect(hydrate(editor, '灯塔')).toBe(false)
    expect(editor.dispatched).toHaveLength(0)
  })

  it('灌入 + 重开账之后：回流的同值是回声、真正的外部改写仍写进来', () => {
    const sync = createControlledEditorSync('')
    sync.emit('敲过的字')
    const editor = rebuilt('')
    hydrate(editor, '敲过的字')
    sync.reset(textOf(editor))
    expect(sync.receive('敲过的字')).toBe(false)
    expect(sync.receive('Agent 改写后的字')).toBe(true)
  })
})

describe('重挂后撤销历史不多出空的那一步', () => {
  it('灌入后接回旧历史：最后一份就是 value，不再把空文档补成最后一步', () => {
    const snapshots = [promptToContent(''), promptToContent('灯塔')]
    const editor = rebuilt('')
    hydrate(editor, '灯塔')
    replayHistory(() => editor.state, (tr) => editor.view.dispatch(tr), snapshots)
    expect(textOf(editor)).toBe('灯塔')
    // 只有当初那一次敲字这一步；没有「从灯塔退回空、又从空补回」的多余步骤。
    expect(undoDepth(editor.state)).toBe(1)
    expect(historySnapshots(editor.state).map((doc) => contentToPrompt(doc))).toEqual(['', '灯塔'])
  })

  it('反例：没灌入就接历史（挂上的文档是空）会把空固化成最后一步——这就是修之前的现场', () => {
    const editor = rebuilt('')
    replayHistory(() => editor.state, (tr) => editor.view.dispatch(tr), [promptToContent(''), promptToContent('灯塔')])
    expect(textOf(editor)).toBe('')
  })
})
