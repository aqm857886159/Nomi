// Agent UI 自动层形态契约（2026-09-03，由 scripts/extract-design-spec.mjs 生成）。
//
// ⚠️ 本文件由脚本自动生成，**禁止手改**——改动在下次 extract-design-spec 运行时被覆盖。
// 需要永久豁免某条规则：在同目录 2026-09-01-agent-ui-final-redesign.intent.mjs 里加注释，
// 或修改 extract-design-spec.mjs 的 CLASS_TO_ANCHOR 映射表。
//
// 样张：docs/design/mockups/2026-09-01-agent-ui-final-redesign.html
// 样张 hash：ddbf0c2d345f1368（hash 不变代表样张未改，规格仍有效）
//
// 这份契约与意图层（*.intent.mjs）**平行但不重叠**：
//   · 自动层（本文件）：挂点全不全、几何有没有跑偏（从样张渲染量出的真实像素）。
//   · 意图层：机器扫不出的「为什么」——哪些位置关系承载拍板时的设计决定。
//
// 容差策略：max(4px token步进, 期望值×25%)——与意图层 _contract.mjs 完全相同。
// 76px 做成 78px 不红；76px 做成 200px 红（见 TOKEN_STEP_PX/MAGNITUDE_RATIO）。
//
// 被 assertMockupContract（tests/ux/_assert.mjs 导出）和 check:mockup-contracts 门岗消费。
// agent-ui-spec.generated.json 是中间产物，它不是契约本体，不被断言器直接调用。

export default {
  mockup: 'docs/design/mockups/2026-09-01-agent-ui-final-redesign.html',
  surface: 'Agent UI（自动层·35 条规格/5 屏）',
  layer: 'auto',

  geometry: [
  {
    "name": "[A-01] 头部一行（data-agent-header）",
    "selector": ".asst-head",
    "dimension": "height",
    "expected": 41,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.asst-head",
    "sourceLibrary": "AI Elements",
    "adaptationRule": "Use the Context/Message/Artifact/Queue interaction pattern only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "h": 4,
      "padding": 4
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-02] 用量胶囊（data-agent-usage-pill）",
    "selector": ".usage-pill",
    "dimension": "height",
    "expected": 22,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.usage-pill",
    "sourceLibrary": "AI Elements",
    "adaptationRule": "Use the Context/Message/Artifact/Queue interaction pattern only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "h": 2,
      "w": 8
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-01] 历史对话按钮（data-agent-history）",
    "selector": ".hico[title=\"历史对话\"]",
    "dimension": "height",
    "expected": 24,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.hico[title=\"历史对话\"]",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "w": 2,
      "h": 2
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-01] 收起按钮（data-agent-collapse）",
    "selector": ".hico[title=\"收起\"]",
    "dimension": "height",
    "expected": 24,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.hico[title=\"收起\"]",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "w": 2,
      "h": 2
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-01] 会话流（role=log）（data-agent-flow）",
    "selector": ".flow",
    "dimension": "height",
    "expected": 417,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.flow",
    "sourceLibrary": "Beautiful UI",
    "adaptationRule": "Use the Thinking/Loading/Tool Chips/Streaming Text behavior only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "w": 4
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-03] 压缩分隔线（data-agent-compaction-line）",
    "selector": ".divider:not(.stage-line)",
    "dimension": "height",
    "expected": 17,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.divider:not(.stage-line)",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "h": 4
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-05] 阶段分隔线（data-agent-stage-line）",
    "selector": ".divider.stage-line",
    "dimension": "height",
    "expected": 21,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.divider.stage-line",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "h": 4
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-06] 用户气泡（data-agent-user-bubble）",
    "selector": ".userbubble",
    "dimension": "height",
    "expected": 52,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.userbubble",
    "sourceLibrary": "Beautiful UI",
    "adaptationRule": "Use the Thinking/Loading/Tool Chips/Streaming Text behavior only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "x": 4,
      "h": 4
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-07] 技能载入事件行（data-agent-skill-event）",
    "selector": ".evt",
    "dimension": "height",
    "expected": 17,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.evt",
    "sourceLibrary": "Beautiful UI",
    "adaptationRule": "Use the Thinking/Loading/Tool Chips/Streaming Text behavior only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "h": 4
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-08] 思考条（落定态）（data-agent-thinking-line）",
    "selector": ".line.settled",
    "dimension": "height",
    "expected": 22,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.line.settled",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "h": 4
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-10] 正文回复（data-agent-reply）",
    "selector": ".asstext",
    "dimension": "height",
    "expected": 19,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.asstext",
    "sourceLibrary": "Beautiful UI",
    "adaptationRule": "Use the Thinking/Loading/Tool Chips/Streaming Text behavior only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "h": 8
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-11] 工具总览行（data-agent-tool-line）",
    "selector": ".toolline",
    "dimension": "height",
    "expected": 21,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.toolline",
    "sourceLibrary": "Beautiful UI",
    "adaptationRule": "Use the Thinking/Loading/Tool Chips/Streaming Text behavior only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "h": 4
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-13] 写入回执行（data-agent-proposal-receipt）",
    "selector": ".receipt",
    "dimension": "height",
    "expected": 22,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.receipt",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "h": 4
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-13] 撤销 icon 钮（data-agent-receipt-undo）",
    "selector": ".rico",
    "dimension": "height",
    "expected": 22,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.rico",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "w": 4,
      "h": 4
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-14] lost-edits 确认卡（data-agent-lost-edits-card）",
    "selector": ".lost-edits",
    "dimension": "height",
    "expected": 87,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.lost-edits",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "h": 8
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-15] 落点胶囊（data-agent-landing-chip）",
    "selector": ".chip-jump",
    "dimension": "height",
    "expected": 22,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.chip-jump",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "h": 4,
      "w": 8
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-16] 排队行（data-agent-queue-row）",
    "selector": ".qline",
    "dimension": "height",
    "expected": 24,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.qline",
    "sourceLibrary": "AI Elements",
    "adaptationRule": "Use the Context/Message/Artifact/Queue interaction pattern only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "h": 4
    },
    "state": "normal",
    "severity": "P0"
  },
  {
    "name": "[A-16] 撤回 × 钮（data-agent-queue-remove）",
    "selector": ".qx",
    "dimension": "height",
    "expected": 18,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.qx",
    "sourceLibrary": "AI Elements",
    "adaptationRule": "Use the Context/Message/Artifact/Queue interaction pattern only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "w": 4,
      "h": 4
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-17] composer 区（data-agent-composer）",
    "selector": ".composer",
    "dimension": "height",
    "expected": 113,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.composer",
    "sourceLibrary": "Beautiful UI",
    "adaptationRule": "Use the Thinking/Loading/Tool Chips/Streaming Text behavior only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "h": 8
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-17] 输入框（data-agent-input）",
    "selector": ".cprompt",
    "dimension": "height",
    "expected": 41,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.cprompt",
    "sourceLibrary": "Beautiful UI",
    "adaptationRule": "Use the Thinking/Loading/Tool Chips/Streaming Text behavior only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "h": 8
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-18] @ 引用 token（正常态）（data-agent-at-token）",
    "selector": ".at:not(.stale)",
    "dimension": "height",
    "expected": 18,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.at:not(.stale)",
    "sourceLibrary": "AI Elements",
    "adaptationRule": "Use the Context/Message/Artifact/Queue interaction pattern only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "h": 2
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-18] @ 引用 token（变黄态）（data-agent-at-token[data-stale=true]）",
    "selector": ".at.stale",
    "dimension": "height",
    "expected": 18,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.at.stale",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "h": 2
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-19] 底排附件钮（data-agent-composer-attach）",
    "selector": ".cbtn.ico[data-tip=\"附件\"]",
    "dimension": "height",
    "expected": 28,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.cbtn.ico[data-tip=\"附件\"]",
    "sourceLibrary": "Beautiful UI",
    "adaptationRule": "Use the Thinking/Loading/Tool Chips/Streaming Text behavior only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "w": 2,
      "h": 2
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-19] 底排执行方式钮（data-agent-composer-mode）",
    "selector": ".cbtn.ico[data-tip=\"模式\"]",
    "dimension": "height",
    "expected": 28,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.cbtn.ico[data-tip=\"模式\"]",
    "sourceLibrary": "Beautiful UI",
    "adaptationRule": "Use the Thinking/Loading/Tool Chips/Streaming Text behavior only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "w": 2,
      "h": 2
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-19] 底排模型钮（data-agent-composer-model）",
    "selector": ".cbtn.ico[data-tip^=\"去选\"]",
    "dimension": "height",
    "expected": 28,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.cbtn.ico[data-tip^=\"去选\"]",
    "sourceLibrary": "Beautiful UI",
    "adaptationRule": "Use the Thinking/Loading/Tool Chips/Streaming Text behavior only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "w": 2,
      "h": 2
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-19] 底排技能钮（data-agent-composer-skill）",
    "selector": ".cbtn.ico[data-tip=\"技能\"]",
    "dimension": "height",
    "expected": 28,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.cbtn.ico[data-tip=\"技能\"]",
    "sourceLibrary": "Beautiful UI",
    "adaptationRule": "Use the Thinking/Loading/Tool Chips/Streaming Text behavior only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "w": 2,
      "h": 2
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-19] 发送钮（data-agent-composer-send）",
    "selector": ".send",
    "dimension": "height",
    "expected": 30,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.send",
    "sourceLibrary": "Beautiful UI",
    "adaptationRule": "Use the Thinking/Loading/Tool Chips/Streaming Text behavior only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "w": 2,
      "h": 2
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[A-20] 模型未选红点（data-agent-model-alert）",
    "selector": ".reddot",
    "dimension": "height",
    "expected": 6,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.reddot",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "w": 2,
      "h": 2
    },
    "state": "normal",
    "severity": "P1"
  },
  {
    "name": "[B-01] 计划卡（data-agent-plan-card）",
    "selector": ".card.accent .chd",
    "dimension": "height",
    "expected": 37,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.card.accent .chd",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "h": 8
    },
    "state": "exception",
    "severity": "P1"
  },
  {
    "name": "[B-02] 付费确认卡（data-agent-spend-card）",
    "selector": ".card.accent .frozen",
    "dimension": "height",
    "expected": 47,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.card.accent .frozen",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "h": 8
    },
    "state": "exception",
    "severity": "P1"
  },
  {
    "name": "[B-03] 有出入卡（data-agent-deviation-card）",
    "selector": ".card.warn",
    "dimension": "height",
    "expected": 248,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.card.warn",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "h": 8
    },
    "state": "exception",
    "severity": "P1"
  },
  {
    "name": "[B-06] 产物缩略卡（data-agent-artifact-card）",
    "selector": ".card.artifact",
    "dimension": "height",
    "expected": 174,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.card.artifact",
    "sourceLibrary": "AI Elements",
    "adaptationRule": "Use the Context/Message/Artifact/Queue interaction pattern only; implement with Nomi primitives and tokens.",
    "tolerance": {
      "h": 8
    },
    "state": "exception",
    "severity": "P1"
  },
  {
    "name": "[B-07] 失败卡（data-agent-failure-card）",
    "selector": ".card.danger",
    "dimension": "height",
    "expected": 114,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.card.danger",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "h": 8
    },
    "state": "exception",
    "severity": "P1"
  },
  {
    "name": "[D-02] 固定结果卡（data-agent-pinned-card）",
    "selector": ".result-card",
    "dimension": "height",
    "expected": 30,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.result-card",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "h": 8
    },
    "state": "completed",
    "severity": "P0"
  },
  {
    "name": "[D-02] 固定卡头部（data-agent-pinned-head）",
    "selector": ".result-card .rc-head",
    "dimension": "height",
    "expected": 28,
    "sourceLocator": "docs/design/mockups/2026-09-01-agent-ui-final-redesign.html#.result-card .rc-head",
    "sourceLibrary": "Nomi",
    "adaptationRule": "Use src/design primitives, Tabler icons, and Nomi tokens; retain Nomi persistence and surface ownership.",
    "tolerance": {
      "h": 4
    },
    "state": "completed",
    "severity": "P0"
  }
],
}
