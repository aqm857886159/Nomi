// R13 走查：参考 URL 白名单改判定器之后，**生产构建的渲染层**照常起得来、画布照常画。
//
// 为什么非走查不可（单测证不了这条）：referenceUrl.asUrl 从「手列 scheme」改成了 import
// electron/catalog/assetValueScheme。那个模块的函数体里用了 Buffer —— 单测跑在 node 里，Buffer
// 天然存在，永远绿；渲染层没有 Buffer，一旦 Vite 把它提到模块初始化期（或解析出别的 node 依赖），
// 整个画布 chunk 会在**用户点进生成画布的那一刻**炸掉，而 build 门岗照样是绿的。
// 所以这里只验一件事，但必须在真产物上验：**打包后的那份 renderer**（dist，不是 Vite dev server，
// 两者的模块解析不是一回事）里，加载画布 + 渲染一个节点（会跑 useNodeDisplayPrompt →
// resolveReferenceSlots → asUrl）不产生任何渲染层错误。
//
// 用法：pnpm run build && node tests/ux/reference-url-scheme-boot.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectVisible, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/reference-url-scheme-boot')
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nomi-reference-url-scheme-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
rmSync(shotsDir, { recursive: true, force: true })
for (const dir of [projectsDir, shotsDir]) mkdirSync(dir, { recursive: true })

const { app, win: initialWin } = await launchNomiApp({
  name: 'reference-url-scheme-boot',
  userDataDir,
  settingsDir: userDataDir,
  projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 0,
})

let win = initialWin
const getWin = () => {
  const live = app.windows().filter((candidate) => !candidate.isClosed())
  win = live.find((candidate) => /projectId=/.test(candidate.url())) || live[live.length - 1] || win
  return win
}

// 渲染层错误全程收集：未捕获异常 + console.error。模块级炸裂两者必中其一。
const rendererErrors = []
const watchWindow = (target) => {
  target.on('pageerror', (error) => rendererErrors.push(`pageerror: ${error.message}`))
  target.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(`console.error: ${message.text().slice(0, 200)}`)
  })
}
watchWindow(initialWin)
app.on('window', watchWindow)

const failures = []
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

try {
  // 首启引导让路（点不到就算了，下面的断言才是判据）。
  for (let index = 0; index < 6; index += 1) {
    const action = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ }).first()
    if (await action.isVisible().catch(() => false)) await action.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
  const blankProject = getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first()
  if (await blankProject.isVisible().catch(() => false)) await blankProject.click()
  await getWin().waitForTimeout(1200)

  const generation = getWin().getByRole('button', { name: '生成', exact: true }).first()
  await generation.waitFor({ timeout: 15_000 })
  await generation.click()
  const toolbar = getWin().locator('.generation-canvas-v2-toolbar').first()
  await expectVisible(toolbar, '生成画布工具栏渲染出来了（画布 chunk 加载成功）')
  check(true, '生成画布工具栏可见')

  // 建一个图片节点：节点渲染会跑 useNodeDisplayPrompt → resolveReferenceSlots → asUrl，
  // 即本次改动的那条真实调用链。它炸的话节点画不出来 / 抛 pageerror。
  await toolbar.locator('[data-node-kind="image"]').click()
  const node = getWin().locator('[data-kind="image"][data-node-id]').last()
  await expectVisible(node, '图片节点渲染完成（参考槽解析链跑通）')
  const nodeId = await node.getAttribute('data-node-id')
  check(Boolean(nodeId), '节点带 data-node-id', String(nodeId))

  const shot = path.join(shotsDir, 'canvas-with-image-node.png')
  await screenshotSettled(getWin(), { path: shot })
  console.log(`  · 截图 ${shot}`)

  const schemeErrors = rendererErrors.filter((line) => /Buffer|require is not defined|Cannot read|Failed to fetch dynamically/i.test(line))
  check(schemeErrors.length === 0, '渲染层无模块级错误（Buffer/require/动态 import）', schemeErrors.join(' | ') || '零条')
  check(rendererErrors.length === 0, '渲染层零错误', rendererErrors.slice(0, 3).join(' | ') || '零条')
} catch (error) {
  failures.push(`异常：${error instanceof Error ? error.message : String(error)}`)
} finally {
  await app.close().catch(() => {})
  rmSync(tempRoot, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`\nWALK FAIL（${failures.length}）：\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log('\n✅ 走查通过：生产构建的渲染层带着新判定器正常渲染画布与节点。')
