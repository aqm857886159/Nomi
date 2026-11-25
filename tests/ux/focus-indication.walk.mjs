// Real Electron tasks: draft in composer, find a project, focus a settings field,
// and edit a storyboard cell. No production DOM/CSS injection or paid generation.
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { expect } from './_assert.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { backToLibrary, closeSettings, openSettings, switchWorkspace } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { assertOutsideRepo } from './uiDriverOptions.mjs'
import {
  createRuntimeWalk, openCanvas, CANVAS_PANEL, COMPOSER, COMPOSER_INPUT, COMPOSER_ADD_FILE, expectComposerText } from './agent-runtime-walk-support.mjs'
process.env.NOMI_WALK_OUT = assertOutsideRepo(makeTempDir('nomi-focus-indication-'))
process.env.EVIDENCE_DIR = process.env.NOMI_WALK_OUT
const walk = await createRuntimeWalk('focus-indication')
let failure
try {
  const { win } = await walk.start({ first: true })
  walk.report.focus = []
  walk.report.surfaces = []
  const recordSurface = async (label, root = win.locator('body')) => {
    const counts = await root.locator('input,textarea,button,a[href],select,summary,[tabindex],[contenteditable]').evaluateAll(elements => {
      const visible = elements.filter(e => { const r=e.getBoundingClientRect(); const s=getComputedStyle(e); return r.width>0 && r.height>0 && s.visibility!=='hidden' && !e.closest('[inert]') })
      return { visible: visible.length, enabled: visible.filter(e=>!e.disabled).length }
    })
    walk.report.surfaces.push({ label, ...counts })
  }
  const measure = (target) => target.evaluate(e => {
    const s = getComputedStyle(e)
    const probe = document.createElement('span'); document.body.append(probe)
    probe.style.color='var(--nomi-ink-40)'; const accent=getComputedStyle(probe).color // 文本框聚焦线（深一档灰，非强调色）
    probe.style.color='var(--nomi-focus)'; const token=getComputedStyle(probe).color
    probe.remove()
    return { focused:document.activeElement===e, visible:e.matches(':focus-visible'), outlineStyle:s.outlineStyle, outlineWidth:s.outlineWidth, outlineColor:s.outlineColor, borderColor:s.borderColor, borderWidth:s.borderWidth, accent, token }
  })
  const inspectText = async (label, target, container = target) => {
    await expect(target, label).toBeVisible()
    await target.click()
    const mouse = await measure(target)
    expect(mouse.focused, `${label} actually focused`).toBe(true)
    expect(mouse.outlineStyle, `${label} has no pointer outer ring`).toBe('none')
    await expect.poll(async () => (await measure(container)).borderColor, { message: `${label} container focus color` }).toBe(mouse.accent)
    await walk.snap(`${label}-mouse`)
    await win.keyboard.press('Tab'); await win.keyboard.press('Shift+Tab')
    const keyboard = await measure(target)
    expect(keyboard.focused, `${label} Tab roundtrip`).toBe(true)
    expect(keyboard.outlineStyle, `${label} keyboard text has no outer ring`).toBe('none')
    walk.report.focus.push({ label, mouse, keyboard, container: await measure(container) })
  }
  // The first-run library has no search field. Create a project through the UI to enter the projects list.
  await walk.newProject()
  await backToLibrary(win)
  const search = win.getByRole('searchbox', { name: uiText('zh-CN', 'library.searchPlaceholder'), exact: true })
  await inspectText('library-search', search, search.locator('..'))
  await search.fill('FOCUS-JOURNEY')
  await expect(search).toHaveValue('FOCUS-JOURNEY')
  await search.fill('')
  await recordSurface('library')
  await walk.newProject()
  await openCanvas(win)
  const input = win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT}`)
  const composer = win.locator(`${CANVAS_PANEL} ${COMPOSER}`)
  await input.fill('远景，雨后的街道。先保留这条创作草稿。')
  await inspectText('canvas-composer', input, composer)
  await win.keyboard.press('Tab')
  await expect(composer.locator('[data-reference-entry="true"]'), 'Tab reaches the canvas reference picker first').toBeFocused()
  await win.keyboard.press('Tab')
  const button = win.locator(`${CANVAS_PANEL} ${COMPOSER_ADD_FILE}`)
  const keyboard = await measure(button)
  expect(keyboard.focused, 'Tab reaches add-file button').toBe(true)
  expect(keyboard.outlineStyle).toBe('solid')
  expect(keyboard.outlineWidth).toBe('2px')
  expect(keyboard.outlineColor).toBe(keyboard.token)
  walk.report.focus.push({ label:'canvas-button-keyboard', keyboard })
  await walk.snap('canvas-button-keyboard')
  await recordSurface('canvas')
  const settings = await openSettings(win, { tab: 'ai' })
  await settings.locator('[data-settings-custom-relay] summary').click()
  const relayEndpoint = settings.locator('[data-settings-field="asset-relay-endpoint"]')
  await inspectText('settings-relay-endpoint', relayEndpoint)
  await recordSurface('settings', settings)
  await closeSettings(win)
  await expectComposerText(input, '远景，雨后的街道。先保留这条创作草稿。', '创作草稿切走再回来还在')
  await switchWorkspace(win, 'creation')
  await openStoryboardEditor(win)
  const storyboard = win.locator('[data-storyboard-editor="true"]')
  await expect(storyboard).toBeVisible()
  const cell = storyboard.locator('[data-storyboard-row="1"] [contenteditable="true"]')
  await expect(cell).toBeVisible()
  await cell.fill('远景：雨后街道，行人走过路灯。')
  const cellContainer = cell.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " border ")][1]')
  await inspectText('storyboard-cell', cell, cellContainer)
  await expect(cell).toContainText('远景：雨后街道')
  walk.report.focus.push({label:'storyboard-cell', mouse:await measure(cell), ancestors:await cell.evaluate(e=>{const out=[];for(let x=e;x&&out.length<6;x=x.parentElement)out.push({tag:x.tagName,class:x.className,border:getComputedStyle(x).border});return out})})
  await recordSurface('storyboard',storyboard)
} catch (error) { failure=error } finally { await walk.finish(failure) }
