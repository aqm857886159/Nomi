#!/usr/bin/env node
// 本地 gates 的「新鲜基线」闸（2026-09-02）。治的是一类**本地全绿、CI 卫生红**：
//
// CI 的 Contracts job 跑的就是 `pnpm run gates:contracts`（quality-gate.yml → test:system:contracts
// → tests/system/profiles.mjs 的 contracts stage）——脚本集合与本地一字不差。但它验的**树**不同：
// pull_request / merge_group 验的是「分支 ∪ 最新 main 的合并树」，本地 gates 验的是「分支树」。
// 棘轮基线、门岗定义、validator 全都住在树里——main 一收紧，分支树照旧绿、合并树当场红：
//   · PR #337 run 33584973338：check:docs-index 红（合并树 323 篇未收录 > main 收紧后的基线 322）
//   · PR #337 run 33592817875：check:root-cause-contracts 红（main 当天扩了 HIGH_RISK 清单，
//     分支树上的旧 validator 根本不知道这些文件算高风险）
//   · PR #344：merge queue 上线，speculative merge 树再次红在根因契约
// 所以「本地 gates 绿 ⟹ CI 静态面绿」要成立，前提是本地树 ⊇ origin/main——这正是
// CLAUDE.md 并行纪律③「push 前 fetch 最新 origin/main 并在任务分支上整合」的机器化。
//
// 附带收敛的第二个缺口：CI 给 check:root-cause-contracts / check:vocabularies 钉了
// ROOT_CAUSE_BASE_REF / VOCAB_BASE_REF = PR base sha，本地 fallback 是 merge-base HEAD origin/main。
// 一旦 origin/main 是 HEAD 的祖先，merge-base 就等于 origin/main tip，两边基线语义收敛。
//
// 为什么 CI 里跳过：GitHub runner（CI=true）checkout 的树**就是**要验的树——
// pull_request 是合并结果、desktop-rc 是指定的发布 ref，拿 origin/main 祖先关系去拦它们
// 全是误伤（发布 ref 落后 main tip 是常态）。这一闸只管本地盖五门戳前的那棵树。
import { execFileSync } from 'node:child_process'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

if (process.env.CI === 'true') {
  console.log('✅ 新鲜基线闸：CI 环境跳过（CI 验的就是目标树本身）')
  process.exit(0)
}

let mainSha
try {
  mainSha = git(['rev-parse', '--verify', 'origin/main^{commit}'])
} catch {
  console.error('❌ 新鲜基线闸：本地没有 origin/main——先 `git fetch origin` 再跑 gates。')
  process.exit(1)
}

try {
  execFileSync('git', ['merge-base', '--is-ancestor', mainSha, 'HEAD'], { stdio: 'ignore' })
} catch {
  console.error(`❌ 新鲜基线闸：origin/main（${mainSha.slice(0, 12)}）不是 HEAD 的祖先——分支还没整合最新 main。`)
  console.error('')
  console.error('   CI 验的是「你的分支 + 最新 main」的合并树；棘轮基线和门岗定义都住在树里，')
  console.error('   main 收紧过的门岗在你这棵旧树上根本不跑/不严——本地全绿证不了 CI 绿')
  console.error('   （实证：#337 红在 docs-index 与根因契约、#344 红在 merge queue 的合并树）。')
  console.error('')
  console.error('   → git fetch origin && git merge origin/main，解完冲突重跑 pnpm run gates')
  process.exit(1)
}

const ageHours = (Date.now() / 1000 - Number(git(['log', '-1', '--format=%ct', mainSha]))) / 3600
console.log(`✅ 新鲜基线闸：origin/main（${mainSha.slice(0, 12)}）已整合进 HEAD`)
if (ageHours > 24) {
  console.log(`   ⚠ 本地 origin/main 的 tip 已是 ${Math.round(ageHours)} 小时前的提交——若很久没 fetch，先 git fetch origin 再信这枚绿。`)
}
