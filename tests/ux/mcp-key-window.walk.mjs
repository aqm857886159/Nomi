// R16 real-user MCP journey: an external Claude-shaped RPC request asks for a key,
// Nomi comes forward, consumes the durable handoff, and the same session continues
// after the key is saved. The profile is isolated; the key is synthetic.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { screenshotSettled, expectVisible, clickOrFail } from './_assert.mjs'

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/mcp-key-window')
const FAKE_KEY = 'sk-nomi-mcp-key-window-walkthrough'

async function waitForAdvert(capabilityDir) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const file = fs.readdirSync(capabilityDir).find((name) => /^instance(?:-[a-f0-9]+)?\.json$/.test(name))
    if (file) {
      try {
        const advert = JSON.parse(fs.readFileSync(path.join(capabilityDir, file), 'utf8'))
        if (Number(advert.port) > 0 && typeof advert.token === 'string' && advert.token.length > 0) return advert
      } catch { /* capability core is still writing the advert */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('MCP key-window walk: Nomi RPC advert did not become ready')
}

function proofFor(token, client = 'claude') {
  return crypto.createHmac('sha256', token).update(`nomi-mcp-client:v1:${client}`).digest('base64url')
}

async function rpc(advert, connectionAttestation, method, params) {
  const response = await fetch(`http://127.0.0.1:${advert.port}/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${advert.token}`,
      'x-nomi-mcp-client': 'claude',
      'x-nomi-mcp-client-proof': proofFor(advert.token),
      'x-nomi-mcp-connection-attestation': connectionAttestation,
    },
    body: JSON.stringify({ method, params }),
  })
  const body = await response.json()
  if (!response.ok || body.ok !== true) throw new Error(`${method} failed: ${JSON.stringify(body)}`)
  return body.result
}

async function main() {
  fs.mkdirSync(shotsDir, { recursive: true })
  const launched = await launchNomiApp({ name: 'mcp-key-window', syntheticCredentialStorage: true, settleMs: 900 })
  const { app, win } = launched
  // 'not-needed' = Nomi 自己就把焦点拿到了；'pending' = 没拿到，已下阳性对照，等旅程走完再判。
  let focusControl = 'not-needed'
  try {
    await win.evaluate(() => {
      for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi.onboarding.scene3dCoach.v1'])
        window.localStorage.setItem(key, 'seen')
      window.localStorage.setItem('nomi:locale:v1', 'zh-CN')
      window.localStorage.setItem('nomi-color-scheme', 'light')
      window.localStorage.setItem('__nomiE2E', '1')
    })
    await win.reload()
    await win.waitForLoadState('domcontentloaded')

    const advert = await waitForAdvert(launched.capabilityDir)
    const connectionAttestation = crypto.randomBytes(32).toString('base64url')

    // 真实场景：用户正在编辑器里跟助手说话，Nomi 缩在 Dock 里或者被 Cmd+H 收起来了。
    // 先把窗口收走，这样「它自己回到前台了」就是一次 Nomi 独占、可判定的状态变化，
    // 而不是「碰巧还在最前面」。
    //
    // 阳性对照挑的是 hide()：macOS 的 minimize 带动画、要等 'minimize' 事件才落定，
    // 拿它当对照就得在测试里等墙钟（R18 明令禁止的那一族）；hide() 当场生效，
    // isVisible() 立刻为 false。两件都做、只对可判定的那件下断言。
    const hidden = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
      if (!window) return null
      globalThis.__nomiWalkFocusEvents = 0
      window.on('focus', () => { globalThis.__nomiWalkFocusEvents += 1 })
      window.minimize()
      window.hide()
      return window.isVisible()
    })
    if (hidden !== false) throw new Error('MCP key-window walk: could not put the window away, the front-and-center check would prove nothing')
    const begun = await rpc(advert, connectionAttestation, 'integration.begin', {
      kind: 'http-api-provider',
      name: 'Kling',
      baseUrl: 'https://api.kling.example/v1',
      providerKind: 'openai-compatible',
      authType: 'bearer',
    })
    const opened = await rpc(advert, connectionAttestation, 'integration.open_credentials', {
      sessionId: begun.id,
      expectedRevision: begun.revision,
    })

    const settings = win.locator('[data-settings-overlay="true"]')
    await expectVisible(settings, 'MCP open_credentials should bring Settings to the front')
    await expectVisible(settings.locator('[data-settings-tab-id="models"]'), '模型 tab should be selected')
    const wizard = settings
    await expectVisible(wizard.getByText('添加一个 AI 模型', { exact: true }), 'durable credential handoff should open the model onboarding page')
    const providerName = win.getByPlaceholder('如：TOAPI 中转')
    await expectVisible(providerName, 'the handoff should locate the requested provider')
    if (await providerName.inputValue() !== 'Kling') throw new Error('MCP key-window walk: provider name was not restored from the handoff')
    // 「它到前台了吗」量的是**事件**不是事后采样：这台机器上常有别的 worktree 在跑 Electron 走查，
    // 谁都可能在下一毫秒把焦点抢回去——那时 isFocused() 是 false，但 Nomi 该做的一件不少。
    // 焦点事件在它发生的那一刻被记下来，抢不走；isFocused 只作为现场证据打印出来。
    const readFront = () => app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
      return {
        focusEvents: globalThis.__nomiWalkFocusEvents ?? 0,
        focused: Boolean(window?.isFocused()),
        visible: Boolean(window?.isVisible()),
        minimized: Boolean(window?.isMinimized()),
      }
    })
    const front = await readFront()
    // 「窗口自己回来了」是 Nomi 完全说了算的那一半，任何时候都必须硬断言。
    if (front.minimized || !front.visible) throw new Error(`MCP key-window walk: window did not come back from the Dock: ${JSON.stringify(front)}`)
    // 焦点这一半要看仪器有没有功率：锁屏 / 没有前台登录会话时，macOS 的窗口服务器**不给任何 App**
    // 焦点，那时候量到的 0 说的是这台机器不是 Nomi。所以拿不到焦点先做一次阳性对照——
    // 由走查自己直接去抢焦点（不经 Nomi 的代码），对照也拿不到 = 环境没功率，明说这一道没跑成；
    // 对照拿得到而 Nomi 的路径拿不到 = 真 bug，照红。
    if (front.focusEvents < 1 && !front.focused) {
      await app.evaluate(({ app: electronApp, BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
        window?.show()
        if (process.platform === 'darwin') electronApp.focus({ steal: true })
        window?.focus()
      })
      focusControl = 'pending'
    }
    await screenshotSettled(win, { path: path.join(shotsDir, '01-provider-page.png') })

    const keyInput = win.getByPlaceholder('sk-...')
    await expectVisible(keyInput, 'provider key input should be visible')
    await keyInput.fill(FAKE_KEY)
    await clickOrFail(wizard.getByRole('button', { name: '保存连接' }), '保存连接')
    await expectVisible(settings.locator('[data-settings-tab-id="models"]'), 'Settings remains open after saving')

    const ready = await rpc(advert, connectionAttestation, 'integration.get', { sessionId: begun.id })
    if (ready.credentialStatus !== 'ready') throw new Error(`credential did not persist: ${JSON.stringify(ready)}`)
    const proposed = await rpc(advert, connectionAttestation, 'integration.propose', {
      sessionId: begun.id,
      expectedRevision: ready.revision,
      proposal: { candidates: [{ modelKey: 'kling-video-v1', kind: 'video' }], selections: [{ modelKey: 'kling-video-v1' }] },
    })
    if (proposed.credentialStatus !== 'ready' || proposed.stage !== 'needs_spend_confirmation')
      throw new Error(`propose regressed to credential state: ${JSON.stringify(proposed)}`)
    const confirmed = await rpc(advert, connectionAttestation, 'integration.request_confirmation', {
      sessionId: begun.id,
      expectedRevision: proposed.revision,
      idempotencyKey: 'mcp-key-window-walkthrough-confirm',
    })
    if (!confirmed.challengeId) throw new Error(`confirm did not return a challenge: ${JSON.stringify(confirmed)}`)

    // B 面：能力核启动时真的改写了某个助手的 Nomi 接入配置 → 主窗口弹一句「去重启它」。
    // 走查里不能让它真去改开发者的 ~/.claude.json（NOMI_E2E=1 时修复整个关掉，见 mcpConfig），
    // 所以这里从渲染层的入口喂进主进程会发的那条 payload——断言的是「名单原样进了提示」。
    await win.waitForFunction(() => typeof window.__nomiCapabilityApply === 'function', undefined, { timeout: 10_000 })
    const notified = await win.evaluate(async () => {
      const apply = window.__nomiCapabilityApply
      return apply('host-config.repaired', { clients: ['Claude Code', 'Codex'] })
    })
    if (notified?.notified !== true) throw new Error(`repair notice was not delivered: ${JSON.stringify(notified)}`)
    await expectVisible(
      win.getByText('已修复 Claude Code、Codex 的 Nomi 接入配置，重启 Claude Code、Codex 后生效', { exact: true }),
      'repair toast should name every repaired assistant',
    )
    await screenshotSettled(win, { path: path.join(shotsDir, '02-host-config-repaired-toast.png') })
    console.log(`MCP KEY WINDOW PASS: ${path.join(shotsDir, '01-provider-page.png')}`)
    console.log(`MCP KEY WINDOW PASS: ${path.join(shotsDir, '02-host-config-repaired-toast.png')}`)
    // 阳性对照的判读放在旅程末尾：中间这些真实交互（填 key、保存、三次 RPC）本身就是
    // 让操作系统有时间把焦点事件送达的等待，不用在测试里数墙钟（R18）。
    if (focusControl === 'pending') {
      const control = await readFront()
      if (control.focusEvents > 0 || control.focused) {
        throw new Error(`MCP key-window walk: the window server does grant focus here, but open_credentials did not take it: ${JSON.stringify(front)}`)
      }
      console.log(`MCP KEY WINDOW FOCUS SKIPPED: 这台机器的窗口服务器现在不给任何 App 焦点（锁屏/无前台会话）——`
        + `阳性对照直接抢焦点同样拿不到 ${JSON.stringify(control)}；本次只验证了「窗口自己回到前台可见」。`)
    }
    console.log(`credentialEntry=${Boolean(opened?.credentialEntry)} front=${JSON.stringify(front)} focusControl=${focusControl} stage=${proposed.stage}`)
  } finally {
    await launched.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
