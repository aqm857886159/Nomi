// 「PR Body」检查（.github/workflows/pr-body.yml）的名字与结论读法——工作流测试和合并前扫描都从这里取，名字只此一份。
//
// 为什么正文合并档单独成一个检查（2026-11-07，10-24 → 11-07 PR 拦截审计）：94 次 PR 红里 63 次带着「按流程注定先红」的
// 合并档正文项（四类 PR 先开 PR 再派验收；账本 fixed 要 PR 号），46 次除此之外什么毛病都没有；为重判一个几秒的正文检查，
// 要重跑 22 分钟的 Contracts（窗口内 22 次）。现在 Contracts 只判推送档，这个检查判合并档、正文一改（edited）就自动重判。
//
// 合并前扫描要求它在 PR 当前 head 上是绿的。读法（gh pr view --json statusCheckRollup）：
//   · 同一个 head 上它可能跑过好几次（opened → edited → edited，旧的被并发组取消）：只要有一次还没跑完 = 在跑（新的那次多半还在排队，
//     排队的 startedAt 不可靠，不能按时间挑出旧的绿灯放行）；全跑完了按完成时间取最新一次；
//   · 绿 = 放行；红 / 取消 / 超时 = 拒；一次都没有 = 拒（本 PR 开得比这条检查早，或工作流没触发），写清怎么触发。

export const PR_BODY_WORKFLOW_FILE = '.github/workflows/pr-body.yml'
export const PR_BODY_WORKFLOW_NAME = 'PR Body'
export const PR_BODY_CHECK_NAME = 'PR Body'

const time = (value) => {
  const ms = Date.parse(value ?? '')
  return Number.isFinite(ms) ? ms : 0
}

/**
 * @param {unknown[]} rollup `gh pr view --json statusCheckRollup` 的 statusCheckRollup（PR 当前 head 上的全部检查）
 * @returns {{ ok: boolean, state: 'success' | 'pending' | 'failure' | 'missing', line: string }}
 */
export function prBodyCheckVerdict(rollup) {
  const runs = (Array.isArray(rollup) ? rollup : []).filter((entry) => entry
    && entry.__typename !== 'StatusContext'
    && entry.name === PR_BODY_CHECK_NAME
    && (entry.workflowName ?? PR_BODY_WORKFLOW_NAME) === PR_BODY_WORKFLOW_NAME)
  if (runs.length === 0) {
    return {
      ok: false,
      state: 'missing',
      line: `✖ PR 当前 head 上没有「${PR_BODY_CHECK_NAME}」检查（本 PR 开得比这条检查早，或工作流没触发）：在 GitHub 上改一下正文（gh pr edit）或推一次，它就会跑，约 1 分钟`,
    }
  }
  if (runs.some((run) => String(run.status ?? '').toUpperCase() !== 'COMPLETED')) {
    return { ok: false, state: 'pending', line: `✖ 「${PR_BODY_CHECK_NAME}」检查还在跑（正文刚改过？）：约 1 分钟后重跑合并前扫描` }
  }
  const latest = runs.reduce((a, b) => ((time(b.completedAt) || time(b.startedAt)) >= (time(a.completedAt) || time(a.startedAt)) ? b : a))
  const conclusion = String(latest.conclusion ?? '').toUpperCase()
  if (conclusion === 'SUCCESS') return { ok: true, state: 'success', line: `✅ 「${PR_BODY_CHECK_NAME}」检查在 PR 当前 head 上是绿的（GitHub 上的合并档正文判据）` }
  return {
    ok: false,
    state: 'failure',
    line: `✖ 「${PR_BODY_CHECK_NAME}」检查最新一次是 ${conclusion || '未知结论'}${latest.detailsUrl ? `（${latest.detailsUrl}）` : ''}：照那一页写的缺项改正文，改完它自动重判，不必重推`,
  }
}
