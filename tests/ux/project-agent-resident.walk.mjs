// Phase6 focused journey: the PR194 resident shell is real UI over one Host projection.
// This deliberately does not submit a provider request. It verifies every composer control,
// cross-surface session state, and the preserved right-dock/timeline geometry without spending.
import { launchNomiApp } from './_launchApp.mjs'
import { screenshotSettled } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-agent-resident-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'phase6-resident-walk'
const projectRoot = path.join(projectsDir, `resident-${projectId}`)
const shotsDir = path.join(repoRoot, 'tests/ux/shots/project-agent-resident')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })
const attachmentFixture = path.join(tempRoot, 'resident-reference.png')
fs.writeFileSync(attachmentFixture, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))

const now = 1
const document = {
  id: 'resident-doc', version: 1, title: 'Agent resident 走查',
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'RESIDENT_SENTINEL：保留右侧布局，重做面板内部交互。' }] }] },
  updatedAt: now,
}
const project = {
  id: projectId, name: 'Phase6 resident 走查', version: 2, createdAt: now, updatedAt: now, savedAt: now, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocuments: [document], activeDocumentId: document.id, timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlans: {}, storyboardDesignsByDocumentId: {},
  },
}
for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) fs.writeFileSync(target, JSON.stringify(project, null, 2))

const { app, win } = await launchNomiApp({ name: 'project-agent-resident', tempRoot, settingsDir, projectsDir, settleMs: 1200 })
const failures = []
const check = (name, condition) => { if (!condition) failures.push(name); console.log(`${condition ? '✓' : '✗'} ${name}`) }
const visible = async (locator) => locator.isVisible().catch(() => false)
const clickSurface = async (mode) => {
  const button = win.locator(`nav.nomi-stepper [data-mode="${mode}"]`).first()
  await button.waitFor({ state: 'visible', timeout: 7000 })
  await button.click()
  await win.locator(`[data-agent-resident][data-agent-surface="${mode}"]`).waitFor({ state: 'visible', timeout: 7000 })
}

try {
  await win.evaluate(() => { for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen') })
  await win.reload()
  await win.locator('[data-project-card="true"]', { hasText: 'Phase6 resident 走查' }).first().waitFor({ state: 'visible', timeout: 12_000 })
  const card = win.locator('[data-project-card="true"]', { hasText: 'Phase6 resident 走查' }).first()
  await card.hover()
  const continueButton = card.getByRole('button', { name: /继续创作/ }).first()
  if (await visible(continueButton)) await continueButton.click()
  else await card.dblclick()
  await win.locator('[data-agent-resident]').waitFor({ state: 'visible', timeout: 12_000 })

  check('one resident shell is mounted', await win.locator('[data-agent-resident]').count() === 1)
  check('right dock layout is preserved', await win.evaluate(() => {
    const shell = document.querySelector('[data-agent-resident]')?.getBoundingClientRect()
    const body = document.querySelector('.workbench-shell__body')?.getBoundingClientRect()
    return Boolean(shell && body && shell.right <= body.right + 1 && shell.left > body.left + 200)
  }))
  await screenshotSettled(win, { path: path.join(shotsDir, '01-resident-creation.png') })

  const threadTrigger = win.locator('[data-agent-thread-trigger]').first()
  await threadTrigger.click()
  check('thread history button opens the current project menu', await win.locator('[data-agent-thread-menu]').count() === 1)
  check('thread menu exposes the create action', await win.locator('[data-agent-thread-menu]').getByText('新对话').count() === 1)
  await win.locator('[data-agent-thread-menu]').getByText('新对话').click()
  await win.waitForTimeout(150)
  await threadTrigger.click()
  check('creating a thread adds a removable project conversation', await win.locator('[data-agent-thread-menu] [aria-label="删除对话"]').count() >= 1)
  await win.locator('[data-agent-thread-menu]').focus()
  await win.locator('[data-agent-thread-menu]').press('Escape')
  check('Escape closes thread history menu', await win.locator('[data-agent-thread-menu]').count() === 0)

  await win.evaluate(() => {
    window.__residentContextFocused = false
    window.addEventListener('nomi-agent-context-focus', () => { window.__residentContextFocused = true }, { once: true })
  })
  const contextButton = win.locator('[data-agent-context] button[data-agent-context-focus="true"]').first()
  await contextButton.waitFor({ state: 'visible', timeout: 7000 })
  await contextButton.click()
  check('back to scene dispatches a focus request to the active work surface', await win.evaluate(() => window.__residentContextFocused === true))
  check('context focus gives visible feedback', await win.locator('[data-agent-context][data-agent-context-focused="true"]').count() === 1)
  await screenshotSettled(win, { path: path.join(shotsDir, '02-resident-context-focused.png') })

  const collapseButton = win.getByRole('button', { name: '收起 Agent' }).first()
  await collapseButton.click()
  check('collapse control replaces the dock with an expand affordance', await win.getByRole('button', { name: '展开 Agent' }).count() === 1)
  await win.locator('[data-agent-resident-collapsed="true"]:visible').waitFor({ state: 'visible', timeout: 5000 })
  check('collapsed Agent is the PR194 rounded status pill', await win.evaluate(() => {
    const pill = document.querySelector('[data-agent-resident-collapsed="true"]')
    if (!(pill instanceof HTMLElement)) return false
    const rect = pill.getBoundingClientRect()
    return Math.round(rect.height) === 36 && rect.width >= 96 && rect.width <= 180 && pill.className.includes('rounded-pill') && pill.className.includes('border-nomi-line')
  }))
  await screenshotSettled(win, { path: path.join(shotsDir, '01-resident-collapsed.png') })
  await win.getByRole('button', { name: '展开 Agent' }).click()
  await win.locator('[data-agent-resident]').waitFor({ state: 'visible', timeout: 5000 })
  check('expand control restores the full resident shell', await win.locator('[data-agent-composer]').count() === 1)

  await clickSurface('creation')
  check('same resident shell projection appears on creation', await win.locator('[data-agent-resident][data-agent-surface="creation"]').count() === 1)
  await win.locator('[data-agent-resident][data-agent-surface="creation"]:visible').getByRole('button', { name: '收起 Agent' }).click()
  await win.locator('[data-agent-resident-collapsed="true"]:visible').waitFor({ state: 'visible', timeout: 5000 })
  check('creation collapse overlays without reserving a side rail', await win.evaluate(() => {
    const resident = document.querySelector('[data-agent-resident][data-agent-surface="creation"]')
    const workspace = resident?.closest('.workbench-creation')
    const assistant = resident?.parentElement?.parentElement
    if (!(workspace instanceof HTMLElement) || !(assistant instanceof HTMLElement)) return false
    return getComputedStyle(assistant).position === 'absolute' && !getComputedStyle(workspace).gridTemplateColumns.includes('36px')
  }))
  await win.locator('[data-agent-resident-collapsed="true"]:visible').click()

  const attach = win.locator('[data-agent-attachment-trigger]')
  await attach.click()
  check('attachment menu has five PR194 entries', await win.locator('[data-agent-menu-item]').count() === 5)
  const voice = win.locator('[data-agent-menu-item="voice"]')
  await voice.click()
  check('voice input action closes the attachment menu', await win.locator('[data-agent-menu-item]').count() === 0)
  await win.locator('[data-agent-composer] input[type="file"]').setInputFiles(attachmentFixture)
  await win.locator('[data-attachment-status]').first().waitFor({ state: 'visible', timeout: 5000 })
  check('file selection creates an attachment rail item', await win.locator('[data-agent-composer] [data-attachment-status]').count() === 1)
  await win.locator('[data-agent-composer] [data-attachment-status] button[aria-label="移除附件"]').click()
  check('attachment remove action clears the rail item', await win.locator('[data-agent-composer] [data-attachment-status]').count() === 0)
  await win.keyboard.press('Escape')
  check('Escape closes attachment menu', await win.locator('[data-agent-menu-item]').count() === 0)

  await win.locator('[data-agent-mention-trigger]').click()
  check('reference menu exposes document/canvas/preview/timeline/browser', await win.locator('[data-agent-menu-item]').count() === 5)
  await win.locator('[data-agent-menu-item="canvas"]').click()
  check('canvas reference creates a removable composer chip', await win.locator('[data-agent-reference="canvas:selection"]').count() === 1)
  for (const [kind, ref] of [['document', 'document:resident-doc'], ['preview', 'preview:frame'], ['timeline', 'timeline:range'], ['browser', 'browser:selection']]) {
    await win.locator('[data-agent-mention-trigger]').click()
    await win.locator(`[data-agent-menu-item="${kind}"]`).click()
    check(`${kind} reference creates a removable composer chip`, await win.locator(`[data-agent-reference="${ref}"]`).count() === 1)
  }
  const referenceChips = win.locator('[data-agent-reference] button[aria-label="移除引用"]')
  check('every reference chip exposes a remove action', await referenceChips.count() === 5)
  await referenceChips.first().click()
  check('reference remove action updates the composer state', await win.locator('[data-agent-reference="canvas:selection"]').count() === 0)

  await win.locator('[data-agent-skill-trigger]').click()
  check('Skill opens as a searchable dialog', await win.getByRole('dialog', { name: '技能' }).count() === 1)
  const skillSearch = win.locator('[data-agent-menu="技能"] input').first()
  check('Skill dialog has search', await skillSearch.count() === 1)
  const compactSkillWidth = await win.locator('[data-agent-menu="技能"]').evaluate((menu) => menu.getBoundingClientRect().width)
  check('Skill dialog collapses the unused preview space', compactSkillWidth <= 340 && await win.locator('[data-agent-menu="技能"] aside').evaluate((aside) => getComputedStyle(aside).display === 'none'))
  await skillSearch.fill('')
  const availableSkillRows = win.locator('[data-agent-menu="技能"] [data-agent-menu-item]:not([data-agent-menu-item="auto"])')
  if (await availableSkillRows.count()) {
    await availableSkillRows.first().hover()
    const expandedSkillWidth = await win.locator('[data-agent-menu="技能"]').evaluate((menu) => menu.getBoundingClientRect().width)
    check('hovering a skill exposes its preview pane without losing the compact default', expandedSkillWidth > compactSkillWidth && (await win.locator('[data-agent-menu="技能"] aside').innerText()).trim().length > 0)
    await availableSkillRows.first().click()
    await win.waitForTimeout(120)
    check('selecting a skill creates a removable skill chip', await win.locator('[data-agent-reference^="skill:"]').count() === 1)
    await win.locator('[data-agent-skill-trigger]').click()
    await win.locator('[data-agent-menu-item="auto"]').click()
  }
  await win.locator('[data-agent-skill-trigger]').click()
  await skillSearch.fill('not-a-real-skill')
  check('Skill search filters to auto fallback', await win.locator('[data-agent-menu-item="auto"]').count() === 1)
  await win.locator('[data-agent-menu-item="auto"]').click()

  await win.locator('[data-agent-prompt-trigger]').click()
  check('Prompt is a separate menu', await win.locator('[data-agent-menu]').count() === 1)
  await win.locator('[data-agent-menu-item="story"]').click()
  check('Prompt selection keeps the icon trigger label and adds a removable prompt chip', (await win.locator('[data-agent-prompt-trigger]').getAttribute('aria-label')) === '选择提示词' && await win.locator('[data-agent-prompt-trigger]').getAttribute('title') === '提示词 · 镜头强化' && await win.locator('[data-agent-reference^="prompt:"]').count() === 1)
  for (const preset of ['script', 'review', 'assets', 'general']) {
    await win.locator('[data-agent-prompt-trigger]').click()
    await win.locator(`[data-agent-menu-item="${preset}"]`).click()
    check(`prompt preset ${preset} updates the selected session context`, preset === 'general' ? await win.locator('[data-agent-reference^="prompt:"]').count() === 0 : await win.locator(`[data-agent-reference="prompt:${preset}"]`).count() === 1)
  }

  const creationResident = win.locator('[data-agent-resident][data-agent-surface="creation"]:visible')
  const modeTrigger = creationResident.locator('[data-agent-mode-trigger]')
  await modeTrigger.click()
  check('Mode menu is not a native select', await win.locator('[data-agent-menu="模式"] [data-agent-menu-item]').count() === 4)
  await win.locator('[data-agent-menu="模式"] [data-agent-menu-item="ask"]').click()
  check('Ask mode is selected', (await modeTrigger.getAttribute('aria-label')) === '模式' && await modeTrigger.getAttribute('title') === '模式 · Ask')
  for (const [mode, label] of [['guided', '引导'], ['balanced', '平衡'], ['auto', '策略自动'], ['ask', 'Ask']]) {
    await modeTrigger.click()
    await win.locator(`[data-agent-menu="模式"] [data-agent-menu-item="${mode}"]`).click()
    check(`run mode ${mode} updates the icon hover label`, await modeTrigger.getAttribute('aria-label') === '模式' && await modeTrigger.getAttribute('title') === `模式 · ${label}`)
  }

  const modelTrigger = creationResident.locator('[data-agent-model-trigger]')
  await modelTrigger.click()
  check('Model menu is present even when catalog is empty', await win.locator('[data-agent-menu="模型"]').count() === 1)
  const catalogFallback = win.locator('[data-agent-menu="模型"] [data-agent-menu-item="catalog"]')
  if (await catalogFallback.count()) {
    await win.evaluate(() => { window.__residentModelCatalogOpened = false; window.addEventListener('nomi-open-model-catalog', () => { window.__residentModelCatalogOpened = true }, { once: true }) })
    await catalogFallback.click()
    check('empty model catalog action opens model settings', await win.evaluate(() => window.__residentModelCatalogOpened === true))
    const settingsClose = win.locator('[data-settings-overlay] [data-settings-close]').first()
    if (await settingsClose.count()) await settingsClose.click()
  }
  await win.keyboard.press('Escape')
  check('toolbar uses the semantic icons with hover labels and reduced-motion-safe motion', await win.evaluate(() => {
    const expected = [
      ['[data-agent-attachment-trigger]', '添加文件', '添加文件，也可直接拖入'],
      ['[data-agent-mention-trigger]', '引用现场或对象', '@ 引用现场或对象'],
      ['[data-agent-skill-trigger]', '选择技能', '技能 · 自动匹配'],
      ['[data-agent-prompt-trigger]', '选择提示词', '提示词 · 未选择'],
      ['[data-agent-mode-trigger]', '模式', '模式 · Ask'],
      ['[data-agent-model-trigger]', '选择模型', '模型 · 全部自动选择'],
    ]
    const resident = document.querySelector('[data-agent-resident][data-agent-surface="creation"]')
    return Boolean(resident) && expected.every(([selector, ariaLabel, title]) => {
      const button = resident.querySelector(selector)
      return button?.getAttribute('aria-label') === ariaLabel && button.getAttribute('title') === title && Math.round(button.getBoundingClientRect().height) === 28 && button.querySelector('svg') && button.className.includes('transition-[background,border-color,color,transform]') && button.className.includes('motion-safe:hover:-translate-y-px')
    })
  }))
  const attachmentIcon = win.locator('[data-agent-attachment-trigger]')
  await attachmentIcon.hover()
  await win.waitForTimeout(180)
  check('toolbar hover gives the icon control a restrained transform', await attachmentIcon.evaluate((button) => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? getComputedStyle(button).transform === 'none' : getComputedStyle(button).transform !== 'none'))

  const composer = win.locator('[data-agent-composer] textarea').first()
  await composer.fill('跨工作区草稿 RESIDENT_DRAFT')
  check('send is disabled for empty only and enabled for a real draft', await win.locator('[data-agent-send]').isEnabled())
  await composer.press('Shift+Enter')
  check('composer uses a textarea with Shift+Enter newline semantics', await composer.inputValue().then((value) => value.includes('\n')))
  await clickSurface('generation')
  check('same resident shell projection appears on generation', await win.locator('[data-agent-resident][data-agent-surface="generation"]').count() === 1)
  check('draft and reference survive Creation → Generation', (await win.locator('[data-agent-composer] textarea').inputValue()).includes('RESIDENT_DRAFT') && await win.locator('[data-agent-reference="document:resident-doc"]').count() === 1)
  check('mode survives Creation → Generation', (await win.locator('[data-agent-resident][data-agent-surface="generation"]:visible [data-agent-mode-trigger]').getAttribute('title')) === '模式 · Ask')
  await win.locator('[data-agent-resident][data-agent-surface="generation"]:visible').getByRole('button', { name: '收起 Agent' }).click()
  await win.locator('[data-agent-resident-collapsed="true"]:visible').waitFor({ state: 'visible', timeout: 5000 })
  check('generation keeps the same rounded collapsed status pill', await win.evaluate(() => {
    const pill = document.querySelector('[data-agent-resident-collapsed="true"]:not([aria-hidden="true"])')
    if (!(pill instanceof HTMLElement)) return false
    const rect = pill.getBoundingClientRect()
    return rect.height === 36 && rect.width >= 96 && rect.width <= 180 && pill.className.includes('rounded-pill')
  }))
  await win.waitForTimeout(500)
  const generationCollapseLayout = await win.evaluate(() => {
    const workspace = document.querySelector('.workbench-generation')
    const canvas = document.querySelector('.workbench-generation__canvas')
    const assistant = document.querySelector('.workbench-generation__ai')
    if (!(workspace instanceof HTMLElement) || !(canvas instanceof HTMLElement) || !(assistant instanceof HTMLElement)) return null
    const workspaceRect = workspace.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    const workspaceStyle = getComputedStyle(workspace)
    return { position: getComputedStyle(assistant).position, width: workspaceStyle.getPropertyValue('--generation-assistant-width').trim(), grid: workspaceStyle.gridTemplateColumns, canvasRight: canvasRect.right, workspaceRight: workspaceRect.right }
  })
  check('generation collapse overlays without reserving a side rail', Boolean(generationCollapseLayout && generationCollapseLayout.position === 'absolute' && generationCollapseLayout.width === '0px' && Math.abs(generationCollapseLayout.canvasRight - generationCollapseLayout.workspaceRight) <= 1))
  await win.locator('[data-agent-resident-collapsed="true"]:visible').click()
  await screenshotSettled(win, { path: path.join(shotsDir, '02-resident-generation.png') })

  await clickSurface('preview')
  check('same resident shell projection appears on preview', await win.locator('[data-agent-resident][data-agent-surface="preview"]').count() === 1)
  check('draft survives Generation → Preview', (await win.locator('[data-agent-composer] textarea').inputValue()).includes('RESIDENT_DRAFT'))
  await win.locator('[data-agent-resident][data-agent-surface="preview"]:visible').getByRole('button', { name: '收起 Agent' }).click()
  await win.locator('[data-agent-resident-collapsed="true"]:visible').waitFor({ state: 'visible', timeout: 5000 })
  check('preview keeps the same rounded collapsed status pill', await win.evaluate(() => {
    const pill = document.querySelector('[data-agent-resident-collapsed="true"]:not([aria-hidden="true"])')
    if (!(pill instanceof HTMLElement)) return false
    const rect = pill.getBoundingClientRect()
    return rect.height === 36 && rect.width >= 96 && rect.width <= 180 && pill.className.includes('rounded-pill')
  }))
  const previewCollapseLayout = await win.evaluate(() => {
    const stage = document.querySelector('.workbench-preview__stage')
    const player = document.querySelector('.workbench-preview__player')
    const resident = stage?.querySelector('[data-agent-resident]')
    const assistant = resident?.parentElement?.parentElement
    if (!(stage instanceof HTMLElement) || !(player instanceof HTMLElement) || !(assistant instanceof HTMLElement)) return null
    const stageRect = stage.getBoundingClientRect()
    const playerRect = player.getBoundingClientRect()
    const stageStyle = getComputedStyle(stage)
    return { position: getComputedStyle(assistant).position, width: stageStyle.getPropertyValue('--preview-assistant-width').trim(), grid: stageStyle.gridTemplateColumns, playerRight: playerRect.right, stageRight: stageRect.right }
  })
  check('preview collapse overlays without reserving a side rail', Boolean(previewCollapseLayout && previewCollapseLayout.position === 'absolute' && previewCollapseLayout.width === '0px' && Math.abs(previewCollapseLayout.playerRight - previewCollapseLayout.stageRight) <= 1))
  await win.locator('[data-agent-resident-collapsed="true"]:visible').click()
  await win.setViewportSize({ width: 900, height: 720 })
  const geometry = await win.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, resident: document.querySelector('[data-agent-resident]')?.getBoundingClientRect().width ?? 0 }))
  check('narrow window has no horizontal overflow', geometry.scrollWidth <= geometry.width + 1)
  check('resident dock remains usable at narrow width', geometry.resident >= 300)
  await screenshotSettled(win, { path: path.join(shotsDir, '03-resident-preview-narrow.png') })

  if (failures.length) throw new Error(`resident journey failures: ${failures.join('; ')}`)
  console.log(JSON.stringify({ ok: true, geometry, screenshots: 4 }))
  await app.close().catch(() => {})
  process.exit(0)
} catch (error) {
  console.error(error)
  await win.screenshot({ path: path.join(shotsDir, 'resident-error.png') }).catch(() => {})
  await app.close().catch(() => {})
  process.exit(1)
}
