// Upgrade-path regression for the 0.22.5 -> 0.23.0 project-open failure.
//
// The caller supplies an isolated, already-created upgrade fixture. This runner
// corrupts only that fixture's durable proposal receipt, opens the project through
// the real library card, and records the quarantine plus successful project open.
// It never touches the user's profile and does not call private renderer state.
import fs from 'node:fs'
import path from 'node:path'

import { launchNomiApp, closeNomiApp } from './_launchApp.mjs'
import { dismissSplashIfPresent } from '../../evals/lib/isoApp.mjs'
import { stationTimeout } from './_station-budget.mjs'

const projectsDir = process.env.NOMI_UPGRADE_PROJECTS_DIR
const userDataDir = process.env.NOMI_UPGRADE_USER_DATA_DIR
const settingsDir = process.env.NOMI_UPGRADE_SETTINGS_DIR
const capabilityDir = process.env.NOMI_UPGRADE_CAPABILITY_DIR
const projectId = process.env.NOMI_UPGRADE_PROJECT_ID || 'upgrade-canvas-history'

if (![projectsDir, userDataDir, settingsDir, capabilityDir].every(Boolean)) {
  throw new Error('Set NOMI_UPGRADE_{PROJECTS,USER_DATA,SETTINGS,CAPABILITY}_DIR to isolated directories')
}

function findProjectRoot() {
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const root = path.join(projectsDir, entry.name)
    const recordPath = path.join(root, '.nomi', 'project.json')
    if (!fs.existsSync(recordPath)) continue
    try {
      if (JSON.parse(fs.readFileSync(recordPath, 'utf8')).id === projectId) return root
    } catch {
      // The app owns the record format; an unreadable sibling is not this fixture.
    }
  }
  throw new Error(`Project ${projectId} is not present in ${projectsDir}`)
}

function rendererLogText() {
  const logs = path.join(userDataDir, 'logs')
  if (!fs.existsSync(logs)) return ''
  return fs.readdirSync(logs)
    .filter((name) => name.endsWith('.log'))
    .map((name) => fs.readFileSync(path.join(logs, name), 'utf8'))
    .join('\n')
}

const projectRoot = findProjectRoot()
const receiptPath = path.join(projectRoot, '.nomi', 'project-agent-proposal-receipt.json')
fs.mkdirSync(path.dirname(receiptPath), { recursive: true })
fs.writeFileSync(receiptPath, '{"schemaVersion":2,"lifecycle":"preparing"', 'utf8')

let app
let win
const evidence = { projectId, projectRoot, receiptPath }
try {
  ({ app, win } = await launchNomiApp({
    name: 'upgrade-0225-to-0230-open',
    userDataDir,
    settingsDir,
    projectsDir,
    capabilityDir,
    timeout: 60_000,
    settleMs: 700,
  }))
  await dismissSplashIfPresent(win)
  const card = win.locator(`[data-project-card="true"][data-project-id="${projectId}"]`)
  await card.waitFor({ state: 'visible', timeout: stationTimeout() }).catch(() => { throw new Error(`Project card ${projectId} is not rendered`) })
  await card.dispatchEvent('click')
  // 两个具体信号赛跑：路由进了 studio，或失败横幅那一行出现（定位到那段文字本身，不扫整页文本）。
  evidence.outcome = await Promise.any([
    win.waitForURL((url) => url.hash.includes('/studio'), { timeout: stationTimeout() }).then(() => 'studio'),
    win.getByText(/发送失败|项目恢复失败|project restore/i).first().waitFor({ state: 'visible', timeout: stationTimeout() }).then(() => 'failure-visible'),
  ])
  evidence.url = win.url()
  evidence.bodyTail = (await win.locator('body').innerText()).slice(-2_000)
} finally {
  await closeNomiApp(app)
}

const allLogs = rendererLogText()
const currentSessionLogs = allLogs.slice(allLogs.lastIndexOf('session-start'))
evidence.logTail = currentSessionLogs.slice(-8_000)
const visibleFailure = evidence.outcome === 'failure-visible' || /发送失败|项目恢复失败|project restore/i.test(evidence.bodyTail || '')
const rawFailure = /project-restore-failed/.test(currentSessionLogs)
const quarantined = fs.readdirSync(path.dirname(receiptPath))
  .some((name) => name.startsWith('project-agent-proposal-receipt.json.quarantined-'))
if (visibleFailure || rawFailure || !quarantined || fs.existsSync(receiptPath)) {
  throw new Error(`Expected receipt quarantine and successful open: ${JSON.stringify({ ...evidence, quarantined })}`)
}
console.log(JSON.stringify(evidence, null, 2))
