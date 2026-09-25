// R13 验收走查（提示词库第三方示例媒体 · 2026-09-25 用户 Mac 控制台：
// cdn.openai.com/sora/videos/*.mp4 被 COEP 拦、video.twimg.com/*.mp4 403）。
//
// 这条走查验的是界面那一半：侧栏「提示词」展开 Sora 两组，示例视频能出的出，出不了的（来源站点删了 /
// 在当前网络下防盗链）显示「示例已失效」而不是黑框；点开失效那张，预览里同样是失效说明。
// COEP 那一半（require-corp → credentialless）Windows 版本来不开隔离、走查进程也关隔离（NOMI_E2E），
// 由 electron/shared/crossOriginIsolation.ts 里记的真机探针矩阵作证，不在这里假装验到。
// 用法: pnpm build && node tests/ux/prompt-library-remote-media.walk.mjs [--locale en]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'

const locale = process.argv.includes('--locale') ? process.argv[process.argv.indexOf('--locale') + 1] : 'zh-CN'
const shotsDir = path.join(repoRoot, `tests/ux/shots/prompt-library-remote-media-${locale}`)
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-prompt-media-'))
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'walk-prompt-media'
const projectName = locale === 'en' ? 'Prompt media' : '提示词示例媒体'
const root = path.join(projectsDir, 'walk-prompt-media')
fs.mkdirSync(path.join(root, '.nomi'), { recursive: true })
const now = Date.now()
fs.writeFileSync(path.join(root, '.nomi', 'project.json'), JSON.stringify({
  id: projectId, name: projectName, version: 2, createdAt: now, updatedAt: now, savedAt: now, revision: 1, lastKnownRootPath: path.resolve(root),
  payload: { timeline: { version: 1, fps: 30, scale: 1, playheadFrame: 0, tracks: [] }, generationCanvas: { nodes: [], edges: [], groups: [], selectedNodeIds: [] } },
}))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`)
}
const snap = async (page, name) => {
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`) }).catch(() => {})
  console.log(`  [shot] ${name}`)
}

let app
let win
try {
  ;({ app, win } = await launchNomiApp({
    name: `prompt-library-remote-media-${locale}`,
    tempRoot,
    projectsDir,
    settleMs: 0,
    viewportSize: { width: 1440, height: 900 },
    initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
  }))
  const consoleErrors = []
  await win.locator('[data-project-card]', { hasText: projectName }).first().click({ timeout: 20000 })
  for (let i = 0; i < 40 && !app.windows().some((page) => /projectId=/.test(page.url())); i += 1) await win.waitForTimeout(250)
  win = app.windows().find((page) => /projectId=/.test(page.url())) ?? win
  win.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.locator('.nomi-stepper').first().waitFor({ timeout: 20000 })
  const stage = win.locator('.react-flow__pane').first()
  if (!(await stage.isVisible().catch(() => false))) await win.locator('.nomi-stepper__step[data-mode="generation"]').first().click()
  await stage.waitFor({ state: 'visible', timeout: 20000 })

  await win.locator(`aside nav button[aria-label="${locale === 'en' ? 'Prompt library' : '提示词库'}"]`).first().click()
  await win.waitForTimeout(1500)
  // 逐个点 Sora 两个来源（推特那组 = Sora 2，openai 那组 = Sora 官方），等媒体落定再数。
  const tally = { videos: 0, loadedVideos: 0, expired: 0 }
  for (const [index, source] of [/^Sora 2$/, /^Sora (官方|official)$/i].entries()) {
    await win.locator('aside button', { hasText: source }).first().click()
    await win.waitForTimeout(800)
    // 超过 4 条的来源组默认收起：像用户一样点开组头。
    const collapsed = win.locator('aside button[data-library-group][aria-expanded="false"]').first()
    if (await collapsed.count()) await collapsed.click()
    await win.waitForTimeout(12000)
    const counts = await win.evaluate(() => ({
      videos: document.querySelectorAll('aside video').length,
      loadedVideos: [...document.querySelectorAll('aside video')].filter((video) => video.readyState >= 1).length,
      expired: document.querySelectorAll('aside [data-example-media-expired]').length,
    }))
    console.log(`  [${source}] ${JSON.stringify(counts)}`)
    for (const key of Object.keys(tally)) tally[key] += counts[key]
    await snap(win, `0${index + 1}-${index === 0 ? 'sora2-twimg' : 'sora-official-openai'}`)
  }
  check('Sora 示例卡片已渲染', tally.videos + tally.expired > 0, JSON.stringify(tally))
  check('没有卡在黑框：每张示例要么出了首帧，要么是「示例已失效」', tally.videos === tally.loadedVideos, JSON.stringify(tally))

  // 回到推特那组找失效卡点开（Sora 2 里有已被删除的示例）。
  await win.locator('aside button', { hasText: /^Sora 2$/ }).first().click()
  await win.waitForTimeout(800)
  const collapsedAgain = win.locator('aside button[data-library-group][aria-expanded="false"]').first()
  if (await collapsedAgain.count()) await collapsedAgain.click()
  await win.waitForTimeout(1500)
  const expiredCard = win.locator('aside button:has([data-example-media-expired])').first()
  if (await expiredCard.count()) {
    await expiredCard.scrollIntoViewIfNeeded()
    await snap(win, '03-expired-card')
    await expiredCard.click()
    await win.waitForTimeout(800)
    const previewExpired = await win.locator('[role="dialog"] [data-example-media-expired], [aria-modal="true"] [data-example-media-expired]').count()
    check('点开失效示例：预览里是失效说明，不是黑框', previewExpired > 0)
    await snap(win, '04-expired-preview')
    await win.keyboard.press('Escape').catch(() => {})
  } else {
    console.log('  (本次网络下所有 Sora 示例都能加载，没有失效卡可点)')
  }
  const coepErrors = consoleErrors.filter((text) => /NotSameOriginAfterDefaultedToSameOriginByCoep/.test(text))
  check('控制台没有 COEP 拦截', coepErrors.length === 0, coepErrors.slice(0, 2).join(' | '))
} catch (error) {
  console.log(`  FAIL walk crashed: ${error?.stack || error}`)
  results.push({ name: 'crash', ok: false })
  if (win) await snap(win, '99-crash')
} finally {
  await app?.close().catch(() => {})
}
const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed · shots: ${path.relative(repoRoot, shotsDir)}`)
process.exit(failed.length ? 1 : 0)
