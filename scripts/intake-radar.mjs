#!/usr/bin/env node
// Intake Radar —— 用户反馈雷达（确定性抓取 + 汇总层）。
//
// 它做什么：从 Cloudflare R2（`infra/feedback-worker` 落的那个桶）增量拉反馈 / 用量事件 /
//          Agent 轨迹，写本地缓存，算出成功率、错误码排行、突增、启动与更新次数，
//          打一段终端摘要，报告写进仓库外的缓存目录。**不判断「是不是 bug」、不碰私有待办**。
// 它不做什么：分诊、归类、对私有待办去重、写用户汇报——那是
//          `agent-skills/nomi-intake-radar/SKILL.md` 里 agent 的活（读这份报告接着干）。
//          这个分工和 feedback-radar.mjs / model-radar.ts 一致：脚本管抓 + 算，skill 管判断。
//
// 用法：
//   pnpm run intake:radar            增量拉 + 算 + 写报告 + 打摘要
//   NOMI_CF_ACCOUNT_ID=... pnpm run intake:radar   跳过 `wrangler whoami` 那一步
//   NOMI_INTAKE_CACHE=<dir> pnpm run intake:radar  换缓存目录（默认见 store.mjs）
//
// 凭据：本机 wrangler 登录态里的 oauth_token，**只在内存里过一遍，从不打印、不落盘**
//      （见 lib/intake-radar/cloudflare.mjs）。账号 id 与 token 都不写进仓库、不进报告。
//
// 失败语义：list/get 任何一步失败 = 这一轮「今天没查成」，红着退出（1），
//          **绝不**把「拉不到」悄悄写成「没有新反馈」——那是最坏的坏法，雷达会永远看起来正常。

import { fileURLToPath } from 'node:url'
import { INTAKE_PREFIXES, resolveCredentials, listAllKeys, getObjectBuffer } from './lib/intake-radar/cloudflare.mjs'
import { resolveCacheDir, readState, writeState, rawFileExists, writeRawFile, listRawRecords, writeReport } from './lib/intake-radar/store.mjs'
import { buildIntakeReport } from './lib/intake-radar/aggregate.mjs'
import { renderMarkdown, renderTerminalSummary } from './lib/intake-radar/render.mjs'

/**
 * 跑一轮。整段逻辑都通过 `deps` 注入依赖（凭据解析、fetch、时钟、日志、缓存目录），
 * 单测靠这个直接跑通「增量状态」「失败退出码」两类场景，不碰真网络、不要真凭据。
 * 返回进程退出码（0 | 1），不在这里调用 `process.exit`——那是 `main()` 的事，
 * 保持这个函数本身可以被测试直接 `await` 断言返回值。
 */
export async function run({
  env = process.env,
  now = () => new Date(),
  resolveCredentialsImpl = () => resolveCredentials({ env }),
  fetchImpl,
  cacheDirOverride,
  log = console.log,
  errorLog = console.error,
} = {}) {
  const cacheDir = cacheDirOverride ?? resolveCacheDir(env)
  const state = readState(cacheDir)

  let credentials
  try {
    credentials = resolveCredentialsImpl()
  } catch (err) {
    errorLog(`今天没查成：拿不到 Cloudflare 凭据 —— ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const newKeysByPrefix = Object.fromEntries(INTAKE_PREFIXES.map((p) => [p, []]))
  try {
    for (const prefix of INTAKE_PREFIXES) {
      const keys = await listAllKeys({ accountId: credentials.accountId, token: credentials.token, prefix, fetchImpl })
      for (const key of keys) {
        if (!state.seenKeys[key]) newKeysByPrefix[prefix].push(key)
        if (!rawFileExists(cacheDir, key)) {
          const buffer = await getObjectBuffer({ accountId: credentials.accountId, token: credentials.token, key, fetchImpl })
          writeRawFile(cacheDir, key, buffer)
        }
      }
    }
  } catch (err) {
    errorLog(`今天没查成：${err instanceof Error ? err.message : String(err)}`)
    return 1
  } finally {
    credentials = null // 用完立刻放手，不让 token 继续躺在闭包里
  }

  const nowIso = now().toISOString()
  for (const prefix of INTAKE_PREFIXES) {
    for (const key of newKeysByPrefix[prefix]) state.seenKeys[key] = nowIso
  }
  state.lastRunAt = nowIso
  state.lastRunOk = true
  writeState(cacheDir, state)

  const feedback = listRawRecords(cacheDir, 'feedback/')
  const events = listRawRecords(cacheDir, 'events/')
  const trajectories = listRawRecords(cacheDir, 'trajectories/')

  const report = buildIntakeReport({
    feedbackRecords: feedback.records,
    eventRecords: events.records,
    trajectoriesCount: trajectories.records.length,
    newFeedbackKeys: newKeysByPrefix['feedback/'],
    newEventKeys: newKeysByPrefix['events/'],
    corruptFiles: [...feedback.corrupt, ...events.corrupt, ...trajectories.corrupt],
    generatedAt: nowIso,
  })

  const { mdPath, jsonPath } = writeReport(cacheDir, report.generatedAt.slice(0, 10), { markdown: renderMarkdown(report), json: report })
  log(renderTerminalSummary(report, { mdPath, jsonPath }))
  return 0
}

async function main() {
  const code = await run()
  process.exit(code)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // 任何漏网的抛错也必须红着退出并明说「今天没查成」——不能因为一个没预料到的异常
    // 就让雷达悄悄以 0 退出，被上层当成「跑完了，没问题」。
    console.error(`今天没查成：${err instanceof Error ? err.stack || err.message : String(err)}`)
    process.exit(1)
  })
}
