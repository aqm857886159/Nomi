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
import { NomiEntryButton } from './ShellNomiEntry'
import { useNomiEntry } from './useNomiEntry'

export type OldForm = 'ball' | 'float' | 'dock'
/** 外壳此刻画出来的形态（收起 = 面板收进顶栏 Nomi 入口）。旧存档里的 'ball' 只在 OldForm 里出现。 */
export type Shown = 'collapsed' | 'float' | 'dock'
export const PROBE_SURFACES: AgentFormSurface[] = ['creation', 'storyboard', 'generation', 'preview']

type ProbeNode = TestHostNode & {
  type: string
  props: Record<string, unknown>
  nodeType: 1
  ownerDocument: Document
  clientWidth: number
  clientHeight: number
  /** 量自己（画布那一格里的东西读它；探针里没有排版，量出来是 0，那些 hook 自己就跳过摆放）。 */
  getBoundingClientRect: () => { left: number; top: number; right: number; bottom: number; width: number; height: number }
  addEventListener(): void
  removeEventListener(): void
  click(): void
  closest: () => null
  querySelector: () => null
  querySelectorAll: () => []
}

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

/** 顶栏最右那颗 Nomi 入口：真 hook（useNomiEntry）+ 真按钮，和顶栏里挂的是同一对（ShellTopBar 的 NomiEntrySlot 只多包一层悬停提示）。 */
function ProbeNomiEntry({ surface }: { surface: AgentFormSurface }): React.JSX.Element {
  const entry = useNomiEntry(surface, true)
  return React.createElement(NomiEntryButton, {
    look: entry.look, pendingCount: entry.pendingCount, capsuleText: entry.capsuleText, open: entry.open, label: entry.label, onClick: entry.toggle,
  })
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
 * 返回的每个动作都走真实入口：顶栏 Nomi 入口的 onClick、形态切换的按钮、「⋯」菜单项、window 上的 keydown、matchMedia 的 change。
 */
export async function bootProbe(input: {
  forms?: Partial<Record<AgentFormSurface, OldForm>>
  narrow: boolean
  page: AgentFormSurface
  agent?: React.ReactElement
  blob?: string
  /** 和外壳一起挂在这一页上的真组件（比如生成页画布那一格的「回到对话」）。 */
  alongside?: (page: AgentFormSurface) => React.ReactElement | null
}) {
  probeStorage.clear()
  probeStorage.set(AGENT_FORM_STORAGE_KEY, input.blob ?? oldBlob(input.forms ?? {}))
  setProbeNarrow(input.narrow, { silent: true })
  await resetFromDisk()
  useWorkbenchStore.setState({ workspaceMode: input.page === 'creation' ? 'creation' : input.page, agentRecallNonce: 0, projectAgentDockCollapsed: false } as never)

  let created: ProbeNode[] = []
  let page = input.page
  const renderer = createReactTestRenderer<ProbeNode>({
    createInstance: (type, props) => {
      const node: ProbeNode = {
        type, props, nodeType: 1, ownerDocument: document, clientWidth: 1200, clientHeight: 800,
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
        addEventListener() {}, removeEventListener() {},
        click() { if (!this.props.disabled && typeof this.props.onClick === 'function') this.props.onClick() },
        closest: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
      }
      created.push(node)
      return node
    },
  })
  const render = () => {
    renderer.render(React.createElement(React.Fragment, null,
      React.createElement(ProbeNomiEntry, { surface: page }),
      React.createElement(ShellAgentHost, { surface: page, dockTarget: null, agent: input.agent ?? React.createElement(AgentProbePanel) }),
      input.alongside?.(page) ?? null))
    renderer.flushPassiveEffects()
  }
  render()
  // 浮窗要量到内容区才画：第一次渲染量到大小之后再来一拍。
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
    /** 点顶栏 Nomi 入口（一直在）：收着 = 打开到这一页上次的摆法，开着 = 收起。 */
    clickEntry(): void {
      click(latest((props) => 'data-shell-nomi-entry' in props), '顶栏 Nomi 入口')
    },
    /** 面板头部形态切换里点一项（收起 / 浮窗 / 停靠）；面板不在（此刻收着）返回 false。 */
    choose(to: 'collapse' | 'float' | 'dock'): boolean {
      if (shown() === 'collapsed') return false
      click(latest((props) => props['data-agent-form-to'] === to), `形态切换「${to}」`)
      return true
    },
    /** 头部窄时「⋯」菜单里的形态项。 */
    more(form: 'collapse' | 'float' | 'dock'): boolean {
      if (shown() === 'collapsed') return false
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
    /** 点最近画出来的、满足条件的那个元素（`alongside` 挂上来的真组件里的按钮）。 */
    clickWhere(match: (props: Record<string, unknown>) => boolean, what: string) {
      click(latest(match), what)
    },
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
