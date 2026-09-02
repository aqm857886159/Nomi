#!/usr/bin/env node
// 「五门刚过」的戳 —— push 闸（R11）唯一的放行凭据。
//
// 为什么不是「一个固定路径下的空文件 + mtime 新鲜」（这是 2026-09-02 之前的实现）：
// 那种戳只有两维身份——路径固定、时间新鲜——**既不认树、也不认提交**。这台机器常年 20+ 棵
// 并行 worktree，于是当天真的出事了：主仓 `.claude/.gates-ok` 里一枚别处盖的旧戳，把一棵
// sibling worktree 里 gates 实际 exit=1 的分支放上了远端（幸好 PR 未开、CI 兜住）。
// 同一枚戳还会往反方向错：B 树明明 gates 全绿，却被 A 树的过期戳拦下。
//
// 现在戳带三维身份，push 闸三项全对才放行：
//   ① 写进**本 worktree 自己的 git dir**（`git rev-parse --absolute-git-dir`）——
//      git worktree 的 gitdir 天然一树一份（主仓 `.git/`，worktree 是 `.git/worktrees/<name>/`），
//      物理上就不可能互相顶用；且在 `.git` 内，不受 `.claude/` 被 gitignore 的影响。
//   ② 记下盖戳时的 worktree 绝对路径——戳被拷来拷去也认得出娘家。
//   ③ 记下盖戳时的 HEAD sha——盖完戳再提交代码，那份新代码没过门，戳就该失效。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const gitDir = git('rev-parse', '--absolute-git-dir')
const worktree = git('rev-parse', '--show-toplevel')
const sha = git('rev-parse', 'HEAD')
const marker = path.join(gitDir, 'nomi-gates-ok')

// 格式是 `key=value` 逐行——push 闸是 bash，得能用 sed 一行取出来，别逼它解析 JSON。
fs.writeFileSync(marker, `sha=${sha}\nworktree=${worktree}\nat=${new Date().toISOString()}\n`)

console.log(`✅ 全门通过，已盖 ${marker}`)
console.log(`   worktree=${worktree} · HEAD=${sha.slice(0, 12)} · 30 分钟内有效（HEAD 一变即失效）`)
