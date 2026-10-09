import { makeTempDir } from '../../scripts/_test-temp.mjs'
// R13/R16 走查（零额度）：**dev 模式下创作区富文本编辑器真实挂载并可输入**。
//
// 为什么这条走查存在（2026-09-01 事故复盘）：一个 ProseMirror 双实例 bug 让 `pnpm dev` 里点开
// 「创作」tab 时整片创作区崩进 chunk 边界（"创作区加载失败"，TypeError: Cannot read properties
// of undefined (reading 'eq'/'localsInner')）。它**溜过了 21 个 PR 的 CI**，两个原因叠加：
//   ① 在此之前没有任何一条旅程会点开创作区；
//   ② 根因只在 **dev 模式** 发作——Vite 的 optimizeDeps 把 @tiptap/starter-kit 预打包成 prosemirror-view
//      实例 A，而 persistentSelection.ts 从 @tiptap/pm/view 引 Decoration/DecorationSet 走未优化的实例 B；
//      两实例在 DecorationGroup.from 的 `m instanceof DecorationSet` 处分裂 → 装饰组里塞进 undefined 成员。
//      生产构建用 rollup 的 prosemirror-vendor manualChunks 把 prosemirror-* 收敛成单实例，天然免疫——
//      **所以跑生产构建的走查根本照不出这个 bug**。这条走查因此必须像 react-flow-read-only.walk.mjs 一样，
//      自己拉起 Vite dev server、以 dev 模式驱动真 app，才能把这个洞焊死。
//   单测同样测不到：崩溃在 prosemirror-view 合并多个装饰源时才发生，而单测从不构造真实 EditorView。
//
// 不生成、不连模型 → 零额度。每步 screenshot 供人眼复核（眼见链）。
// 用法：pnpm run build && node tests/ux/creation-editor-mount.walk.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectVisible, clickOrFail, proveProbe, expectAbsent } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/creation-editor-mount')
const port = 5292
const appUrl = `http://127.0.0.1:${port}/`
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const base = makeTempDir('nomi-creation-mount-')
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

// 种一个最小项目，打开后直接落在创作区（空文档 → 编辑器该显占位提示）。
const projectId = 'creation-mount-0001'
const projDir = path.join(projectsDir, `creation-mount-${projectId}`)
fs.mkdirSync(projDir, { recursive: true })
const project = {
  id: projectId, name: '创作区挂载走查', version: 1,
  createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projDir,
  payload: {
    workbenchDocument: { version: 1, title: '创作区挂载走查', updatedAt: 1, contentJson: { type: 'doc', content: [] } },
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null, storyboardPlanCommitted: false,
  },
}
fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(project, null, 2))

let n = 0
const snap = async (win, name) => {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await win.screenshot({ path: path.join(shotsDir, `${tag}.png`) }).catch((e) => console.log(`  (snap ${tag} failed: ${e.message})`))
  console.log(`  · shot ${tag}`)
}

// ── 拉起 dev 模式的 Vite（这是本走查的关键：只有 dev 预打包路径才会分裂 prosemirror 实例）──
const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
  // 强制重新预打包，确保吃到 optimizeDeps 配置（否则可能命中旧缓存，照不出配置回归）。
  env: { ...process.env, NOMI_E2E: '1', NOMI_FORCE_VITE_OPTIMIZE_DEPS: '1' },
})
const viteOutput = []
const keepViteOutput = (chunk) => {
  viteOutput.push(...String(chunk).split('\n').filter((line) => line.trim()))
  if (viteOutput.length > 40) viteOutput.splice(0, viteOutput.length - 40)
}
vite.stdout.on('data', keepViteOutput)
vite.stderr.on('data', keepViteOutput)
const viteFailure = new Promise((_, reject) => {
  vite.once('error', (error) => reject(error))
  vite.once('exit', (code, signal) => reject(new Error(`Vite exited before ready (code=${code}, signal=${signal})`)))
})

let launched
let app
let exitCode = 0
const eqCrashHits = []
try {
  try {
    await Promise.race([
      expect.poll(async () => {
        try {
          const response = await fetch(appUrl, { signal: AbortSignal.timeout(1_500) })
          await response.arrayBuffer()
          return response.ok
        } catch {
          return false
        }
      }, { message: `Vite 未就绪 @ ${appUrl}`, timeout: 60_000, intervals: [100, 250, 500, 1_000] }).toBe(true),
      viteFailure,
    ])
  } catch (error) {
    throw new Error(`${String(error)}\nVite output:\n${viteOutput.join('\n') || '(none)'}`)
  }
  console.log('  ✓ dev 模式 Vite 已就绪')

  launched = await launchNomiApp({
    name: 'creation-editor-mount',
    userDataDir: settingsDir,
    settingsDir,
    projectsDir,
    args: ['--disable-gpu', '--disable-software-rasterizer'],
    env: {
      NOMI_DESKTOP_DEV: '1',
      VITE_DEV_SERVER_URL: appUrl,
      NOMI_CAPABILITY_DIR: path.join(settingsDir, 'capability-core'),
    },
    timeout: 300000,
  })
  const { app: launchedApp, win } = launched
  app = launchedApp

  // 渲染层抛出崩溃指纹 = 硬失败。回归里创作区就是崩进 chunk 边界的，pageerror 里正是这条 TypeError。
  win.on('pageerror', (e) => {
    const text = e.stack || e.message || String(e)
    if (/reading '(eq|localsInner)'|创作区加载失败/.test(text)) {
      console.log('  ✗ 命中创作区崩溃指纹（ProseMirror 装饰实例分裂）：', text.slice(0, 200))
      eqCrashHits.push(text.slice(0, 200))
      exitCode = 1
    }
  })

  await win.evaluate(() => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  for (let i = 0; i < 6; i++) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成/ }).first()
    if (await skip.count()) await skip.click({ timeout: 1000 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
  }
  await snap(win, 'library')

  // 打开项目：hover 卡片 → 点「继续创作」（悬停才露出）。
  const card = win.getByText('创作区挂载走查', { exact: false }).first()
  await expectVisible(card, '项目库里应能看到刚种的项目卡片')
  await card.hover().catch(() => {})
  const continueBtn = win.locator('button,[role="button"]', { hasText: /继续创作/ }).first()
  await clickOrFail(continueBtn, '项目卡片上的「继续创作」按钮')
  await snap(win, 'in-project')

  // 确保停在「创作」tab（打开后通常即默认态；若不是则点它）。
  const creationTab = win.locator('button,[role="button"],[role="tab"]', { hasText: /^创作$/ }).first()
  await clickOrFail(creationTab, '顶部「创作」tab')

  // ── 核心断言 1：创作区挂载出「源文档编辑面」，而不是降级 chunk 边界 ──
  // data-creation-surface="source" 是 CreationWorkspace 渲染源文档编辑器时打的标记；
  // 它出现 = CreationWorkspace 整棵子树（含 WorkbenchEditor→useEditor）成功渲染到位。
  const surface = win.locator('[data-creation-surface="source"]')
  const surfaceProof = await proveProbe(surface, '创作区渲染出源文档编辑面（data-creation-surface=source）')

  // ── 核心断言 2：ProseMirror 编辑器真的挂载且可编辑（不是一具空壳）──
  // .workbench-editor__content 是内核给 ProseMirror contenteditable 打的类
  // （useNomiRichTextEditor editorProps.attributes.class）。可见 = 编辑器构造成功、装饰机制没崩。
  const editor = win.locator('.workbench-editor__content[contenteditable="true"]')
  await expectVisible(editor, '富文本编辑器应挂载且可编辑（contenteditable 的 ProseMirror 面）')
  await snap(win, 'creation-editor-mounted')

  // ── 核心断言 3：降级 chunk 边界**不该**出现（这正是事故里用户看到的东西）──
  // provenBy 用上面已证的 surface：既然源编辑面确实渲染得出来，那么「没有创作区 chunk 边界」
  // 就是一句测得到的实话，而非探针没生效的空洞通过。
  const chunkBoundary = win.locator('[data-chunk-boundary="创作区"]')
  await expectAbsent(chunkBoundary, {
    provenBy: surfaceProof,
    message: '创作区不该降级成「加载失败」chunk 边界',
  })

  // ── 核心断言 4：真的能往里打字（回归里编辑器是崩的、根本输不进）──
  await clickOrFail(editor, '编辑器可编辑区域（点进去准备输入）')
  await win.keyboard.type('创作区挂载自检 OK')
  await expectVisible(
    editor.getByText('创作区挂载自检 OK', { exact: false }),
    '刚键入的文本应出现在编辑器里（证明它真的接受输入，不是死壳）',
  )
  await snap(win, 'creation-editor-typed')

  if (eqCrashHits.length > 0) {
    throw new Error(`创作区崩溃指纹命中 ${eqCrashHits.length} 次（ProseMirror 装饰实例分裂回归）`)
  }
  console.log('\n═══ CREATION-EDITOR-MOUNT（dev）：编辑器挂载 ✓ · 无降级边界 ✓ · 可输入 ✓ ═══')
  console.log(`  截图 → ${shotsDir}（人眼复核）`)
} catch (err) {
  console.log(`✗ ${err?.message || err}`)
  if (app && launched?.win) await snap(launched.win, 'failure').catch(() => {})
  exitCode = 1
} finally {
  if (app) await app.close().catch(() => {})
  vite.kill('SIGTERM')
}
process.exit(exitCode)
