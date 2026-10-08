// 分镜方案用户审计走查（只读审计，不改产品代码）：以创作者的身份把分镜方案的每个功能走一遍，
// 取证据（截图 + 实测数字）。报告：docs/research/2026-10-05-storyboard-plan-user-audit.md。
//
// 零额度：供应商是本机回环夹具，出网闸拦真实域名；窗口全程在屏幕外（_offscreenWindows.cjs），不抢焦点。
// 用法：
//   pnpm run build
//   NOMI_AUDIT_LOCALE=zh-CN node tests/ux/audit-storyboard.walk.mjs
//   NOMI_AUDIT_LOCALE=en    node tests/ux/audit-storyboard.walk.mjs
// 产出：tests/ux/shots/audit-storyboard/<locale>/*.png + observations.json
//
// 为什么没用 full-walk 的 startPlaybook：它在装监视器时读 useAgentPanelSpendConfirm.ts 的 POLL_INTERVAL_MS，
// 而付费卡并进对话那一刀（38db4a3d9）把它删了，所以 main 上 startPlaybook 起不来（走查基座本身红了）。
// 这里直接用它下面的零件（夹具 / 出网闸 / 上传中继 / 脚本化大脑）。
//
// 2026-10-06（分镜复用画布交互，L-sbui）：镜头行的参考区、模式下拉、底栏 ⋯ 开关弹层、参考卡空画面格里的
// 「生成」都已删，换成视觉列里的参考条（缩略图带 × + 「+」开素材选择器）、画布同款参数条（汇总按钮 → 平铺面板）、
// 底栏右端的「生成」。定位器跟着改到新界面；测的问题不变，截图名里写着旧结论的几张改成中性名字。
import fs from 'node:fs'
import path from 'node:path'
import { stationTimeout } from './_station-budget.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'

process.env.NOMI_WALK_UNPRICED_MODEL = '1'
const locale = process.env.NOMI_AUDIT_LOCALE === 'en' ? 'en' : 'zh-CN'
const EN = locale === 'en'
const t = (zh, en) => (EN ? en : zh)

const { launchCoreSmoke } = await import('./core-smoke/fixture.mjs')
const { startEgressWatch, readEgressLog } = await import('./full-walk/egress.mjs')
const { startUploadRelay } = await import('./full-walk/uploadRelay.mjs')
const { standingBackgroundResponders, scriptTurn, toolResultText } = await import('./full-walk/brain.mjs')
const { sendCreation } = await import('./agent-runtime-walk-support.mjs')
const { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR } = await import('./agent-runtime-fixture.mjs')
const { repoRoot } = await import('./_launchApp.mjs')

const DOC = 'doc-1'
const DESIGN = 'audit-sb'
const SEEDANCE = { modelKey: 'doubao-seedance-2.5', modelVendor: 'apimart' }
const shot = (index, prompt, anchorIds, extra = {}) => ({
  index, shotId: `shot-${index}`, shotKind: 'video', durationSec: 5, anchorIds, prompt, ...SEEDANCE, ...extra,
})
const plan = {
  title: t('雨夜追逐', 'Rainy chase'),
  anchors: [
    { id: 'hero', kind: 'character', name: t('林薇', 'Lin Wei'), description: t('短发，风衣，眼神冷', 'Short hair, trench coat, cold eyes'), carrier: 'visual' },
    { id: 'alley', kind: 'scene', name: t('后巷', 'Back alley'), description: t('窄巷，霓虹，积水', 'Narrow alley, neon, puddles'), carrier: 'visual' },
    { id: 'mood', kind: 'style', name: t('全片风格', 'Look'), description: t('赛博霓虹，冷蓝洋红', 'Cyber neon, cold blue magenta'), carrier: 'text' },
  ],
  shots: [
    shot(1, t('林薇冲进后巷，镜头跟拍', 'Lin Wei runs into the alley, tracking shot'), ['hero', 'alley', 'mood']),
    shot(2, t('她回头，追兵的车灯扫过', 'She looks back, headlights sweep'), ['hero', 'alley']),
    shot(3, t('她翻过围墙', 'She vaults a wall'), ['hero']),
    shot(4, t('远景，清晨的海边', 'Wide shot, seaside at dawn'), [], { shotKind: 'image', durationSec: 3, modelKey: FIXTURE_IMAGE_MODEL, modelVendor: FIXTURE_VENDOR }),
  ],
}

const outDir = path.join(repoRoot, 'tests', 'ux', 'shots', 'audit-storyboard', locale)
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const tmpDir = path.join(repoRoot, '.tmp', 'audit')
fs.mkdirSync(tmpDir, { recursive: true })

const egress = await startEgressWatch({ logFile: path.join(tmpDir, `egress-${locale}.jsonl`) })
const relay = await startUploadRelay()
const smoke = await launchCoreSmoke({
  name: 'audit-storyboard', needs: ['loopbackProvider', 'fixtureTextModel', 'paidGenerationRoute'], locale, syntheticCredentialStorage: true,
  seed: () => ({
    nodes: [], groups: [], edges: [],
    payload: {
      workbenchDocuments: [{ id: DOC, version: 1, title: t('雨夜', 'Rainy night'), updatedAt: 10,
        contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t('雨夜，林薇被追进后巷。', 'On a rainy night, Lin Wei is chased into an alley.') }] }] } }],
      activeDocumentId: DOC,
      storyboardDesignsByDocumentId: { [DOC]: [{ id: DESIGN, documentId: DOC, title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }] },
    },
  }),
  extras: {
    // 窗口全程在屏幕外、不抢焦点：用户的 Nomi 开着时也能跑。
    mainRequire: [...egress.mainRequire, path.join(repoRoot, 'tests', 'ux', '_offscreenWindows.cjs')],
    env: { ...egress.env, ...relay.env },
    needsOptions: { fixture: { usage: 'measured' } },
  },
})
const fixture = smoke.needs.loopbackProvider
standingBackgroundResponders(fixture)
const win = () => smoke.win

const O = { locale, phases: {}, errors: {} }
const snap = async (name, opts = {}) => { await win().screenshot({ path: path.join(outDir, `${name}.png`), ...opts }) }
async function phase(id, fn) {
  const record = {}
  O.phases[id] = record
  try { await fn(record) } catch (error) {
    O.errors[id] = String(error?.message ?? error).split('\n')[0].slice(0, 300)
    console.log(`[audit] phase ${id} failed:`, O.errors[id])
  }
  console.log(`[audit] phase ${id} done`)
}
const readProject = () => JSON.parse(fs.readFileSync(path.join(smoke.project.projectRoot, '.nomi', 'project.json'), 'utf8')).payload
const settle = (ms = 700) => win().waitForTimeout(ms)
const editor = () => win().locator('[data-storyboard-editor="true"]:visible')
const row = (index) => editor().locator(`[data-storyboard-row="${index}"]`)
const scroller = () => win().locator('[data-storyboard-scroll="true"]')
const scrollTo = async (top) => { await scroller().evaluate((el, v) => { el.scrollTop = v }, top); await settle(350) }
const visibleOptions = () => win().evaluate(() => [...document.querySelectorAll('[role=listbox]')]
  .filter((box) => box.getBoundingClientRect().width > 0 && getComputedStyle(box).visibility !== 'hidden')
  .flatMap((box) => [...box.querySelectorAll('[role=option]')].map((o) => o.textContent.trim())))

async function openEditor(designId = DESIGN) {
  await win().locator('.nomi-stepper__step[data-mode="creation"]').first().click()
  await settle(700)
  await openStoryboardEditor(win(), designId)
  await editor().waitFor({ timeout: stationTimeout({ operations: 2 }) })
  await settle(1000)
}
async function backToCreation() {
  await editor().locator('xpath=ancestor::*[1]').first().evaluate(() => {}).catch(() => {})
  await win().locator('footer button').first().click()
  await settle(800)
}
const nodesOf = () => readProject().generationCanvas.nodes
const metaBrief = (n) => ({ kind: n.kind, title: n.title, status: n.status, model: n.meta?.modelKey ?? n.meta?.imageModel ?? null, vendor: n.meta?.modelVendor ?? null, anchorId: n.meta?.anchorId ?? null, shotId: n.meta?.shotId ?? null })
const refAdd = (index) => row(index).locator('[data-storyboard-ref-add] [data-asset-add-tile]').first()
const picker = () => win().locator('[data-testid="asset-picker"]').last()
const paramsPill = (scope) => scope.getByRole('button', { name: t('生成参数', 'Generation parameters'), exact: true }).first()
const modelButton = (scope) => scope.locator('[data-storyboard-composer-bar]').getByRole('button', { name: t('模型', 'Model'), exact: true }).first()
const rectOf = (selector) => win().evaluate((s) => { const e = document.querySelector(s); const r = e?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) } : null }, selector)

try {
  await smoke.openProject()
  O.viewport = await win().evaluate(() => ({ w: innerWidth, h: innerHeight }))

  await phase('P1-initial', async (r) => {
    await win().locator('.nomi-stepper__step[data-mode="creation"]').first().click()
    await settle(900)
    await snap('01-creation-sidebar')
    await openEditor()
    await snap('02-editor-initial')
    r.footer = (await editor().locator('footer').innerText()).replace(/\n+/g, ' | ')
    r.hintLine = (await editor().locator('header + div').innerText()).replace(/\n+/g, ' ')
    r.batchButton = await editor().locator('[data-storyboard-batch]').innerText()
    r.anchorChips = await editor().locator('[data-storyboard-anchor-chip]').allInnerTexts()
    r.rowRefThumbs = await row(1).locator('[data-storyboard-ref-thumb]').count()
    r.rowRefAdd = await row(1).locator('[data-storyboard-ref-add]').first().getAttribute('data-storyboard-ref-add').catch(() => null)
    r.rowNumbers = await editor().locator('[data-storyboard-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-storyboard-row')))
  })

  await phase('P2-anchor-bar', async (r) => {
    await editor().locator('[data-storyboard-anchors-toggle="true"]').click()
    await settle(600)
    await scrollTo(0)
    await snap('03-anchors-expanded')
    const bar = (id) => win().evaluate((anchorId) => [...document.querySelectorAll(`[data-storyboard-anchor-row="${anchorId}"] [data-storyboard-composer-bar] button`)].map((b) => (b.getAttribute('aria-label') || b.title || b.textContent || '').trim().replace(/\s+/g, ' ')).filter(Boolean), id)
    r.heroBarBefore = await bar('hero')
    // 选一个有「比例 / 清晰度 / 张数」参数的图片模型，看锚的参数区会不会长出来。
    await modelButton(editor().locator('[data-storyboard-anchor-row="hero"]')).click()
    await settle(400)
    r.anchorModelOptions = (await visibleOptions()).slice(0, 14)
    await snap('04-anchor-model-menu')
    await win().getByRole('option', { name: /GPT Image 2(?!\.)/ }).first().click()
    await settle(700)
    r.heroBarAfterGptImage2 = await bar('hero')
    await snap('05-anchor-after-gpt-image-2')
    // 同一个模型放在镜头行的「⋯」里有哪些参数（对照）
  })

  await phase('P3-shot-bar', async (r) => {
    await scrollTo(0)
    await editor().locator('[data-storyboard-anchors-toggle="true"]').click() // 收起，回到镜头
    await settle(400)
    await scrollTo(120)
    // 模式不再是行上的一颗下拉：和画布节点一样在参数汇总按钮的面板里（生成方式一组 + 其余参数平铺）。
    const pill = paramsPill(row(1))
    r.defaultModeLabel = (await pill.innerText()).trim()
    await pill.click()
    await settle(500)
    const panel = win().locator('[data-agent-parameter-panel]').last()
    const modes = panel.locator('[data-agent-generation-mode] [role="radio"]')
    r.modeOptions = (await modes.allInnerTexts()).map((text) => text.trim())
    await snap('06-shot-params-panel')
    // 切到带参考槽的模式（最后一项 = 全能参考）
    await modes.last().click()
    await settle(700)
    r.shotParamPanel = (await panel.innerText().catch(() => '')).replace(/\n+/g, ' / ').slice(0, 300)
    r.refsAfterOmni = { add: await row(1).locator('[data-storyboard-ref-add]').first().getAttribute('data-storyboard-ref-add').catch(() => null), thumbs: await row(1).locator('[data-storyboard-ref-thumb]').count() }
    await snap('07-shot1-omni-mode')
    // 旧 08（底栏 ⋯ 开关弹层）已删：生成音频 / 返回尾帧这类开关现在就在上面这块面板里，06 那张已经照到。
    await win().keyboard.press('Escape')
  })

  await phase('P4-bulk-bar', async (r) => {
    await scrollTo(0)
    r.controls = await editor().locator('[data-storyboard-bulkbar] [aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    await editor().locator('[data-storyboard-bulkbar] button').nth(3).click()
    await settle(400)
    r.aspectOptions = await visibleOptions()
    await snap('09-bulk-aspect-menu')
    await win().keyboard.press('Escape')
  })

  await phase('P5-batch-dialog', async (r) => {
    await win().keyboard.press('Escape')
    const before = nodesOf().length
    await editor().locator('[data-storyboard-batch]').click()
    await win().locator('[data-spend-confirm-dialog]').first().waitFor({ timeout: stationTimeout() })
    await settle(500)
    r.dialogText = (await win().locator('[data-spend-confirm-dialog]').first().innerText()).replace(/\n+/g, ' | ')
    await snap('10-generate-remaining-dialog')
    await win().locator('[data-spend-confirm-action="cancel"]').first().click()
    await settle(3500)
    const after = nodesOf()
    r.nodesBefore = before
    r.nodesAfterCancel = after.length
    r.createdByCancelledBatch = after.map(metaBrief).filter((n) => n.shotId || n.anchorId)
    r.anchorNodesCreated = after.filter((n) => n.meta?.anchorId).length
    r.footerAfterCancel = (await editor().locator('footer').innerText()).replace(/\n+/g, ' | ')
    await snap('11-after-cancel-nodes-left-behind')
  })

  await phase('P6-reference-slot', async (r) => {
    await scrollTo(120)
    const png = path.join(smoke.project.projectRoot, 'assets', 'imported', 'frame-1.png')
    await refAdd(1).click()
    await settle(700)
    await snap('12-ref-picker-empty')
    r.popoverRect = await rectOf('[data-testid="asset-picker"]')
    r.viewportH = (await win().evaluate(() => innerHeight))
    r.popoverTopOverlapsHeader = r.popoverRect ? r.popoverRect.y < 88 : null
    await picker().locator('input[type="file"]').setInputFiles(png)
    await settle(3500)
    await snap('13-ref-picker-after-upload')
    await win().keyboard.press('Escape')
    await settle(500)
    // 删参考的入口：缩略图右上角的 ×（画布同款 AssetTile），不用再点开浮层。
    r.removeButton = await win().evaluate(() => { const b = document.querySelector('[data-storyboard-row="1"] [data-asset-tile-remove]'); const e = b?.getBoundingClientRect(); return e ? { label: b.getAttribute('aria-label'), x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.width), h: Math.round(e.height), color: getComputedStyle(b).color } : null })
    await snap('14-ref-tile-remove-affordance')
    r.tileHasInlineRemove = await row(1).locator('[data-storyboard-ref-thumb] [data-asset-tile-remove]').count()
    r.tileRect = await row(1).locator('[data-storyboard-ref-thumb]').first().boundingBox()
    // @ 引用：只列「某镜结果 / 素材库」？
    const box = row(1).locator('[data-storyboard-prompt-block] [contenteditable="true"]').first()
    await box.click()
    await win().keyboard.press('End')
    await win().keyboard.type(' @', { delay: 60 })
    await settle(900)
    r.mentionMenuGroups = await win().evaluate(() => [...document.querySelectorAll('[role=listbox] *, [data-mention-menu] *')].filter((e) => e.children.length === 0).map((e) => e.textContent.trim()).filter(Boolean).slice(0, 12))
    await snap('15-at-mention-menu')
    await win().getByText('frame-2.png').first().click()
    await settle(800)
    r.chipsAfterPick = await win().locator('[data-storyboard-mention-chip]').allInnerTexts()
    await win().locator('[data-storyboard-mention-chip]').first().click()
    await settle(400)
    r.lightboxOnSingleClick = await win().locator('[aria-modal="true"]').count()
    await win().locator('[data-storyboard-mention-chip]').first().dblclick()
    await settle(1000)
    r.lightboxOnDoubleClick = await win().locator('[aria-modal="true"]').count()
    r.lightboxControls = await win().evaluate(() => [...document.querySelectorAll('[aria-modal="true"] button')].map((b) => (b.getAttribute('aria-label') || b.textContent).trim()))
    await snap('16-chip-double-click-lightbox')
    await win().keyboard.press('Escape')
    await settle(500)
    // 把绑定在槽里删掉，看提示词里的引用还在不在
    r.slotsBefore = await row(1).locator('[data-storyboard-ref-thumb]').count()
    for (let i = 0; i < 3; i += 1) {
      const remove = row(1).locator('[data-storyboard-ref-thumb] [data-asset-tile-remove]').first()
      if (!(await remove.count())) break
      await remove.click()
      await settle(400)
    }
    await settle(600)
    r.chipsAfterBindingRemoved = await win().locator('[data-storyboard-mention-chip]').allInnerTexts()
    r.tilesAfterBindingRemoved = await row(1).locator('[data-storyboard-ref-thumb]').count()
    await snap('17-binding-removed-chips-after')
  })

  await phase('P7-skip-and-selection', async (r) => {
    await scrollTo(120)
    const check = row(2).locator('input[type="checkbox"]')
    r.checkboxAria = await check.getAttribute('aria-label')
    r.checkboxTitle = await check.getAttribute('title')
    const footerBefore = (await editor().locator('footer').innerText()).replace(/\n+/g, ' | ')
    await check.click()
    await settle(600)
    await snap('18-checkbox-means-skip')
    r.rowOpacityAfterCheck = await row(2).evaluate((e) => getComputedStyle(e).opacity)
    r.rowTagAfterCheck = (await row(2).innerText()).replace(/\n+/g, ' | ').slice(0, 160)
    r.footerBefore = footerBefore
    r.footerAfter = (await editor().locator('footer').innerText()).replace(/\n+/g, ' | ')
    // 点行 = 选中；浮条在哪
    await scrollTo(0)
    await row(1).locator('[data-storyboard-frame]').first().click({ position: { x: 5, y: 5 } })
    await settle(600)
    const measure = () => win().evaluate(() => { const bar = document.querySelector('[data-storyboard-selection-toolbar]'); const f = document.querySelector('footer').getBoundingClientRect(); const r = bar?.getBoundingClientRect(); const s = document.querySelector('[data-storyboard-scroll]'); return { present: Boolean(bar), scrollTop: Math.round(s.scrollTop), toolbarY: r && Math.round(r.y), toolbarBottom: r && Math.round(r.bottom), footerTop: Math.round(f.top), visiblePx: r ? Math.max(0, Math.round(Math.min(r.bottom, f.top) - Math.max(r.y, 0))) : 0, position: bar && getComputedStyle(bar).position, parentOverflow: bar && getComputedStyle(bar.parentElement).overflow } })
    r.toolbarAtTop = await measure()
    await snap('19-selected-row-toolbar-not-visible')
    await scrollTo(99999)
    r.toolbarAtBottom = await measure()
    await snap('20-toolbar-only-visible-at-bottom')
    await scrollTo(0)
    // 清掉选中与跳过，免得影响后面的步骤
    await win().locator('[data-storyboard-selection-toolbar] button').last().click().catch(() => {})
    await row(2).locator('input[type="checkbox"]').click()
    await settle(400)
  })

  await phase('P8-anchor-generate', async (r) => {
    await scrollTo(0)
    await editor().locator('[data-storyboard-anchors-toggle="true"]').click()
    await settle(500)
    // 后巷：先换成回环图片模型再生成（零额度）。
    const alley = editor().locator('[data-storyboard-anchor-row="alley"]')
    await modelButton(alley).click()
    await settle(400)
    await win().getByRole('option', { name: /Fixture/ }).first().click()
    await settle(500)
    // 「生成」在参考卡底栏右端（画面格里不再放一颗）。
    await alley.locator('[data-storyboard-composer-bar] [data-storyboard-generate-state]').click()
    for (let i = 0; i < 30; i += 1) { await settle(1000); if (await alley.locator('[data-anchor-face="done"]').count()) break }
    await settle(800)
    await scrollTo(0)
    await snap('21-alley-anchor-generated')
    r.alleyFace = await alley.locator('[data-anchor-face]').first().getAttribute('data-anchor-face')
    // 林薇：先用 GPT Image 2（出网闸会拦 → 失败），换成回环模型再重试：看节点用的是哪个模型。
    const hero = editor().locator('[data-storyboard-anchor-row="hero"]')
    await hero.locator('[data-storyboard-composer-bar] [data-storyboard-generate-state]').click()
    // 等它真的失败再换模型：只等固定 2.5 秒时，失败面还没出来，「重试」那一下就没点上，测的问题落空。
    for (let i = 0; i < 30; i += 1) { await settle(1000); if (await hero.locator('[data-anchor-face="failed"]').count()) break }
    r.heroFailedBeforeRetry = await hero.locator('[data-anchor-face="failed"]').count() > 0
    await modelButton(hero).click()
    await settle(400)
    await win().getByRole('option', { name: /Fixture/ }).first().click()
    await settle(600)
    if (await hero.locator('[data-anchor-face="failed"] button').count()) await hero.locator('[data-anchor-face="failed"] button').click()
    for (let i = 0; i < 30; i += 1) { await settle(1000); if (await hero.locator('[data-anchor-face="done"]').count()) break }
    await settle(800)
    await snap('22-hero-model-changed-then-retry')
    await settle(2500)
    const design = readProject().storyboardDesignsByDocumentId[DOC].find((d) => d.id === DESIGN)
    r.heroPlanModel = design.plan.anchors.find((a) => a.id === 'hero')?.modelKey
    r.heroNode = metaBrief(nodesOf().find((n) => n.meta?.anchorId === 'hero') ?? {})
    { const heroRaw = nodesOf().find((n) => n.meta?.anchorId === 'hero'); r.heroNodeDetail = heroRaw ? { status: heroRaw.status, error: String(heroRaw.error ?? '').slice(0, 200), metaKeys: Object.keys(heroRaw.meta ?? {}).sort() } : null }
    // 自动引用：锚出图后，引用它的镜头有没有拿到
    await editor().locator('[data-storyboard-anchors-toggle="true"]').click()
    await settle(500)
    await scrollTo(120)
    r.anchorChipsAfter = await editor().locator('[data-storyboard-anchor-chip]').allInnerTexts()
    r.shot1Bindings = (design.plan.shots[0].referenceBindings ?? null)
    r.shotRefStates = await editor().locator('[data-storyboard-row]').evaluateAll((els) => els.map((e) => ({ row: e.getAttribute('data-storyboard-row'), thumbs: e.querySelectorAll('[data-storyboard-ref-thumb]').length, add: e.querySelector('[data-storyboard-ref-add]')?.getAttribute('data-storyboard-ref-add') ?? null, prompt: e.querySelector('[data-storyboard-prompt-block]')?.innerText.slice(0, 40) })))
    r.anchorsListedByAnchorIds = design.plan.shots.map((s) => ({ shot: s.index, anchorIds: s.anchorIds }))
    await snap('23-shots-after-anchor-generated')
    // 参考条「+」开的素材选择器里能挑到锚的图吗（手动一张张挑）
    await refAdd(1).click()
    await settle(700)
    r.pickerCanvasSection = await win().evaluate(() => [...document.querySelectorAll('[data-testid="asset-picker"] button')].map((b) => (b.getAttribute('aria-label') || b.title || b.textContent || '').trim()).filter((x) => x && !/^embedded-/.test(x)).slice(0, 8))
    await snap('24-ref-picker-anchor-results')
    await win().keyboard.press('Escape')
  })

  await phase('P9-done-frame', async (r) => {
    await scrollTo(99999)
    await row(4).locator('[data-storyboard-generate-state]').first().click()
    for (let i = 0; i < 25; i += 1) { await settle(1000); if (await row(4).locator('[data-storyboard-frame] img').count()) break }
    await settle(800)
    await row(4).locator('[data-storyboard-frame]').first().hover()
    await settle(500)
    await snap('25-done-shot-frame-actions')
    r.frameActions = await row(4).locator('[data-storyboard-frame] button, [data-storyboard-actbar] button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label') || b.title || b.textContent.trim()))
    // 「用作…」菜单：开在最后一行，被表格 overflow-hidden 截
    await row(4).locator('[data-storyboard-actbar] button, [data-storyboard-frame] button').last().click()
    await settle(500)
    r.useAsMenu = await win().evaluate(() => {
      const items = [...document.querySelectorAll('[data-storyboard-row="4"] *')].filter((e) => e.children.length === 0 && /存为参考|设为首帧|Save as reference|Use as first frame|First frame/i.test(e.textContent))
      const table = document.querySelector('[data-storyboard-rows]').getBoundingClientRect()
      return items.map((e) => { const r = e.getBoundingClientRect(); return { text: e.textContent.trim(), bottom: Math.round(r.bottom), tableBottom: Math.round(table.bottom), clipped: r.bottom > table.bottom } })
    })
    await snap('26-use-as-menu-clipped')
    await win().keyboard.press('Escape')
    // 行 ⋯ 菜单里有没有「清掉结果」
    await row(4).getByRole('button', { name: /更多|more|open|打开/i }).first().click().catch(() => {})
    await settle(400)
    r.rowMenuItems = await win().evaluate(() => [...document.querySelectorAll('[role=menuitem], [role=menu] button')].map((b) => b.textContent.trim()).filter(Boolean))
    await snap('27-row-menu')
    await win().keyboard.press('Escape')
  })

  await phase('P10-agent-drafts', async (r) => {
    await backToCreation()
    const plansInSidebar = () => win().evaluate(() => [...document.querySelectorAll('[data-storyboard-id]')].map((e) => e.getAttribute('data-storyboard-id').slice(0, 11) + ' | ' + e.textContent.trim().slice(0, 24)))
    const img = { providerId: 'apimart', modelId: 'gpt-image-2' }
    const vid = { providerId: 'apimart', modelId: 'kling-v3' }
    r.plansBefore = await plansInSidebar()
    // ① 一份带锚的草稿：锚占掉前几个镜号
    const turn1 = scriptTurn(fixture, { label: 'aud-1', marker: 'AUD1', steps: [
      { name: 'draft_shots', args: { shots: [
        { role: 'anchor', title: t('小满', 'Xiaoman'), prompt: t('扎马尾的小女孩，红雨衣', 'A girl in a ponytail and red raincoat'), taskKind: 'text_to_image', candidate: img, storyboard: { kind: 'character', carrier: 'visual', scope: 'selective' } },
        { role: 'anchor', title: t('雨巷', 'Rain alley'), prompt: t('窄巷，霓虹，积水', 'Narrow alley, neon, puddles'), taskKind: 'text_to_image', candidate: img, storyboard: { kind: 'scene', carrier: 'visual', scope: 'selective' } },
        { title: t('追逐', 'Chase'), prompt: t('小满冲进雨巷，镜头跟拍', 'Xiaoman runs into the alley, tracking'), taskKind: 'text_to_video', durationSec: 5, candidate: vid },
        { title: t('回头', 'Look back'), prompt: t('她回头，车灯扫过', 'She looks back as headlights sweep'), taskKind: 'text_to_video', durationSec: 5, candidate: vid },
      ] } },
      { text: t('分镜写好了，在左侧栏。', 'The storyboard is written; open it in the left column.') },
    ] })
    await sendCreation(win(), t('AUD1: 帮我做 2 镜的分镜方案，别生成。', 'AUD1: make a 2-shot storyboard plan, do not generate.'))
    await turn1.done
    await settle(3000)
    r.toolResult1 = (toolResultText(fixture.requests.at(-1)?.body, 'aud-1-0') || '').match(/"shots":\[[\s\S]*?\],"updatedAt"/)?.[0]?.replace(/"candidate":\{[^}]*\{[^}]*\}[^}]*\}/g, '"candidate":{…}').slice(0, 900) ?? null
    const design1 = readProject().storyboardDesignsByDocumentId[DOC].find((d) => d.id.startsWith('op-'))
    r.createdPlan = { id: design1.id.slice(0, 11), anchors: design1.plan.anchors.map((a) => ({ id: a.id, name: a.name })), shots: design1.plan.shots.map((s) => ({ index: s.index, shotId: s.shotId, prompt: s.prompt })) }
    await openStoryboardEditor(win(), design1.id)
    await editor().waitFor({ timeout: stationTimeout() })
    await settle(1200)
    r.headerCount = (await editor().locator('header').innerText()).replace(/\n+/g, ' ')
    r.rowNumbers = await editor().locator('[data-storyboard-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-storyboard-row')))
    await snap('28-agent-plan-rows-numbered-from-3')
    await backToCreation()
    // ② 「改第 1 镜」：模型自然会用 shot-1——它是一张锚
    const turn2 = scriptTurn(fixture, { label: 'aud-2', marker: 'AUD2', steps: [
      { name: 'draft_shots', args: { operationId: design1.id, shots: [{ shotId: 'shot-1', prompt: t('她站在天台边缘，风吹起雨衣', 'She stands at the rooftop edge, the raincoat blowing') }] } },
      { text: t('第 1 镜已改。', 'Shot 1 is changed.') },
    ] })
    await sendCreation(win(), t('AUD2: 把第 1 镜改成她站在天台边缘。', 'AUD2: change shot 1 so she stands at the rooftop edge.'))
    await turn2.done
    await settle(3000)
    const design2 = readProject().storyboardDesignsByDocumentId[DOC].find((d) => d.id === design1.id)
    r.afterPatchShot1 = { anchors: design2.plan.anchors.map((a) => ({ id: a.id, name: a.name, description: a.description })), shots: design2.plan.shots.map((s) => ({ index: s.index, shotId: s.shotId, prompt: s.prompt })) }
    // ③ 宿主自己的提示「镜头下一轮再补」→ 模型第二次新建 → 左栏多一份
    const turn3 = scriptTurn(fixture, { label: 'aud-3', marker: 'AUD3', steps: [
      { name: 'draft_shots', args: { shots: [{ role: 'anchor', title: t('阿哲', 'Azhe'), prompt: t('戴眼镜的青年', 'A young man with glasses'), taskKind: 'text_to_image', candidate: img, storyboard: { kind: 'character', carrier: 'visual' } }] } },
      { name: 'draft_shots', args: { shots: [{ title: t('开场', 'Opening'), prompt: t('阿哲推门走进咖啡店', 'Azhe pushes the door into the cafe'), taskKind: 'text_to_video', durationSec: 5, candidate: vid }, { title: t('对话', 'Talk'), prompt: t('阿哲与店员交谈', 'Azhe talks with the clerk'), taskKind: 'text_to_video', durationSec: 5, candidate: vid }] } },
      { text: t('做好了。', 'Done.') },
    ] })
    await sendCreation(win(), t('AUD3: 做一个咖啡店的分镜，先立角色再排镜头。', 'AUD3: make a cafe storyboard — set up the character first, then the shots.'))
    await turn3.done
    await settle(3000)
    r.firstCreateNote = (toolResultText(fixture.requests.at(-1)?.body, 'aud-3-0') || '').match(/"note":"[^"]*"/)?.[0] ?? null
    r.plansAfter = await plansInSidebar()
    await snap('29-sidebar-several-plans-for-one-request')
  })

  await phase('P11-min-window', async (r) => {
    const browserWindow = await smoke.app.browserWindow(win())
    await browserWindow.evaluate((target) => { target.setContentSize(1100, 690) })
    await win().setViewportSize({ width: 1100, height: 690 })
    await settle(900)
    r.viewport = await win().evaluate(() => ({ w: innerWidth, h: innerHeight }))
    await openEditor()
    await scrollTo(0)
    await snap('30-min-window-editor')
    await editor().locator('[data-storyboard-anchors-toggle="true"]').click()
    await settle(600)
    await snap('31-min-window-anchors-expanded')
    await editor().locator('[data-storyboard-anchors-toggle="true"]').click()
    await settle(400)
    await scrollTo(120)
    await refAdd(1).click().catch(() => {})
    await settle(700)
    await snap('32-min-window-ref-picker')
    r.minPopoverRect = await rectOf('[data-testid="asset-picker"]')
    await win().keyboard.press('Escape')
    await row(3).locator('[data-storyboard-frame]').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
    await settle(600)
    await snap('33-min-window-selected-row')
    r.minToolbar = await rectOf('[data-storyboard-selection-toolbar]')
    // 横向溢出
    r.horizontalOverflow = await win().evaluate(() => document.documentElement.scrollWidth > innerWidth)
    await browserWindow.evaluate((target) => { target.setContentSize(1280, 800) })
    await win().setViewportSize({ width: 1280, height: 800 })
  })
} finally {
  O.egressVendorHostsBlocked = [...new Set(readEgressLog(path.join(tmpDir, `egress-${locale}.jsonl`)).filter((e) => e.kind === 'blocked' && /apimart|jimeng|volc|dreamina/i.test(String(e.host))).map((e) => e.host))]
  O.fixtureImageRequests = fixture.images.length
  O.fixtureVideoRequests = fixture.videos.length
  fs.writeFileSync(path.join(outDir, 'observations.json'), JSON.stringify(O, null, 2))
  await smoke.close().catch(() => undefined)
  await egress.close().catch(() => undefined)
  await relay.close().catch(() => undefined)
}
console.log('[audit] done', locale, Object.keys(O.errors).length ? `errors in ${Object.keys(O.errors).join(',')}` : 'no phase errors')
process.exit(0)
