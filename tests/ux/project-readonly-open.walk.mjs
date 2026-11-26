import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { once } from 'node:events'
import { require as tsxRequire } from 'tsx/cjs/api'
import { clickOrFail, DEFAULT_TIMEOUT_MS, expect } from './_assert.mjs'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { writeFakeApimartCatalog } from './_mcpL2Fixture.mjs'
import { backToLibrary, switchWorkspace } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'

const { openFixtureWorld } = tsxRequire('../fixtures/readonlyOpenProjects.ts', import.meta.url)
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const taskId = 's-walk-video-8'
const h0 = '82bd0ce70ebafa1bcfb0556cbb674a75d48792de3492c49bb6bef6b936d49a18'

function snapshot(dir, prefix = '') {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    const key = prefix + entry.name
    if (entry.isDirectory()) files.push(...snapshot(file, key + '/'))
    else files.push([key, hash(fs.readFileSync(file))])
  }
  return files
}

function verifyTree(initial, current) {
  const before = new Map(initial)
  const after = new Map(current)
  for (const [file, sha] of before) assert.equal(after.get(file), sha, file)
  const added = [...after.keys()].filter(file => !before.has(file))
  for (const file of added) assert.match(file, /^[^/]+\/\.nomi\/cache\/filmstrip\/filmstrip-[^/]+\.jpg$/)
  console.log('H0 files unchanged:', before.size, 'new filmstrips:', added.length)
}

const { world, projects } = openFixtureWorld()
const requests = []
const provider = http.createServer((req, res) => {
  requests.push({ method: req.method, path: req.url })
  const poll = req.method === 'GET' && req.url?.split('?')[0] === '/v1/tasks/' + taskId
  res.writeHead(poll ? 200 : 404, { 'content-type': 'application/json' })
  res.end(JSON.stringify(poll ? { code: 200, data: { id: taskId, status: 'processing', progress: 35 } } : { code: 404 }))
})

async function browse(win, project) {
  const card = win.locator(`[data-project-card][data-project-id="${project.id}"]`)
  await clickOrFail(card, project.name)
  await switchWorkspace(win, 'creation')
  await expect(win.locator('.tiptap:visible').first()).toBeVisible()
  const boards = Object.values(project.read().payload.storyboardDesignsByDocumentId ?? {}).flat()
  if (boards.length) {
    await clickOrFail(win.locator('[data-creation-document-switcher]'), '打开文稿菜单')
    await clickOrFail(win.getByRole('menuitem', { name: boards[0].title }), '查看项目分镜')
    await expect(win.locator('[data-workspace-mode="storyboard"]')).toBeVisible()
  }
  await switchWorkspace(win, 'generation')
  const nodes = project.read().payload.generationCanvas.nodes
  await expect(win.locator(`[data-node-id="${nodes[0].id}"]:visible`).first()).toBeVisible()
  const running = nodes.find(node => node.runs?.some(run => run.taskId === taskId))
  if (running) {
    await expect(win.locator(`[data-node-id="${running.id}"][data-status="recoverable"]`).first()).toBeVisible()
  }
  await switchWorkspace(win, 'preview')
  await expect(win.locator('[data-timeline-toolbar-row]:visible').first()).toBeVisible()
  return card
}

async function manualZoom(win, project, locale) {
  const toolbar = win.locator('[data-timeline-toolbar-row]:visible').first()
  const scale = () => project.read().payload.timeline.scale
  const gesture = async (act, label) => {
    const before = project.read()
    await act()
    await expect.poll(() => project.read().revision, { message: label }).toBe(before.revision + 1)
    assert.notEqual(scale(), before.payload.timeline.scale, label)
    await expect(toolbar.getByText(Math.round(scale() * 100) + '%', { exact: true })).toBeVisible()
  }
  await gesture(() => clickOrFail(toolbar.getByTitle(uiText(locale, 'timelineEditor.zoomInShortcut')), '手动放大时间轴'), 'button')
  await gesture(() => win.keyboard.press('0'), 'keyboard Fit')
  await gesture(async () => {
    await win.locator('.workbench-timeline__tracks:visible').first().hover()
    await win.keyboard.down('Control')
    try { await win.mouse.wheel(0, -100) } finally { await win.keyboard.up('Control') }
  }, 'modified wheel')
}

try {
  const initial = snapshot(world.projectsDir).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  assert.equal(initial.length, 122)
  assert.equal(hash(JSON.stringify(initial)), h0, 'S frozen project file hashes')
  provider.listen(0, '127.0.0.1')
  await once(provider, 'listening')
  const origin = 'http://127.0.0.1:' + provider.address().port
  writeFakeApimartCatalog(world.settingsDir, world.userDataDir, origin)
  const options = {
    world, name: 'project-readonly-open', syntheticCredentialStorage: true,
    viewportSize: { width: 1280, height: 860 }, args: ['--no-proxy-server'],
    mainRequire: [path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs')],
    env: {
      NOMI_DISABLE_AUTO_UPDATE: '1', NOMI_TEST_NETWORK_GUARD: '1',
      NOMI_WALK_ALLOW_ORIGINS: '', NOMI_TEST_NETWORK_FIXTURE_ORIGINS: '',
      NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: origin }]),
      NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: origin,
    },
  }
  for (const [round, letters, locale] of [['first', ['A', 'C', 'B'], 'zh-CN'], ['reopen', ['B'], 'en'], ['edit', ['A'], 'en']]) {
    const start = requests.length
    const { app, win } = await launchNomiApp({
      ...options, initialLocalStorage: {
        'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen',
        'nomi:canvas-gesture-hint:v1': 'seen', 'nomi-onboarding-checklist:v1': 'seen',
      },
    })
    try {
      for (const letter of letters) {
        const project = projects.find(entry => entry.name.startsWith('项目' + letter))
        const card = await browse(win, project)
        if (letter === 'B') {
          await expect.poll(() => requests.slice(start).some(req => req.method === 'GET' && req.path.split('?')[0] === '/v1/tasks/' + taskId),
            { message: '本次冷开确已查询 H0 的原任务号', timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
        }
        if (round === 'edit') await manualZoom(win, project, locale)
        await backToLibrary(win)
        await expect(card).toBeVisible()
      }
    } finally { await app.close() }
    const calls = requests.slice(start)
    assert.deepEqual(calls.filter(req => req.method !== 'GET'), [], 'only status queries on open')
    console.log(round, calls)
    if (round !== 'edit') verifyTree(initial, snapshot(world.projectsDir))
  }
} finally {
  if (provider.listening) await new Promise(resolve => provider.close(resolve))
  world.cleanup()
}
