/* global window, document, crypto */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import console from 'node:console'
import readline from 'node:readline'
import { createHash } from 'node:crypto'
import { launchNomiApp } from './_launchApp.mjs'

// Explicit opt-in: this driver invokes the signed-in official CLI and may consume account quota.
if (process.env.NOMI_LIVE_ANTIGRAVITY !== '1') throw new Error('Set NOMI_LIVE_ANTIGRAVITY=1 to run the authenticated walkthrough')
const out = path.join(process.cwd(), 'outputs/antigravity-authenticated-20260827/application')
const tempRoot = '/tmp/nomi-antigravity-application-20260827'
fs.mkdirSync(out, { recursive: true })
const report = { tempRoot, build: createHash('sha256').update(fs.readFileSync('dist-electron/ai/antigravityProcess.js')).digest('hex'), actions: [], errors: [] }
if (fs.existsSync(path.join(out, 'report.json'))) fs.copyFileSync(path.join(out, 'report.json'), path.join(out, `report-${Date.now()}.json`))
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
const { app, win: initialWin, close } = await launchNomiApp({ name: 'antigravity-application', tempRoot,
  env: { HTTPS_PROXY: 'http://127.0.0.1:7897', HTTP_PROXY: 'http://127.0.0.1:7897', NO_PROXY: 'localhost,127.0.0.1,::1' } })
if (process.env.NOMI_LIVE_AGY_DIAGNOSTICS === '1') {
  // Test-process observation only: same binary/argv/env and unchanged production request path.
  // Captures only this isolated app's headless CLI stdout, never login or credential files.
  await app.evaluate((_, directory) => {
    const childProcess = process.getBuiltinModule('node:child_process')
    const fs = process.getBuiltinModule('node:fs'); const path = process.getBuiltinModule('node:path')
    const original = childProcess.spawn
    childProcess.spawn = function (...args) {
      const child = original.apply(this, args)
      if (path.basename(String(args[0])) === 'agy' && args[1]?.includes('--input-format')) {
        const file = path.join(directory, `native-${Date.now()}-${child.pid}.jsonl`)
        let bytes = 0
        child.stdout.on('data', chunk => {
          bytes += Buffer.byteLength(chunk)
          if (bytes <= 4 * 1024 * 1024) fs.appendFileSync(file, chunk, { mode: 0o600 })
        })
      }
      return child
    }
  }, out).catch(async error => { await close(); throw error })
}
let win = initialWin
win.on('pageerror', (error) => { report.errors.push(error.message); save() })
const nativeWindow = await app.browserWindow(win)
await nativeWindow.evaluate((window) => window.setBounds({ width: 1600, height: 1000 }))
await win.evaluate(() => {
  for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi-onboarding-checklist:v1']) window.localStorage.setItem(key, 'seen')
})
await win.reload(); await win.waitForLoadState('domcontentloaded')
async function inspect() {
  return win.evaluate(() => ({
    pages: [...document.querySelectorAll('[data-model-settings-page]')].map((e) => e.getAttribute('data-model-settings-page')),
    buttons: [...document.querySelectorAll('button,[role="button"],summary')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => ({
      text: e.textContent?.trim().slice(0, 100), aria: e.getAttribute('aria-label'), testid: e.getAttribute('data-testid'),
      available: e.getAttribute('data-model-home-available'), connection: e.getAttribute('data-model-home-connection'), disabled: e.disabled,
    })).slice(0, 100),
    nodes: [...document.querySelectorAll('[data-node-id][data-kind]')].map((e) => ({ id: e.getAttribute('data-node-id'), kind: e.getAttribute('data-kind'), status:e.getAttribute('data-status') })),
    images: [...document.images].filter((e) => e.getBoundingClientRect().width > 20).map((e) => ({alt:e.alt,loaded:e.complete && e.naturalWidth > 0, width:e.naturalWidth,height:e.naturalHeight})),
  }))
}
async function screenshot(name) {
  const file = path.join(out, name + '.png'); await win.screenshot({ path: file }); return file
}
const catalog = () => win.evaluate(async () => (await window.nomiDesktop.modelCatalog.listModels()).filter((m) => m.vendorKey === 'antigravity-cli').map((m) => ({modelKey:m.modelKey,kind:m.kind,enabled:m.enabled,meta:m.meta})))
console.log(JSON.stringify({ ready:true, tempRoot, initial:await inspect(), screenshot:await screenshot('01-initial') })); save()
const input = readline.createInterface({ input:process.stdin, crlfDelay:Infinity })
try {
  for await (const line of input) {
    if (!line.trim()) continue
    const command = JSON.parse(line)
    try {
      const live = app.windows().filter((page) => !page.isClosed())
      win = live.find((page) => /projectId=/.test(page.url())) || live[live.length - 1] || win
      let result
      if (command.action === 'close') break
      if (command.action === 'inspect') result = await inspect()
      else if (command.action === 'click') { await win.locator(command.selector).click({timeout:8000}); result = {clicked:command.selector} }
      else if (command.action === 'textClick') { await win.getByText(command.text,{exact:command.exact ?? true}).first().click({timeout:8000}); result = {clicked:command.text} }
      else if (command.action === 'fill') { await win.locator(command.selector).fill(command.value); result = {filled:true} }
      else if (command.action === 'insert') { await win.locator(command.selector).click(); await win.keyboard.insertText(command.value); result = {inserted:true} }
      else if (command.action === 'key') { await win.keyboard.press(command.key); result = {key:command.key} }
      else if (command.action === 'wait') { await win.locator(command.selector).waitFor({state:command.state || 'visible',timeout:command.timeout || 30000}); result = {waited:command.selector} }
      else if (command.action === 'screenshot') result = await screenshot(command.name)
      else if (command.action === 'scroll') { await win.locator(command.selector).scrollIntoViewIfNeeded(); result = {scrolled:true} }
      else if (command.action === 'resize') { await (await app.browserWindow(win)).evaluate((window, bounds) => window.setBounds(bounds), { width:command.width, height:command.height }); result = {resized:true} }
      else if (command.action === 'verifyGroups') {
        const labels = await win.locator('[data-agy-models] button').allTextContents()
        const expected = ['Gemini 3.7 Flash','Gemini 3.6 Flash','Gemini 3.5 Flash','Gemini 3.1 Pro','Claude Sonnet 4.6','Claude Opus 4.6','GPT-OSS 120B']
        for (const label of expected) assert(labels.includes(label), 'Missing family: '+label)
        assert.equal(labels.length,9,'Seven models, one tool and one route')
        result={families:7,labels}
      }
      else if (command.action === 'verifyDetail') {
        const detail=win.locator('[data-model-settings-page="model"]')
        assert.equal(await detail.getAttribute('data-model-settings-model'),command.modelId)
        if (command.variant) assert.equal(await detail.locator('[aria-label="思考档位"]').textContent(),command.variant)
        if (typeof command.enabled === 'boolean') assert.equal(await detail.locator('[role="switch"]').isChecked(),command.enabled)
        result={modelId:command.modelId,verified:true}
      }
      else if (command.action === 'verifyCancellation') {
        await win.locator('[data-agy-test]').click()
        assert.match(await win.locator('[data-agy-test]').textContent(),/取消/)
        await win.keyboard.press('Escape')
        await win.locator('[data-model-settings-page="model"]').waitFor({state:'hidden'})
        await win.locator('button:has-text("重新检测"):not([disabled])').waitFor({timeout:15000})
        const status=await win.evaluate(()=>window.nomiDesktop.onboarding.antigravityStatus())
        assert(!status.checks?.some(check=>check.modelId===command.modelId && check.capability===command.capability && check.state==='passed'),'Dismissed active test must not restore proof')
        result={cancelled:true,modelId:command.modelId}
      }
      else if (command.action === 'catalog') result = await catalog()
      else if (command.action === 'status') result = await win.evaluate(() => window.nomiDesktop.onboarding.antigravityStatus())
      else if (command.action === 'test') result = await win.evaluate((request) => window.nomiDesktop.onboarding.antigravityTest(request),command.request)
      else if (command.action === 'enable') result = await win.evaluate((modelKey) => {
        window.nomiDesktop.modelCatalog.upsertModel({vendorKey:'antigravity-cli',modelKey,enabled:true})
        window.nomiDesktop.modelCatalog.upsertVendor({key:'antigravity-cli',enabled:true}); return {enabled:modelKey}
      },command.modelKey)
      else if (command.action === 'projects') result = await win.evaluate(() => window.nomiDesktop.projects.list().map((p) => ({id:p.id,name:p.name})))
      else if (command.action === 'assets') result = await win.evaluate(async (projectId) => window.nomiDesktop.assets.list({projectId}),command.projectId)
      else if (command.action === 'task') result = await win.evaluate(async (value) => {
        const b = window.nomiDesktop; const nodeId = 'agy-walk-' + crypto.randomUUID()
        const {grantId} = await b.tasks.grantSpend({nodeIds:[nodeId],maxAttemptsPerNode:1})
        return b.tasks.run({vendor:'antigravity-cli',request:{kind:value.kind,prompt:value.prompt,
          extras:{projectId:value.projectId,modelKey:value.modelKey,nodeId,spendGrantId:grantId,idempotencyKey:nodeId,...(value.refs?{reference_images:value.refs}:{})}}})
      },command)
      else if (command.action === 'result') result = await win.evaluate((payload) => window.nomiDesktop.tasks.result(payload),command.payload)
      else if (command.action === 'cancel') result = await win.evaluate((taskId) => window.nomiDesktop.tasks.cancel(taskId),command.taskId)
      else if (command.action === 'matrix') {
        const discovery = await win.evaluate(() => window.nomiDesktop.onboarding.antigravityStatus())
        const results = []
        for (const model of discovery.models) {
          for (const capability of ['text','vision']) {
            const status = await win.evaluate((request) => window.nomiDesktop.onboarding.antigravityTest(request),{capability,modelId:model.id})
            const check = status.checks?.find((c) => c.modelId === model.id && c.capability === capability)
            results.push({modelId:model.id,capability,...check,code:status.code})
            if (check?.state === 'passed') await win.evaluate((modelKey) => {
              window.nomiDesktop.modelCatalog.upsertModel({vendorKey:'antigravity-cli',modelKey,enabled:true})
              window.nomiDesktop.modelCatalog.upsertVendor({key:'antigravity-cli',enabled:true})
            },model.id)
            fs.writeFileSync(path.join(out,'model-matrix.json'),JSON.stringify(results,null,2))
            console.log(JSON.stringify({matrixProgress:results.at(-1)}))
            if (status.code === 'ANTIGRAVITY_QUOTA' || status.state === 'login-required') throw new Error(status.code)
          }
        }
        result = results
      } else throw new Error('Unknown walkthrough command')
      report.actions.push({command,result}); save(); console.log(JSON.stringify({ok:true,result}))
    } catch (error) { report.actions.push({command,error:error.message}); save(); console.log(JSON.stringify({ok:false,error:error.message})) }
  }
} finally { input.close(); save(); await close() }

if (report.errors.length || report.actions.some(action => action.error)) process.exitCode = 1
