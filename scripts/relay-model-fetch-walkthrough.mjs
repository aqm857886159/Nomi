// Real UI, loopback only: a SPA fallback must reach /v1/models; discovery never sends a video model to chat.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { launchNomiApp, repoRoot } from '../tests/ux/_launchApp.mjs'
import { expect, screenshotSettled } from '../tests/ux/_assert.mjs'
import { closeSettings, openCustomApiWizard } from '../tests/ux/_shell.mjs'

const out = path.resolve(process.env.NOMI_WALK_OUT || path.join(repoRoot, '.relay-fetch-walk'))
fs.mkdirSync(out, { recursive: true })
const models = ['doubao-seedance-2-0-mini-260615', 'doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128']
const requests = []
const server = http.createServer((req, res) => {
  const url = (req.url || '').split('?')[0]
  requests.push({ method: req.method, path: url })
  if (url === '/v1/models') {
    const rejected = req.headers.authorization === 'Bearer sk-loopback-rejected'
    res.writeHead(rejected ? 401 : 200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(rejected ? { error: { message: 'Invalid token' } } : { data: models.map(id => ({ id })) }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end('<!doctype html><html><body><div id="root"></div></body></html>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const { app, win } = await launchNomiApp({
  name: 'relay-model-fetch', syntheticCredentialStorage: true,
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:locale:v1': 'zh-CN' },
  env: { NOMI_TEST_NETWORK_GUARD: '1', NOMI_WALK_ALLOW_ORIGINS: '', NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: base },
})
try {
  for (const rejected of [true, false]) {
    await openCustomApiWizard(win)
    await win.getByPlaceholder(/如：TOAPI|Example: TOAPI/).fill('Loopback video relay')
    await win.getByPlaceholder('https://api.openai.com/v1').fill(base)
    await win.getByPlaceholder('sk-...').fill(rejected ? 'sk-loopback-rejected' : 'sk-loopback-valid')
    await win.getByRole('button', { name: /保存连接|Save connection/i, exact: true }).click()
    await win.locator('[data-model-connection-saved]').waitFor()
    await win.getByRole('button', { name: /获取模型|Get Models/i, exact: true }).click()
    if (rejected) {
      await expect(win.getByText(/401|鉴权|Invalid token/).first()).toBeVisible()
      expect(await win.locator('body').innerText()).not.toContain('{"error"')
    } else {
      for (const id of models) await expect(win.getByText(id, { exact: true }).first()).toBeVisible()
    }
    expect(await win.getByRole('button', { name: /测试连接|Test Connection/i }).count()).toBe(0)
    await screenshotSettled(win, { path: path.join(out, rejected ? '01-rejected-list.png' : '02-three-video-models.png') })
    await closeSettings(win)
  }
  expect(requests.some(row => row.path === '/models')).toBe(true)
  expect(requests.some(row => row.path === '/v1/models')).toBe(true)
  expect(requests.filter(row => row.method === 'POST')).toEqual([])
  expect(requests.filter(row => /chat|responses|messages/.test(row.path))).toEqual([])
  console.log('PASS relay list fallback, readable rejection, three video candidates and zero chat/generation calls')
} finally {
  fs.writeFileSync(path.join(out, 'requests.json'), JSON.stringify(requests, null, 2))
  await app.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
