import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// 菜单打开时「作用在哪一行」看得见，且菜单项的语义色压得住调用方的皮肤类——在真浏览器 + 真编译 CSS 里走
// （docs/engineering/direction-checks/2026-11-23-workbench-menu-trigger-contract.md）。
//
// 为什么不用 contextMenusMigration.characterization 那套假 DOM：那里没有 CSS 引擎、没有真实焦点 / 悬停，
// compare-01（焦点进菜单后行丢 :focus-within 灰底）和 53750a05b（itemClassName 压掉危险红）都抓不出来。
// 这里挂的是**生产组件本身**（原稿列表、分类树、导演台时间轴），注入 `scripts/build-tailwind.mjs` 编出的整站样式表，
// 右键之后先把鼠标挪开（排除 :hover 冒充打开态），再读真实 computed backgroundColor。

const ROOT = process.cwd()
const CSS_FILE = path.join(ROOT, 'public', 'tailwind.generated.css')

async function bundle(contents: string): Promise<string> {
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const result = await build({
    stdin: { contents, resolveDir: ROOT, loader: 'tsx' },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl', '.woff2': 'dataurl', '.glb': 'dataurl', '.hdr': 'dataurl', '.wasm': 'dataurl' },
    logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"http://localhost/"', 'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"test"}', global: 'globalThis' },
  })
  return result.outputFiles[0].text
}

// `menu` 用命名空间导入：换结构前 WorkbenchContextMenu 还不存在，这里拿到 undefined，宿主照样能跑、断言照样红在「行没有打开态」上，
// 而不是红在编译期。
const HOST = `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import i18n from './src/i18n';
import * as menu from './src/design/menu';
import DocumentListSidebar from './src/workbench/creation/DocumentListSidebar';
import CategoryTree from './src/workbench/sidebar/CategoryTree';
import { useWorkbenchStore } from './src/workbench/workbenchStore';
import { useGenerationCanvasStore } from './src/workbench/generationCanvas/store/generationCanvasStore';
import { BUILTIN_CATEGORIES } from './src/workbench/project/projectCategories';
import { DirectorStoreContext } from './src/workbench/generationCanvas/nodes/director/DirectorEditorContext';
import { CameraRecorderContext } from './src/workbench/generationCanvas/nodes/director/CameraRecorderContext';
import { createDirectorStore } from './src/workbench/generationCanvas/nodes/director/model/directorStore';
import { DirectorTimeline } from './src/workbench/generationCanvas/nodes/director/timeline/DirectorTimeline';
import { GenerationPageLayer } from './src/workbench/generation/pageLayer';
import { GenerationPageLayerProvider } from './src/workbench/generation/pageLayerContext';
import { useGenerationCanvasReactFlowPointer } from './src/workbench/generationCanvas/reactFlow/useGenerationCanvasReactFlowPointer';
import { useCanvasContextNodeMenu } from './src/workbench/generationCanvas/components/useCanvasContextNodeMenu';

void i18n.changeLanguage('zh-CN');
useWorkbenchStore.setState({
  workbenchDocuments: [
    { id: 'doc-1', title: '第一场剧本', content: '', updatedAt: 100 },
    { id: 'doc-2', title: '第二场剧本', content: '', updatedAt: 100 },
  ],
  activeDocumentId: 'doc-1',
  activeStoryboardId: 'design-active',
  storyboardDesignsByDocumentId: {
    'doc-1': [
      { id: 'design-idle', documentId: 'doc-1', title: '方案 A', shots: [], committed: false, sourceDocumentUpdatedAt: 100, updatedAt: 100 },
      { id: 'design-active', documentId: 'doc-1', title: '方案 B', shots: [], committed: false, sourceDocumentUpdatedAt: 100, updatedAt: 100 },
    ],
  },
  categories: [...BUILTIN_CATEGORIES],
  activeCategoryId: 'shots',
});
useGenerationCanvasStore.setState({
  nodes: [
    { id: 'node-idle', kind: 'image', categoryId: 'shots', title: '开场远景', position: { x: 0, y: 0 }, meta: {} },
    { id: 'node-picked', kind: 'image', categoryId: 'shots', title: '已选中节点', position: { x: 0, y: 0 }, meta: {} },
    { id: 'node-member', kind: 'image', categoryId: 'shots', title: '组内节点', position: { x: 0, y: 0 }, meta: {} },
  ],
  groups: [{ id: 'group-1', categoryId: 'shots', name: '序幕分组', nodeIds: ['node-member'] }],
  selectedNodeIds: ['node-picked'],
});

const director = createDirectorStore({ defaultSceneName: 'Scene 1' });
const zero = { x: 0, y: 0, z: 0 };
const characterId = director.getState().addObject({ type: 'character', name: '角色 1', position: zero, rotation: zero, scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false });
director.getState().addEntityToTimeline(characterId);
director.getState().select({ objectId: null, cameraId: null, lightId: null, multiObjectIds: [] });

const nop = () => undefined;
const recorder = { active: false, start: nop, stop: nop, cancel: nop, ghostRef: { current: null } };
const SKIN = 'text-nomi-ink-80';
const cascadeItems = [
  { id: 'plain', label: '普通项', onSelect: nop },
  { id: 'danger', label: '危险项', danger: true, onSelect: nop },
  { id: 'disabled', label: '禁用项', disabled: true, onSelect: nop },
  { id: 'disabled-danger', label: '禁用危险项', danger: true, disabled: true, onSelect: nop },
];

const dummyFlow = { getViewport: () => ({ x: 0, y: 0, zoom: 1 }), setViewport: async () => true };

function PortalStageProbe() {
  const stageRef = React.useRef(null);
  const [portalHost, setPortalHost] = React.useState(null);
  const [, setLiveViewport] = React.useState({ x: 0, y: 0, zoom: 1 });
  const offsetRef = React.useRef({ x: 0, y: 0 });
  const zoomRef = React.useRef(1);
  const [clearedCount, setClearedCount] = React.useState(0);
  const pointer = useGenerationCanvasReactFlowPointer({
    readOnly: false,
    hostRef: stageRef,
    flow: dummyFlow,
    activeCategoryId: 'shots',
    rememberCategoryViewport: nop,
    setLiveViewport,
  });
  const ctxMenu = useCanvasContextNodeMenu({
    readOnly: false,
    stageRef,
    offsetRef,
    zoomRef,
    pendingConnectionSourceId: null,
    clearSelection: () => setClearedCount((n) => n + 1),
    ensureNodeSelected: nop,
  });
  const ContextMenu = menu.WorkbenchContextMenu;
  return (
    <GenerationPageLayerProvider value={{ host: portalHost, active: true }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <div
          id="canvas-stage-probe"
          ref={stageRef}
          data-cleared-count={String(clearedCount)}
          data-canvas-blank-menu={ctxMenu.contextNodeMenu ? 'open' : 'closed'}
          style={{ width: 160, height: 36 }}
          onPointerDownCapture={(event) => {
            if (ctxMenu.prepareContextMenuPointerDown(event)) { event.stopPropagation(); return; }
            pointer.handleCanvasPointerDownCapture(event);
          }}
          onPointerDown={pointer.handleCanvasPointerDown}
          onPointerMove={(event) => { ctxMenu.handleContextMenuPointerMove(event); pointer.handleCanvasPointerMove(event); }}
          onPointerUp={(event) => {
            const suppress = event.button === 2 && pointer.shouldSuppressContextMenu();
            pointer.handleCanvasPointerEnd(event);
            ctxMenu.finishContextMenuPointerUp(event, suppress);
          }}
          onWheelCapture={pointer.handleCanvasWheelCapture}
          onContextMenu={ctxMenu.handleStageContextMenu}
        >
          canvas stage
          <GenerationPageLayer>
            {ContextMenu ? (
              <ContextMenu items={[{ id: 'portal-item', label: '导演台轨道项', onSelect: nop }]} ariaLabel="portal-layer-menu">
                <div id="portal-layer-row" className={menu.WORKBENCH_MENU_TRIGGER_OPEN_CLASS} style={{ width: 180, height: 28 }}>导演台轨道</div>
              </ContextMenu>
            ) : null}
          </GenerationPageLayer>
        </div>
        <div id="page-layer-host" ref={setPortalHost} style={{ position: 'relative', width: 200, height: 36 }} />
      </div>
    </GenerationPageLayerProvider>
  );
}

function Host() {
  const [pointOpen, setPointOpen] = React.useState(false);
  const scopeRef = React.useRef('timeline');
  window.__openPoint = () => setPointOpen(true);
  const ContextMenu = menu.WorkbenchContextMenu;
  return <MantineProvider><div style={{ display: 'grid', gridTemplateColumns: '240px 240px', gap: 8 }}>
    <section id="doc-list" style={{ height: 300, display: 'flex' }}><DocumentListSidebar /></section>
    <section id="category-tree" style={{ height: 300, display: 'flex', flexDirection: 'column' }}><CategoryTree categories={[...BUILTIN_CATEGORIES]} /></section>
  </div>
  <section id="director" style={{ height: 200, width: 900 }}>
    <DirectorStoreContext.Provider value={director}><CameraRecorderContext.Provider value={recorder}><DirectorTimeline collapsed={false} onToggleCollapsed={nop} scopeRef={scopeRef} /></CameraRecorderContext.Provider></DirectorStoreContext.Provider>
  </section>
  <section id="cascade" style={{ display: 'flex', gap: 8 }}>
    <span id="probe-danger" className="text-workbench-danger">probe</span>
    <span id="probe-disabled" className="text-nomi-ink-40">probe</span>
    <span id="probe-skin" className={SKIN}>probe</span>
    {ContextMenu ? <ContextMenu items={cascadeItems} itemClassName={SKIN} ariaLabel="cascade-context"><div id="cascade-row" style={{ width: 160, height: 28 }}>cascade row</div></ContextMenu> : null}
    <menu.WorkbenchMenu open={pointOpen} onOpenChange={setPointOpen} point={{ x: 600, y: 40 }} ariaLabel="cascade-point" itemClassName={SKIN} items={cascadeItems} />
  </section>
  <PortalStageProbe />
  <div id="neutral" style={{ height: 40 }} />
  </MantineProvider>;
}
createRoot(document.getElementById('root')).render(<Host />);
`

let browser: Awaited<ReturnType<typeof chromium.launch>>
let script = ''
let css = ''
const errors: string[] = []

beforeAll(async () => {
  // 每次都现编：样式表是生成物（.gitignore），本次改的类必须真的进了 CSS 才算数。
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-tailwind.mjs')], { cwd: ROOT, encoding: 'utf8' })
  if (built.status !== 0) throw new Error(`build-tailwind 失败：${built.stderr || built.stdout}`)
  css = fs.readFileSync(CSS_FILE, 'utf8')
  script = await bundle(HOST)
  browser = await chromium.launch()
}, 180_000)
afterAll(async () => { await browser?.close() })

async function open(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  errors.length = 0
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setContent('<!doctype html><html data-mantine-color-scheme="light"><head></head><body><main id="root"></main></body></html>')
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: script })
  try {
    await page.waitForSelector('[data-document-row="doc-2"]', { timeout: 15_000 })
    await page.waitForSelector('[data-testid="director-timeline-track"]', { timeout: 15_000 })
  } catch (cause) {
    throw new Error(`宿主没渲染出来：${errors.join(' | ') || String(cause)}`, { cause })
  }
  errors.length = 0
  return page
}

const TRANSPARENT = 'rgba(0, 0, 0, 0)'
const bg = (page: Page, selector: string): Promise<string> => page.$eval(selector, (el) => getComputedStyle(el).backgroundColor)
const state = (page: Page, selector: string): Promise<string | null> => page.$eval(selector, (el) => el.getAttribute('data-state'))
/** 鼠标挪到页面空白处：排除 :hover 冒充「菜单开着」的灰底。 */
const parkMouse = async (page: Page): Promise<void> => { await page.mouse.move(1080, 740); await page.waitForTimeout(120) }
const rightClick = async (page: Page, selector: string): Promise<void> => {
  await page.click(selector, { button: 'right' })
  await page.waitForSelector('[role="menu"]')
  await parkMouse(page)
}
/** 点一处不可聚焦的空白关掉菜单（不让 Esc 的焦点归还把 :focus-within 带回来）。 */
const closeByOutsideClick = async (page: Page): Promise<void> => {
  await page.mouse.click(1080, 740)
  await page.waitForTimeout(200)
  expect(await page.locator('[role="menu"]').count()).toBe(0)
}

describe('① 被右键 / 被点开的那一行在菜单开着时有打开态，关掉后复原', () => {
  const unselectedRows = [
    ['原稿列表：非当前文稿行', '[data-document-row="doc-2"]'],
    ['原稿列表：非当前分镜方案行', '[data-storyboard-row="design-idle"]'],
    ['分类树：非激活分类行', '[data-category-id="cast"]'],
    ['分类树：未选中节点行', '[data-node-id="node-idle"]'],
    ['分类树：子组行', 'button[aria-expanded][title="序幕分组"]'],
    ['导演台：未选中轨道主行', '[data-testid="director-timeline-track"]'],
  ] as const

  it.each(unselectedRows)('%s：右键 → data-state=open + 非透明底；点外关 → closed + 透明', async (_label, selector) => {
    const page = await open()
    expect(await bg(page, selector)).toBe(TRANSPARENT)
    await rightClick(page, selector)
    expect(await state(page, selector)).toBe('open')
    expect(await bg(page, selector)).not.toBe(TRANSPARENT)
    await closeByOutsideClick(page)
    expect(await state(page, selector)).toBe('closed')
    expect(await bg(page, selector)).toBe(TRANSPARENT)
    expect(errors).toEqual([])
    await page.close()
  }, 60_000)

  it('导演台：泳道行（空白处）右键 → 该泳道行 data-state=open + 非透明底', async () => {
    const page = await open()
    const lane = '[data-testid="director-timeline-lanes"] > div'
    const laneBox = (await page.locator(lane).first().boundingBox())!
    // 泳道比视口宽（60s 全长）：点片段条右边、视口内的空白处。
    await page.mouse.click(laneBox.x + 420, laneBox.y + laneBox.height / 2, { button: 'right' })
    await page.waitForSelector('[role="menu"]')
    await parkMouse(page)
    expect(await page.locator(lane).first().getAttribute('data-state')).toBe('open')
    expect(await page.locator(lane).first().evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(TRANSPARENT)
    await closeByOutsideClick(page)
    expect(await page.locator(lane).first().getAttribute('data-state')).toBe('closed')
    expect(await page.locator(lane).first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(TRANSPARENT)
    await page.close()
  }, 60_000)

  it.each([
    ['原稿列表：当前分镜方案行（accent-soft）', '[data-storyboard-row="design-active"]'],
    ['分类树：已选中节点行（ink-10）', '[data-node-id="node-picked"]'],
    ['分类树：激活分类行（ink-10）', '[data-category-id="shots"]'],
  ] as const)('%s：右键前后底色完全一致（打开态不盖掉选中态）', async (_label, selector) => {
    const page = await open()
    const before = await bg(page, selector)
    expect(before).not.toBe(TRANSPARENT)
    await rightClick(page, selector)
    expect(await state(page, selector)).toBe('open')
    expect(await bg(page, selector)).toBe(before)
    await page.close()
  }, 60_000)

  it('导演台轨道「+」：左键点开 → 按钮 data-state=open + aria-expanded=true，菜单不压按钮；关后复原', async () => {
    const page = await open()
    const plus = '[data-testid="director-timeline-track"] button[aria-label="添加动作 / 骨骼 / 视线片段"]'
    await page.hover('[data-testid="director-timeline-track"]')
    await page.click(plus)
    await page.waitForSelector('[role="menu"][data-nomi-escape-layer="director-timeline-menu"]')
    await parkMouse(page)
    expect(await state(page, plus)).toBe('open')
    expect(await page.$eval(plus, (el) => el.getAttribute('aria-expanded'))).toBe('true')
    const button = (await page.locator(plus).boundingBox())!
    const panel = (await page.locator('[role="menu"]').boundingBox())!
    const overlaps = button.x < panel.x + panel.width && panel.x < button.x + button.width && button.y < panel.y + panel.height && panel.y < button.y + button.height
    expect(overlaps).toBe(false)
    expect(await bg(page, plus)).not.toBe(TRANSPARENT)
    // 操作组在菜单开着时不随鼠标离开变半透明（has-[[data-state=open]]）。
    expect(await page.$eval(plus, (el) => getComputedStyle(el.parentElement!).opacity)).toBe('1')
    await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    expect(await state(page, plus)).toBe('closed')
    expect(await page.$eval(plus, (el) => el.getAttribute('aria-expanded'))).toBe('false')
    expect(errors).toEqual([])
    await page.close()
  }, 60_000)
})

describe('③ 调用方 itemClassName 传常规文字色，危险项仍红、禁用项仍灰（真 CSS 级联）', () => {
  const readColors = (page: Page) => page.evaluate(() => {
    const color = (sel: string) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).color : null }
    return {
      danger: color('#probe-danger'), disabled: color('#probe-disabled'), skin: color('#probe-skin'),
      items: Object.fromEntries([...document.querySelectorAll('[role="menu"] [data-menu-item]')].map((el) => [el.getAttribute('data-menu-item'), getComputedStyle(el).color])),
    }
  })
  const expectSemanticColors = (colors: Awaited<ReturnType<typeof readColors>>) => {
    expect(colors.danger).not.toBe(colors.skin)
    expect(colors.items.plain).toBe(colors.skin)
    expect(colors.items.danger).toBe(colors.danger)
    expect(colors.items.disabled).toBe(colors.disabled)
    expect(colors.items['disabled-danger']).toBe(colors.disabled)
  }

  it('点位入口（WorkbenchMenu point）', async () => {
    const page = await open()
    await page.evaluate(() => (window as unknown as { __openPoint: () => void }).__openPoint())
    await page.waitForSelector('[role="menu"][aria-label="cascade-point"]')
    expectSemanticColors(await readColors(page))
    await page.close()
  }, 60_000)

  it('右键入口（WorkbenchContextMenu）', async () => {
    const page = await open()
    await rightClick(page, '#cascade-row')
    expect(await page.locator('[role="menu"][aria-label="cascade-context"]').count()).toBe(1)
    expectSemanticColors(await readColors(page))
    await page.close()
  }, 60_000)
})

describe('④ 页内全屏层（GenerationPageLayer createPortal）不被底下画布捕获期抢走右键', () => {
  it('右键落在 GenerationPageLayer 内的触发行：内层菜单打开且行高亮，画布不进平移、不清选、不弹空白菜单', async () => {
    const page = await open()
    await page.click('#portal-layer-row', { button: 'right' })
    await page.waitForSelector('[role="menu"][aria-label="portal-layer-menu"]', { timeout: 4000 })
    await parkMouse(page)
    expect(await state(page, '#portal-layer-row')).toBe('open')
    expect(await bg(page, '#portal-layer-row')).not.toBe(TRANSPARENT)
    expect(await page.$eval('#canvas-stage-probe', (el) => el.getAttribute('data-panning'))).toBeNull()
    expect(await page.$eval('#canvas-stage-probe', (el) => el.getAttribute('data-cleared-count'))).toBe('0')
    expect(await page.$eval('#canvas-stage-probe', (el) => el.getAttribute('data-canvas-blank-menu'))).toBe('closed')
    await closeByOutsideClick(page)
    expect(await state(page, '#portal-layer-row')).toBe('closed')
    expect(errors).toEqual([])
    await page.close()
  }, 60_000)
})
