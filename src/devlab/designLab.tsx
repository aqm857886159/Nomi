// 设计实验室（Design Lab）—— Agent 面板的可拍板真相源。
//
// 2026-09-06 用户拍板：**以后 UI 交付的定义 = 「实验室截图拍板 + 视觉基线绿」**，
// 不再靠手写 HTML 样张与人眼对比。手写样张的问题是结构性的：样张是 HTML、实现是 React，
// 两套代码描述同一个东西，中间靠人脑翻译，漂移必然发生。实验室把这一层删掉——
// 屏幕上那一格就是**现役 React 组件**渲染的，喂它固定夹具数据而已。
//
// 怎么开：
//   pnpm run dev:renderer  →  http://127.0.0.1:5173/design-lab.html?screen=<屏>&state=<id>
//   接触表（该屏所有状态平铺一图，拍板用）：        design-lab.html?screen=<屏>&contact=1
//   单格无 chrome（接触表 iframe / 视觉基线用）：    design-lab.html?screen=<屏>&state=<id>&frame=1
// 屏在 `designLab/labScreens.ts` 注册（agent-panel / editing / storyboard）。
//
// 生产包为什么进不来：`vite build` 只吃 `index.html`（vite.config.ts 没有覆盖 rollup input），
// `design-lab.html` 是另一个根入口，**根本不参与打包**——不是运行时判旗、不是死代码分支，
// 是这段代码物理上不在产物里（同 `pose-lab.html` / `staging-lab.html` 的既有做法）。
// `scripts/check-design-lab.mjs` 把这条守住：一旦有人把 lab 入口接进 index.html 的模块图，当场红。
//
// 不接 Host、不发网络：面板数据来自 `agentPanelFixtures.ts` 灌进 store，
// Host IPC / 模型目录 / 技能列表在无桥环境下各自 catch 成空，面板照常渲染。
import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/fraunces/wght.css'
import { NomiAppProviders } from '../NomiAppProviders'
import { NomiColorSchemeProvider } from '../theme/NomiColorSchemeProvider'
import { persistColorScheme, primeNomiColorScheme } from '../theme/colorScheme'
import { findLabScreen, findLabState, LAB_SCREENS } from './designLab/labScreens'
import type { LabScreen, LabState } from './designLab/labScreen'

const params = new URL(window.location.href).searchParams
const screen = findLabScreen(params.get('screen'))
const stateId = params.get('state')
const contactMode = params.get('contact') === '1'
const frameMode = params.get('frame') === '1'
const forcedScheme = params.get('scheme')

const COVERAGE_TONE: Record<LabState['coverage'], string> = {
  shell: '#2f7d4f',
  'component-only': '#9a6a3c',
  missing: '#b23c3c',
  retired: '#6b6b6b',
}

const COVERAGE_TEXT: Record<LabState['coverage'], string> = {
  shell: '整条通',
  'component-only': '只有组件',
  missing: '没实现',
  retired: '已取消',
}

function labUrl(next: Record<string, string | null>): string {
  const url = new URL(window.location.href)
  for (const [key, value] of Object.entries(next)) {
    if (value === null) url.searchParams.delete(key)
    else url.searchParams.set(key, value)
  }
  return `${url.pathname}${url.search}`
}

/** 单格：只有舞台，没有任何实验室自己的 chrome——视觉基线截的就是这一格。 */
function Cell({ state }: { state: LabState }): JSX.Element {
  return (
    <div data-design-lab-shot={state.id} style={{ display: 'inline-block' }}>
      {state.render()}
    </div>
  )
}

function ContactSheet({ screen: sheetScreen }: { screen: LabScreen }): JSX.Element {
  const [loaded, setLoaded] = React.useState(0)
  React.useEffect(() => {
    if (loaded >= sheetScreen.states.length) markReady()
  }, [loaded, sheetScreen])
  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ font: '600 15px/1.4 system-ui', margin: '0 0 4px' }}>
        {sheetScreen.label} · 接触表（{sheetScreen.states.length} 个状态）
      </h1>
      <p style={{ font: '12px/1.5 system-ui', color: '#666', margin: '0 0 14px' }}>
        绿=面板整条通 · 棕=组件在但面板走不到 · 红=设计要求但现役没有 · 灰=设计已取消
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${sheetScreen.cell.width + 24}px, 1fr))`,
          gap: 16,
          alignItems: 'start',
        }}
        data-design-lab-contact="true"
      >
        {sheetScreen.states.map((state) => (
          <figure key={state.id} style={{ margin: 0 }}>
            <figcaption style={{ font: '11px/1.4 system-ui', marginBottom: 6 }}>
              <span
                style={{
                  display: 'inline-block',
                  marginRight: 6,
                  padding: '1px 5px',
                  borderRadius: 8,
                  color: '#fff',
                  background: COVERAGE_TONE[state.coverage],
                }}
              >
                {COVERAGE_TEXT[state.coverage]}
              </span>
              <strong>{state.name}</strong>
              <span style={{ color: '#888' }}> · {state.id}</span>
            </figcaption>
            <iframe
              title={state.name}
              src={labUrl({ state: state.id, contact: null, frame: '1' })}
              onLoad={() => setLoaded((value) => value + 1)}
              style={{ width: sheetScreen.cell.width + 4, height: sheetScreen.cell.height, border: '1px solid #ddd', background: '#fff' }}
            />
          </figure>
        ))}
      </div>
    </div>
  )
}

function SingleState({ state }: { state: LabState }): JSX.Element {
  React.useEffect(() => { markReady() }, [])
  if (frameMode) return <Cell state={state} />
  return (
    <div style={{ padding: 16 }}>
      <div style={{ font: '11px/1.5 system-ui', color: '#666', marginBottom: 10, maxWidth: 640 }}>
        <div>
          <strong style={{ font: '600 13px system-ui', color: '#222' }}>{state.name}</strong>
          <span style={{ marginLeft: 8, color: COVERAGE_TONE[state.coverage] }}>
            {COVERAGE_TEXT[state.coverage]}
          </span>
        </div>
        <div>来源：{state.source}</div>
      </div>
      <Cell state={state} />
    </div>
  )
}

function DesignLabApp(): JSX.Element {
  const state = findLabState(screen, stateId) ?? screen.states[0]
  if (frameMode) return <SingleState state={state} />
  return (
    <div style={{ minHeight: '100%' }}>
      <header
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          padding: '8px 16px',
          borderBottom: '1px solid #e2ddd4',
          font: '12px system-ui',
          position: 'sticky',
          top: 0,
          background: '#faf8f4',
          zIndex: 2,
        }}
        data-design-lab-header="true"
      >
        <strong>设计实验室</strong>
        <select
          value={screen.id}
          onChange={(event) => {
            window.location.href = labUrl({ screen: event.currentTarget.value, state: null, contact: null })
          }}
          style={{ font: '12px system-ui', padding: '2px 4px' }}
          aria-label="屏"
        >
          {LAB_SCREENS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          value={contactMode ? '' : state.id}
          onChange={(event) => {
            window.location.href = labUrl({ state: event.currentTarget.value, contact: null })
          }}
          style={{ font: '12px system-ui', padding: '2px 4px' }}
          aria-label="状态"
        >
          {screen.states.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <a href={labUrl({ contact: contactMode ? null : '1', state: null })}>
          {contactMode ? '回到单状态' : '接触表'}
        </a>
        <span style={{ color: '#888' }}>{screen.states.length} 个状态</span>
      </header>
      {contactMode ? <ContactSheet screen={screen} /> : <SingleState state={state} />}
    </div>
  )
}

/**
 * 截图的就绪信号。走查等的是这个旗，不是墙钟——「等 2 秒应该够了」这种写法
 * 单跑绿、并行翻红（R18/`check:test-waits` 拦的正是那一族）。
 * 两帧 rAF 让 React 提交 + 布局都落定后再举旗。
 */
function markReady(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ;(window as unknown as { __designLabReady?: boolean }).__designLabReady = true
    })
  })
}

// 实验室**永远显式钉死**明暗档：App 的默认是「天黑自动暗」（按本地时间），
// 视觉基线要是跟着钟走，同一份代码上午绿、晚上红。默认浅色，`?scheme=dark` 手动看暗色。
persistColorScheme(forcedScheme === 'dark' ? 'dark' : 'light')
primeNomiColorScheme()

// 让走查能从**活页面**读到注册表，而不是只信 `labStates.mjs` 的源码正则。
// 两边对不上 = 解析器漂了，走查当场红——这是那把正则唯一的活性证据。
;(window as unknown as { __designLabStates?: readonly string[] }).__designLabStates =
  screen.states.map((state) => state.id)

const container = document.getElementById('design-lab-root')
if (!container) throw new Error('design lab root missing')
// 刻意不套 StrictMode：它会 mount→cleanup→mount 双跑一遍 effect，把实验室灌进
// projection store 的夹具在第二次挂载前清掉，面板于是渲染成空态——一张骗人的「面板是空的」基线。
// StrictMode 的价值是逼出副作用不纯，那属于生产壳的测试，不属于这台取景台。
createRoot(container).render(
  <NomiColorSchemeProvider>
    <NomiAppProviders>
      <DesignLabApp />
    </NomiAppProviders>
  </NomiColorSchemeProvider>,
)
