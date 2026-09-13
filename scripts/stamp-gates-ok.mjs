#!/usr/bin/env node
// 五门通过戳的**唯一书写者**（2026-09-02）。
//
// 起因：这枚戳的「格式」以前没有主人，它被三处各自独立地写死过一遍——
//   ① `package.json` 的 `gates` 里一段内联 node（写 `.claude/.gates-ok`，只有一个时间戳）；
//   ② `scripts/claude-hooks/pre-push-check.sh`（读戳的那一方）；
//   ③ 读戳方拦人时让你手动补盖的那行提示（`node ./scripts/stamp-gates-ok.mjs`）。
// 没有任何机制强迫这三处一致。2026-09-02 读戳方升级成「认树 + 认提交」的三维戳之后，
// 写戳方原地不动、③ 指的文件压根不存在 —— 于是 `pnpm run gates` 全过也照样被拦，
// 每棵 worktree 都得手写一次戳才能推。20+ 棵并行的机器上这是天天复发的摩擦。
//
// 形状：戳的路径与字段名只在这里定义一次，写戳方（gates）以它为准；读戳方是 shell、
// import 不了它，所以由 `scripts/check-hook-behavior.mjs` **实际运行读戳方**来证明两边仍然一致。
//
// 为什么戳落在 `git rev-parse --absolute-git-dir` 而不是工作区里的固定路径：
// git worktree 的 gitdir 一树一份（主仓 `.git/`，worktree 是 `.git/worktrees/<name>/`），
// 物理上不可能互相顶用——这正是读戳方要的「一棵树一枚戳」。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readTierRecord } from './run-gates-tests.mjs'

/** 戳的文件名。改这里 = 改契约，`check:hook-behavior` 会实际跑读戳方来验它跟得上。 */
export const MARKER_BASENAME = 'nomi-gates-ok'

/**
 * 戳的**身份字段**：读戳方必须逐个校验它们，否则闸门就少一维。
 *
 * 这份清单是真正的书写清单——`collectStampFields()` 按它逐项取值、`writeStamp()` 按它逐行写，
 * 谁都不许另起一份字面量（此前 writeStamp 用的是硬编码模板，等于在同一个文件里
 * 又开了第二个真相源；那正是本文件要消灭的那类漂移，只是缩到了 17 行之内）。
 *
 * 往这里加字段，`check:hook-behavior` 会要求你同时给出一个「篡改该字段 → 读戳方必须拦」的
 * 用例；给不出就报红。也就是说：新增的身份维度**必须被证明真的在把关**，不能只是写进文件里。
 */
export const STAMP_KEYED_FIELDS = ['sha', 'worktree']

/**
 * 只**给人看**的附加行：读戳方不校验它们，篡改它们也不该拦人。
 *
 * 它单独成一份清单，而不是在测试里写一串 `field !== 'stamped_at' && field !== 'tier'`——
 * 否则「这一行是身份还是记录」就会有两个答案（2026-09-12 加 tier 时，验戳内容的那条测试
 * 正是因为把 `stamped_at` 硬编码成唯一例外而红的）。加记录行只加这里；加**身份**行加上面那份，
 * 并按它的注释补一个「篡改 → 读戳方必须拦」的用例。
 */
export const STAMP_INFORMATIONAL_FIELDS = ['tier', 'stamped_at']

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** 每个身份字段怎么取值。键必须与 STAMP_KEYED_FIELDS 一一对应。 */
const FIELD_SOURCES = {
  sha: (cwd) => git(['rev-parse', 'HEAD'], cwd),
  worktree: (cwd) => git(['rev-parse', '--show-toplevel'], cwd),
}

/** 本棵 worktree 的戳该落在哪。 */
export function resolveMarkerPath(cwd = process.cwd()) {
  return path.join(git(['rev-parse', '--absolute-git-dir'], cwd), MARKER_BASENAME)
}

/** 按 STAMP_KEYED_FIELDS 逐项取值；缺 source 就直接炸，不许写出一个空字段。 */
export function collectStampFields(cwd = process.cwd()) {
  const values = {}
  for (const field of STAMP_KEYED_FIELDS) {
    const source = FIELD_SOURCES[field]
    if (!source) throw new Error(`STAMP_KEYED_FIELDS 里的 ${field} 没有取值来源（FIELD_SOURCES 漏了）`)
    values[field] = source(cwd)
  }
  return values
}

/** 盖戳：按字段清单逐行写入本树身份，mtime 天然就是盖戳时刻。 */
export function writeStamp(cwd = process.cwd()) {
  const marker = resolveMarkerPath(cwd)
  const values = collectStampFields(cwd)
  const body = STAMP_KEYED_FIELDS.map((field) => `${field}=${values[field]}`).join('\n')
  fs.mkdirSync(path.dirname(marker), { recursive: true })
  // tier / stamped_at 都只是**给人看的记录**，不是身份字段：读戳方（pre-push-check.sh）只校验
  // STAMP_KEYED_FIELDS。要让 push 闸开始认档位，得先给它加一个「篡改该字段 → 必须拦」的用例
  // （见 STAMP_KEYED_FIELDS 的注释），那是另一件事。这里只回答「这枚戳是哪一档跑出来的」，
  // 好让事后翻账的人不用猜（2026-09-12，R22 分档）。
  const tier = readTierRecord(cwd)?.tier ?? 'manual'
  fs.writeFileSync(marker, `${body}\ntier=${tier}\nstamped_at=${new Date().toISOString()}\n`)
  return { marker, tier, ...values }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { marker, sha, worktree, tier } = writeStamp()
    console.log(`✅ 五门戳已盖：${marker}`)
    console.log(`   sha=${sha.slice(0, 12)}  worktree=${worktree}  tier=${tier}`)
  } catch (error) {
    // 盖不上戳就得让调用者知道——静默失败会让 gates「假绿」，push 时才在闸门前发现。
    console.error(`✖ 盖戳失败（不在 git 工作区？）：${error.message}`)
    process.exit(1)
  }
}
