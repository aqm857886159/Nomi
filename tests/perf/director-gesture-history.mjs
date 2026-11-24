// Run after pnpm build. Exercise the shipped inspector in an isolated Electron
// project. Schedule input on animation frames to keep driver latency out of p95.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { launchNomiApp, closeNomiApp } from '../ux/_launchApp.mjs'
import { addCanvasNodeFromRail } from '../ux/_canvasRail.mjs'
import { enterRefine } from '../ux/_directorLab.mjs'
import { createBlankProject, switchWorkspace } from '../ux/_shell.mjs'
import { uiTextWith } from '../ux/full-walk/invariants.mjs'

const { values } = parseArgs({
  options: {
    runs: { type: 'string' },
    out: { type: 'string' },
  },
  allowPositionals: true,
})
const runs = values.runs ? Number(values.runs) : 1
assert.ok(Number.isInteger(runs) && runs >= 1, '--runs must be a positive integer')

const locale = 'en'
const t = key => uiTextWith(locale, key)
const { app, win } = await launchNomiApp({
  name: 'director-gesture-history',
  initialLocalStorage: {
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
    'nomi:canvas-gesture-hint:v1': 'seen',
    'nomi:locale:v1': locale,
  },
})

try {
  await createBlankProject(win)
  await switchWorkspace(win, 'generation')
  await win.locator('[data-empty-canvas-tasks] [data-add-intent="image"]').click()
  await addCanvasNodeFromRail(win, 'director')
  const arrival = win.locator('[data-canvas-arrival-hint]')
  if (await arrival.count()) await arrival.click()
  await win.getByTestId('director-node-open').click()
  await enterRefine(win)
  await win.getByTestId('director-scene-menu').click()
  await win.getByText(t('director.topbar.sceneSettings'), { exact: true }).click()

  const editor = win.getByTestId('director-editor')
  const field = editor.locator('label').filter({ hasText: t('director.inspector.gridHeight') })
  const slider = field.locator('input[type=range]')
  const displayed = field.locator('input[type=text]')
  const undo = editor.getByRole('button', { name: new RegExp(t('director.bottomBar.undo')) })
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const toggle = editor.getByRole('switch', { name: t('director.inspector.gridVisible'), exact: true })
  for (let i = 0; i < 50; i++) await toggle.click()
  assert.ok(await undo.isEnabled(), 'Filling history must enable the topbar undo button')

  const frameGapP95 = []
  const longTasks = []

  for (let runIndex = 0; runIndex < runs; runIndex++) {
    let worstP95 = 0
    let runLongTasks = 0
    for (const mode of ['drag', 'wheel']) {
      const initial = Number(await displayed.inputValue())
      const result = await slider.evaluate(async (input, mode) => {
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
        const updateValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        const stringify = JSON.stringify
        let projectSerializations = 0
        let observedLongTasks = 0
        let observer = null
        try {
          observer = new PerformanceObserver((list) => { observedLongTasks += list.getEntries().length })
          observer.observe({ type: 'longtask' })
        } catch { /* unsupported in environment */ }
        JSON.stringify = function (value, ...args) {
          if (value?.activeSceneId && Array.isArray(value.scenes)) projectSerializations++
          return stringify.call(this, value, ...args)
        }
        const intervals = []
        let changes = 0
        const start = Number(input.value)
        let previous = await frame()
        try {
          if (mode === 'drag') input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
          for (let i = 0; i < 120; i++) {
            const oldValue = input.value
            if (mode === 'wheel') {
              // Reverse periodically to stay within the slider range for two seconds.
              const up = i % 32 < 16
              input.dispatchEvent(new WheelEvent('wheel', { deltaY: up ? -1 : 1, bubbles: true, cancelable: true }))
            } else {
              updateValue.call(input, String(((i % 30) + 1) / 10))
              input.dispatchEvent(new Event('input', { bubbles: true }))
            }
            const now = await frame()
            intervals.push(now - previous)
            previous = now
            if (input.value !== oldValue) changes++
          }
        } finally {
          if (mode === 'drag') input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
          JSON.stringify = stringify
          observer?.disconnect()
        }
        intervals.sort((a, b) => a - b)
        return {
          mode,
          run: mode,
          changes,
          projectSerializations,
          longTasks: observedLongTasks,
          start,
          end: Number(input.value),
          p50: Math.round(intervals[59] * 10) / 10,
          p95: Math.round(intervals[113] * 10) / 10,
          max: Math.round(intervals.at(-1) * 10) / 10,
        }
      }, mode)
      console.log(JSON.stringify({ runIndex, ...result }))
      assert.equal(result.changes, 120)
      assert.notEqual(result.end, initial)
      await slider.press(`${mod}+z`)
      assert.equal(Number(await displayed.inputValue()), initial)
      await slider.press(`${mod}+Shift+z`)
      assert.equal(Number(await displayed.inputValue()), result.end)
      assert.equal(result.projectSerializations, 0)
      assert.ok(result.p95 <= 33, `${mode} frame p95 exceeded 33 ms`)
      worstP95 = Math.max(worstP95, result.p95)
      runLongTasks += result.longTasks
    }
    frameGapP95.push(worstP95)
    longTasks.push(runLongTasks)
  }

  let depth = 0
  while (await undo.isEnabled() && depth <= 50) {
    await undo.click()
    depth++
  }
  assert.equal(depth, 50)
  console.log(JSON.stringify({ depth }))

  if (values.out) {
    const outPath = path.resolve(values.out)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, `${JSON.stringify({
      runs,
      noisy: false,
      metrics: {
        frameGapP95,
        longTasks,
      },
    }, null, 2)}\n`)
  }
} finally {
  await closeNomiApp(app)
}
