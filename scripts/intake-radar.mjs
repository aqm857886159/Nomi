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
//   pnpm run intake:radar -- --triaged NF-1101-0001 NF-1101-0002 --todo <待办号或说明>   这几条记进待办了，出账
//   pnpm run intake:radar -- --triaged-through 2026-10-31 --todo <待办号或说明>          这天及更早的全部出账
//   （出账只改本机的账，不联网、不要凭据。）
//
// 凭据：本机 wrangler 登录态里的 oauth_token，**只在内存里过一遍，从不打印、不落盘**
//      （见 lib/intake-radar/cloudflare.mjs）。账号 id 与 token 都不写进仓库、不进报告。
//
// 失败语义：list/get 任何一步失败 = 这一轮「今天没查成」，红着退出（1），
//          **绝不**把「拉不到」悄悄写成「没有新反馈」——那是最坏的坏法，雷达会永远看起来正常。

import { fileURLToPath } from 'node:url'
import { INTAKE_PREFIXES, resolveCredentials, listAllKeys, getObjectBuffer } from './lib/intake-radar/cloudflare.mjs'
import { resolveCacheDir, readState, writeState, rawFileExists, writeRawFile, listRawRecords, writeReport } from './lib/intake-radar/store.mjs'
import { buildFeedbackItems, buildIntakeReport } from './lib/intake-radar/aggregate.mjs'
import { readInbox, reconcileInbox, triageInbox, untriagedItems, writeInbox } from './lib/intake-radar/inbox.mjs'
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
  healthOptions = {},
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

  const feedback = listRawRecords(cacheDir, 'feedback/')
  const events = listRawRecords(cacheDir, 'events/')
  const trajectories = listRawRecords(cacheDir, 'trajectories/')

  // 先记账再写 state、再写报告：哪一步之后被杀掉，下一轮都还能从缓存把账补齐，新反馈漏不掉。
  const inbox = reconcileInbox(readInbox(cacheDir), {
    feedbackItems: buildFeedbackItems(feedback.records),
    corruptKeys: feedback.corrupt.map((file) => file.key),
    seenKeys: state.seenKeys,
    nowIso,
  })
  writeInbox(cacheDir, inbox)
  writeState(cacheDir, state)

  const report = buildIntakeReport({
    feedbackRecords: feedback.records,
    eventRecords: events.records,
    trajectoriesCount: trajectories.records.length,
    newFeedbackKeys: newKeysByPrefix['feedback/'],
    newEventKeys: newKeysByPrefix['events/'],
    corruptFiles: [...feedback.corrupt, ...events.corrupt, ...trajectories.corrupt],
    generatedAt: nowIso,
    inbox,
    healthOptions: {
      ...(env.NOMI_HEALTH_NEW_VERSION ? { newVersion: env.NOMI_HEALTH_NEW_VERSION } : {}),
      ...(env.NOMI_HEALTH_OLD_VERSION ? { oldVersion: env.NOMI_HEALTH_OLD_VERSION } : {}),
      ...healthOptions,
    },
  })

  const { mdPath, jsonPath } = writeReport(cacheDir, report.generatedAt, { markdown: renderMarkdown(report), json: report })
  log(renderTerminalSummary(report, { mdPath, jsonPath }))
  return report.versionHealth.stop ? 1 : 0
}

/** 命令行参数。pnpm 可能把 `--` 原样传下来，认不出的不猜，交给调用方报错。 */
export function parseTriageArgs(argv) {
  const args = argv.filter((arg) => arg !== '--')
  const options = { ids: [], through: null, todo: null, unknown: [] }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--triaged') {
      while (args[index + 1] && !args[index + 1].startsWith('--')) options.ids.push(args[(index += 1)])
    } else if (arg === '--triaged-through') {
      options.through = args[(index += 1)] ?? ''
    } else if (arg === '--todo') {
      options.todo = args[(index += 1)] ?? ''
    } else {
      options.unknown.push(arg)
    }
  }
  return options
}

/**
 * 出账：这几条已经记进待办了。只改本机的账，不联网、不要凭据。
 * 必须说清记到了哪个待办：出账是「有人管了」，不是「我看过了」。
 */
export function runTriage({ argv, env = process.env, now = () => new Date(), cacheDirOverride, log = console.log, errorLog = console.error }) {
  const { ids, through, todo, unknown } = parseTriageArgs(argv)
  const usage = '用法：pnpm run intake:radar -- --triaged <编号…> --todo <待办号或说明>，或 --triaged-through <YYYY-MM-DD> --todo <待办号或说明>'
  if (unknown.length) {
    errorLog(`认不出这些参数：${unknown.join(' ')}。${usage}`)
    return 1
  }
  if (!todo || !todo.trim()) {
    errorLog(`出账要写清记到了哪个待办（--todo）。${usage}`)
    return 1
  }
  if (ids.length === 0 && through === null) {
    errorLog(`没说要出账哪几条。${usage}`)
    return 1
  }
  if (through !== null && !/^\d{4}-\d{2}-\d{2}$/.test(through)) {
    errorLog(`--triaged-through 要一个 YYYY-MM-DD 的日期，收到的是：${through || '（空）'}。`)
    return 1
  }
  const cacheDir = cacheDirOverride ?? resolveCacheDir(env)
  const current = readInbox(cacheDir)
  if (!current.exists || current.rebuilt) {
    errorLog(current.rebuilt ? '待分诊账读不出来，先跑一轮 pnpm run intake:radar 把它重建。' : '还没有待分诊账，先跑一轮 pnpm run intake:radar。')
    return 1
  }
  let result
  try {
    result = triageInbox(current, { ids, through, todo: todo.trim(), nowIso: now().toISOString() })
  } catch (err) {
    errorLog(`账没动：${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
  writeInbox(cacheDir, result.inbox)
  const remaining = untriagedItems(result.inbox)
  log(`已出账 ${result.newlyTriaged.length} 条${result.newlyTriaged.length ? `：${result.newlyTriaged.join(' ')}` : ''}。还剩 ${remaining.length} 条待分诊${remaining.length ? `：${remaining.slice(0, 5).map((item) => item.id).join(' ')}${remaining.length > 5 ? ' …' : ''}` : ''}。`)
  return 0
}

async function main() {
  const argv = process.argv.slice(2)
  const code = argv.length ? runTriage({ argv }) : await run()
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
