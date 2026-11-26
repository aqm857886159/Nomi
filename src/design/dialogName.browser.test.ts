import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import tailwindConfig from '../../tailwind.config'
import { createRequire } from 'node:module'
import { AxeBuilder } from '@axe-core/playwright'
import { chromium, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// 弹窗的读屏名字由外壳给（Mantine Modal.Title → aria-labelledby），在真浏览器里用真组件量：
// · axe-core 的 aria-dialog-name 规则：对话框必须有名字；
// · Playwright 按角色 + 名字找：getByRole('dialog', { name }) 恰好找到一个；
// · aria-labelledby 指向的元素文字就是名字本身（不带副标、封面、链接），元素上没有 aria-label 顶替。
// 名字以外的头部内容（图标、副标、封面、来源链接）走外壳的 header 插槽，摆在名字旁边，不进名字。
// 最后一格是量具自检：一个没有名字的对话框，axe 必须报、按名字必须找不到——量具瞎了这一格先红。

async function bundle(contents: string): Promise<string> {
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const result = await build({ stdin: { contents, resolveDir: process.cwd(), loader: 'tsx' }, jsx: 'automatic', bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl', '.mp4': 'dataurl', '.md': 'text' }, logLevel: 'error', define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"http://localhost/"', 'import.meta.env': '{}' } })
  return result.outputFiles[0].text
}

const SKILL_TITLE = 'Shot language'
const LONG_TITLE = 'Create another high definition version of this sample draft?'
const HOST = `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import i18n from './src/i18n';
import { buildNomiTheme } from './src/theme/nomiTheme';
import { DesignModal } from './src/design/overlays';
import { SkillDetail } from './src/workbench/skillLibrary/SkillDetail';
import { SpendConfirmDialog } from './src/workbench/generationCanvas/spend/SpendConfirmDialog';
import { useSpendConfirmStore } from './src/workbench/generationCanvas/spend/spendConfirm';
import { UpdateDialogCard } from './src/ui/app-shell/UpdateDialog';
const nop = () => undefined;
const skill = { id: 'skill:name-census', title: ${JSON.stringify(SKILL_TITLE)}, description: 'Cut on action, keep the axis.', source: 'https://example.com/skill',
  body: '## Steps\\n\\nKeep the axis.', illustration: false, license: 'MIT', author: 'https://github.com/someone/skill',
  skill: { name: 'name-census', directoryName: 'name-census', label: 'name-census', description: null, author: null, stageLabels: [], isPlaybook: false,
    neededProviders: [], manifestError: null, origin: 'user', packageVersion: '1', contentHash: 'fixture' } };
const digest = { title: 'Projects and assets stay on your computer', groups: [{ heading: 'New', items: ['One'] }], hiddenGroups: 0 };
function Scene({ scene }) {
  if (scene === 'plain') return <DesignModal opened onClose={nop} title="Plain title"><p>Body</p></DesignModal>;
  if (scene === 'slot') return <DesignModal opened onClose={nop} title="Slot title"
    header={(title) => <span className="flex items-center gap-2"><span aria-hidden="true">*</span><span>{title}<span>Subtitle beside the name</span></span></span>}><p>Body</p></DesignModal>;
  if (scene === 'skill') return <SkillDetail entry={skill} onClose={nop} onAddToChat={nop} onExport={nop} onDelete={nop} />;
  if (scene === 'update') return <UpdateDialogCard view="available" version="0.25.0" digest={digest} releaseUrl={null} canAutoInstall onClose={nop} />;
  if (scene.startsWith('spend-')) return <SpendConfirmDialog />;
  if (scene === 'nameless') return <div role="dialog" aria-modal="true"><p>No name at all</p></div>;
  return null;
}
window.__mount = async (scene) => {
  await i18n.changeLanguage('en');
  const agentTitle = i18n.t('runtime.capability.generationGateTitle');
  if (scene === 'spend-agent') void useSpendConfirmStore.getState().requestConfirm({ title: agentTitle, message: 'This will generate 1 image.', source: 'agent', kind: 'generation' });
  if (scene === 'spend-long') void useSpendConfirmStore.getState().requestConfirm({ title: ${JSON.stringify(LONG_TITLE)}, message: 'Confirm this draft.', source: 'user', kind: 'generation' });
  if (scene === 'spend-user') void useSpendConfirmStore.getState().requestConfirm({ title: 'Generate reference images?', message: 'This will generate 2 reference images.', source: 'user', kind: 'reference' });
  window.__expected = { plain: 'Plain title', slot: 'Slot title', skill: ${JSON.stringify(SKILL_TITLE)},
    update: i18n.t('updateReminder.dialog.availableTitle', { version: '0.25.0' }),
    'spend-agent': agentTitle, 'spend-user': 'Generate reference images?',
    agentNotice: i18n.t('generationCommon.spend.agentNotice') }[scene] ?? null;
  window.__agentNotice = i18n.t('generationCommon.spend.agentNotice');
  createRoot(document.getElementById('root')).render(<MantineProvider theme={scene.startsWith('spend-') ? buildNomiTheme() : undefined}><Scene scene={scene} /></MantineProvider>);
};
`

let browser: Awaited<ReturnType<typeof chromium.launch>>
let script = ''
beforeAll(async () => { script = await bundle(HOST); browser = await chromium.launch() }, 120_000)
afterAll(async () => { await browser?.close() })

async function mount(scene: string): Promise<{ page: Page; expected: string | null; errors: string[] }> {
  // axe 的 Playwright 适配要求页面来自 newContext（它要在同一上下文里另开页注入脚本）。
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<main id="root"></main>')
  await page.addScriptTag({ content: script })
  await page.evaluate((name) => (window as unknown as { __mount: (s: string) => Promise<void> }).__mount(name), scene)
  await page.locator('[role="dialog"]').first().waitFor({ state: 'visible', timeout: 15_000 })
  const expected = await page.evaluate(() => (window as unknown as { __expected: string | null }).__expected)
  return { page, expected, errors }
}

const closePage = (page: Page): Promise<void> => page.context().close()

type Labelled = { text: string; ariaLabel: string | null } | null
async function labelledTargets(page: Page): Promise<Labelled[]> {
  return page.locator('[role="dialog"]').first().evaluate((dialog) => (dialog.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => {
    const target = document.getElementById(id)
    return target ? { text: (target.textContent || '').replace(/\s+/g, ' ').trim(), ariaLabel: target.getAttribute('aria-label') } : null
  }))
}

async function expectNamedByShell(scene: string): Promise<Page> {
  const { page, expected, errors } = await mount(scene)
  expect(expected).toBeTruthy()
  const axe = await new AxeBuilder({ page }).withRules(['aria-dialog-name']).analyze()
  expect(axe.violations.map((violation) => violation.id)).toEqual([])
  expect(axe.passes.find((rule) => rule.id === 'aria-dialog-name')?.nodes.length ?? 0).toBeGreaterThan(0)
  await expect(page.getByRole('dialog', { name: expected!, exact: true }).count()).resolves.toBe(1)
  expect(await labelledTargets(page)).toEqual([{ text: expected, ariaLabel: null }])
  expect(errors).toEqual([])
  return page
}

describe('弹窗的读屏名字由外壳给，只是名字那一句', () => {
  it('字符串标题：名字就是标题', async () => { await closePage(await expectNamedByShell('plain')) }, 60_000)

  it('插槽里摆在名字旁边的东西不进名字', async () => {
    const page = await expectNamedByShell('slot')
    await expect(page.getByText('Subtitle beside the name').isVisible()).resolves.toBe(true)
    await closePage(page)
  }, 60_000)

  it('技能详情：名字是技能名，不带封面、简介、来源链接', async () => { await closePage(await expectNamedByShell('skill')) }, 60_000)

  it('更新弹窗：名字是标题，不带副标', async () => { await closePage(await expectNamedByShell('update')) }, 60_000)

  it('花钱确认（Agent 发起）：名字是标题，Agent 副标看得见、紧跟名字、不进名字', async () => {
    const page = await expectNamedByShell('spend-agent')
    const notice = await page.evaluate(() => (window as unknown as { __agentNotice: string }).__agentNotice)
    const visible = page.getByRole('dialog').getByText(notice, { exact: true })
    await expect(visible.count()).resolves.toBe(1)
    await expect(visible.isVisible()).resolves.toBe(true)
    // 阅读顺序：副标在名字之后，正文之前（Mantine 8.3.18 的 aria-describedby 固定指向 Modal.Body，副标不在描述里）。
    const title = await page.evaluate(() => (window as unknown as { __expected: string }).__expected)
    const order = await page.getByRole('dialog').evaluate((dialog, { title, text }) => {
      const all = (dialog.textContent || '').replace(/\s+/g, ' ')
      return { title: all.indexOf(title), notice: all.indexOf(text), body: all.indexOf('This will generate 1 image.') }
    }, { title, text: notice })
    expect(order.title).toBeGreaterThanOrEqual(0)
    expect(order.notice).toBeGreaterThan(order.title)
    expect(order.body).toBeGreaterThan(order.notice)
    await closePage(page)
  }, 60_000)

  it('花钱确认（用户直发）：名字是标题', async () => { await closePage(await expectNamedByShell('spend-user')) }, 60_000)

  it('量具自检：没有名字的对话框，axe 报 aria-dialog-name、按名字找不到', async () => {
    const { page } = await mount('nameless')
    const axe = await new AxeBuilder({ page }).withRules(['aria-dialog-name']).analyze()
    expect(axe.violations.map((violation) => violation.id)).toEqual(['aria-dialog-name'])
    await expect(page.getByRole('dialog', { name: /.+/ }).count()).resolves.toBe(0)
    await closePage(page)
  }, 60_000)
})

// 只编译挂载出的生产类（与 build-tailwind 一样：Mantine 在前，项目 Tailwind 在后）。
async function styledSpend(scene: string) {
  const { page } = await mount(scene)
  const classes = await page.locator('[class]').evaluateAll(nodes => nodes.map(el => el.getAttribute('class')).join(' '))
  const content = ['src/design/overlays.tsx', { raw: classes, extension: 'html' }]
  const css = await postcss([tailwindcss({ ...tailwindConfig, content, safelist: [] })])
    .process('@tailwind base; @tailwind utilities;', { from: undefined })
  const require = createRequire(import.meta.url)
  await page.addStyleTag({ content: readFileSync(require.resolve('@mantine/core/styles.css'), 'utf8') + css.css })
  return page
}

describe('380px 花钱确认卡的标题排版', () => {
  it('60 字符的英文标题完整折行，关闭键和图标靠首行', async () => {
    const page = await styledSpend('spend-long')
    try {
      const dialog = page.getByRole('dialog', { name: LONG_TITLE, exact: true })
      expect((await dialog.boundingBox())?.width).toBe(380)
      const heading = dialog.getByRole('heading', { name: LONG_TITLE })
      const style = await heading.evaluate(el => {
        const css = getComputedStyle(el)
        const text = document.createRange()
        text.selectNodeContents(el)
        return { whiteSpace: css.whiteSpace, overflow: css.textOverflow, lines: text.getClientRects().length,
          clipped: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight }
      })
      expect(style.whiteSpace).not.toBe('nowrap')
      expect(style.overflow).not.toBe('ellipsis')
      expect(style.lines).toBe(2)
      expect(style.clipped).toBe(false)
      const header = dialog.locator('header').first()
      const title = await heading.boundingBox()
      for (const item of [header.locator('svg').first().locator('..'), header.getByRole('button')]) {
        await expect.poll(async () => (await item.boundingBox())?.y).toBe(title?.y)
      }
    } finally { await closePage(page) }
  })

  it('原本一行的标题仍用原有字形并与图标、关闭键垂直居中', async () => {
    const page = await styledSpend('spend-user')
    try {
      const header = page.getByRole('dialog').locator('header').first()
      const heading = header.getByRole('heading')
      const appearance = await heading.evaluate(el => {
        const css = getComputedStyle(el)
        return { size: css.fontSize, weight: css.fontWeight, classes: [...el.classList] }
      })
      expect(appearance.size).toBe('16px')
      expect(appearance.weight).toBe('500')
      expect(appearance.classes).toEqual(expect.arrayContaining(['text-title', 'font-medium', 'text-nomi-ink']))
      const center = async (item: typeof heading) => {
        const box = (await item.boundingBox())!
        return box.y + box.height / 2
      }
      const y = await center(heading)
      expect(await center(header.getByRole('button'))).toBeCloseTo(y, 1)
      expect(await center(header.locator('svg').first().locator('..'))).toBeCloseTo(y, 1)
    } finally { await closePage(page) }
  })
})
