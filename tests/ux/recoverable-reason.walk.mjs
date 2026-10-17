// #1213 走查：可找回面板显示最后一次取回失败的原话（服务商原话 / 复制详情 / 技术详情，与失败卡同一套）。
// 真 Electron 构建产物 + 隔离 profile + 屏外窗口；项目夹具在盘上物化一个已落「可找回」、带原因的视频节点，
// 走真实加载路径渲染真 NodeRecoverableReport。中英 × 亮暗四张截图，外加「技术详情」展开一张。
// 用法: pnpm run build && node tests/ux/recoverable-reason.walk.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { uiText } from './full-walk/invariants.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const shotsDir = path.join(repoRoot, 'docs/evidence/2026-10-16-recoverable-reason')
fs.mkdirSync(shotsDir, { recursive: true })

const PROJECT_ID = 'project-recoverable-reason-0001'
const NODE_ID = 'shot-recoverable-1'
const UPSTREAM = '当前分组 default 下对于模型  无可用渠道'
// 与真实路径同形：主进程 VendorRequestError 经 taskIpcGuard 编码穿过 IPC，原样落到节点上。
const RETRIEVAL_FAILURE =
  'NOMI_VENDOR_ERR_B64::' +
  Buffer.from(JSON.stringify({ vendorKey: 'relay', method: 'GET', httpStatus: 503, upstreamMsg: UPSTREAM, category: 'server', retryable: true }), 'utf8').toString('base64') +
  `:: Provider request failed (HTTP 503) at relay GET https://relay.example/api/v3/contents/generations/tasks/cgt-20261017001118-abcde: ${UPSTREAM}`

function writeFixture(projectsDir) {
  const now = Date.now()
  const node = {
    id: NODE_ID, kind: 'video', title: '镜头 2 · 视频',
    position: { x: 160, y: 120 }, size: { width: 420, height: 300 },
    prompt: '图中的猫洗脸',
    status: 'recoverable',
    error: RETRIEVAL_FAILURE,
    runs: [{ id: 'run-recoverable-1', status: 'recoverable', taskId: 'cgt-20261017001118-abcde', error: RETRIEVAL_FAILURE, startedAt: now - 600000, updatedAt: now }],
    meta: { modelKey: 'doubao-seedance-2-0-fast-260128', vendor: 'relay', modelVendor: 'relay' },
    categoryId: 'shots',
  }
  const record = {
    id: PROJECT_ID, name: 'ZZ 可找回原因', version: 2, createdAt: now, updatedAt: now, savedAt: now, revision: 1, lastKnownRootPath: '',
    payload: {
      workbenchDocument: { version: 1, title: '', contentJson: { type: 'doc', content: [] } },
      generationCanvas: { nodes: [node], edges: [], selectedNodeIds: [], groups: [] },
      timeline: { version: 1, fps: 30, scale: 1, playheadFrame: 0, tracks: [
        { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
        { id: 'videoTrack', type: 'video', label: '视频轨', clips: [] },
      ] },
    },
  }
  const rootPath = path.join(projectsDir, 'ZZ-recoverable-reason')
  fs.mkdirSync(path.join(rootPath, '.nomi'), { recursive: true })
  fs.writeFileSync(path.join(rootPath, '.nomi', 'project.json'), JSON.stringify({ ...record, lastKnownRootPath: rootPath }, null, 1))
}

// 界面文案从词典读（不在走查里抄一份）：词典改了，这里跟着变。
const label = (locale, key) => uiText(locale, key).trim()
const configs = [
  { name: 'zh-light', locale: 'zh-CN', scheme: 'light' },
  { name: 'zh-dark', locale: 'zh-CN', scheme: 'dark' },
  { name: 'en-light', locale: 'en', scheme: 'light' },
  { name: 'en-dark', locale: 'en', scheme: 'dark' },
].map((config) => ({
  ...config,
  provider: label(config.locale, 'generationCommon.error.providerMessage'),
  technical: label(config.locale, 'generationCommon.error.technicalDetails'),
}))

const failures = []
function check(ok, label, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

for (const config of configs) {
  const tempRoot = makeTempDir(`nomi-recoverable-reason-${config.name}-`)
  const userDataDir = path.join(tempRoot, 'user-data')
  const projectsDir = path.join(tempRoot, 'projects')
  fs.mkdirSync(userDataDir, { recursive: true })
  writeFixture(projectsDir)
  const { app, win } = await launchNomiApp({
    name: `recoverable-reason-${config.name}`,
    userDataDir,
    settingsDir: userDataDir,
    projectsDir,
    args: ['--no-proxy-server', '--disable-features=CalculateNativeWinOcclusion'],
    mainRequire: [path.join(here, '_offscreenWindows.cjs')],
    initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', 'nomi-color-scheme': config.scheme, 'nomi:locale:v1': config.locale, __nomiE2E: '1' },
    settleMs: 900,
    env: { NOMI_DISABLE_CAPABILITY_CORE: '1' },
  })
  let page = win
  try {
    const card = page.locator(`[data-project-card][data-project-id="${PROJECT_ID}"]`).first()
    await card.waitFor({ timeout: stationTimeout() })
    await card.click()
    await expect.poll(() => {
      page = app.windows().find((candidate) => /projectId=/.test(candidate.url())) || page
      return page.url()
    }, { timeout: stationTimeout({ operations: 2 }) }).toContain('projectId=')
    const node = page.locator(`.generation-canvas-v2-node[data-node-id="${NODE_ID}"]`)
    await node.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
    const panel = node.locator('[role="status"]').first()
    await panel.waitFor({ state: 'visible', timeout: stationTimeout() })
    const text = (await panel.textContent()) || ''
    check(text.includes(config.provider), `${config.name}: 面板显示服务商原话标签`)
    check(text.includes('无可用渠道'), `${config.name}: 面板显示最后一次取回失败的原话`)
    await screenshotSettled(node, { path: path.join(shotsDir, `${config.name}.png`) })
    if (config.name === 'zh-light' || config.name === 'en-dark') {
      await panel.locator('button', { hasText: config.technical }).first().click()
      const expanded = (await panel.textContent()) || ''
      check(expanded.includes('HTTP 503'), `${config.name}: 技术详情展开后有原始错误`)
      await screenshotSettled(node, { path: path.join(shotsDir, `${config.name}-technical.png`) })
    }
  } catch (error) {
    check(false, `${config.name}: walk error`, String(error?.message || error))
  } finally {
    await app.close().catch(() => undefined)
  }
}

if (failures.length) {
  console.error(`FAILED ${failures.length}: ${failures.join(' | ')}`)
  process.exitCode = 1
}
