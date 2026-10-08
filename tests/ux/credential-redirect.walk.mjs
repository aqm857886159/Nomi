import { makeTempDir } from '../../scripts/_test-temp.mjs'
// R13 走查：服务商地址发生跳转时，用户看到的那句话（zh / en 各一张截图）。
// 走的是真实用户路径：设置 → 模型 → 一条手动接入连接 → 改接入地址 → 添加模型 → 获取可用模型。
//
// 真实应用（开发构建）+ 真实资料副本（_realProfile 的凭据副本，用完即删）+ 一个会 302 的本地地址。
// 不花钱：被请求的只有本机两个端口，真实供应商一次都没碰。第二个端口记下收到的一切——
// 走查末尾断言它一个字节都没收到（密钥没被带过去）。
// 用法：先 pnpm run build，再 node tests/ux/credential-redirect.walk.mjs
//       EVIDENCE_DIR=<目录> 指定截图落点（默认 tests/ux/shots/credential-redirect）
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { realProfileFingerprint, removeRealCredentials, seedRealCredentials } from './_realProfile.mjs'
import { clickOrFail, expect, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'

const evidenceDir = process.env.EVIDENCE_DIR || path.join(repoRoot, 'tests/ux/shots/credential-redirect')
fs.mkdirSync(evidenceDir, { recursive: true })

const LOCALES = [
  { locale: 'zh-CN', panel: /^模型$/, vendor: /api-apimart-ai/, edit: /^修改$/, addOther: /添加其他/, fetch: '获取可用模型', save: '保存', test: '测试连接', expect: /服务商地址发生了跳转.*为保护你的密钥已停止请求/ },
  { locale: 'en', panel: /^Models$/, vendor: /api-apimart-ai/, edit: /^Edit$/, addOther: /Add More/i, fetch: 'Get available models', save: 'Save', test: 'Test connection', expect: /The provider address redirected.*stopped to protect your key/ },
]

const before = realProfileFingerprint()
const seen = []
const servers = []
async function listen(handler) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  return `http://127.0.0.1:${server.address().port}`
}
const target = await listen((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => { seen.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') }); response.end('{}') })
})
let sourceHits = 0
const source = await listen((request, response) => {
  sourceHits += 1
  request.resume()
  request.on('end', () => { response.writeHead(307, { location: `${target}/second-origin` }); response.end() })
})

let failure = null
for (const spec of LOCALES) {
  const root = makeTempDir(`nomi-credential-redirect-${spec.locale}-`)
  const settingsDir = path.join(root, 'settings')
  const userDataDir = path.join(root, 'user-data')
  const projectsDir = path.join(root, 'projects')
  seedRealCredentials({ settingsDir, userDataDir })
  let app
  try {
    let win
    ;({ app, win } = await launchNomiApp({
      name: `credential-redirect-${spec.locale}`, tempRoot: root, userDataDir, settingsDir, projectsDir, settleMs: 0,
      initialLocalStorage: { 'nomi:locale:v1': spec.locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
      args: ['--no-proxy-server'],
    }))
    await win.waitForTimeout(1500)
    const snap = (name) => screenshotSettled(win, { path: path.join(evidenceDir, `${spec.locale}-${name}.png`) })
    await clickOrFail(win.locator('button', { hasText: spec.panel }), 'model access panel')
    await win.waitForTimeout(900)
    await clickOrFail(win.locator('button', { hasText: spec.vendor }), 'vendor row')
    await win.waitForTimeout(700)
    // 用户把服务商地址改成一个会跳转的地址（真实资料副本里的一条手动接入连接，原库不动）。
    await clickOrFail(win.locator('button', { hasText: spec.edit }), 'edit address')
    await win.locator('input[placeholder="https://…"]').first().fill(`${source}/v1`)
    await clickOrFail(win.getByRole('button', { name: spec.save, exact: true }), 'save address')
    await win.waitForTimeout(1500)
    await clickOrFail(win.getByRole('button', { name: spec.addOther }).first(), 'add other')
    await win.waitForTimeout(700)
    await clickOrFail(win.getByRole('button', { name: spec.fetch }).first(), 'fetch available models')
    const message = win.locator('[role=dialog]').getByText(spec.expect).first()
    await expect(message, `界面上要出现那句话：${spec.expect}`).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await snap('redirect-message')
    const shown = await message.innerText()
    console.log(`[${spec.locale}] ${shown}`)
    expect(shown, '提示里要写出跳转目标（只有主机和路径）').toContain(`${new URL(target).host}/second-origin`)
  } catch (error) {
    failure = error
    console.error(`[${spec.locale}] ${error?.message || error}`)
  } finally {
    if (app) await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 8000))])
    removeRealCredentials({ settingsDir, userDataDir })
  }
}
for (const server of servers) { server.closeAllConnections(); server.close() }
const after = realProfileFingerprint()
expect(JSON.stringify(after), '真实资料原库在走查前后一个字节都不许变').toBe(JSON.stringify(before))
expect(seen, '第二个端口不许收到任何请求').toEqual([])
console.log(`source hits=${sourceHits}, second-origin requests=${seen.length}`)
if (failure) process.exit(1)
