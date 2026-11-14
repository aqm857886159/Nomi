// Zero-spend journeys using the real NodeParameterControls and desktop catalog.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { launchNomiApp, repoRoot, seedSavedFixtureCredentials } from './_launchApp.mjs'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { expect, expectAbsent, proveProbe } from './_assert.mjs'

const out = path.join(repoRoot, 'artifacts/chip-contract-limits')
fs.mkdirSync(out, { recursive: true })
const port = 5337
const url = `http://127.0.0.1:${port}/tests/ux/fixtures/model-contract-limits-harness.html`
const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: repoRoot, stdio: 'ignore' })
let app
try {
  await expect.poll(async () => {
    try { return (await fetch(url)).ok } catch { return false }
  }, { timeout: 30_000 }).toBe(true)
  // APIMart 的占位 key 起 App 前备好（先经保存口存成密文、再在盘上翻成已启用，见 seedSavedFixtureCredentials）；
  // harness 里不再存 key：保存即真验证，开网 401、关网存成「未验证、停用」，模型都进不了选择器（夜跑 run 40035294026）。
  const profileRoot = makeTempDir('nomi-contract-limits-')
  const launchOptions = { name: 'model-contract-limits', userDataDir: path.join(profileRoot, 'user-data'), settingsDir: path.join(profileRoot, 'settings'), env: { NOMI_DESKTOP_DEV: '1', VITE_DEV_SERVER_URL: url }, syntheticCredentialStorage: true, settleMs: 0 }
  await seedSavedFixtureCredentials(launchOptions, ['apimart'])
  const launched = await launchNomiApp(launchOptions)
  app = launched.app
  const win = launched.win
  win.on('pageerror', error => console.error(error.message))
  await expect(win.locator('[data-contract-stage]')).toBeVisible()
  await expect(win.getByRole('button', { name: '生成参数', exact: true })).toBeVisible()
  await win.getByRole('button', { name: '生成参数', exact: true }).click()
  const panel = win.locator('[data-agent-parameter-panel]')
  await expect(panel).toBeVisible()
  const durationProof = await proveProbe(panel.getByRole('radio', { name: '10', exact: true }), '768p offers ten seconds')
  await panel.getByRole('radio', { name: '1080p', exact: true }).click()
  await expectAbsent(panel.getByRole('radio', { name: '10', exact: true }), { provenBy: durationProof, message: '1080p removes ten seconds' })
  await expect(panel.getByRole('radio', { name: '6', exact: true })).toHaveAttribute('aria-checked', 'true')
  const readMeta = () => win.evaluate(async () => (await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')).useGenerationCanvasStore.getState().nodes[0].meta)
  await expect.poll(async () => (await readMeta()).duration).toBe(6)
  await win.keyboard.press('Escape')
  // Esc 关面板，摘要报的是刚定下的值。2026-11-12 bd2f0f11c 起摘要 pill 按宽度整值让位（窄了只露时长），
  // 完整摘要在 title 上，所以断「面板关了 + 完整摘要 = 1080p · 6s + 露出来的那几段都出自完整摘要」（2026-11-14 清红走查）。
  const summaryPill = win.getByRole('button', { name: '生成参数', exact: true })
  await expect(panel).toBeHidden()
  await expect(summaryPill).toHaveAttribute('aria-expanded', 'false')
  await expect(summaryPill).toHaveAttribute('title', '1080p · 6s')
  const shownParts = (await summaryPill.getAttribute('data-parameter-summary')).split(' · ')
  if (!shownParts[0] || shownParts.some((part) => !['1080p', '6s'].includes(part))) throw new Error(`摘要 pill 露出来的值不是刚定下的：${shownParts.join(' · ')}`)
  await summaryPill.click()
  await win.screenshot({ path: path.join(out, 'hailuo-1080p-6s.png'), clip: { x: 16, y: 16, width: 600, height: 340 } })
  console.log('PASS: 1080p narrows the real panel to 6s and commits duration=6')
  await panel.getByRole('radio', { name: '768p', exact: true }).click()
  await expect(panel.getByRole('radio', { name: '10', exact: true })).toBeVisible()
  console.log('PASS: returning to 768p restores the 10s option')
  await win.keyboard.press('Escape')
  await win.evaluate(async () => {
    const { useGenerationCanvasStore } = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const store = useGenerationCanvasStore.getState()
    const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="gray"/></svg>')
    store.updateNode('contract-video', { meta: { modelKey: 'MiniMax-H3', vendor: 'apimart', archetype: { id: 'minimax-h3-apimart', modeId: 'ref' }, referenceImageUrls: Array.from({ length: 9 }, (_, i) => image + '#' + i), referenceAudioUrls: ['https://example.com/1.mp3', 'https://example.com/2.mp3'] } })
  })
  // 「加参考」这个名字 10-22 起归画布点选钮（AssetReferenceButton），参考行的「+」是 [data-reference-add-entry]；
  // 满额时「+」灰显、title 说明（c0243f22e「首尾帧满额「+」灰显」），不再整颗拿掉（2026-11-14 清红走查）。
  const addPlus = win.locator('[data-reference-add-entry]')
  await expect(addPlus, 'eleven references leave one slot').toBeEnabled()
  await win.evaluate(async () => {
    const store = (await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')).useGenerationCanvasStore.getState()
    const node = store.nodes[0]
    store.updateNode(node.id, { meta: { ...node.meta, referenceAudioUrls: ['https://example.com/1.mp3', 'https://example.com/2.mp3', 'https://example.com/3.mp3'] } })
  })
  await expect(win.getByText('参考总数最多 12 个（图片、视频和音频合计）', { exact: true })).toBeVisible()
  await expect(addPlus, 'twelve references disable the add affordance').toBeDisabled()
  await win.screenshot({ path: path.join(out, 'h3-total-12.png'), clip: { x: 16, y: 16, width: 950, height: 300 } })
  console.log('PASS: twelve references disable adding other media and explain the shared limit')
  await win.evaluate(async () => {
    const store = (await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')).useGenerationCanvasStore.getState()
    const node = store.nodes[0]
    store.updateNode(node.id, { meta: { ...node.meta, referenceAudioUrls: ['https://example.com/1.mp3', 'https://example.com/2.mp3'] } })
  })
  await expect(addPlus, 'removing one reference re-enables adding').toBeEnabled()
  console.log('PASS: removing one reference restores the picker; no media silently discarded')
} finally {
  if (app) await app.close()
  vite.kill('SIGTERM')
}
