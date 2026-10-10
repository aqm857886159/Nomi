import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 功能普查 F1–F19（docs/plan/2026-10-10-group-header-board-parity.md）：框外标签改框内后，每一条功能都有去处。
// 每条断言都指向现役代码里真实存在的去处；删掉的东西断言它确实不在了（删干净，P1）。
const here = path.dirname(fileURLToPath(import.meta.url))
const read = (name: string) => fs.readFileSync(path.join(here, name), 'utf8')
const header = read('GroupFrameHeader.tsx')
const frame = read('GroupFrame.tsx')
const toolbar = read('CanvasGroupToolbar.tsx')
const menu = read('FrameContextMenu.tsx')
const actions = read('useCanvasFrameActions.ts')
const wiring = fs.readFileSync(path.join(here, '../reactFlow/GenerationCanvasReactFlow.tsx'), 'utf8')

// 普查清单：每一行是一条功能去处断言（F1–F19 对应功能普查表，见 docs/plan/2026-10-10-group-header-board-parity.md）。
// 加一条功能就加一行；删一条功能就删一行并断言去处仍在。
const CENSUS: ReadonlyArray<readonly [string, () => void]> = [
  ['F1 堆叠图标（框外标签）已删', () => {
      expect(header).not.toContain('IconStack2')
  }],
  ['F2 标题前色点已删；当前色在工具条颜色按钮上显示', () => {
      expect(header).not.toContain('data-group-color-dot')
      expect(toolbar).toContain('group-color')
      expect(toolbar).toContain('colorClass.dot')
  }],
  ['F3 组名在框内左上（data-frame-title）', () => {
      expect(header).toContain('data-frame-title="true"')
      expect(read('groupFrameLabel.ts')).toContain('storyboardPrefix')
  }],
  ['F4 双击组名改名', () => {
      expect(header).toContain('onDoubleClick={beginEditing}')
  }],
  ['F5 说明字段并入编辑态（菜单「编辑」同时开组名与说明输入框）', () => {
      expect(header).toContain('data-field="description"')
      expect(header).toContain('data-field="name"')
      expect(menu).toContain("'edit'")
  }],
  ['F6 计数肉眼可见（不再 sr-only）', () => {
      expect(header).toContain('data-frame-count="true"')
      expect(header).not.toContain('sr-only')
  }],
  ['F7 拖动预览计数「3 → 2」在框内显示（countPreview）', () => {
      expect(read('groupFrameLabel.ts')).toContain("'generationCommon.canvas.group.countPreview'")
      expect(header).toContain('groupFrameLabel(t, { name, storyboard, memberCount, previewCount })')
  }],
  ['F8 框头折叠钮已删；折叠在右键菜单「折叠成卡」', () => {
      expect(header).not.toContain('collapseNamed')
      expect(header).not.toContain('onCollapse')
      expect(menu).toContain("'collapse'")
  }],
  ['F9 框头 ⋯ 按钮已删；工具条末尾「⋯」打开同一份菜单', () => {
      expect(header).not.toContain('data-frame-more')
      expect(header).not.toContain('onOpenMenu')
      expect(toolbar).toContain('IconDots')
      expect(toolbar).toContain('onOpenMenu({ x: rect?.right')
      expect(wiring).toContain('openFrameMenu: frameActions.openFrameMenu')
  }],
  ['F10 菜单「编辑」（改名 / 说明）在右键 / 工具条 ⋯ 菜单里', () => {
      expect(menu).toContain("action: 'edit'")
  }],
  ['F11 菜单「生成整框」与框头「生成全部」同一执行口（runFrameAction generate）', () => {
      expect(header).toContain('onGenerate')
      expect(frame).toContain('onGenerate={frame?.onGenerate}')
      expect(wiring).toContain("runFrameAction(groupId, 'generate')")
      expect(toolbar).toContain('onGenerate')
  }],
  ['F12 「整组进时间轴」在工具条（onSendToTimeline）', () => {
      expect(toolbar).toContain('onSendToTimeline')
  }],
  ['F13 「折叠」在右键菜单（menu collapse）', () => {
      expect(menu).toContain("action: 'collapse'")
  }],
  ['F14 「解散」在工具条（onDissolve）', () => {
      expect(toolbar).toContain('onDissolve')
  }],
  ['F15 「删除」在右键菜单，并与选中框按 Delete 同一条（deleteGroup）', () => {
      expect(menu).toContain("action: 'delete'")
      expect(actions).toContain("action === 'delete'")
      expect(actions).toContain('deleteGroup(groupId, true)')
  }],
  ['F16 拖动整个组的把手仍在框体上（data-group-drag-surface + onPointerDown）', () => {
      expect(frame).toContain('data-group-drag-surface="true"')
      expect(frame).toContain('onPointerDown(event, box.group.id)')
  }],
  ['F17 标题区不参与拖动（claimPointer 吃掉 pointerdown，双击才进编辑态）', () => {
      expect(header).toContain('onPointerDown={claimPointer}')
  }],
  ['F18 有线待连时头部只是装饰（connectable）', () => {
      expect(header).toContain('connectable')
      expect(frame).toContain('connectable')
  }],
  ['F19 「生成全部」是新入口，走同一执行口，不另开口', () => {
      expect(header).toContain('data-frame-generate-all="true"')
      expect(header).toContain('disabled={memberCount === 0}')
      expect(wiring).toContain("runFrameAction(groupId, 'generate')")
  }],
]

describe('group frame feature census F1–F19 (10-10)', () => {
  it.each(CENSUS)('%s', (_title, check) => {
    check()
  })
})
