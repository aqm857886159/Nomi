import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { applyColorSchemeForShot, expect } from './_assert.mjs'
import { createBlankProject, collapseAgentPanel, selectedNodeComposer, selectOrAddCanvasNode, switchWorkspace } from './_shell.mjs'

const out = path.join(repoRoot, 'docs/evidence/2026-11-24-t5-onboarding-s6')
await fs.mkdir(out, { recursive: true })
let response = 'positive'
const requests = []
const stub = http.createServer((req, res) => {
  requests.push({ path: req.url, method: req.method })
  if (req.method !== 'GET' || req.url !== '/v1/balance') {
    res.writeHead(404).end()
    return
  }
  if (response === 'offline') { req.socket.destroy(); return }
  if (response === 'invalid') { res.writeHead(401).end(); return }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ success: true, remain_credits: 52.3, remain_balance: 5.23, unlimited_quota: false }))
})
stub.listen(0, '127.0.0.1')
await once(stub, 'listening')
const origin = `http://127.0.0.1:${stub.address().port}`
const redirects = ['apimart.ai', 'apib.ai', 'aiuxu.com', 'aishuch.com'].map((domain) => ({ from: `https://api.${domain}`, to: origin }))
const shoot = (win, name) => win.screenshot({path: path.join(out, name + '.png')})

async function compare(win, name, pairs) {
  const previews = path.join(repoRoot, 'docs/design/boards/2026-11-07-onboarding/preview')
  const rows = []
  for (const [board, shot] of pairs) {
    const read = async (dir, file) => 'data:image/png;base64,' + (await fs.readFile(path.join(dir, file + '.png'))).toString('base64')
    rows.push([await read(previews, board), await read(out, shot)])
  }
  const result = await win.evaluate(async (images) => {
    const canvas = document.createElement('canvas')
    const width = 850, height = 550
    canvas.width = width * 2
    canvas.height = images.length * height
    const context = canvas.getContext('2d')
    for (const [row, pair] of images.entries()) {
      for (const [column, url] of pair.entries()) {
        const image = new Image()
        image.src = url
        await image.decode()
        const scale = Math.min(width / image.width, height / image.height)
        context.drawImage(image, column * width, row * height, image.width * scale, image.height * scale)
      }
    }
    return canvas.toDataURL('image/png').split(',')[1]
  }, rows)
  await fs.writeFile(path.join(out, name + '.png'), Buffer.from(result, 'base64'))
}

async function run(locale, theme, width) {
  const { app, win } = await launchNomiApp({
    name: 't5-s6-' + theme, viewportSize: { width, height: 900 }, syntheticCredentialStorage: true,
    initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': theme, 'nomi:canvas-gesture-hint:v1': 'seen' },
    mainRequire: [path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs')],
    env: { NOMI_TEST_NETWORK_GUARD: '1', NOMI_WALK_ALLOW_ORIGINS: '', NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify(redirects), NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: origin },
  })
  try {
    // Capture browser handoff without opening an external browser.
    await app.evaluate(({ shell }) => { shell.openExternal = async () => {} })
    await applyColorSchemeForShot(win, theme)
    const library = win.locator('[data-library-hero-connect]')
    await library.click()
    const input = win.locator('#apimart-connect-key-input')
    await win.locator('[data-apimart-open-site]').click()
    await expect(win.locator('[data-apimart-waiting]'), 'board:Onboarding/wait.banner').toBeVisible()
    await win.keyboard.press('Escape')
    await library.click()
    await expect(win.locator('[data-apimart-waiting]')).toBeVisible()
    await expect(win.locator('[data-apimart-return-line]'), 'board:Onboarding/wait.return-line').toBeVisible()
    await shoot(win, 'o3-' + theme)
    if (theme === 'dark') {
      const window = await app.browserWindow(win)
      await window.evaluate((native) => native.setContentSize(700, 720))
      await win.setViewportSize({ width: 700, height: 720 })
      await expect(win.locator('[data-apimart-layout]')).toHaveAttribute('data-apimart-layout', 'narrow')
      await shoot(win, 'o3-narrow')
      await window.evaluate((native, width) => native.setContentSize(width, 900), width)
      await win.setViewportSize({ width, height: 900 })
    }
    await win.locator('[data-apimart-waiting] button').last().click()
    await expect(win.locator('[data-apimart-mirror]'), 'board:Onboarding/error.site-blocked').toHaveCount(3)
    await shoot(win, 'o6-mirrors-' + theme)
    await win.locator('[data-apimart-waiting] button').last().click()

    const submit = async (value) => { await input.fill(value); await input.press('Enter') }
    const before = requests.length
    await submit('https://example.invalid/')
    await expect(win.locator('[data-apimart-key-error=format]'), 'board:Onboarding/error.key-format').toBeVisible()
    assert.equal(requests.length, before, 'board:Onboarding/depart.key-input')
    await shoot(win, 'o6-format-' + theme)
    response = 'invalid'
    await input.focus()
    await input.evaluate((field) => {
      // Supply the synthetic paste through ClipboardEvent; leave the system clipboard intact.
      const data = new DataTransfer()
      data.setData('text/plain', 'sk-loopback-refused')
      field.dispatchEvent(new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: data}))
    })
    await expect(win.locator('[data-apimart-key-error=invalid]'), 'board:Onboarding/error.key-invalid').toBeVisible()
    await shoot(win, 'o6-invalid-' + theme)
    assert.doesNotMatch(await win.locator('[data-apimart-key-error]').innerText(), /方舟|Volcengine|Ark console/, 'board:Onboarding/error.legacy-copy')
    await win.keyboard.press('Escape')
    await createBlankProject(win, 'create draft project')
    await switchWorkspace(win, 'generation')
    await collapseAgentPanel(win, 'show canvas')
    await selectOrAddCanvasNode(win, 'image', 'select image node')
    const composer = selectedNodeComposer(win)
    const prompt = composer.locator('[data-node-composer-prompt] [contenteditable=true]').first()
    await prompt.fill('An orange cat at the window')
    await composer.locator('[data-composer-connect=true]').click()
    await app.evaluate(({ safeStorage }) => {
      const encrypt = safeStorage.encryptString.bind(safeStorage)
      safeStorage.encryptString = (value) => { safeStorage.encryptString = encrypt; throw new Error('locked fixture') }
    })
    response = 'positive'
    await submit('sk-loopback-locked')
    await expect(win.locator('[data-apimart-key-error=keychain]'), 'board:Onboarding/error.keychain').toBeVisible()
    await shoot(win, 'o6-keychain-' + theme)
    response = 'offline'
    await win.locator('[data-apimart-key-error=keychain] button').click()
    await expect(win.locator('[data-apimart-key-error=offline]'), 'board:Onboarding/error.offline').toBeVisible({timeout: 30000})
    await shoot(win, 'o6-offline-' + theme)
    response = 'positive'
    await win.context().setOffline(true)
    await win.context().setOffline(false)
    await expect(win.locator('[data-apimart-checks] li'), 'board:Onboarding/return.check-rows').toHaveCount(4)
    await expect(win.locator('[data-apimart-checks] li').nth(2)).toContainText('52.3')
    await shoot(win, 'o4a-' + theme)
    await expect(composer.locator('[data-apimart-connected]'), 'board:Onboarding/return.back').toBeVisible()
    await expect(prompt).toContainText('An orange cat at the window')
    await shoot(win, 'o4b-' + theme)
    await expect(composer.locator('[data-apimart-connected]')).toHaveCount(0, {timeout: 6000})
    if (theme === 'light') {
      await compare(win, 'board-vs-impl-o3-o4', [['O3-waiting', 'o3-light'], ['O4a-check', 'o4a-light'], ['O4b-back', 'o4b-light']])
      await compare(win, 'board-vs-impl-o6', [['O6-errors', 'o6-invalid-light'], ['O6-errors', 'o6-offline-light']])
    } else {
      await compare(win, 'board-vs-impl-en-dark', [['O4a-en', 'o4a-dark'], ['O6-errors-dark', 'o6-keychain-dark']])
    }
  } finally { await app.close() }
}
try {
  await run('zh-CN', 'light', 1440)
  await run('en', 'dark', 1440)
  assert(requests.length > 0 && requests.every((req) => req.method === 'GET'))
  console.log('loopback GET requests:', requests.length)
} finally {
  stub.closeAllConnections()
  await new Promise((resolve) => stub.close(resolve))
}
