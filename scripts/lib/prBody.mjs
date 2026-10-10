// PR 正文的**唯一取法**（2026-09-18）。此前 check:prior-art 与（已于 2026-10-01 删除的）check:door-map 各自读一个
// 工作流注入的 env（`PRIOR_ART_PR_BODY` / `DOOR_MAP_PR_BODY` = `github.event.pull_request.body`），
// 也就是**事件负载里的那份正文**。
//
// 为什么那是一个结构性的坑：事件负载是 push 那一刻的快照。你推完代码、再去把方案链接补进正文——
// 正在跑的那轮 CI 看到的仍然是旧正文，于是门岗报「PR 正文没有引用这份根因合同」，
// 而你屏幕上的正文明明就引用了。修法只剩「再 push 一次空提交把事件刷新」，一轮 40 分钟。
// 2026-09-17 PR #804 就是这么白烧了一轮（正文比 push 晚 19 秒）。最近 40 次 quality-gate 里
// Contracts 红了 7 次，door-map 4 次、prior-art 2 次，绝大部分是这一类。
//
// 改法两半，本文件是第一半：**正文一律现取**（`gh pr view --json body`），不再读事件负载。
// 现取的正文和作者屏幕上看到的是同一份，所以「改完正文重跑这个 job」就能变绿，不必重推。
// 第二半在 scripts/pre-push-contracts.mjs（pre-push 钩子的入口）：push 前在本地先跑一遍同样的判据，
// 让「正文没写全」在推之前就被发现，而不是四十分钟以后。
//
// fail-closed 的边界写死在这里，别靠猜：
//   · `pull_request` 事件里**必查**，而且**取不到正文 = 红**（旧写法把空正文当「查过了」，
//     一个拿不到证据的门岗只能报它真拿到的那个结论 —— 拿不到就说拿不到，别假装通过）。
//   · 本地默认跳过（本地没有 PR 这个东西）；显式 `--pr` 时用 gh 取当前分支的 PR 正文，
//     取不到就明说「今天没查成」并跳过 —— 本地不是最后一道闸，CI 侧仍然 fail-closed。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** 还没有 PR 时，实现线按约定把 PR 正文草稿写在仓库根的这个文件（已 gitignore）；推送前就用它按合并前的标准判。 */
export const LOCAL_PR_BODY_DRAFT = '.tmp-pr-body.md'

function readLocalDraft(cwd) {
  try { return fs.readFileSync(path.join(cwd, LOCAL_PR_BODY_DRAFT), 'utf8') } catch { return null }
}

/** gh 对「这个分支没有 PR」的固定说法；只有它才允许走草稿 / 跳过。 */
const NO_PR_FOR_BRANCH = /no pull requests found/i

/** gh 最多等多久。手动跑挂 600–1700 秒的事故（2026-10-09）里 gh 没有超时是原因之一：超时 = 明确报错，不是继续等。 */
export const GH_TIMEOUT_MS = 20_000

/** `gh pr view` 的默认实现；测试里换成假的（opts.bin / opts.args 让测试用真子进程模拟「一直不返回」）。 */
export function ghPullRequestBody(args, cwd, opts = {}) {
  return execFileSync(opts.bin ?? 'gh', opts.args ?? args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: opts.timeoutMs ?? GH_TIMEOUT_MS, killSignal: 'SIGKILL' })
}

/**
 * @returns {{available: true, body: string, source: string}
 *   | {available: false, required: boolean, reason: string}}
 * `required: true` 的不可用一律是红（调用方不许当跳过）。
 */
export function resolvePullRequestBody({
  env = process.env,
  argv = process.argv,
  cwd = process.cwd(),
  fetchBody = ghPullRequestBody,
  readDraft = readLocalDraft,
  readFile = (file) => fs.readFileSync(file, 'utf8'),
} = {}) {
  // 显式喂正文（测试与 --body-file 之类的本地用法）。空字符串是合法输入：
  // 「正文是空的」本身就是一个应该报红的事实，不是「没拿到」。
  const injected = env.NOMI_PR_BODY
  if (typeof injected === 'string') return { available: true, body: injected, source: 'NOMI_PR_BODY' }

  // 手动跑也可以把正文放文件里（NOMI_PR_BODY_FILE）。指了文件却读不了 = 明确的红，不回落到 gh / 草稿（指错了文件不能当没指）。
  const bodyFile = env.NOMI_PR_BODY_FILE
  if (typeof bodyFile === 'string' && bodyFile !== '') {
    try { return { available: true, body: readFile(bodyFile), source: 'NOMI_PR_BODY_FILE' } } catch (error) {
      return { available: false, required: true, reason: `NOMI_PR_BODY_FILE 指向的文件读不了：${String(error instanceof Error ? error.message : error).split('\n')[0]}` }
    }
  }

  const inPullRequest = env.GITHUB_EVENT_NAME === 'pull_request'
  const asked = argv.includes('--pr')
  if (!inPullRequest && !asked) {
    return { available: false, required: false, reason: '不在 pull_request 事件里，且未加 --pr' }
  }

  // CI 的 checkout 是游离 HEAD，`gh pr view` 认不出分支，所以 PR 号由工作流显式传进来。
  const number = String(env.NOMI_PR_NUMBER ?? '').trim()
  const args = ['pr', 'view']
  if (number) args.push(number)
  args.push('--json', 'body', '--jq', '.body')
  try {
    return { available: true, body: fetchBody(args, cwd), source: number ? `gh pr view ${number}` : 'gh pr view' }
  } catch (error) {
    // 只有能识别出的「这个分支没有 PR」才允许走草稿 / 跳过；其余（超时、没装 gh、没登录、没权限、网络错）一律是明确的红，写清下一步
    const stderrText = `${error && error.stderr ? error.stderr : ''}${'\n'}${error instanceof Error ? error.message : String(error)}`
    const nextStep = '改用 NOMI_PR_BODY / NOMI_PR_BODY_FILE 直接给正文，或先修好 gh（gh auth status）'
    if (error && error.code === 'ETIMEDOUT') {
      return { available: false, required: true, reason: `gh pr view 超时（${GH_TIMEOUT_MS / 1000} 秒没有返回）；${nextStep}` }
    }
    if (error && error.code === 'ENOENT') {
      return { available: false, required: true, reason: `找不到 gh 命令；安装 GitHub CLI 并 gh auth login，或${nextStep}` }
    }
    if (!NO_PR_FOR_BRANCH.test(stderrText)) {
      const first = stderrText.trim().slice(0, 200)
      return { available: false, required: true, reason: `gh pr view 失败（${first}）；${nextStep}` }
    }
    // 本地、这条分支还没有 PR：有草稿就用草稿（CI 里没有这个文件，也永远不走这条）
    const draft = inPullRequest ? null : readDraft(cwd)
    if (draft !== null) return { available: true, body: draft, source: LOCAL_PR_BODY_DRAFT }
    return { available: false, required: inPullRequest, reason: '这条分支还没有 PR（gh：no pull requests found），也没有 .tmp-pr-body.md 草稿' }
  }
}
