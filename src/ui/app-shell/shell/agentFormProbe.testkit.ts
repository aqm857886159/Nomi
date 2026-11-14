// 常驻探针（真窗探针表缩成的单测）：挂真的 ShellAgentHost，点真按钮、按真快捷键、拨真的窗宽查询、切页 = 换 surface 重渲，
// 读的是外壳自己画出来的形态（层上的 data-agent-form）。不在 store 层重放调用方写法——调用方怎么改，这里都量得到。
//
// 用法：测试文件先 `import './agentFormProbe.globals'`，再 vi.mock 拖动库 / 门户 / 菜单（见 ShellAgentHost.formProbe.test.tsx），
// 然后用这里的 `bootProbe`。存档用**旧版真实落盘的形状**种进去（`nomi:shell-agent-form:v1`、每页一个三值 form），
// 所以同一张表在改结构前后都能跑：改前直接读，改后经迁移读。
import React from 'react'
import { createReactTestRenderer, type TestHostNode } from '../../../workbench/ai/v4/testReactRenderer'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { AgentPanelHeaderSlotContext } from './agentPanelHeaderSlot'
import { probeKeyListeners, probeStorage, setProbeNarrow } from './agentFormProbe.globals'
import { AGENT_FORM_STORAGE_KEY, useAgentFormStore, type AgentFormSurface } from './agentFormStore'
import { useAgentFormViewStore } from './agentFormViewStore'
import { ShellAgentHost } from './ShellAgentHost'

export type OldForm = 'ball' | 'float' | 'dock'
export type Shown = 'ball' | 'float' | 'dock'
export const PROBE_SURFACES: AgentFormSurface[] = ['creation', 'storyboard', 'generation', 'preview']

type ProbeNode = TestHostNode & { type: string; props: Record<string, unknown>; nodeType: 1; clientWidth: number; clientHeight: number }

/** 面板替身：只把外壳插进头部的东西摆出来（形态切换 + 「⋯」菜单项），面板别的部分和这张表无关。 */
function AgentProbePanel(): React.JSX.Element | null {
  const slot = React.useContext(AgentPanelHeaderSlotContext)
  if (!slot) return null
  return React.createElement('div', { 'data-probe-panel': true },
    slot.actions,
    ...(slot.menuItems ?? []).map((item) => React.createElement('button', {
      key: item.id, type: 'button', 'data-probe-more-item': item.id, disabled: item.disabled, onClick: item.onSelect,
    })))
}

/** 旧版（0.24.x 到改结构之前）落盘的样子：每页 { form, float, ball }，persist version 1。 */
export function oldBlob(forms: Partial<Record<AgentFormSurface, OldForm>>, extra: Partial<Record<AgentFormSurface, { float?: unknown; ball?: unknown }>> = {}): string {
  const defaults: Record<AgentFormSurface, OldForm> = { creation: 'dock', storyboard: 'dock', generation: 'ball', preview: 'dock' }
  const bySurface = Object.fromEntries(PROBE_SURFACES.map((surface) => [surface, {
    form: forms[surface] ?? defaults[surface],
    float: extra[surface]?.float ?? null,
    ball: extra[surface]?.ball ?? null,
  }]))
  return JSON.stringify({ state: { bySurface }, version: 1 })
}

/** 回到「刚启动」：内存里的形态全回初值，再从磁盘那份读。不动磁盘。 */
async function resetFromDisk(): Promise<void> {
  const disk = probeStorage.get(AGENT_FORM_STORAGE_KEY) ?? null
  useAgentFormStore.setState(useAgentFormStore.getInitialState(), true)
  useAgentFormViewStore.setState(useAgentFormViewStore.getInitialState(), true)
  if (disk === null) probeStorage.delete(AGENT_FORM_STORAGE_KEY)
  else probeStorage.set(AGENT_FORM_STORAGE_KEY, disk)
  await useAgentFormStore.persist.rehydrate()
}

export type Probe = Awaited<ReturnType<typeof bootProbe>>

/**
 * 起一个外壳：磁盘上是 `forms` 那份旧存档，窗口 `narrow`，停在 `page`。
 * 返回的每个动作都走真实入口：小球的 onClick、形态切换的按钮、「⋯」菜单项、小球右键菜单、window 上的 keydown、matchMedia 的 change。
 */
export async function bootProbe(input: { forms?: Partial<Record<AgentFormSurface, OldForm>>; narrow: boolean; page: AgentFormSurface; blob?: string }) {
  probeStorage.clear()
  probeStorage.set(AGENT_FORM_STORAGE_KEY, input.blob ?? oldBlob(input.forms ?? {}))
  setProbeNarrow(input.narrow, { silent: true })
  await resetFromDisk()
  useWorkbenchStore.setState({ workspaceMode: input.page === 'creation' ? 'creation' : input.page, agentRecallNonce: 0, projectAgentDockCollapsed: false } as never)

  let created: ProbeNode[] = []
  let page = input.page
  const renderer = createReactTestRenderer<ProbeNode>({
    createInstance: (type, props) => {
      const node: ProbeNode = { type, props, nodeType: 1, clientWidth: 1200, clientHeight: 800 }
      created.push(node)
      return node
    },
  })
  const render = () => {
    renderer.render(React.createElement(ShellAgentHost, { surface: page, dockTarget: null, agent: React.createElement(AgentProbePanel) }))
    renderer.flushPassiveEffects()
  }
  render()
  // 小球 / 浮窗要量到内容区才画：第一次渲染量到大小之后再来一拍。
  render()

  const latest = (match: (props: Record<string, unknown>) => boolean): ProbeNode | undefined => created.filter((node) => match(node.props)).at(-1)
  const click = (node: ProbeNode | undefined, what: string) => {
    if (!node) throw new Error(`探针：找不到 ${what}`)
    const onClick = node.props.onClick as ((event: unknown) => void) | undefined
    if (!onClick) throw new Error(`探针：${what} 没有 onClick`)
    onClick({ preventDefault: () => undefined, stopPropagation: () => undefined })
    renderer.flushPassiveEffects()
    render()
  }
  const shown = (): Shown => latest((props) => 'data-shell-agent-layer' in props)?.props['data-agent-form'] as Shown

  return {
    /** 外壳此刻画出来的形态。 */
    shown,
    get page() { return page },
    /** 切页（工作区换 surface，外壳是同一个、只换页）。 */
    goto(next: AgentFormSurface) {
      page = next
      render()
      render()
    },
    /** 点小球（小球在才点得到；不在返回 false）。 */
    clickBall(): boolean {
      if (shown() !== 'ball') return false
      click(latest((props) => 'data-agent-ball' in props), '小球')
      return true
    },
    /** 小球右键菜单里点一项（'float' | 'dock'）；小球不在返回 false。 */
    ballMenu(id: 'float' | 'dock'): boolean {
      if (shown() !== 'ball') return false
      const ball = latest((props) => 'data-agent-ball' in props)
      const onContextMenu = ball?.props.onContextMenu as ((event: unknown) => void) | undefined
      if (!onContextMenu) throw new Error('探针：小球没有右键菜单')
      onContextMenu({ preventDefault: () => undefined, clientX: 10, clientY: 10 })
      render()
      click(latest((props) => props['data-probe-menu-item'] === id), `小球菜单「${id}」`)
      return true
    },
    /** 面板头部形态切换里点一项；面板不在（此刻是小球）返回 false。 */
    choose(form: OldForm): boolean {
      if (shown() === 'ball') return false
      click(latest((props) => props['data-agent-form-to'] === form), `形态切换「${form}」`)
      return true
    },
    /** 头部窄时「⋯」菜单里的形态项。 */
    more(form: OldForm): boolean {
      if (shown() === 'ball') return false
      click(latest((props) => props['data-probe-more-item'] === `form-${form}`), `「⋯」里的「${form}」`)
      return true
    },
    /** ⌘J / ⌘\。 */
    key(key: 'j' | '\\') {
      const event = { key, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, preventDefault: () => undefined }
      for (const listener of [...probeKeyListeners]) listener(event)
      renderer.flushPassiveEffects()
      render()
    },
    /** 别处叫回（任务中心「定位到制作」、分镜「交给 Agent」：把 Nomi 栏显示态翻成展开）。 */
    recall() {
      useWorkbenchStore.getState().setProjectAgentDockCollapsed(false)
      renderer.flushPassiveEffects()
      render()
    },
    /** 拉宽 / 拉窄（跨阈值）。 */
    resize(narrow: boolean) {
      setProbeNarrow(narrow)
      renderer.flushPassiveEffects()
      render()
    },
    /** 关掉应用再开（同一窗宽）：只剩磁盘那份。 */
    async relaunch() {
      renderer.close()
      await resetFromDisk()
      created = []
      render()
      render()
    },
    /** 磁盘上那一份（原样字符串）。 */
    disk: (): string | null => probeStorage.get(AGENT_FORM_STORAGE_KEY) ?? null,
    /** 某个非 React 处要同步一拍（store 被直接改过之后）。 */
    settle() {
      renderer.flushPassiveEffects()
      render()
    },
    close() {
      renderer.close()
    },
  }
}
