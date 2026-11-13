#!/usr/bin/env node
// 只给协调跑的付费入口（两张图）：同一镜画布、分镜表各下一单，旧的那单晚到，两张付了钱的图都要落在这一镜上。
// 先跑免费演练（tests/ux/shot-result-ownership-real.rehearsal.walk.mjs），把它的收据交给 NOMI_OWNERSHIP_REHEARSAL_RECEIPT。
// 服务商是真的；「旧的那单晚到」靠本脚本在测试进程里压住任务查询（回「处理中」，不转发），放开后照常转发——出图本身不碰。
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { LOCK_EXIT_JOURNEY_CONDITIONS, applyLockExitJourneyConditions } from './_generationLockExitHosting.mjs'
import { openPaidWalk, DEFAULT_PAID_BRAIN } from './_paidRun.mjs'
import { ENV_KEY_VENDOR } from './_paidEnvKey.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { createGenerationLockExitProxy } from './_generationLockExitProxy.mjs'
import { lockExitFixtureInput } from './_generationLockExitSteps.mjs'
import { shotResultOwnershipJourney, SHOT_RESULT_OWNERSHIP_BUILD_MARKERS } from './_shotResultOwnershipJourney.mjs'

const receiptPath = process.env.NOMI_OWNERSHIP_REHEARSAL_RECEIPT
assert.ok(receiptPath, 'Provide the green free rehearsal receipt before running the paid entry')
const rehearsal = JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
assert.equal(rehearsal.status, 'passed', 'The free rehearsal must pass first')
assert.match(rehearsal.commit ?? '', /^[a-f0-9]{40}$/, 'The rehearsal must identify its exact commit')
assert.ok(Object.values(rehearsal.report?.checks ?? {}).length && Object.values(rehearsal.report.checks).every(Boolean), 'Every rehearsal check must pass')
execFileSync('git', ['diff', '--quiet', rehearsal.commit, 'HEAD', '--', 'src', 'electron'])
execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'src', 'electron'])

/** 测试进程里的任务查询闸：hold 时对任务查询回「处理中」不转发；其余请求原样转发。 */
async function createTaskPollHold(target) {
  let hold = false
  const held = []
  const server = http.createServer(async (req, res) => {
    const parts = []
    for await (const part of req) parts.push(part)
    const task = req.method === 'GET' ? /\/tasks\/([^/?]+)/.exec(req.url) : null
    if (hold && task) {
      held.push({ at: Date.now(), task: task[1] })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: 200, data: { id: task[1], status: 'processing' } }))
      return
    }
    const origin = new URL(target)
    const upstream = (origin.protocol === 'https:' ? https : http).request(new URL(req.url, origin), { method: req.method, headers: { ...req.headers, host: origin.host } }, (response) => {
      res.writeHead(response.statusCode, response.headers)
      response.pipe(res)
    })
    upstream.on('error', () => res.destroy())
    upstream.end(Buffer.concat(parts))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    origin: `http://127.0.0.1:${server.address().port}`, held,
    setHold(on) { hold = Boolean(on) },
    async close() { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) },
  }
}

const model = { vendorKey: ENV_KEY_VENDOR, modelKey: 'gpt-image-2' }
let launchEnv
const paid = await openPaidWalk('shot-result-ownership-real.paid.mjs', 'shot-result-ownership-real', [DEFAULT_PAID_BRAIN, model], {
  buildMarkers: SHOT_RESULT_OWNERSHIP_BUILD_MARKERS,
  hostedUploads: LOCK_EXIT_JOURNEY_CONDITIONS.hostedUploads,
  createWalk: (name, options) => { launchEnv = options.env; return createRuntimeWalk(name, { env: launchEnv }) },
})
const { walk } = paid
let pollHold, proxy, failure
try {
  const target = walk.report.networkAllowlist[0]
  if (!target || !/^https:\/\//.test(target)) throw new Error('The authorized upstream API origin is missing')
  pollHold = await createTaskPollHold(target)
  // 两单就是两张图：第三张起转发层直接拒（403），结构上多花不了。
  proxy = await createGenerationLockExitProxy({ target: pollHold.origin, imageModel: model.modelKey, maxImages: 2 })
  Object.assign(launchEnv, { NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: target, to: proxy.origin }]), NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: proxy.origin })
  const { win } = await walk.start({ first: true })
  await paid.lockToAuthorizedModels(win)
  await applyLockExitJourneyConditions(win)
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  const project = await walk.newProject()
  const report = await shotResultOwnershipJourney({ page: win, ...lockExitFixtureInput(project, walk.fixture), model, proxy, locale: 'zh-CN',
    screenshotDir: path.join(walk.outputDir, 'shots'), holdTasks: (on) => pollHold.setHold(on) })
  walk.report.shotResultOwnership = report
  walk.report.proxy = { simulated: ['task status held as processing until released'], maxImages: 2, requests: proxy.records, heldPolls: pollHold.held.length }
} catch (error) { failure = error; process.exitCode = 1 }
finally {
  if (proxy) await proxy.close()
  if (pollHold) await pollHold.close()
  await paid.finish(failure)
}
