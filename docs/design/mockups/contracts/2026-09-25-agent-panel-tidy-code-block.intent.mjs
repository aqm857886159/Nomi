// Agent 回复代码块 · **意图层**形态契约（2026-09-25 用户拍板样张「设计没问题」，D3-A / D5-A）。
//
// 正本是样张本身（docs/design/mockups/2026-09-25-agent-panel-tidy/index.html）。D3/D4 取代了
// docs/plan/2026-09-09-b2e-streamdown.md 原先「代码横向滚动」「复制按钮位于独立头栏」两条定案。
// 这里只写意图关系：
//   · 没有语言标题行（D3-A）——默认不可见；
//   · 复制钮是 24px 小图标（D3-A），不是原先那颗带边框的大按钮；
//   · 提示词围栏按正文排、JSON 仍按代码排（D5-A）——两段提示词各算一个 prose，参数算一个 code。
// 「自动换行不横滚」（D4-A）是计算样式，契约的规则形状表达不了，由走查量 scrollWidth（溢出 ≤1px）。
// 走查：tests/ux/agent-code-block.walk.mjs（真 app + loopback 模型，zh / en）。

export default {
  mockup: 'docs/design/mockups/2026-09-25-agent-panel-tidy/index.html',
  mechanizes: {
    sections: ['D3-A 去掉语言标题行、复制钮 24px 在右上角', 'D5-A 字体按内容判断'],
    migratedAt: '2026-09-25',
  },
  surface: 'Agent 回复代码块',
  layer: 'intent',

  structure: [
    { name: '没有语言标题行（D3-A）', selector: '[data-streamdown="code-block-header"]', hiddenByDefault: true },
    { name: '提示词围栏按正文排（D5-A）', ancestor: '[data-nomi-code="prose"]', descendant: 'pre', minCount: 2 },
    { name: 'JSON 围栏仍按代码排（D5-A）', ancestor: '[data-nomi-code="code"]', descendant: 'pre', minCount: 1 },
  ],
  geometry: [
    { name: '复制钮是 24px 小图标（D3-A）', selector: '[data-streamdown="code-block-copy-button"]', dimension: 'width', expected: 24 },
  ],
}
