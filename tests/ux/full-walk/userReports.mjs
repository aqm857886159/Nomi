// 用户报的问题 → 应该由哪条剧本、哪条铁律规则抓到（跑器据此在报告里标「复现 / 没复现」）。
//
// 用途：一份活的回归表。问题修好之后，对应规则在当前 main 上不再触发，这一行自动变绿；
// 哪天又触发了，报告第一眼就能看到是哪一个老问题回来了。
// 只写用户看得见的描述（公开仓库：不写私有待办编号、价格或供应商合作信息）。
// 这里不写「归到哪个底层设计问题」：那是规则的属性，只在 rules.mjs RULE_ROOTS 登记一份，报告按 rules 推出来。
export const USER_REPORTED_ISSUES = Object.freeze([
  { id: 'U01', reported: '2026-09-29', text: '付费卡两页，只在第 1 页点「仍要生成」就直接开跑，第二张卡还没确认', playbook: 'pb01-two-page-card', rules: ['card-scope-mismatch'] },
  { id: 'U02', reported: '2026-09-29', text: 'Agent 说「已经开始跑」，实际另一镜根本没开拍', playbook: 'pb01-two-page-card', rules: ['receipt-claims-whole-draft-started'] },
  { id: 'U03', reported: '2026-09-29', text: '参考图明明连着，经付费卡确认后发出去的请求里没有它', playbook: 'pb02-reference-image', rules: ['sent-references-on-canvas', 'sent-references'] },
  { id: 'U04', reported: '2026-09-29', text: '设置 / Agent 面板里的「图片默认 / 视频默认」模型，Agent 不管', playbook: 'pb03-default-models', rules: ['agent-ignores-declared-default'] },
  { id: 'U05', reported: '2026-09-29', text: '给 Agent 传 txt 附件，发出后附件没了，Agent 也没读', playbook: 'pb04-script-attachment-long-chat', rules: ['attachment-gone-after-send', 'attachment-not-sent-to-model'] },
  { id: 'U06', reported: '2026-09-29', text: '分镜表自己冒出来（没点过）', playbook: 'pb05-pause-resume', rules: ['surface-storyboardTable', 'surface-workspaceMode', 'surface-creationSelection'] },
  { id: 'U07', reported: '2026-09-29', text: '暂停以后，上面的消息 / 转圈一直在转', playbook: 'pb05-pause-resume', rules: ['spinner-without-deadline', 'run-stuck-pausing', 'agent-turn-idle'] },
  { id: 'U08', reported: '2026-09-29', text: '节点上的无效角标：只有 1 版也显示「几版」', playbook: 'pb01-two-page-card', rules: ['9a-single-version-pill'] },
  { id: 'U10', reported: '2026-09-29', text: '缩小窗口后右上角的提示框伸出窗口，关闭钮点不到，还叠 ×3', playbook: 'pb06-failure-small-window', rules: ['overlay-out-of-viewport', 'close-button-unreachable', '9c-repeated-toast'] },
  { id: 'U11', reported: '2026-09-28', text: '长对话里 Agent 一回合输入 token 爆到几十万，写剧本连着失败', playbook: 'pb04-script-attachment-long-chat', rules: ['input-tokens-over-budget', 'agent-write-receipt-stuck'] },
  { id: 'U12', reported: '2026-09-29', text: '生成失败时的提示文字：原因说错、把旧失败算到新换的那家头上、提示是英文原话', playbook: 'pb06-failure-small-window', rules: ['failure-reason-misstated', 'failure-blamed-on-wrong-vendor', 'raw-english-in-chinese-ui', 'stale-failure-toast'] },
  { id: 'U13', reported: '2026-09-29', text: '失败停批后没开拍的镜头显示「预算已用完」「提额续拍」，里面的额度全是 0', playbook: null, rules: ['ui-stopped-after-failure'],
    notYet: '要一条「参考卡（定妆照）失败 → Run 进 needs_attention → 没开拍的镜头」的剧本，第一个里程碑没写（下一批）' },
  // 2026-09-29 起返工 / 续拍没有笼统的「稍后再试」：每种失败一句话。还说不清是哪种的只剩「这是 Nomi 自己的问题」——它出现 = 这个老问题换了个样子回来。
  { id: 'U14', reported: '2026-09-29', text: '点了之后弹「操作没成功，稍后再试」', playbook: 'pb01-two-page-card', rules: ['ui-action-internal-error'] },
  { id: 'U15', reported: '2026-09-29', text: 'Seedream 5.0 供应商出了图，Nomi 显示失败还劝换供应商', playbook: 'pb90-seedream5-paid', rules: ['provider-succeeded-nomi-failed', 'suggests-switching-after-local-failure'],
    notYet: '只进付费小额组：零花费夹具复现不了真供应商回的那张图；剧本已写，发版前 NOMI_SPEND_OK=1 跑' },
  { id: 'U16', reported: '2026-09-30', text: '分镜里把图片提示词写成「巨龙」，生成出来的却是人物（提示词被追加了看不见的人物特征、还连上了看不见的人物参考图）', playbook: 'pb07-storyboard-prompt-truth', rules: ['sent-prompt-unseen-addition', 'sent-references'] },
  { id: 'U17', reported: '2026-09-30', text: '让 Agent 做封面：画布上是「视频」节点写着「排队中」，付费卡标题说视频、卡里却是图片模型和 3:4 图片尺寸，卡上改不了模型和参数，点确认提示没开始生成', playbook: 'pb08-cover-card-kind', rules: ['card-kind-mismatch', 'ui-queued-before-consent'] },
].map(Object.freeze))
