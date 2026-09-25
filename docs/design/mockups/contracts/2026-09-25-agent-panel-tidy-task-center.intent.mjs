// 任务面板 · **意图层**形态契约（2026-09-25 用户拍板样张「设计没问题」，D1-A / D2-A）。
//
// 正本是样张本身（docs/design/mockups/2026-09-25-agent-panel-tidy/index.html），没有另一份散文合同。
// 这里只写拍板那刻的人知道、机器扫不出的关系：
//   · 「等你处理」排在最上面——要你动手的先看见，不被在跑的大卡片挤到下面；
//   · 「重新拉取」住在「等你处理」这一组的行上，常驻可见，不是悬停才出；
//   · 其余两组的先后（进行中在已完成之前）。
// 走查：tests/ux/task-center-states.walk.mjs（真 app，zh / en 各跑一遍）。

export default {
  mockup: 'docs/design/mockups/2026-09-25-agent-panel-tidy/index.html',
  mechanizes: {
    sections: ['D1-A 等你处理排最上面、行上常驻重新拉取', 'D2-A 顶栏数字计入等你处理'],
    migratedAt: '2026-09-25',
  },
  surface: '任务面板',
  layer: 'intent',

  structure: [
    { name: '「等你处理」排在「进行中」之前（D1-A）', before: '[data-task-section="attention"]', after: '[data-task-section="running"]' },
    { name: '「进行中」排在「已完成」之前', before: '[data-task-section="running"]', after: '[data-task-section="done"]' },
    { name: '「重新拉取」住在「等你处理」组里（D1-A）', ancestor: '[data-task-group="attention"]', descendant: '[data-task-action="recover_generation"]', minCount: 2 },
  ],
}
