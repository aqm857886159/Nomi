#!/usr/bin/env node
// Git 钩子的唯一分发入口（2026-10-09）。.git 里生成的钩子文件只写「exec node scripts/git-hook.mjs <钩子名> "$@"」，
// 不再写任何脚本名：具体跑哪些脚本由本文件按**当前工作树**查 scripts/git-hooks.json 决定。
//
// 为什么（10-09 实据）：钩子文件住在 .git 里，只在 pnpm install 时生成一次、之后不会更新。旧钩子写死了 check-pr-body-gates.mjs，
// #1134 删掉这个脚本后，旧钩子的 `[ -f ... ] || exit 0` 把一次推送静默放行，一道门岗都没跑。
// 以后改名 / 删脚本只改 git-hooks.json（一份，随分支走），钩子文件永远不需要重装。
//
// 分发表格式：{ "<钩子名>": [ [候选脚本, 候选脚本…], … ] }——外层是按顺序跑的步骤，内层是同一步的候选
// （第一个存在的跑；新入口不在时退回旧入口就是把旧入口排在后面）。任何一步红就停，退出码原样返回。
// 铁律：任何「跳过」都必须在 stderr 说原因，不许静默；分发器在场时一律 fail-closed（只有「分支里没有分发器」由钩子壳打印原因后放行）。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')

export function runHook(hookName, args, { root = repoRoot, table = path.join(scriptDir, 'git-hooks.json') } = {}) {
  // fail-closed：分发器既然在，就必须有可跑的东西——表读不到 / 坏了 / 没这个钩子 / 某一步的候选全不在，都是非零 + 原因。
  // 唯一允许「打印原因后放行」的情形是「分支里根本没有分发器」，那由生成的钩子壳判断（见 install-git-hooks.cjs），不在这里。
  const fail = (text) => { console.error(`[${hookName}] BLOCKED：${text}`); return 1 }
  let steps
  try { steps = JSON.parse(fs.readFileSync(table, 'utf8'))[hookName] } catch (error) {
    return fail(`读不了或解析不了分发表 scripts/git-hooks.json（${String(error.message).slice(0, 160)}）——修好这张表再继续`)
  }
  if (!Array.isArray(steps) || steps.length === 0 || steps.some((candidates) => !Array.isArray(candidates) || candidates.length === 0)) {
    return fail(`分发表里没有 ${hookName}，或它的步骤是空的——在 scripts/git-hooks.json 里补上`)
  }
  for (const candidates of steps) {
    const found = candidates.find((rel) => fs.existsSync(path.join(root, rel)))
    if (!found) return fail(`${candidates.join(' / ')} 都不在本分支；脚本改名或删除后请同步改 scripts/git-hooks.json`)
    // 内部标记：脚本只有同时见到它和 git 传入的参数，才把自己当作被钩子调用（读 stdin 的 ref 行）
    const result = spawnSync(process.execPath, [path.join(root, found), ...args], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, NOMI_GIT_HOOK_DISPATCH: hookName } })
    if (result.error) return fail(`${found} 没能启动：${result.error.message}`)
    if (result.status !== 0) return result.status ?? 1
  }
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [hookName, ...args] = process.argv.slice(2)
  if (!hookName) { console.error('[git-hook] 用法：node scripts/git-hook.mjs <钩子名> [git 传入的参数…]'); process.exitCode = 2 }
  else process.exitCode = runHook(hookName, args)
}
