// 真窗口任务走查；只替换模型为回环夹具。证据与旧资料复制件均在仓库外。
// 经 with-gates-lock.py 跑本文件；每段用新 --out，结果 JSON 的 checks 是逐项判定。
// --phase toolbar（--locale zh|en --size 1280x800|700x720）、legacy（旧节点/记忆/重放/助手）、
// assistant、replay、rollback、storyboard、other；回退输入为 PR 存盘后留下的 upgraded-profile。
// legacy 的输入：--backup <旧资料根> --legacy-root <旧根绝对路径> --project <id>。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { stationTimeout } from './_station-budget.mjs'

const originalFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input.href)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return Promise.reject(new Error('remove-node-lock: loopback only'))
  return originalFetch(input, init)
}
await assert.rejects(fetch('https://remove-node-lock.invalid/canary'), /loopback only/)

const { uiText } = await import('./full-walk/invariants.mjs')
const text = key => uiText('zh-CN', key)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const arg = (name, fallback) => process.argv[process.argv.indexOf(name) + 1] && process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback
assert(arg('--out') && path.isAbsolute(arg('--out')), '--out must name an absolute evidence directory')
const out = path.resolve(arg('--out'))
const backupPath = arg('--backup', process.env.NOMI_LOCK_LEGACY_BACKUP)
assert(out !== root && !out.startsWith(root + path.sep), 'Evidence must stay outside the checkout')
fs.mkdirSync(out, { recursive: true })
process.chdir(out)
const phase = arg('--phase')
const locale = arg('--locale', 'zh')
const size = arg('--size', '1280x800')
const result = { phase, locale, size, canary: true, checks: {}, screenshots: [], skipped: [] }
const write = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2))
const run = promisify(execFile)
const lock = process.env.NOMI_GATES_LOCK
async function ui(...args) {
  if (args[0] === 'up') assert(lock && path.isAbsolute(lock), 'Set NOMI_GATES_LOCK to with-gates-lock.py')
  const command = [path.join(root, 'tests/ux/ui.mjs'), ...args]
  const options = { cwd: root, timeout: 240000, env: { ...process.env, NOMI_TEST_NETWORK_GUARD: '1', NOMI_DISABLE_AUTO_UPDATE: '1', NOMI_WALK_ALLOW_ORIGINS: '' } }
  const { stdout } = args[0] === 'up'
    ? await run('python3', [lock, '--', process.execPath, ...command], options)
    : await run(process.execPath, command, options)
  fs.appendFileSync(path.join(out, 'ui-output.jsonl'), JSON.stringify({ args, stdout }) + '\n')
  return args[0] === 'up' || args[0] === 'down' ? stdout : JSON.parse(stdout)
}
async function toolbar() {
  const { CANVAS_ADD_BAR } = await import('./_shell.mjs')
  await ui('up', '--locale', locale, '--size', size, '--out', out)
  try {
    assert.equal((await ui('doctor')).doctor.ok, true)
    await ui('features')
    for (const kind of ['image', 'video', 'text']) {
      if (kind === 'text') {
        await ui('click', `css:${CANVAS_ADD_BAR} [data-add-intent="text"]`)
      } else await ui('goto', 'canvas-node', kind)
      // 点这一类节点本身，不能把前一个仍选中的图片当成视频。
      await ui('click', `css:.generation-canvas-v2-node[data-kind="${kind}"]`)
      const actual = (await ui('read', `[...document.querySelectorAll('.generation-canvas-v2-node')].filter(e=>e.querySelector('.generation-canvas-v2-node__composer')).map(e=>e.dataset.kind)`)).value
      assert.deepEqual(actual, [kind])
      const shot = await ui('shot', `${kind}-before`)
      result.screenshots.push(shot.shot)
      const bar = (await ui('read', `Array.from(document.querySelectorAll('[data-node-floating-toolbar]')).map(e=>({width:e.getBoundingClientRect().width,expectedWidth:[...e.children].reduce((n,c)=>n+c.offsetWidth,0)+parseFloat(getComputedStyle(e).paddingLeft)+parseFloat(getComputedStyle(e).paddingRight)+parseFloat(getComputedStyle(e).borderLeftWidth)+parseFloat(getComputedStyle(e).borderRightWidth)+(e.children.length-1)*parseFloat(getComputedStyle(e).columnGap),layoutWidth:e.offsetWidth,children:[...e.children].map(c=>({width:c.getBoundingClientRect().width,label:c.getAttribute('aria-label')||c.textContent,title:c.title}))}))`)).value
      assert(bar.length > 0 && bar.every(b => b.children.length > 0 && Math.abs(b.layoutWidth - b.expectedWidth) <= 1 && b.children.every(c => c.width > 0 && c.label)))
      result.checks[kind] = { actual, bar }
      if (kind === 'text') {
        assert.equal((await ui('read', "!document.querySelector('[data-text-process-box] textarea')?.disabled")).value, true, 'Text prompt must be editable regardless of toolbar wording')
        const marker = `L_EDIT_${locale}`
        await ui('fill', 'css:[data-text-process-box] textarea', marker)
        await ui('press', 'Tab')
        assert.equal((await ui('read', `document.querySelector('[data-text-process-box] textarea')?.value`)).value, marker)
        const project = (await ui('read', 'window.nomiDesktop.projects.readAsync(new URLSearchParams(location.hash.split("?")[1]).get("projectId"))')).value
        write('text-persisted.json', project)
        assert(JSON.stringify(project).includes(marker), 'Prompt must survive storage read')
        result.checks.text.editable = true
        result.screenshots.push((await ui('shot', 'text-after')).shot)
      }
    }
  } finally { await ui('down') }
}

async function replayOldJournal(backup) {
  assert(backup && path.isAbsolute(backup), '--backup must name the copied legacy fixture')
  const { require: tsxRequire } = await import('tsx/cjs/api')
  const { replayCanvasEvents } = tsxRequire(path.join(root, 'src/workbench/generationCanvas/events/canvasEventReducer.ts'), import.meta.url)
  const projectName = fs.readdirSync(path.join(backup, 'projects'))[0]
  const eventDir = path.join(backup, 'projects', projectName, '.nomi/events')
  const events = fs.readdirSync(eventDir).filter(f => /^log-\d+\.jsonl$/.test(f)).flatMap(f => fs.readFileSync(path.join(eventDir, f), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)).sort((a, b) => a.seq - b.seq)
  const lockEvents = events.filter(e => /^canvas\.node\.(un)?locked$/.test(e.type))
  assert(lockEvents.length >= 4)
  const replayed = replayCanvasEvents(events)
  const lockedIds = new Set(lockEvents.filter(e => e.type === 'canvas.node.locked').map(e => e.payload.nodeId))
  for (const id of lockedIds) assert(replayed.nodes.some(n => n.id === id && !Object.hasOwn(n, 'locked')))
  write('journal-replay.json', { eventCount: events.length, lockEventCount: lockEvents.length, replayed })
  result.checks.replay = true
}

async function legacy() {
  const { launchNomiApp } = await import('./_launchApp.mjs')
  const shell = await import('./_shell.mjs')
  const { expect } = await import('./_assert.mjs')
  const { createAgentRuntimeFixture, flattenRequestText, FIXTURE_TEXT_MODEL_LABEL } = await import('./agent-runtime-fixture.mjs')
  const { chooseAssistantModel, sendCanvas, hasToolResult, recorded, waitForV4TurnIdle, CANVAS_PANEL, approvePendingIntervention } = await import('./agent-runtime-walk-support.mjs')
  assert(backupPath && path.isAbsolute(backupPath), '--backup must name the legacy fixture')
  const backup = backupPath
  const oldRoot = arg('--legacy-root', process.env.NOMI_LOCK_LEGACY_ROOT)
  assert(oldRoot && path.isAbsolute(oldRoot), '--legacy-root must name the original isolated root')
  const projectId = arg('--project', 'project-1794890849328-89ocnz')
  const tempRoot = path.join(out, 'profile')
  assert(!fs.existsSync(tempRoot), 'Use a new evidence directory for each run')
  fs.cpSync(backup, tempRoot, { recursive: true })
  // 仅改复制件里旧的绝对路径；原始快照与事件字节保留在 backup。
  function relocate(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) relocate(file)
      else if (/\.jsonl?$/.test(file)) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split(oldRoot).join(tempRoot))
    }
  }
  relocate(path.join(tempRoot, 'settings'))
  const projectRoot = path.join(tempRoot, 'projects', fs.readdirSync(path.join(tempRoot, 'projects'))[0])
  fs.renameSync(path.join(tempRoot, 'settings/model-catalog.json'), path.join(tempRoot, 'settings/model-catalog.before.json'))
  if (phase === 'storyboard') {
    const file = path.join(projectRoot, '.nomi/project.json')
    const project = JSON.parse(fs.readFileSync(file, 'utf8'))
    const design = Object.values(project.payload.storyboardDesignsByDocumentId)[0][0]
    design.plan.anchors = [{ id: 'L_REF', name: 'L_REF', kind: 'character', carrier: 'visual', description: '短发，蓝衣', modelKey: 'gpt-image-2', modelVendor: 'apimart', modeId: 't2i' }]
    design.plan.shots = [1, 2].map(index => ({ index, shotId: 'L_SHOT_' + index, shotKind: 'image', durationSec: 3, anchorIds: ['L_REF'], prompt: 'L_REF 走在街头 ' + index, modelKey: 'gpt-image-2', modelVendor: 'apimart', modeId: 't2i' }))
    fs.writeFileSync(file, JSON.stringify(project))
    // 分镜夹具改了方案内容：不继承旧复制件的同步指纹；老用户升级阶段不改这个文件。
    fs.renameSync(path.join(tempRoot, 'settings/workspace-sync-baseline.json'), path.join(tempRoot, 'settings/workspace-sync-baseline.before.json'))
  }
  const fixture = await createAgentRuntimeFixture({ rootDir: root, settingsDir: path.join(tempRoot, 'settings'), generationProvider: 'apimart', userDataDir: path.join(tempRoot, 'user-data'), appName: 'nomi' })
  let app, win, launched
  const nodes = p => p.payload.generationCanvas.nodes
  const save = () => win.evaluate(id => window.nomiDesktop.projects.readAsync(id), projectId)
  const snap = async name => { const file = path.join(out, name + '.png'); await win.screenshot({ path: file }); result.screenshots.push(file) }
  try {
    launched = await launchNomiApp({ name: 'remove-node-lock', tempRoot, settingsDir: path.join(tempRoot, 'settings'), viewportSize: { width: 1280, height: 800 }, settleMs: 0,
      mainRequire: [path.join(root, 'scripts/walkthrough-network-guard.cjs')],
      initialLocalStorage: { 'nomi:locale:v1': 'zh-CN', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen' },
      env: { NOMI_TEST_NETWORK_GUARD: '1', NOMI_WALK_ALLOW_ORIGINS: '', NOMI_WALK_NET_LOG: path.join(out, 'network.jsonl'), NOMI_DISABLE_AUTO_UPDATE: '1', NOMI_E2E_PRODUCTION_FIXTURE: '1', NOMI_E2E_FIXTURE_BASE_URL: fixture.baseURL, NOMI_E2E_FIXTURE_API_KEY: 'agent-runtime-apimart-fixture', NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: fixture.baseURL, NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: fixture.baseURL }]) },
    })
    app = launched.app; win = launched.win
    for (const stream of ['stdout', 'stderr']) app.process()[stream]?.on('data', data => fs.appendFileSync(path.join(out, 'app.log'), data))
    const card = win.locator(`[data-project-card][data-project-id="${projectId}"]`)
    await card.hover()
    await card.getByRole('button', { name: text('library.continueCreating'), exact: true }).click()
    await expect.poll(() => app.windows().some(w => !w.isClosed() && w.url().includes(projectId))).toBe(true)
    win = app.windows().find(w => !w.isClosed() && w.url().includes(projectId))
    await expect(win.locator('[data-mode="creation"]').first()).toBeVisible()
    await snap('legacy-open')
    assert.equal(await app.evaluate(async () => { try { await fetch('https://remove-node-lock.invalid/main-canary'); return false } catch { return true } }), true)
    if (phase === 'rollback') {
      const original = JSON.parse(fs.readFileSync(path.join(backup, 'projects', path.basename(projectRoot), '.nomi/project.json'), 'utf8'))
      const reopened = await save()
      assert.deepEqual(nodes(reopened).map(n => n.id).sort(), nodes(original).map(n => n.id).sort())
      await shell.switchWorkspace(win, 'generation')
      await shell.switchGenerationView(win, 'canvas')
      await shell.collapseAgentPanel(win)
      await shell.canvasFitView(win)
      for (const node of nodes(reopened).filter(n => n.kind === 'text')) {
        await win.locator(`[data-node-id="${node.id}"]`).click({ position: { x: 8, y: 8 } })
        await expect(win.locator('[data-text-process-box] textarea')).toBeEditable()
      }
      write('rollback-project.json', reopened)
      result.checks.rollback = { nodeCount: nodes(reopened).length, editable: true }
      await snap('rollback-open')
      return
    }
    if (phase === 'storyboard') {
      const { openStoryboardEditor } = await import('./_creationResourceTree.mjs')
      await shell.switchWorkspace(win, 'creation')
      await openStoryboardEditor(win, { pick: 'first' }, 'node-lock reference regression')
      await shell.collapseAgentPanel(win)
      const expand = win.getByRole('button', { name: text('storyboardEditor.anchor.expandAll'), exact: true })
      if (await expand.count()) await expand.click()
      const anchor = win.locator('[data-storyboard-anchor-row="L_REF"]')
      await expect(anchor).toBeVisible()
      const confirm = win.locator('[data-spend-confirm-action="confirm"]')
      const finishGeneration = async ready => {
        await expect.poll(async () => {
          if (await confirm.isVisible() && await confirm.isEnabled()) await confirm.click()
          return ready()
        }, { timeout: stationTimeout({ operations: 3 }) }).toBe(true)
      }
      await snap('reference-generation-before')
      await anchor.getByRole('button', { name: '生成参考卡「L_REF」', exact: true }).click()
      await finishGeneration(() => anchor.locator('[data-anchor-face="done"]').isVisible())
      const batch = win.locator('[data-storyboard-batch="true"]')
      const state = async () => ({ enabled: await batch.isEnabled(), label: await batch.innerText(), footer: await win.locator('[data-storyboard-plan-footer]').innerText() })
      const unfrozen = await state()
      await snap('reference-unfrozen')
      await anchor.getByRole('button', { name: text('storyboardEditor.anchor.freezeTitle'), exact: true }).click()
      await expect(anchor.locator('[data-anchor-face="locked"]')).toBeVisible()
      const frozen = await state()
      await snap('reference-frozen')
      await expect.poll(async () => nodes(await save()).some(n => n.title === 'L_REF' && n.meta?.frozen?.by === 'user')).toBe(true)
      write('reference-frozen-persisted.json', await save())
      await anchor.getByRole('button', { name: '解锁', exact: true }).click()
      await expect(anchor.locator('[data-anchor-face="done"]')).toBeVisible()
      const unfrozenAgain = await state()
      await snap('reference-unfrozen-again')
      const menu = win.locator('[data-storyboard-row-menu-trigger="1"]')
      await menu.click()
      const menuText = await win.locator('[data-storyboard-row-menu="1"]').innerText()
      await snap('shot-menu')
      assert(menuText.includes(text('storyboardEditor.frame.freeze')))
      await win.keyboard.press('Escape')
      assert(unfrozen.enabled && frozen.enabled && unfrozenAgain.enabled, 'Reference look toggles must not disable these runnable shots')
      await batch.click()
      await snap('batch-after-click')
      await finishGeneration(async () => {
        const shots = nodes(await save()).filter(n => n.meta?.shotId?.startsWith('L_SHOT_'))
        return fixture.images.length === 3 && shots.length === 2 && shots.every(n => n.status === 'success' && n.result?.url)
      })
      result.checks.storyboard = { unfrozen, frozen, unfrozenAgain, menuText, imageRequests: fixture.images.length }
      write('storyboard-persisted.json', await save())
      await snap('batch-after')
      return
    }
    if (phase === 'other') {
      await shell.switchWorkspace(win, 'generation')
      await shell.switchGenerationView(win, 'canvas')
      await shell.collapseAgentPanel(win)
      await shell.canvasFitView(win)
      await win.locator('.generation-canvas-v2-node[data-kind="director"]').click({ position: { x: 8, y: 8 } })
      await win.getByRole('button', { name: text('director.node.open'), exact: true }).click()
      await win.getByRole('button', { name: '精修', exact: true }).click()
      await win.getByRole('button', { name: /场景「场景 1」/ }).click()
      await snap('director-locked')
      await win.locator('button[title="解锁"]').click()
      await expect(win.locator('button[title="锁定"]')).toBeVisible()
      await snap('director-unlocked')
      await win.locator('button[title="锁定"]').click()
      await expect(win.locator('button[title="解锁"]')).toBeVisible()
      await snap('director-relocked')
      result.checks.director = true
      await win.getByRole('button', { name: text('director.editor.exit'), exact: true }).click()
      await win.getByRole('dialog').getByRole('button', { name: '退出', exact: true }).click()
      await expect(win.getByRole('dialog')).toBeHidden()
      await shell.canvasFitView(win)
      await win.locator('.generation-canvas-v2-node[data-kind="whiteboard"]').click({ position: { x: 8, y: 8 } })
      await win.getByRole('button', { name: text('generationCommon.nodeEmpty.whiteboard.action'), exact: true }).click()
      await win.getByRole('button', { name: '图层', exact: true }).click()
      await snap('whiteboard-layers')
      const controls = await win.locator('[data-whiteboard-panel="layers"] button').evaluateAll(es => es.map(e => ({ aria: e.getAttribute('aria-label'), title: e.title, text: e.textContent })))
      assert(controls.length > 0, 'Read the opened layer panel, not hidden canvas buttons')
      result.checks.whiteboard = { controls, lockEntry: controls.some(e => /^(锁定|解锁|Lock|Unlock)$/.test(e.title || e.aria || e.text || '')) }
      await win.getByRole('button', { name: '完成', exact: true }).click()
      write('other-persisted.json', await save())
      return
    }
    const before = await save()
    write('legacy-open.json', before)
    const ids = nodes(before).filter(n => n.kind === 'text').map(n => n.id)
    assert.equal(ids.length, 2)
    await shell.switchWorkspace(win, 'generation')
    await shell.switchGenerationView(win, 'canvas')
    await shell.collapseAgentPanel(win)
    await shell.canvasFitView(win)
    if (phase === 'legacy') {
    for (const [index, id] of ids.entries()) {
      await win.locator(`[data-node-id="${id}"]`).click({ position: { x: 8, y: 8 } })
      const input = win.locator('[data-text-process-box] textarea')
      await snap(`legacy-${index}-before`)
      await expect(input, 'Old locked node must be editable regardless of lock label').toBeEditable()
      await input.fill(`L_LEGACY_PROMPT_${index}`)
      await input.press('Tab')
      await expect.poll(async () => nodes(await save()).find(n => n.id === id)?.prompt).toBe(`L_LEGACY_PROMPT_${index}`)
      await snap(`legacy-${index}-after`)
    }
    assert(nodes(await save()).filter(n => ids.includes(n.id)).every(n => !Object.hasOwn(n, 'locked')))
    result.checks.legacyEditable = true
    result.checks.legacyTopLevelLockRemoved = true
    await replayOldJournal(backup)
    }
    await shell.ensureAgentPanelOpen(win)
    await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, CANVAS_PANEL)
    const trigger = 'L_REMOVE_NODE_LOCK'
    const calls = [
      ['read', 'look_at_canvas', {}],
      ['write', 'write_node_text', { nodeId: ids[0], text: 'L_ASSISTANT_EDITED', mode: 'replace' }],
      ['read-again', 'look_at_canvas', {}],
      ['delete', 'delete_from_canvas', { nodeIds: [nodes(before).find(n => n.kind === 'image').id] }],
    ]
    for (const [index, [id, name, args]] of calls.entries()) fixture.expectText({ label: id, match: b => {
      const matched = flattenRequestText(b).includes(trigger) && (index === 0 ? !hasToolResult(b, 'L_read') : hasToolResult(b, 'L_' + calls[index - 1][0])) && !hasToolResult(b, 'L_' + id)
      if (matched && id === 'read-again') {
        const file = path.join(projectRoot, '.nomi/project-agent-proposal-receipt.json')
        if (fs.existsSync(file)) fs.copyFileSync(file, path.join(out, 'write-receipt.json'))
      }
      return matched
    }, reply: { type: 'tool', id: 'L_' + id, name, args } })
    const done = fixture.expectText({ label: 'done', match: b => hasToolResult(b, 'L_delete'), reply: { type: 'text', text: 'L_DONE' } })
    await sendCanvas(win, `${trigger}：改文字节点 ${ids[0]} 的正文，然后删除空图片节点；不生成。`)
    await expect(win.locator(`${CANVAS_PANEL} [data-v4-control="confirm"]`)).toBeVisible({ timeout: stationTimeout({ operations: 3 }) })
    await snap('delete-before')
    await approvePendingIntervention(win, CANVAS_PANEL)
    await recorded(done.received, 'delete receipt')
    await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: win.locator(CANVAS_PANEL).getByText('L_DONE', { exact: true }) })
    await expect.poll(async () => JSON.stringify(nodes(await save()).find(n => n.id === ids[0]))).toContain('L_ASSISTANT_EDITED')
    write('model-requests.json', fixture.requests)
    const toolResults = fixture.requests.flatMap(r => (r.body.messages ?? []).filter(m => m.role === 'tool'))
    assert(toolResults.length >= 4)
    assert(!/\\?"locked\\?"\s*:|node_locked/.test(JSON.stringify(toolResults)))
    const receipt = fs.readFileSync(path.join(projectRoot, '.nomi/project-agent-proposal-receipt.json'), 'utf8')
    fs.writeFileSync(path.join(out, 'delete-receipt.json'), receipt)
    assert(!/"locked"\s*:/.test(receipt))
    assert(!/"locked"\s*:/.test(fs.readFileSync(path.join(out, 'write-receipt.json'), 'utf8')))
    result.checks.assistant = true
    await snap('assistant-after')
    write('legacy-after.json', await save())
    fs.cpSync(tempRoot, path.join(out, 'upgraded-profile'), { recursive: true })
    result.checks.rollback = 'unverified: reopen upgraded-profile with the old build'
  } catch (error) {
    write('model-requests.json', fixture.requests)
    if (win && !win.isClosed()) { await snap('failure'); write('failure-dom.json', { url: win.url(), text: await win.locator('body').innerText(), windows: app.windows().map(w => w.url()) }) }
    throw error
  } finally { if (launched) await launched.close(); await fixture.close() }
}
try {
  if (phase === 'replay') await replayOldJournal(backupPath)
  else if (phase === 'toolbar') await toolbar()
  else if (['legacy', 'assistant', 'storyboard', 'other', 'rollback'].includes(phase)) await legacy()
  else throw new Error(`Unknown phase ${phase}`)
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'; result.error = error.stack
  console.error(error.stack)
  process.exitCode = 1
} finally { write('result.json', result) }
