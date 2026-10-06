// 分镜表 · **意图层**形态契约（拍板方手写，2026-09-03 建；2026-09-18 迁到 v6；2026-10-06 按正本 §2.3 / §2.4 修订重誊）。
//
// ⚠️ 文件名跟着 v5 样张走（门岗 `check:mockup-contracts` 按样张名找契约），但**条款已迁到 v6**：
// 机制的正本是 `mechanizes` 里那份获批设计合同，不是同名的 v5 样张 HTML。
// v6（信息架构重做，0d5a56d47）有意推翻了 v5 的两条，见下方逐条注释；v5 其余条款原样保留。
// 2026-10-06（#1042 分镜复用画布交互，用户三轮拍板）：正本 §2.3 / §2.4 加了修订——行骨架换成
// 「行首 / 视觉列 / 内容列」三列、预览框按整片画幅定（横宽 240、竖高 240、方 180）、参考列换成视觉列里的参考条。
// 本次重誊只抄正本修订**自己写下的数字**（16:9 → 240×135、9:16 → 135×240、1:1 → 180×180、竖版视觉列 240、
// 参考缩略图 36），一个都没有新编；被修订作废的条款（136 列宽、76×135、56px tile、65px 固定盒、
// 「提示词块高度不低于画面格」）连同它们的选择器一起删掉，不留成过期的数字。
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
  /** 这份契约机械化的是哪一份获批设计合同——换了信息架构却没换这一行，就是契约过期了。 */
  mechanizes: {
    doc: 'docs/design/2026-09-05-storyboard-table-v6-design-contract.md',
    sections: ['§2.3 行骨架（含 2026-10-06 修订）', '§2.4 画面格比例规则（含 2026-10-06 修订）', '§4.1（2026-10-06 修订：参考列换成参考条）'],
    migratedAt: '2026-10-06',
  },
  surface: '分镜表 v6 · 分镜行',
  layer: 'intent',

  structure: [
    { name: '骨架段必须长在提示词框内部', ancestor: '[data-storyboard-prompt-block]', descendant: '[data-storyboard-prompt-segment]' },
    { name: '@ 引用胶囊必须长在提示词框内部', ancestor: '[data-storyboard-prompt-block]', descendant: '[data-storyboard-mention-chip]' },

    // ── 行内阅读顺序：看这一镜长什么样（视觉列：画面 → 参考）→ 说什么（提示词）→ 怎么生成（底栏）。
    // 正本 §2.3 修订（2026-10-06）：「三块的阅读顺序不变……DOM 顺序就是这个顺序」。用户 2026-09-01 指定的顺序。
    {
      name: '画面格排在参考条之前',
      before: '[data-storyboard-frame]',
      after: '[data-storyboard-refs]',
    },
    {
      name: '参考条排在提示词块之前（参考住在视觉列里，不在提示词上方）',
      before: '[data-storyboard-refs]',
      after: '[data-storyboard-prompt-block]',
    },
    {
      name: '视觉列排在内容列之前（行骨架：行首 │ 视觉列 │ 内容列）',
      before: '[data-storyboard-visual-column]',
      after: '[data-storyboard-content-column]',
    },
    // 正本 §2.3 修订：底栏 = 画布同款参数条 + 最右「生成」，视觉上属于提示词块（「和画布节点同一手感」）。
    { name: '底栏长在提示词块里（参数条 + 生成是内容列的一部分，不是表格的列）', ancestor: '[data-storyboard-prompt-block]', descendant: '[data-storyboard-composer-bar]' },

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

    // ── v6 §2.3 推翻了 v5 的「悬停才出现」：动作条**移到画面格下方、一行常驻小图标**，
    // 理由写在合同里——半透明按钮压在缩略图上本来就是 §1.5.3 的已知反例，不是 v6 引入的新债。
    // 所以这条从「默认不可见」翻成「排在画面格之后」：常驻可以，压图不行。
    {
      name: '动作条排在画面格之后（v6：移到格子下方，不压图）',
      before: '[data-storyboard-frame]',
      after: '[data-storyboard-actbar]',
    },
    // v6 §2.3：「分镜行只有四块……行尾没有展开按钮，也没有展开区」。展开态连同台词/转场字段
    // 已整体删除，这条从「默认收起」变成「不许再长回来」的看门狗（元素不存在即满足）。
    {
      name: '行展开区不存在（v6 删掉了行展开态，台词/转场归剪辑面）',
      selector: '[data-storyboard-expand]',
      hiddenByDefault: true,
    },
  ],

  geometry: [
    // ── 「图是主角」：用户 2026-09-02 定的最高原则；2026-10-06 用户「给左边留出空间可以清晰预览」把框放大。
    // 正本 §2.4 修订：预览框由整片默认画幅定、全表同一只——竖版高固定 240（9:16 → 135×240）。
    // 走查的方案是短剧片种（整片 9:16），所以量竖版那一档。
    {
      name: '9:16 预览框 135×240（§2.4 修订的竖版落点）· 宽',
      selector: '[data-storyboard-frame-media="9:16"]',
      dimension: 'width',
      expected: 135,
    },
    {
      name: '9:16 预览框 135×240（§2.4 修订的竖版落点）· 高',
      selector: '[data-storyboard-frame-media="9:16"]',
      dimension: 'height',
      expected: 240,
    },
    // 正本 §2.3 修订：「整片竖版时列宽仍是 240（框靠左，参考条在框右边）」——各行左缘和内容列起点与横版表一致。
    {
      name: '整片竖版时视觉列宽 240（与横版表同一起点）',
      selector: '[data-storyboard-visual-column]',
      dimension: 'width',
      expected: 240,
    },
    // 正本 §2.3 修订：参考缩略图 36 方块，末格「+」同尺寸。
    {
      name: '参考条的格子 36 方块（宽档）',
      selector: '[data-storyboard-ref-add] [data-asset-add-tile]',
      dimension: 'width',
      expected: 36,
    },
    {
      name: '画面格比参考条的格子宽（图是主角，参考是配料）',
      selector: '[data-storyboard-frame]',
      largerThan: '[data-storyboard-ref-add] [data-asset-add-tile]',
      dimension: 'width',
    },

    // ── 提示词块是主输入面，不是行里的一个格子。用户原话：
    // 「提示词就那一窄条，他怎么输入呢？」——这条防止它再被压回条状。
    {
      name: '提示词块必须比参考条宽（它是主输入面，不是一个格子）',
      selector: '[data-storyboard-prompt-block]',
      largerThan: '[data-storyboard-refs]',
      dimension: 'width',
    },
  ],
}
