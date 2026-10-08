// 全功能走查的**规则归类**（唯一一份）：每条监视器规则归到哪个底层设计问题、审计的哪个结构簇。
// 单独成文件、不带任何运行时依赖：监视器（记违反）、跑器（出报告）、目录自检（contracts 里查「用到的规则都登记了」）都读它。

/** 四个候选的底层设计问题（任务书给的），违反记录上标哪一个是监视器的初判，报告里人再复核。 */
export const DESIGN_ROOTS = Object.freeze({
  A: '批准与派发没有唯一主人',
  B: '界面和 Agent 的话是拼出来的，不是读出来的',
  C: '没有上限或时限',
  D: '「谁发起的」不是一等事实',
})

const rooted = (root, cluster) => Object.freeze({ root, cluster })
/**
 * 每条规则归到哪个底层设计问题（A–D）与审计的哪个结构簇（docs/audit/2026-09-26-phase-zero-cluster-index.md）——
 * 全走查**唯一一份**：违反记录、「用户报的问题」那张表、报告里的归类都从这里取，调用 violate 的地方不再各写各的。
 * 这是监视器的初判，人复核后改这里，已跑的证据用 `run.mjs --report-only` 重出报告即可（归类不是观测，重出不用重跑）。
 * 新规则不登记，violate 当场抛错。
 */
export const RULE_ROOTS = Object.freeze({
  // A 批准与派发没有唯一主人：用户批的是一样东西，派出去的由另一处决定
  'submission-without-consent': rooted('A', 'P0-1'),
  'submitted-after-user-stopped': rooted('A', 'P0-1'),
  'duplicate-submission': rooted('A', 'P0-1'),
  'exactly-one-submission': rooted('A', 'P0-1'),
  'card-scope-mismatch': rooted('A', 'P1-6'),
  'sent-references': rooted('A', 'P0-4'),
  'sent-references-on-canvas': rooted('A', 'P0-3'),
  // B 界面和 Agent 的话是拼出来的，不是读出来的：说的话不从状态的主人那里读
  'sent-prompt-unseen-addition': rooted('B', 'P0-4'),
  'card-kind-mismatch': rooted('B', 'P0-4'),
  'ui-queued-before-consent': rooted('B', 'P0-2'),
  'sent-model': rooted('B', 'P0-4'),
  'sent-aspect_ratio': rooted('B', 'P0-4'),
  'sent-resolution': rooted('B', 'P0-4'),
  'sent-duration': rooted('B', 'P0-4'),
  'receipt-claims-whole-draft-started': rooted('B', 'P1-6'),
  'receipt-maybe-submitted-but-nothing-sent': rooted('B', 'P1-6'),
  'ui-maybe-submitted-but-nothing-sent': rooted('B', 'P1-6'),
  'ui-consent-expired': rooted('B', 'P0-2'),
  'ui-stopped-after-failure': rooted('B', 'P0-2'),
  'ui-stopped-for-recovery': rooted('B', 'P0-2'),
  'ui-action-internal-error': rooted('B', 'P0-2'),
  'ui-stopped-remaining': rooted('B', 'P0-1'),
  'ui-queued': rooted('B', 'P0-2'),
  'failure-reason-misstated': rooted('B', 'P0-4'),
  'stale-failure-toast': rooted('B', 'P0-4'),
  'raw-english-in-chinese-ui': rooted('B', 'P0-4'),
  'ui-leaked-internals': rooted('B', 'P0-4'),
  'cjk-in-english-ui': rooted('B', 'P0-2'),
  'attachment-gone-after-send': rooted('B', 'P1-6'),
  'attachment-not-sent-to-model': rooted('B', 'P1-6'),
  '9a-single-version-pill': rooted('B', 'P0-2'),
  'provider-succeeded-nomi-failed': rooted('B', 'P0-4'),
  // ⑫ 点了 = 以为的：控件长得像 A、点下去做的是 B——界面的意思不是从用户心智读出来的（初判 B，人复核后改）
  'click-expectation': rooted('B', 'P0-2'),
  // C 没有上限或时限：该收场的不收场、该有边的没有边
  'spinner-without-deadline': rooted('C', 'P0-5'),
  'spinner-on-finished-node': rooted('C', 'P0-2'),
  'node-phase-deadline': rooted('C', 'P0-5'),
  'agent-turn-idle': rooted('C', 'P1-6'),
  'run-stuck-pausing': rooted('C', 'P0-1'),
  'overlay-out-of-viewport': rooted('C', 'P0-2'),
  'close-button-unreachable': rooted('C', 'P0-2'),
  'control-partly-covered': rooted('C', 'P0-2'),
  'agent-write-receipt-stuck': rooted('C', 'P1-6'),
  'input-tokens-over-budget': rooted('C', 'P1-6'),
  // D 「谁发起的」不是一等事实：分不清是用户、Agent 还是哪一次失败引起的
  'agent-ignores-declared-default': rooted('D', 'P0-2'),
  'failure-blamed-on-wrong-vendor': rooted('D', 'P0-4'),
  '9c-repeated-toast': rooted('D', 'P0-2'),
  'suggests-switching-after-local-failure': rooted('D', 'P0-4'),
  'surface-*': rooted('D', 'P0-3'),
  // 隔离漏网（不算产品违反）：夹具只把一部分出口指到本机，App 分不清「这是彩排」
  'egress-to-real-vendor': rooted('D', 'P1-7'),
})

/** 某条规则的归类；面变化那一族（surface-<面>）共用一行。没登记返回 null。 */
export function rootOfRule(rule) {
  const value = String(rule ?? '')
  return RULE_ROOTS[value] ?? (value.startsWith('surface-') ? RULE_ROOTS['surface-*'] : null)
}
