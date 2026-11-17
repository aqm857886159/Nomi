// 回环真窗口：--phase reopen|old|mixed|single|storyboard，--repo 可指主分支分离检出。
// old/reopen 用 --source <主分支真存盘资料> --project <id>；--broken-source 验证打不开必红。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stationTimeout } from './_station-budget.mjs'

const nativeFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input.href)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return Promise.reject(new Error('scope walk: loopback only'))
  return nativeFetch(input, init)
}
await assert.rejects(fetch('https://scope-walk.invalid/canary'), /loopback only/)
const { expect } = await import('./_assert.mjs')
const { createAgentRuntimeFixture } = await import('./agent-runtime-fixture.mjs')
const arg = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback
const ownRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const repo = path.resolve(arg('--repo', ownRoot))
const { UI_DIR: ipc } = await import(pathToFileURL(path.join(repo, 'tests/ux/uiDir.mjs')).href)
const out = arg('--out')
assert(out && path.isAbsolute(out) && out !== repo && !out.startsWith(repo + path.sep), '--out must be outside the checkout')
const phase = arg('--phase', 'old')
assert(['reopen', 'old', 'mixed', 'single', 'storyboard'].includes(phase), 'unknown phase')
const locale = arg('--locale', 'zh')
assert(['zh', 'en'].includes(locale), 'locale must be zh or en')
fs.mkdirSync(out, { recursive: true })
const write = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2))
const result = { phase, locale, repo, canary: true, checks: {}, screenshots: [], skipped: [] }
const run = promisify(execFile)
const fixture = await createAgentRuntimeFixture({ rootDir: repo, settingsDir: path.join(out, 'fixture-settings'), userDataDir: path.join(out, 'fixture-user-data'), appName: 'nomi', generationProvider: 'apimart', seedApimartKey: false })
fixture.holdTasks(true)
const env = { ...process.env, NOMI_TEST_NETWORK_GUARD: '1', NOMI_E2E_PRODUCTION_FIXTURE: '1', NOMI_E2E_FIXTURE_BASE_URL: fixture.baseURL, NOMI_E2E_FIXTURE_API_KEY: 'agent-runtime-apimart-fixture', NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: fixture.baseURL, NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: fixture.baseURL }]) }
const source = arg('--source')
if (source) {
  assert(path.isAbsolute(source), '--source must be absolute')
  assert(arg('--project'), '--source needs --project')
  // 驱动只收登记夹具；在它分配自己的临时根时复制真存档，保证旧登记表在应用启动前已存在。
  const seed = path.join(out, 'seed-old-profile.mjs')
  fs.writeFileSync(seed, `import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
const source = ${JSON.stringify(source)}, out = ${JSON.stringify(out)}, project = ${JSON.stringify(arg('--project'))}
const original = fs.mkdtempSync
fs.mkdtempSync = function(prefix, ...args) {
  const created = original.call(this, prefix, ...args)
  if (!String(prefix).endsWith('nomi-ui-driver-p' + process.pid + '-')) return created
  const target = fs.realpathSync(created)
  for (const name of ['settings', 'projects', 'user-data']) fs.cpSync(path.join(source, name), path.join(target, name), { recursive: true })
  const registry = JSON.parse(fs.readFileSync(path.join(source, 'settings/recent-workspaces.json'), 'utf8'))
  const entry = registry.find(row => row.id === project)
  assert(entry, 'source must contain requested project')
  const oldRoot = path.dirname(entry.nativeRootPath)
  for (const name of ['recent-workspaces.json', 'workspace-sync-baseline.json']) {
    const file = path.join(target, 'settings', name)
    if (fs.existsSync(file)) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split(oldRoot).join(target))
  }
  if (${process.argv.includes('--broken-source')}) {
    const folder = entry.rootPath.replace(oldRoot, target)
    assert(folder.startsWith(target + path.sep), 'only move the copied project')
    fs.renameSync(folder, path.join(out, 'unavailable-project'))
  }
  fs.writeFileSync(path.join(out, 'seed.json'), JSON.stringify({ source, target, project, beforeAppLaunch: true }))
  return target
}
`)
  env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(seed).href}`.trim()
}
const lock = process.env.NOMI_GATES_LOCK || path.resolve(ownRoot, '../coord-main/scripts/with-gates-lock.py')
async function ui(...args) {
  const command = [path.join(repo, 'tests/ux/ui.mjs'), ...args]
  try {
    const { stdout } = args[0] === 'up'
      ? await run('python3', [lock, '--', process.execPath, ...command], { cwd: repo, env })
      : await run(process.execPath, command, { cwd: repo, env, timeout: 210000 })
    fs.appendFileSync(path.join(out, 'ui-output.jsonl'), JSON.stringify({ args, stdout }) + '\n')
    return ['up', 'down'].includes(args[0]) ? stdout : JSON.parse(stdout)
  } catch (error) {
    fs.appendFileSync(path.join(out, 'ui-output.jsonl'), JSON.stringify({ args, error: String(error), stdout: error.stdout, stderr: error.stderr }) + '\n')
    throw error
  }
}
const read = async expression => (await ui('read', expression)).value
const click = target => ui('click', target)
async function shot(name) { result.screenshots.push((await ui('shot', name)).shot) }
async function reload() {
  // Electron 重载会换窗口；共享驱动下一条命令会重新取活窗口。
  try { await ui('press', 'Meta+r') } catch (error) {
    assert.match(error.stdout || '', /Target page, context or browser has been closed/)
  }
  await expect.poll(async () => (await ui('doctor')).doctor.ok, { timeout: stationTimeout() }).toBe(true)
}
const rows = () => read("Array.from(document.querySelectorAll('[data-spend-confirm-dialog] input')).map(e=>({label:e.getAttribute('aria-label'),checked:e.checked,disabled:e.disabled,text:e.parentElement?.innerText}))")
async function configureProvider() {
  await ui('goto', 'model-settings')
  await click(locale === 'en' ? 'text:Connect APIMart' : 'text:接入 APIMart')
  await ui('fill', 'css:[data-settings-dialog] input[placeholder]', 'agent-runtime-apimart-fixture')
  await click(locale === 'en' ? 'text:Save Verify' : 'text:保存验证')
  await click('css:[data-settings-close]')
}
async function oldProject() {
  assert(source && arg('--project'), 'old/reopen needs --source and --project')
  const state = JSON.parse(fs.readFileSync(path.join(ipc, 'state.json'), 'utf8'))
  const profile = state.tempRoot
  result.checks.seed = JSON.parse(fs.readFileSync(path.join(out, 'seed.json'), 'utf8'))
  assert.equal(result.checks.seed.target, profile, 'must seed the shared driver profile before launch')
  await ui('goto', 'library')
  result.checks.library = await read("Array.from(document.querySelectorAll('[data-project-card]')).map(e=>({id:e.dataset.projectId,text:e.innerText}))")
  await shot('01-library')
  assert(result.checks.library.some(row => row.id === arg('--project')), 'old project card must exist')
  await click(`css:[data-project-id="${arg('--project')}"] button:has-text("${locale === 'en' ? 'Continue' : '继续创作'}")`)
  await ui('goto', 'canvas')
  result.checks.opened = await read('location.href')
  assert(result.checks.opened.includes(arg('--project')), 'must open the requested old project')
  await shot('02-opened')
  if (phase !== 'old') return
  const project = await read(`window.nomiDesktop.projects.readAsync(${JSON.stringify(arg('--project'))})`)
  write('persisted-project.json', project)
  result.checks.oldNodes = project.payload.generationCanvas.nodes.map((node, index) => {
    const shot = /^shot-(\d+)$/.exec(node.meta?.materializationClientId || node.meta?.shotId || '')
    return { id: node.id, status: node.status, result: Boolean(node.result), frozen: Boolean(node.meta?.frozen), label: shot ? `${locale === 'en' ? 'Shot' : '镜'} ${String(shot[1]).padStart(2, '0')}` : `${locale === 'en' ? 'Image' : '图片'} ${index + 1}` }
  })
  await click('css:[data-frame-generate-all]:enabled')
  result.checks.rows = await rows()
  await shot('03-old-card')
  assert(result.checks.rows.length, 'old card must have rows')
  assert(!result.checks.rows.some(row => /已锁定|node_locked|Locked/.test(row.text || '')), 'canvas group must not recognize node locks')
  const recoverable = result.checks.oldNodes.filter(node => node.status === 'recoverable')
  assert(recoverable.length && result.checks.rows.filter(row => row.disabled).length === recoverable.length, 'restarted recoverable rows must be disabled')
  const disabledPoint = await read("Array.from(document.querySelectorAll('[data-spend-confirm-dialog] input')).filter(e=>e.disabled).map(e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})[0]")
  await click(`xy:${disabledPoint.x},${disabledPoint.y}`)
  assert((await rows()).filter(row => row.disabled).every(row => !row.checked), 'clicking a recoverable checkbox must not select it')
  await click('css:[data-spend-confirm-action="cancel"]')
  const other = locale === 'en' ? 'zh-CN' : 'en'
  await click('css:[data-shell-settings]')
  await click('css:[data-settings-tab-id="general"]')
  await click(`css:[data-settings-locale="${other}"]`)
  await click('css:[data-settings-close]')
  await click('css:[data-frame-generate-all]:enabled')
  result.checks.otherLocaleRows = await rows()
  await shot('04-old-card-other-locale')
  assert.deepEqual(result.checks.otherLocaleRows.map(({ checked, disabled }) => ({ checked, disabled })), result.checks.rows.map(({ checked, disabled }) => ({ checked, disabled })))
  await click('css:[data-spend-confirm-action="cancel"]')
  result.checks.oldNodeRows = {}
  const missingSamples = []
  for (const [name, predicate] of Object.entries({ frozenResult: n => n.frozen && n.result, recoverableResult: n => n.status === 'recoverable' && n.result, idleResult: n => n.status === 'idle' && n.result, idleEmpty: n => n.status === 'idle' && !n.result })) {
    const node = result.checks.oldNodes.find(predicate)
    if (!node) {
      result.checks.oldNodeRows[name] = { status: 'unverified', reason: 'missing genuine main-built sample' }
      missingSamples.push(name)
      continue
    }
    const row = result.checks.rows.find(candidate => candidate.label === node.label)
    assert(row, `missing old node row: ${node.label}`)
    assert.equal(row.checked, node.status === 'idle')
    assert.equal(row.disabled, node.status === 'recoverable')
    result.checks.oldNodeRows[name] = row
  }
  assert.deepEqual(missingSamples, [], `missing genuine main-built samples: ${missingSamples.join(', ')}`)
}
async function canvasDispatch() {
  await configureProvider()
  await ui('goto', 'canvas-node', 'image')
  for (let index = 0; index < (phase === 'single' ? 3 : 4); index += 1) {
    if (index) await click('css:[data-add-intent="image"]')
    await ui('fill', `css:.generation-canvas-v2-node[data-kind="image"] >> nth=${index} >> [data-prompt-box] .ProseMirror`, `L scope ${phase} ${locale} node ${index}`)
    if (!index) {
      await click(locale === 'en' ? 'aria:Model' : 'aria:模型')
      await click('role:option=GPT Image 2.6 Flare')
    }
    if (index < 2) {
      await click(locale === 'en' ? 'aria:Generate asset' : 'aria:生成素材')
      await expect.poll(() => fixture.images.length, { timeout: stationTimeout() }).toBe(index + 1)
    }
  }
  await reload()
  await ui('goto', 'canvas')
  await click('css:.react-flow__pane')
  await ui('press', 'Meta+a')
  await ui('press', 'Meta+g')
  await shot('01-before-group')
  const generateGroup = () => click(`css:[data-group-toolbar] button:has-text("${locale === 'en' ? 'Generate group' : '生成整组'}")`)
  await generateGroup()
  if (phase === 'single') {
    await expect.poll(() => fixture.images.length, { timeout: stationTimeout() }).toBe(3)
    assert.equal(await read("Boolean(document.querySelector('[data-spend-confirm-dialog]'))"), false)
    result.checks.directWithoutCard = true
  } else {
    result.checks.rows = await rows()
    assert.equal(result.checks.rows.length, 2)
    assert(result.checks.rows.every(row => row.checked && !row.disabled))
    await shot('02-mixed-card')
    await click('css:[data-spend-confirm-dialog] input >> nth=0')
    assert.equal((await rows()).filter(row => row.checked).length, 1)
    await click('css:[data-spend-confirm-dialog] input >> nth=0')
    await click('css:[data-spend-confirm-action="cancel"]')
    assert.equal(fixture.images.length, 2)
    await generateGroup()
    await click('css:[data-spend-confirm-action="confirm"]')
    await expect.poll(() => fixture.images.length, { timeout: stationTimeout() }).toBe(4)
    assert.deepEqual(fixture.images.slice(2).map(request => request.body.prompt).sort(), [2, 3].map(index => `L scope ${phase} ${locale} node ${index}`).sort())
  }
  fixture.holdTasks(false)
  const skipped = () => read("document.querySelector('[data-notification-reason=\"generation-skipped\"] [data-toast-message]')?.innerText")
  await expect.poll(skipped, { timeout: stationTimeout({ operations: 2 }) }).toMatch(locale === 'en' ? /2.*skip|skip.*2/i : /2.*跳过|跳过.*2/)
  result.checks.after = await skipped()
  await shot('03-after-dispatch')
}
try {
  await ui('up', '--locale', locale, '--out', out)
  if (source && await read("localStorage.getItem('nomi:locale:v1')") !== (locale === 'en' ? 'en' : 'zh-CN')) {
    await click('css:[data-shell-settings]')
    await click('css:[data-settings-tab-id="general"]')
    await click(`css:[data-settings-locale="${locale === 'en' ? 'en' : 'zh-CN'}"]`)
    await click('css:[data-settings-close]')
  }
  assert.equal((await ui('doctor')).doctor.ok, true)
  await ui('features')
  if (['old', 'reopen', 'storyboard'].includes(phase)) {
    await oldProject()
    if (phase === 'storyboard') {
      await ui('goto', 'storyboard')
      const next = await read(`window.nomiDesktop.projects.readAsync(${JSON.stringify(arg('--project'))}).then(p=>Math.max(...Object.values(p.payload.storyboardDesignsByDocumentId).flatMap(ds=>ds.flatMap(d=>d.plan.shots.map(s=>s.index))))+1)`)
      await click(locale === 'en' ? 'text:Add shot' : 'text:添加镜头')
      await ui('fill', `css:[data-storyboard-row="${next}"] .ProseMirror`, 'L scope remaining new shot')
      await click(`css:[data-storyboard-row="${next}"] button[aria-label="${locale === 'en' ? 'Model' : '模型'}"]`)
      await click('role:option=GPT Image 2.6 Flare')
      await shot('storyboard-before-batch')
      await click('css:[data-storyboard-batch]')
      result.checks.storyboardCard = await read("document.querySelector('[data-spend-confirm-dialog]')?.innerText")
      await shot('storyboard-card')
      assert(result.checks.storyboardCard, 'remaining eligible shots must open a card')
      const cardRows = await rows()
      assert.equal(cardRows.length, 1)
      assert.match(cardRows[0].label, new RegExp(String(next)))
      await click('css:[data-spend-confirm-action="confirm"]')
      await expect.poll(() => fixture.images.length, { timeout: stationTimeout() }).toBe(1)
      assert.equal(fixture.images[0].body.prompt, 'L scope remaining new shot')
      await shot('storyboard-after-confirm')
    }
  }
  else await canvasDispatch()
  assert.equal(fixture.unexpected.length, 0)
  result.ok = true
} catch (error) {
  result.ok = false
  result.error = String(error.stack || error)
  await shot('failure').catch(() => {})
  process.exitCode = 1
} finally {
  write('requests.json', { images: fixture.images, videos: fixture.videos, unexpected: fixture.unexpected })
  const stateFile = path.join(ipc, 'state.json')
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    assert.equal(state.out, out, 'only collect logs from this walk')
    const logs = path.join(env.NOMI_UI_USER_DATA || path.join(state.tempRoot, 'user-data'), 'logs')
    if (fs.existsSync(logs)) fs.cpSync(logs, path.join(out, 'main-logs'), { recursive: true })
  }
  result.checks.consoleErrors = fs.existsSync(path.join(out, 'errors.log')) ? fs.readFileSync(path.join(out, 'errors.log'), 'utf8').split('\n').filter(line => /\[(pageerror|console.error|crash)\]/.test(line)) : []
  await ui('down')
  await fixture.close()
  write('result.json', result)
}
console.log(`${result.ok ? 'PASS' : 'FAIL'} generation-scope ${phase} ${locale}; ${path.join(out, 'result.json')}`)
