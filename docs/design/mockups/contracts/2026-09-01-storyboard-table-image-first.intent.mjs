// 分镜表 v5 · **意图层**形态契约（拍板方手写，2026-09-03）。
//
// 契约的边界：这里只写「机器扫不出、但拍板那刻的人知道」的关系——哪些位置承载设计意图。
// 挂点全不全、几何精确值、token 有没有漂，归**自动层**（同目录 `*.auto.mjs`，从样张导出）。
// 两层共用 `tests/ux/_assert.mjs` 的 `assertMockupContract` 与门岗 `check:mockup-contracts`。
//
// 每条规则都对应一次真实的拍板决定，注释写清「为什么这条是意图而不是实现细节」——
// 没有理由的规则会随时间腐烂成教条，下一个人不敢删也不敢改。
//
// ⚠️ 本文件当前覆盖 main 上已落地的 A/B 段形态。**C 段（结构化提示词）落地时必须补两条**，
// 它们正是催生整套机制的那次偏离（样张里骨架段是提示词文本内的虚线段，实现做成了框下一行胶囊）：
//   { name: '骨架段必须长在提示词框内部', ancestor: '[data-storyboard-prompt-block]',
//     descendant: '[data-storyboard-prompt-segment]' }
//   { name: '@ 引用胶囊必须长在提示词框内部', ancestor: '[data-storyboard-prompt-block]',
//     descendant: '[data-storyboard-mention-chip]' }
// 这两条已写进 C 段打回单，收货时逐条验。

export default {
  mockup: 'docs/design/mockups/2026-09-01-storyboard-table-image-first.html',
  surface: '分镜表 v5 · 分镜行',
  layer: 'intent',

  structure: [
    { name: '骨架段必须长在提示词框内部', ancestor: '[data-storyboard-prompt-block]', descendant: '[data-storyboard-prompt-segment]' },
    { name: '@ 引用胶囊必须长在提示词框内部', ancestor: '[data-storyboard-prompt-block]', descendant: '[data-storyboard-mention-chip]' },

    // ── 行三块顺序：要生成的 → 拿来参考的 → 怎么描述。用户 2026-09-01 亲自指定的阅读顺序。
    {
      name: '画面格排在参考区之前',
      before: '[data-storyboard-frame]',
      after: '[data-storyboard-refzone]',
    },
    {
      name: '参考区排在提示词块之前',
      before: '[data-storyboard-refzone]',
      after: '[data-storyboard-prompt-block]',
    },

    // ── 上下位置本身在教顺序：先把「谁/哪儿」定下来，再一镜一镜拍。不用写一个字的说明。
    {
      name: '参考卡区排在分镜表之前（版面即教学顺序）',
      before: '[data-storyboard-anchors]',
      after: '[data-storyboard-rows]',
    },
    // 「全部镜头」批量条（样张 A 拍板 2026-08-17）改的是整片，必须排在逐行表格之前——
    // §1.6 C3：不同作用域的控件必须视觉可分，位置是最强的那道分隔。
    // 注意别错认底栏的 [data-storyboard-batch]（那是「生成未生成的 N 镜」按钮，本就在表之后）。
    {
      name: '整片作用域的批量条排在逐行表格之前',
      before: '[data-storyboard-bulkbar]',
      after: '[data-storyboard-rows]',
    },

    // ── §1.5：情境控件不许挤常驻位；动作不许常驻压在内容上。
    // 悬停浮条是「瞬时覆盖」，常驻就变成永久遮挡（用户 2026-09-02 亲自裁定过这条边界）。
    {
      name: '画面格动作浮条默认不可见（悬停才出现）',
      selector: '[data-storyboard-actbar]',
      hiddenByDefault: true,
    },
    {
      name: '行展开态默认收起（台词/转场/参数不占行内预算）',
      selector: '[data-storyboard-expand]',
      hiddenByDefault: true,
    },
  ],

  geometry: [
    // ── 「图是主角」：用户 2026-09-02 定的最高原则。画面格必须是行内视觉重心，
    // 不能退化成邮票——一旦小到认不出人脸，整张表就失去「扫一列看全片」的价值。
    {
      name: '画面格宽度约 76px（竖屏项目主画幅）',
      selector: '[data-storyboard-frame]',
      dimension: 'width',
      expected: 76,
    },
    {
      name: '画面格高度约 132px（9:16，不是缩成一条）',
      selector: '[data-storyboard-frame]',
      dimension: 'height',
      expected: 132,
    },
    {
      name: '画面格必须比参考区宽（图是主角，参考是配料）',
      selector: '[data-storyboard-frame]',
      largerThan: '[data-storyboard-ref-tile]',
      dimension: 'width',
    },

    // ── 参考 tile 56px 是用户 2026-09-02 亲自从 40px 提上来的：
    // 「40px 连这是谁都认不出」。认人靠 56px，判断靠悬停浮层，细看靠全屏——三层分工的第一层。
    {
      name: '参考 tile 约 56px（认得出是谁的下限）',
      selector: '[data-storyboard-ref-tile]',
      dimension: 'width',
      expected: 56,
    },

    // ── 提示词块是主输入面，不是行里的一个格子。用户原话：
    // 「提示词就那一窄条，他怎么输入呢？」——这条防止它再被压回条状。
    {
      name: '提示词块必须比参考区宽（它是主输入面，不是一个格子）',
      selector: '[data-storyboard-prompt-block]',
      largerThan: '[data-storyboard-refzone]',
      dimension: 'width',
    },
    {
      name: '提示词块高度不低于画面格（占满行高，不是压在行底的一条）',
      selector: '[data-storyboard-prompt-block]',
      dimension: 'height',
      expected: 132,
    },
  ],
}
