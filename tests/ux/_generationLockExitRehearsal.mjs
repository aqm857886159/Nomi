import { execFileSync } from 'node:child_process'
import { stationTimeout } from './_station-budget.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { registerTestTemp } from '../../scripts/_test-temp.mjs'
import { launchNomiApp, closeNomiApp } from './_launchApp.mjs'
import { newProjectEntry } from './_shell.mjs'
import { createAgentRuntimeFixture, FIXTURE_APIMART_API_KEY, FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR } from './agent-runtime-fixture.mjs'
import { createLockExitJourneyProxy } from './_generationLockExitProxy.mjs'
import { generationLockExitJourney, lockExitFixtureInput } from './_generationLockExitSteps.mjs'

export async function runLockExitRehearsal(locale = 'zh-CN', journey = generationLockExitJourney) {
  const root = process.cwd()
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (journey === generationLockExitJourney) execFileSync('git', ['diff', '--quiet', commit, '--', 'src', 'electron'])
  const storage = fs.statfsSync(root)
  if (storage.bavail * storage.bsize < 10 * 1024 ** 3) throw new Error('Less than 10 GiB available; stop generation lock exit validation')
  const out = path.resolve(process.env.NOMI_LOCK_EXIT_OUT || '.tmp/generation-lock-exit')
  fs.mkdirSync(out, { recursive: true })
  const tempRoot = registerTestTemp(fs.mkdtempSync(path.join(out, 'isolated-')))
  const settingsDir = path.join(tempRoot, 'settings')
  const userDataDir = path.join(tempRoot, 'user-data')
  const projectsDir = path.join(tempRoot, 'projects')
  const fixture = await createAgentRuntimeFixture({ rootDir: root, settingsDir, userDataDir, appName: 'nomi', generationProvider: 'apimart' })
  const proxy = await createLockExitJourneyProxy({ target: fixture.baseURL, imageModel: FIXTURE_APIMART_MODEL })
  let app, page, project
  const launch = async () => {
    const started = await launchNomiApp({ name: 'generation-lock-exit', tempRoot, settingsDir, userDataDir, projectsDir, settleMs: 0, viewportSize: { width: 1280, height: 860 },
      mainRequire: [path.join(root, 'scripts/walkthrough-network-guard.cjs'), path.join(root, 'tests/ux/_quietWalk.cjs')],
      env: { NOMI_TEST_NETWORK_GUARD: '1', NOMI_E2E_PRODUCTION_FIXTURE: '1', NOMI_E2E_FIXTURE_BASE_URL: proxy.origin,
        NOMI_E2E_FIXTURE_API_KEY: FIXTURE_APIMART_API_KEY, NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: [fixture.baseURL, proxy.origin].join(','),
        NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: proxy.origin }, { from: fixture.baseURL, to: proxy.origin }]) },
      initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' }, args: ['--no-proxy-server'] })
    app = started.app; page = started.win
    page.setDefaultTimeout(stationTimeout({ operations: 3 }))
    return page
  }
  let failure, report
  try {
    await launch()
    await newProjectEntry(page).click()
    await expect(page.locator('.tiptap[contenteditable="true"]').first()).toBeVisible()
    const projectId = await page.evaluate(() => new URL(location.href).searchParams.get('projectId') ?? new URLSearchParams(location.hash.split('?')[1] ?? '').get('projectId'))
    project = (await page.evaluate(() => window.nomiDesktop.projects.listAsync())).find(value => value.id === projectId)
    report = await journey({ page, ...lockExitFixtureInput({ projectId }, fixture), proxy, model: { vendorKey: FIXTURE_APIMART_VENDOR, modelKey: FIXTURE_APIMART_MODEL }, locale,
      screenshotDir: process.env.NOMI_LOCK_EXIT_SHOTS || path.join(root, 'tests/ux/shots/generation-lock-exit'),
      restart: async () => { await closeNomiApp(app); app = null; await launch(); await page.locator('[data-project-card]', { hasText: project.name }).first().click(); return page } })
    if (journey === generationLockExitJourney) execFileSync('git', ['diff', '--quiet', commit, '--', 'src', 'electron'])
  } catch (error) { report = error.report; failure = error; process.exitCode = 1; console.error(error) }
  finally {
    if (page && failure) await page.screenshot({ path: path.join(out, `${locale}-FAIL.png`) }).catch(() => {})
    if (app) await closeNomiApp(app).catch(() => {})
    await proxy.close(); await fixture.close()
    if (!failure && journey === generationLockExitJourney) {
      report.openRunStages = []
      const cases = [
        ['window-close', 'generation-lock-exit-interrupted.walk.mjs', ['window-close'], 'i6-window-close'],
        ['sigkill', 'generation-lock-exit-interrupted.walk.mjs', ['sigkill'], 'i6-sigkill'],
        ['reload', 'generation-lock-exit-interrupted.walk.mjs', ['reload'], 'i6-reload'],
        ['retrieve', 'generation-lock-exit-late-result.walk.mjs', [], 'i5LateResult'],
        ['resend', 'generation-lock-exit-late-resend.walk.mjs', [], 'i5bResend'],
      ]
      try {
        for (const [name, file, args, receiptName] of cases) {
          const childOut = path.join(out, name)
          fs.mkdirSync(childOut, { recursive: true })
          let exit = 0
          try { execFileSync(process.execPath, [path.join(root, 'tests/ux', file), ...args], { stdio: 'inherit', env: { ...process.env, NOMI_LOCK_EXIT_LOCALE: locale, NOMI_LOCK_EXIT_OUT: childOut } }) }
          catch (error) { exit = error.status ?? 1 }
          const receipt = path.join(childOut, `${locale}-${receiptName}.json`)
          const result = JSON.parse(fs.readFileSync(receipt, 'utf8'))
          if (result.status !== 'passed') { failure = new Error(`${name}: ${result.error ?? 'free scenario failed'}`); process.exitCode = 1; break }
          report.openRunStages.push({ name, status: result.status, commit: result.commit, receipt, exit })
        }
        execFileSync('git', ['diff', '--quiet', commit, '--', 'src', 'electron'])
      } catch (error) { failure = error; process.exitCode = 1; console.error(error) }
    }
    fs.writeFileSync(path.join(out, journey === generationLockExitJourney ? `${locale}-rehearsal.json` : `${locale}-${journey.name}.json`), JSON.stringify({ commit, status: failure ? 'failed' : report?.blocked?.length ? 'partial' : 'passed', error: failure?.message, report, requests: proxy.records }, null, 2))
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
  if (report?.blocked?.length) process.exitCode = 1
  if (failure) throw failure
  return report
}
