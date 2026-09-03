// Agent UI P0 异常态样张 · **意图层**形态契约（2026-09-03 · 设计班写，拍板前待审）
//
// 契约边界：只写「机器扫不出、但设计时知道的关系」——哪些位置承载设计意图。
// 挂点全不全、几何值、token 漂移归**自动层**（`*.auto.mjs`，从样张导出）。
// 两层共用 `tests/ux/_assert.mjs` 的 `assertMockupContract`。
//
// 本样张是**纯设计产物**（待拍板），不对应任何生产实现代码。
// 对应缺口文档：`docs/design/agent-ui-state-coverage-gaps.md` P0 列表（17 件）。
// 基版正常态契约：`2026-09-01-agent-ui-final-redesign.auto.mjs`（本文只补异常态）。

export default {
  mockup: 'docs/design/mockups/2026-09-03-agent-ui-p0-exception-states.html',
  surface: 'Agent UI · P0 异常态（17 件 · 4 族）',
  layer: 'intent',

  structure: [
    // ── 族1 · 折叠策略：「折叠/封顶行」必须在内容区之后（列表滚动区之后）
    // 为什么是意图：折叠行出现在内容区之前会让用户以为「这是个标题」，
    // 必须在内容区之后（用户扫完可见内容，才遇见「还有更多」的提示）。
    {
      name: '计划卡折叠脚部摘要行在列表区之后',
      before: '[data-agent-plan-card] [data-plan-list]',
      after: '[data-agent-plan-card] [data-plan-summary]',
    },
    {
      name: '有出入卡「还有 M 处」折叠行在偏差列表之后',
      before: '[data-agent-deviation-card] [data-deviation-list]',
      after: '[data-agent-deviation-card] [data-deviation-more]',
    },

    // ── 族1 · 排队行：前 N 条显示在折叠行之前（用户先看到具体内容才知道要不要展开）
    {
      name: '可见排队行排在折叠行之前',
      before: '[data-agent-queue-row]',
      after: '[data-queue-more-row]',
    },

    // ── 族1 · 多候选：+N 盒必须和前 3 个缩略图在同一行内（视觉是「最后一格」）
    // 为什么是意图：+N 如果换行，用户感知会是「第二排候选」而不是「折叠控件」。
    {
      name: '+N 折叠盒与前 3 个候选在同一视觉行内',
      ancestor: '[data-agent-candidates-card]',
      descendant: '[data-cand-more]',
    },

    // ── 族2 · 错误态：「是否扣钱」说明必须在主体原因文字之后（信息优先级：先原因，再金额）
    // 为什么是意图：先给钱的说明再给原因，用户会把关注点放在钱上而不是解决问题上——
    // 原因在前告诉用户「发生了什么」，钱的信息在后告诉用户「后果」，顺序即优先级。
    {
      name: '错误原因文字排在扣钱说明之前',
      before: '[data-err-reason]',
      after: '[data-err-billing]',
    },

    // ── 族2 · 付费卡价格失败：已知信息（镜数/模型）必须在不可获取价格行之前
    // 为什么是意图：让用户先看到确定的信息，才能在「暂时无法获取」面前有所参考。
    {
      name: '付费卡已知明细行排在价格不可获取行之前',
      before: '[data-agent-spend-card] [data-price-known]',
      after: '[data-agent-spend-card] [data-price-unknown]',
    },

    // ── 族2 · 写入失败：失败回执必须在对话流内（不是模态弹窗，不是 toast 区）
    // 为什么是意图：失败发生在对话流里，就在流里就地展示——
    // 如果失败行出现在流外，用户要在两处查信息，增加认知负荷。
    {
      name: '写入失败回执在对话流内（非弹窗非 toast）',
      ancestor: '[data-agent-flow]',
      descendant: '[data-agent-proposal-receipt]',
    },

    // ── 族2 · 产物卡失败：错误原因行在缩略图区之后（结构：图 → 原因，先呈现上下文再说错误）
    {
      name: '产物卡错误说明行在缩略图区之后',
      before: '[data-agent-artifact-card] [data-artifact-thumb]',
      after: '[data-agent-artifact-card] [data-artifact-err]',
    },

    // ── 族3 · 骨架态：加载中的动作按钮必须存在但禁用（不是隐藏）
    // 为什么是意图：禁用态预告「这里会有操作」，让用户知道加载完就能用，避免「突然冒出按钮」的跳变感。
    // 隐藏 + 显现 = 布局跳动；禁用 + 启用 = 状态过渡，认知成本更低。
    {
      name: '计划卡加载中按钮存在且禁用（不隐藏）',
      ancestor: '[data-agent-plan-card][data-state=loading]',
      descendant: 'button[disabled]',
    },
    {
      name: '产物卡加载中动作组存在且禁用',
      ancestor: '[data-agent-artifact-card][data-state=loading]',
      descendant: '[data-artifact-acts]',
    },

    // ── 族4 · 空状态：引导按钮必须在 @ 选择器内部（不是跳转到别处的链接）
    // 为什么是意图：按钮触发「跳转到素材库」动作——这个动作需要在选择器的上下文里发生，
    // 不是新标签页打开，是在同一个 app 内跳转（关闭选择器 + 切换到素材库视图）。
    {
      name: '空状态引导按钮在 at-picker 内部',
      ancestor: '[data-agent-at-picker][data-empty=true]',
      descendant: '[data-at-empty-cta]',
    },
  ],

  // 异常态样张不写精确几何（几何依赖正常态基版，本文只覆盖异常态的结构关系）
  geometry: [],
}
