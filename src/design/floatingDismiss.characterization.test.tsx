import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// 第⑤刀特征测试（Commit 1 先落盘，在未改生产代码与删掉 outsidePress.ts 之后都用同一套真浏览器契约核对）：
// 1. 画布平移面（d3-zoom 在 mousedown 上 stopImmediatePropagation）与卡片冒泡拦截（pointerdown stopPropagation）外点都能收起；
// 2. 点浮层内部、点触发钮 / 附加边界 ref 不会误关（避免 pointerdown 先关、click 又重新打开的二次翻转）；
// 3. 点浮层之上更高层 Portal 菜单或显式排除的选择器（如提示词提取设置弹窗）不会误关；
// 4. 浮层关闭或未传 onClose 时不挂任何激活态 document 按下监听，外点不触发 onDismiss。

const ROOT = process.cwd()
const CSS_FILE = path.join(ROOT, 'public', 'tailwind.generated.css')

function ensureTailwindCss(): string {
  if (!fs.existsSync(CSS_FILE)) {
    const built = spawnSync(process.execPath, ['scripts/build-tailwind.mjs'], { cwd: ROOT, encoding: 'utf8' })
    if (built.status !== 0) {
      throw new Error(`build-tailwind 失败：${built.stderr || built.stdout}`)
    }
  }
  return fs.readFileSync(CSS_FILE, 'utf8')
}

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
    loader: {
      '.css': 'empty',
      '.svg': 'dataurl',
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.webp': 'dataurl',
      '.woff2': 'dataurl',
      '.glb': 'dataurl',
      '.hdr': 'dataurl',
      '.wasm': 'dataurl',
    },
    logLevel: 'error',
    define: {
      'process.env.NODE_ENV': '"development"',
      'import.meta.url': '"http://localhost/"',
      'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"test"}',
      global: 'globalThis',
    },
  })
  return result.outputFiles[0].text
}

const LISTENER_PROBE_PRELUDE = `
(() => {
  const PRESS_TYPES = new Set(['pointerdown', 'mousedown', 'touchstart', 'click']);
  const active = [];
  const origAdd = Document.prototype.addEventListener;
  const origRemove = Document.prototype.removeEventListener;
  function isCapture(opts) {
    return typeof opts === 'boolean' ? opts : Boolean(opts && opts.capture);
  }
  Document.prototype.addEventListener = function(type, listener, options) {
    if (this === document && PRESS_TYPES.has(type) && listener) {
      const cap = isCapture(options);
      const exists = active.some((e) => e.type === type && e.listener === listener && e.capture === cap);
      if (!exists) active.push({ type, listener, capture: cap });
    }
    return origAdd.call(this, type, listener, options);
  };
  Document.prototype.removeEventListener = function(type, listener, options) {
    if (this === document && PRESS_TYPES.has(type) && listener) {
      const cap = isCapture(options);
      const idx = active.findIndex((e) => e.type === type && e.listener === listener && e.capture === cap);
      if (idx >= 0) active.splice(idx, 1);
    }
    return origRemove.call(this, type, listener, options);
  };
  window.__pressListenerProbe = {
    snapshot: () => active.map((e) => ({ type: e.type, capture: e.capture })),
    count: () => active.length,
  };
})();
`

const HOST = `
import React from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import i18n from './src/i18n';
import { AnchoredPopover } from './src/design';
import EditingLayoutMenu from './src/workbench/preview/EditingLayoutMenu';
import { TaskCenterPanel } from './src/workbench/taskCenter/TaskCenterPanel';
import { NomiBrowserAssetPopover } from './src/ui/browser/popover/NomiBrowserAssetPopover';

void i18n.changeLanguage('zh-CN');

function CanvasSurfaces() {
  const panRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = panRef.current;
    if (!el) return undefined;
    const swallowMouseDown = (event: MouseEvent) => {
      event.stopImmediatePropagation();
    };
    el.addEventListener('mousedown', swallowMouseDown);
    return () => el.removeEventListener('mousedown', swallowMouseDown);
  }, []);
  return (
    <div style={{ display: 'flex', gap: 16, marginTop: 24 }}>
      <div
        ref={panRef}
        data-testid="canvas-pan-surface"
        style={{ width: 220, height: 120, background: '#eef2f6', display: 'grid', placeItems: 'center' }}
      >
        Canvas Pan (d3-zoom mousedown stopImmediatePropagation)
      </div>
      <div
        data-testid="canvas-card-surface"
        onPointerDown={(event) => event.stopPropagation()}
        style={{ width: 220, height: 120, background: '#f8fafc', display: 'grid', placeItems: 'center' }}
      >
        Canvas Card (bubble pointerdown stopPropagation)
      </div>
    </div>
  );
}

type HarnessState = {
  mode: 'idle' | 'anchored' | 'anchored-passive' | 'task-center' | 'editing-layout' | 'browser-asset';
  open: boolean;
  showHigherMenu: boolean;
  showPromptSettingsPortal: boolean;
};

function HarnessApp() {
  const [state, setState] = React.useState<HarnessState>({
    mode: 'idle',
    open: false,
    showHigherMenu: false,
    showPromptSettingsPortal: false,
  });
  const [dismissCount, setDismissCount] = React.useState(0);
  const anchorRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    (window as unknown as Record<string, unknown>).__harness = {
      configure: (next: Partial<HarnessState>, resetDismiss = true) => {
        if (resetDismiss) setDismissCount(0);
        setState((prev) => ({ ...prev, ...next }));
      },
      getDismissCount: () => dismissCount,
    };
  }, [dismissCount]);

  return (
    <MantineProvider>
      <div style={{ padding: 24, minHeight: 720 }}>
        <div data-testid="dismiss-count">{dismissCount}</div>

        {(state.mode === 'anchored' || state.mode === 'anchored-passive') && (
          <div>
            <button
              ref={anchorRef}
              type="button"
              data-testid="anchored-trigger"
              onClick={() => setState((prev) => ({ ...prev, open: !prev.open }))}
              style={{ padding: '6px 12px' }}
            >
              Anchored Trigger
            </button>
            {state.open && (
              <AnchoredPopover
                anchorRef={anchorRef}
                onClose={
                  state.mode === 'anchored-passive'
                    ? undefined
                    : () => {
                        setDismissCount((c) => c + 1);
                        setState((prev) => ({ ...prev, open: false }));
                      }
                }
              >
                <div data-testid="anchored-popover-surface" style={{ padding: 12, width: 200 }}>
                  <button type="button" data-testid="anchored-inside-btn">
                    Inside Popover Action
                  </button>
                </div>
              </AnchoredPopover>
            )}
            {state.open && state.showHigherMenu
              ? createPortal(
                  <div
                    data-radix-popper-content-wrapper=""
                    style={{ position: 'fixed', left: 320, top: 80, zIndex: 9999 }}
                  >
                    <div role="menu" data-testid="higher-radix-menu" style={{ padding: 12, background: '#fff' }}>
                      <button type="button" role="menuitem" data-testid="higher-menu-item">
                        Higher Menu Item
                      </button>
                    </div>
                  </div>,
                  document.body,
                )
              : null}
          </div>
        )}

        {state.mode === 'task-center' && (
          <div>
            <button
              type="button"
              data-task-center-trigger="true"
              data-testid="task-center-trigger"
              onClick={() => setState((prev) => ({ ...prev, open: !prev.open }))}
              style={{ padding: '6px 12px' }}
            >
              Task Center Trigger
            </button>
            <TaskCenterPanel
              opened={state.open}
              onClose={() => {
                setDismissCount((c) => c + 1);
                setState((prev) => ({ ...prev, open: false }));
              }}
              productionRuns={[]}
              exportJobs={[]}
            />
          </div>
        )}

        {state.mode === 'editing-layout' && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <EditingLayoutMenu />
          </div>
        )}

        {state.mode === 'browser-asset' && (
          <div style={{ position: 'relative', width: 640, height: 420 }}>
            <NomiBrowserAssetPopover
              opened={state.open}
              onOpenChange={(nextOpen) => {
                if (!nextOpen) setDismissCount((c) => c + 1);
                setState((prev) => ({ ...prev, open: nextOpen }));
              }}
            />
            {state.showPromptSettingsPortal
              ? createPortal(
                  <div
                    data-nomi-prompt-extraction-settings-dialog="true"
                    data-testid="prompt-settings-portal"
                    style={{ position: 'fixed', left: 680, top: 80, width: 180, height: 90, background: '#fff', zIndex: 9999 }}
                  >
                    Prompt Extraction Settings Portal
                  </div>,
                  document.body,
                )
              : null}
          </div>
        )}

        <CanvasSurfaces />
      </div>
    </MantineProvider>
  );
}

createRoot(document.getElementById('root')!).render(<HarnessApp />);
`

let browser: Browser
let page: Page
let baselineListeners = 0

async function configureHarness(
  next: {
    mode: 'idle' | 'anchored' | 'anchored-passive' | 'task-center' | 'editing-layout' | 'browser-asset'
    open: boolean
    showHigherMenu?: boolean
    showPromptSettingsPortal?: boolean
  },
): Promise<void> {
  await page.evaluate((cfg) => {
    const h = (window as unknown as { __harness: { configure: (c: unknown, r?: boolean) => void } }).__harness
    h.configure({ showHigherMenu: false, showPromptSettingsPortal: false, ...cfg }, true)
  }, next)
  await page.waitForTimeout(60)
}

async function getAddedPressListenerCount(): Promise<number> {
  const total = await page.evaluate(() => {
    return (window as unknown as { __pressListenerProbe: { count: () => number } }).__pressListenerProbe.count()
  })
  return total - baselineListeners
}

async function getDismissCount(): Promise<number> {
  return page.evaluate(() => Number(document.querySelector('[data-testid="dismiss-count"]')?.textContent ?? '0'))
}

beforeAll(async () => {
  const css = ensureTailwindCss()
  const appScript = await bundle(HOST)
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1100, height: 780 } })
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.setContent('<!doctype html><html data-mantine-color-scheme="light"><head></head><body><main id="root"></main></body></html>')
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: LISTENER_PROBE_PRELUDE })
  await page.addScriptTag({ content: appScript })
  await page.waitForSelector('[data-testid="canvas-pan-surface"]', { timeout: 15_000 })
  if (errors.length > 0) {
    throw new Error(`宿主初始化报错：${errors.join(' | ')}`)
  }
  // 记录 React 根挂载后自身的固定监听基线，后续核对各浮层关着时增量为 0。
  baselineListeners = await page.evaluate(() => {
    return (window as unknown as { __pressListenerProbe: { count: () => number } }).__pressListenerProbe.count()
  })
}, 60_000)

afterAll(async () => {
  await page?.close()
  await browser?.close()
})

describe('outside-press floating dismissal characterization', () => {
  it('attaches 0 extra document press listeners when surfaces are closed or passive without onClose', async () => {
    await configureHarness({ mode: 'anchored', open: false })
    expect(await getAddedPressListenerCount()).toBe(0)
    await page.click('[data-testid="canvas-pan-surface"]')
    expect(await getDismissCount()).toBe(0)

    await configureHarness({ mode: 'anchored-passive', open: true })
    await page.waitForSelector('[data-testid="anchored-popover-surface"]')
    expect(await getAddedPressListenerCount()).toBe(0)
    await page.click('[data-testid="canvas-pan-surface"]')
    expect(await getDismissCount()).toBe(0)

    // TaskCenterPanel 常驻挂载但 opened=false 时不挂任何外部按下监听。
    await configureHarness({ mode: 'task-center', open: false })
    expect(await getAddedPressListenerCount()).toBe(0)
    await page.click('[data-testid="canvas-pan-surface"]')
    expect(await getDismissCount()).toBe(0)

    await configureHarness({ mode: 'browser-asset', open: false })
    expect(await getAddedPressListenerCount()).toBe(0)
  })

  it('dismisses AnchoredPopover on capture pointerdown even when canvas pan swallows mousedown or card stops bubble pointerdown', async () => {
    await configureHarness({ mode: 'anchored', open: true })
    await page.waitForSelector('[data-testid="anchored-popover-surface"]')
    expect(await getAddedPressListenerCount()).toBeGreaterThan(0)

    await page.click('[data-testid="canvas-pan-surface"]')
    await page.waitForSelector('[data-testid="anchored-popover-surface"]', { state: 'detached' })
    expect(await getDismissCount()).toBe(1)
    expect(await getAddedPressListenerCount()).toBe(0)

    await configureHarness({ mode: 'anchored', open: true })
    await page.waitForSelector('[data-testid="anchored-popover-surface"]')
    await page.click('[data-testid="canvas-card-surface"]')
    await page.waitForSelector('[data-testid="anchored-popover-surface"]', { state: 'detached' })
    expect(await getDismissCount()).toBe(1)
    expect(await getAddedPressListenerCount()).toBe(0)
  })

  it('keeps AnchoredPopover open when pressing inside the popover, its trigger ref, or a higher-layer popup portal', async () => {
    await configureHarness({ mode: 'anchored', open: true, showHigherMenu: true })
    await page.waitForSelector('[data-testid="anchored-popover-surface"]')
    await page.waitForSelector('[data-testid="higher-menu-item"]')

    // 点浮层内部按钮 → 不触发外部收起
    await page.click('[data-testid="anchored-inside-btn"]')
    expect(await getDismissCount()).toBe(0)
    expect(await page.locator('[data-testid="anchored-popover-surface"]').count()).toBe(1)

    // 点浮层之上 Portal 出去的下拉菜单项 → 让位给上层菜单，不误关浮层
    await page.click('[data-testid="higher-menu-item"]')
    expect(await getDismissCount()).toBe(0)
    expect(await page.locator('[data-testid="anchored-popover-surface"]').count()).toBe(1)

    // 点触发钮 → 由触发钮 onClick 自己收起，不走 outside-press 回调（否则 pointerdown 先关、click 又翻回打开）
    await page.click('[data-testid="anchored-trigger"]')
    await page.waitForSelector('[data-testid="anchored-popover-surface"]', { state: 'detached' })
    expect(await getDismissCount()).toBe(0)
    expect(await getAddedPressListenerCount()).toBe(0)
  })

  it('respects external trigger selector on TaskCenterPanel and dismisses on canvas pan click', async () => {
    await configureHarness({ mode: 'task-center', open: true })
    await page.waitForSelector('[data-task-center-trigger="true"]')

    // 点外置触发钮只走触发钮自己的开合切换，不计入 outside-press
    await page.click('[data-testid="task-center-trigger"]')
    await page.waitForTimeout(60)
    expect(await getDismissCount()).toBe(0)
    expect(await getAddedPressListenerCount()).toBe(0)

    // 重新打开后点画布平移面 → 正常收起并卸监听
    await page.click('[data-testid="task-center-trigger"]')
    await page.waitForTimeout(60)
    expect(await getAddedPressListenerCount()).toBeGreaterThan(0)

    await page.click('[data-testid="canvas-pan-surface"]')
    await page.waitForTimeout(60)
    expect(await getDismissCount()).toBe(1)
    expect(await getAddedPressListenerCount()).toBe(0)
  })

  it('keeps EditingLayoutMenu open on multi-select panel checkboxes and dismisses on canvas pan or trigger toggle', async () => {
    await configureHarness({ mode: 'editing-layout', open: false })
    expect(await getAddedPressListenerCount()).toBe(0)

    const trigger = page.locator('button[aria-haspopup="menu"]')
    await trigger.click()
    await page.waitForSelector('[role="menu"]')
    expect(await getAddedPressListenerCount()).toBeGreaterThan(0)

    // 点菜单内多选面板开关 → 保持打开
    await page.locator('[role="menuitemcheckbox"]').first().click()
    expect(await page.locator('[role="menu"]').count()).toBe(1)

    // 点触发钮 → 干净收起，不会因 pointerdown 先收再被 click 翻回打开
    await trigger.click()
    await page.waitForSelector('[role="menu"]', { state: 'detached' })
    expect(await getAddedPressListenerCount()).toBe(0)

    // 再次打开后点画布平移面 → 收起
    await trigger.click()
    await page.waitForSelector('[role="menu"]')
    await page.click('[data-testid="canvas-pan-surface"]')
    await page.waitForSelector('[role="menu"]', { state: 'detached' })
    expect(await getAddedPressListenerCount()).toBe(0)
  })

  it('preserves NomiBrowserAssetPopover filter button exclusion and prompt-settings dialog selector exclusion', async () => {
    await configureHarness({ mode: 'browser-asset', open: true, showPromptSettingsPortal: true })
    const filterBtn = page.locator('button[aria-haspopup="dialog"]')
    await filterBtn.waitFor({ state: 'visible' })

    // 打开内部筛选小浮层，再点一次筛选按钮应干净关掉（不因缺少 filterButtonRef 排除而二次翻转重开）
    await filterBtn.click()
    expect(await filterBtn.getAttribute('aria-expanded')).toBe('true')
    await filterBtn.click()
    expect(await filterBtn.getAttribute('aria-expanded')).toBe('false')
    expect(await getDismissCount()).toBe(0)

    // 点溢出到 body 的提示词提取设置弹窗 → 不误关素材浮窗
    await page.click('[data-testid="prompt-settings-portal"]')
    expect(await getDismissCount()).toBe(0)

    // 点画布平移面 → 收起素材浮窗并卸下所有监听
    await page.click('[data-testid="canvas-pan-surface"]')
    await page.waitForTimeout(60)
    expect(await getDismissCount()).toBe(1)
    expect(await getAddedPressListenerCount()).toBe(0)
  })
})
