import { createRequire } from 'node:module'
import { chromium, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// 共用菜单关掉后焦点去哪（真浏览器里用真键盘、真鼠标走）：
// · 用键盘关（Esc / 键盘选一项）→ 回到打开它之前聚焦的那个元素（按钮点开的回按钮，右键点位的回原来聚焦的元素）；
// · 鼠标点别处关、鼠标选一项关 → 不动；
// · 选中的那一项自己把焦点送去别处（同步 focus / 下一帧 focus）→ 不被抢回；
// · 打开前的元素已经被卸载 / 本来就没有聚焦元素 → 什么都不做、不报错。
// 共用菜单内部没有任何一个调用方的名字，所以这里用一个最小宿主覆盖三类调用方的形状（按钮点开 / 点位 / 自己安排焦点）。

async function bundle(contents: string): Promise<string> {
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const result = await build({ stdin: { contents, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' }, logLevel: 'error', define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"http://localhost/"', 'import.meta.env': '{}' } })
  return result.outputFiles[0].text
}

const HOST = `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { WorkbenchMenu } from './src/design/menu';
import { DesignModal } from './src/design/overlays';
const nop = () => undefined;
function Host() {
  // A：按钮点开，选项不安排焦点
  const aBtn = React.useRef(null); const [aOpen, setAOpen] = React.useState(false); const [aRect, setARect] = React.useState(null);
  // B：按钮点开，选项自己安排焦点（同步 / 下一帧）
  const [bModal, setBModal] = React.useState(false); const [bDlg, setBDlg] = React.useState(false);
  const bBtn = React.useRef(null); const bInput = React.useRef(null); const [bOpen, setBOpen] = React.useState(false); const [bRect, setBRect] = React.useState(null);
  // C：点位菜单（没有触发按钮）
  const [cOpen, setCOpen] = React.useState(false); const [cPoint, setCPoint] = React.useState({ x: 300, y: 200 });
  // D：按钮点开，选项把按钮自己卸掉
  const [dShow, setDShow] = React.useState(true); const dBtn = React.useRef(null); const [dOpen, setDOpen] = React.useState(false); const [dRect, setDRect] = React.useState(null);
  window.__openC = () => { setCPoint({ x: 300, y: 200 }); setCOpen(true) };
  window.__removeD = () => setDShow(false);
  const openFrom = (ref, setRect, setOpen) => () => { setRect(ref.current.getBoundingClientRect()); setOpen(true) };
  return <MantineProvider><main>
    <button id="a-btn" ref={aBtn} onClick={openFrom(aBtn, setARect, setAOpen)}>A</button>
    <button id="b-btn" ref={bBtn} onClick={openFrom(bBtn, setBRect, setBOpen)}>B</button>
    <input id="b-input" ref={bInput} />
    {bModal ? <div role="dialog"><input id="b-modal-input" autoFocus /></div> : null}
    <div id="c-div" tabIndex={0} onKeyDown={(e) => { if (e.key === 'm') window.__openC() }}>C</div>
    {dShow ? <button id="d-btn" ref={dBtn} onClick={openFrom(dBtn, setDRect, setDOpen)}>D</button> : null}
    <button id="outside">outside</button>
    <WorkbenchMenu open={aOpen} onOpenChange={setAOpen} point={{ x: 0, y: 0 }} anchorRect={aRect ?? undefined} ariaLabel="A" items={[{ id: 'a1', label: 'A1', onSelect: nop }, { id: 'a2', label: 'A2', onSelect: nop }]} />
    <WorkbenchMenu open={bOpen} onOpenChange={setBOpen} point={{ x: 0, y: 0 }} anchorRect={bRect ?? undefined} ariaLabel="B" items={[
      { id: 'b-sync', label: 'sync', onSelect: () => bInput.current?.focus() },
      { id: 'b-modal', label: 'modal', onSelect: () => setBModal(true) },
      { id: 'b-dialog', label: 'dialog', onSelect: () => setBDlg(true) },
      { id: 'b-late', label: 'late', onSelect: () => { setTimeout(() => bInput.current?.focus(), 60) } },
      { id: 'b-raf', label: 'raf', onSelect: () => { requestAnimationFrame(() => bInput.current?.focus()) } },
    ]} />
    <WorkbenchMenu open={cOpen} onOpenChange={setCOpen} point={cPoint} ariaLabel="C" items={[{ id: 'c1', label: 'C1', onSelect: nop }]} />
    <WorkbenchMenu open={dOpen} onOpenChange={setDOpen} point={{ x: 0, y: 0 }} anchorRect={dRect ?? undefined} ariaLabel="D" items={[{ id: 'd-remove', label: 'remove', onSelect: () => setDShow(false) }]} />
    <DesignModal opened={bDlg} onClose={() => setBDlg(false)} title="真弹窗"><button id="dlg-btn">in dialog</button></DesignModal>
  </main></MantineProvider>
}
createRoot(document.getElementById('root')).render(<Host />);
`

let browser: Awaited<ReturnType<typeof chromium.launch>>
let script = ''
const errors: string[] = []
beforeAll(async () => { script = await bundle(HOST); browser = await chromium.launch() }, 60_000)
afterAll(async () => { await browser?.close() })

async function open(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  errors.length = 0
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<main id="root"></main>')
  await page.addScriptTag({ content: script })
  await page.waitForSelector('#a-btn')
  return page
}
const activeId = (page: Page): Promise<string> => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName.toLowerCase() || '')
const settle = (page: Page): Promise<void> => page.waitForTimeout(200)

describe('共用菜单关后焦点', () => {
  it('按钮点开：键盘开 + Esc 关 → 焦点回按钮', async () => {
    const page = await open()
    await page.focus('#a-btn'); await page.keyboard.press('Enter')
    await page.waitForSelector('[data-menu-item="a1"]')
    await page.keyboard.press('Escape'); await settle(page)
    expect(await activeId(page)).toBe('a-btn')
    expect(errors).toEqual([])
    await page.close()
  }, 30_000)

  it('按钮点开：键盘开 + 键盘选一项 → 焦点回按钮', async () => {
    const page = await open()
    await page.focus('#a-btn'); await page.keyboard.press('Enter')
    await page.waitForSelector('[data-menu-item="a1"]')
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await settle(page)
    expect(await page.locator('[data-menu-item="a1"]').count()).toBe(0)
    expect(await activeId(page)).toBe('a-btn')
    await page.close()
  }, 30_000)

  it('鼠标开 + 点别处关 → 焦点留在被点的那个元素，不被拉回按钮', async () => {
    const page = await open()
    await page.click('#a-btn')
    await page.waitForSelector('[data-menu-item="a1"]')
    await page.click('#outside'); await settle(page)
    expect(await activeId(page)).toBe('outside')
    await page.close()
  }, 30_000)

  it('鼠标开 + 鼠标选一项 → 和今天一样（不把焦点拉回按钮）', async () => {
    const page = await open()
    await page.click('#a-btn')
    await page.click('[data-menu-item="a1"]'); await settle(page)
    expect(await activeId(page)).toBe('body')
    await page.close()
  }, 30_000)

  it('鼠标开 + Esc 关 → 和今天一样（鼠标点开的不算键盘到达，焦点不被还回按钮）', async () => {
    const page = await open()
    await page.click('#a-btn')
    await page.waitForSelector('[data-menu-item="a1"]')
    await page.keyboard.press('Escape'); await settle(page)
    expect(await activeId(page)).toBe('body')
    await page.close()
  }, 30_000)

  it('Tab 键到的按钮：回车开 + Esc 关 → 焦点回按钮', async () => {
    const page = await open()
    await page.keyboard.press('Tab')
    expect(await activeId(page)).toBe('a-btn')
    await page.keyboard.press('Enter')
    await page.waitForSelector('[data-menu-item="a1"]')
    await page.keyboard.press('Escape'); await settle(page)
    expect(await activeId(page)).toBe('a-btn')
    await page.close()
  }, 30_000)

  it('选中的那项打开真弹窗（带焦点陷阱）→ 焦点留在弹窗里，不被抢回按钮', async () => {
    const page = await open()
    await page.focus('#b-btn'); await page.keyboard.press('Enter')
    await page.waitForSelector('[data-menu-item="b-dialog"]')
    await page.focus('[data-menu-item="b-dialog"]'); await page.keyboard.press('Enter')
    await page.waitForSelector('[role="dialog"]'); await page.waitForTimeout(400)
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true)
    await page.close()
  }, 30_000)

  it('键盘开 + 鼠标选一项 → 按鼠标算，焦点不被还回按钮', async () => {
    const page = await open()
    await page.focus('#a-btn'); await page.keyboard.press('Enter')
    await page.waitForSelector('[data-menu-item="a1"]')
    await page.click('[data-menu-item="a1"]'); await settle(page)
    expect(await activeId(page)).toBe('body')
    await page.close()
  }, 30_000)

  it('键盘导航后改用鼠标点别处关 → 按鼠标算，不拉回', async () => {
    const page = await open()
    await page.focus('#a-btn'); await page.keyboard.press('Enter')
    await page.waitForSelector('[data-menu-item="a1"]')
    await page.keyboard.press('ArrowDown')
    await page.click('#outside'); await settle(page)
    expect(await activeId(page)).toBe('outside')
    await page.close()
  }, 30_000)

  it.each(['b-sync', 'b-raf', 'b-late', 'b-modal'])('选中的那项（%s）自己安排焦点（同步 / 下一帧 / 延后 / 打开弹窗聚焦输入框）→ 不被抢回按钮', async (item) => {
    const page = await open()
    await page.focus('#b-btn'); await page.keyboard.press('Enter')
    await page.waitForSelector(`[data-menu-item="${item}"]`)
    await page.focus(`[data-menu-item="${item}"]`); await page.keyboard.press('Enter'); await settle(page)
    expect(await activeId(page), item).toBe(item === 'b-modal' ? 'b-modal-input' : 'b-input')
    await page.close()
  }, 30_000)

  it('点位菜单：打开前聚焦的元素，键盘关后回到它', async () => {
    const page = await open()
    await page.focus('#c-div'); await page.keyboard.press('m')
    await page.waitForSelector('[data-menu-item="c1"]')
    await page.keyboard.press('Escape'); await settle(page)
    expect(await activeId(page)).toBe('c-div')
    await page.close()
  }, 30_000)

  it('点位菜单：打开前没有聚焦任何元素 → 什么都不做', async () => {
    const page = await open()
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); (window as unknown as { __openC: () => void }).__openC() })
    await page.waitForSelector('[data-menu-item="c1"]')
    await page.keyboard.press('Escape'); await settle(page)
    expect(await activeId(page)).toBe('body')
    expect(errors).toEqual([])
    await page.close()
  }, 30_000)

  it('打开前的按钮在菜单开着时被卸载 → 不报错、不乱聚焦', async () => {
    const page = await open()
    await page.focus('#d-btn'); await page.keyboard.press('Enter')
    await page.waitForSelector('[data-menu-item="d-remove"]')
    await page.evaluate(() => (window as unknown as { __removeD: () => void }).__removeD()); await settle(page)
    await page.keyboard.press('Escape'); await settle(page)
    expect(await activeId(page)).toBe('body')
    expect(errors).toEqual([])
    await page.close()
  }, 30_000)

  it('键盘选中的那项把按钮自己卸掉 → 不报错、不乱聚焦', async () => {
    const page = await open()
    await page.focus('#d-btn'); await page.keyboard.press('Enter')
    await page.waitForSelector('[data-menu-item="d-remove"]')
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await settle(page)
    expect(await activeId(page)).toBe('body')
    expect(errors).toEqual([])
    await page.close()
  }, 30_000)
})
