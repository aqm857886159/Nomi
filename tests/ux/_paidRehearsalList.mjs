// 批量演练的纯判据（2026-11-15）：挑哪些脚本、日志 → 一句原因。单独成文件：批量命令要遍历 tests/ux、跑 git，
// 单测只测这里的纯函数，不 import 那份会遍历目录的命令行（扫描型守卫识别器按 import 闭包判）。
import path from 'node:path'

import { PAID_WALKS_WITHOUT_OPEN_PAID_WALK } from './_paidRun.mjs'

/** 要演练的脚本：tests/ux 下所有 *.paid.mjs，去掉不走 openPaidWalk 的例外表（它们没有演练开关）。 */
export function rehearsalTargets(files, exceptions = PAID_WALKS_WITHOUT_OPEN_PAID_WALK) {
  const excluded = new Set(exceptions.map((entry) => path.basename(entry.file)))
  return files.filter((file) => file.endsWith('.paid.mjs') && !excluded.has(file)).sort()
}

/** 日志 → 一句原因：最后一句 [rehearsal]，没有就最后一句像错误的行。 */
export function reasonFromLog(text) {
  const lines = String(text).split('\n').map((line) => line.trim()).filter(Boolean)
  const tagged = lines.filter((line) => line.startsWith('[rehearsal]')).at(-1)
  if (tagged) return tagged.replace(/^\[rehearsal\]\s*/, '')
  const error = lines.filter((line) => /Error|拒跑|失败|不过|throw/i.test(line) && !line.startsWith('at ')).at(-1)
  return (error ?? lines.at(-1) ?? '没有输出').slice(0, 300)
}

/**
 * 演练前就知道跑不了的（缺参数 / 缺环境 / 要真资料那一档）：批量和夜间都记「跳过：要什么」，不进红名单。
 * `env`：缺这些环境变量才跳过（给了就照跑）；`always`：批量从不给的（命令行参数、只在本机真资料里才有的东西），一律跳过。
 * 只写「要什么」，不写为什么坏——坏了的进下面的红名单。
 */
export const REHEARSAL_SKIPS = Object.freeze({
  'agent-default-model-real.paid.mjs': { always: true, needs: '点名了 agnes 的模型：要 NOMI_PAID_REHEARSAL=real-key 档（拷本机真资料），夜间不跑' },
  'agent-image-input-real.paid.mjs': { env: ['NOMI_REAL_MEDIA_DIR'], needs: 'NOMI_REAL_MEDIA_DIR（本机真实素材目录）' },
  'apimart-text-brains-real.paid.mjs': { always: true, needs: '读图候选只在本机真资料的目录里：要 real-key 档（拷本机真资料），夜间不跑' },
  'browser-extract-real.paid.mjs': { env: ['NOMI_REAL_MEDIA_DIR'], needs: 'NOMI_REAL_MEDIA_DIR（本机真实素材目录）' },
  'catalog-media-rest-real.paid.mjs': { env: ['NOMI_MEDIA_REST_PAID_PLAN'], needs: 'NOMI_MEDIA_REST_PAID_PLAN（这一发的计划文件）' },
  'relay-video-onboarding-real.paid.mjs': { env: ['NOMI_RELAY_PAID_PLAN'], needs: 'NOMI_RELAY_PAID_PLAN（这一发的计划文件）' },
  'release-core-compare.paid.mjs': { always: true, needs: '--target-root <要比的安装包目录>（命令行参数）' },
  'shot-table-vision-leg.paid.mjs': { always: true, needs: '--vision-model <模型 id>（命令行参数）' },
})

/** 这一份这一场要不要跳过：返回「要什么」，不跳过返回 null。 */
export function rehearsalSkipOf(file, env = process.env, table = REHEARSAL_SKIPS) {
  const row = table[file]
  if (!row) return null
  if (row.always) return row.needs
  return (row.env ?? []).some((name) => !String(env[name] ?? '').trim()) ? row.needs : null
}

/**
 * 「今天不过」红名单（2026-11-15 定，只减不增；守它的测试在 _paidRehearsalList.test.mjs）：真坏了的付费脚本，每条一句原因。
 * 夜间：名单外的不过 → 红；名单里的今天过了 → 也红（提醒把它删掉）；名单里写了已经不存在的脚本 → 红。只修了才删，不许往里加。
 */
export const KNOWN_RED = Object.freeze({
  'canvas-spend-policy.paid.mjs': '花钱前核对没过：新节点的模型不是被授权的 z-image-turbo（脚本在点生成前自己停下）',
  'storyboard-agent-bulk-real.paid.mjs': '发第一条请求之前脚本自己报错：对 undefined 调 replace',
})

/** 夜间这一步的结论：返回要报红的问题（空 = 绿）。rows = 批量的结果行（{ file, status: 'passed' | 'failed' | 'skipped', reason }）。 */
export function nightlyProblems(rows, knownRed = KNOWN_RED) {
  const problems = []
  const seen = new Set(rows.map((row) => row.file))
  for (const row of rows) {
    const listed = Object.hasOwn(knownRed, row.file)
    if (row.status === 'failed' && !listed) problems.push(`${row.file} 演练不过，不在「今天不过」名单里：${row.reason}`)
    if (row.status === 'passed' && listed) problems.push(`${row.file} 在「今天不过」名单里，但今天过了——把它从名单里删掉`)
  }
  for (const file of Object.keys(knownRed)) if (!seen.has(file)) problems.push(`「今天不过」名单里的 ${file} 这一场没跑到（脚本删了、改名了或被跳过）——把它从名单里删掉`)
  return problems
}
