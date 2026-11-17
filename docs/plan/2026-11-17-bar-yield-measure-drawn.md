# 生成底栏「窄了谁先让」：量的就是画的，任何一格变了尺寸就重量（短版设计卡）

方向检查：`docs/engineering/direction-checks/2026-11-17-bar-yield.md`（第 6 节「删掉」那条路，照做、不加别的）。

## 短版设计卡

- ★1 修复什么：画布生成框 600 宽、英文，开参数面板把时长 5s 改 10s 再 Esc，摘要「16:9 · 720p · 10s」的箭头压住右边第一颗图标；连改几次参数又会让多（只剩「10s」）。真实任务：选 Seedance 2.0 Mini → 16:9 / 720p / 5s → 开面板改时长 / 清晰度 → Esc，连做三次，中英各一遍。量具：`tests/ux/composer-bar-yield-cycle.walk.mjs`（真 Electron、本机回环假服务、不花钱）+ `tests/ux/composer-bar-yield-transitions.walk.mjs`（设计实验室三条特征测试）。不做什么：梯子、让的顺序、四处共用都不动；画布第 ① 级是空级（`Boolean(footer.action)`）只记录不改。已知坑：内容只在更低一级上变窄、当前这一级画出来的每一格尺寸都没变时（例如停在「方式只剩图标」那级时切成方式名更短的语言），不重量，可能多让一级——这种情况没有专门测，记为未验证。★1c 老用户：不适用，不碰任何存储，只改量法。
- ★2 谁说了算：让级只有 `InlineParameterBar` 量（`node scripts/door-map.mjs composerYieldLadder`：1 扇门）；底栏别的组件只从 `ComposerBarYieldContext` 读。新加 eslint 门岗：底栏文件表 + 任何引了 `composerBarYield` 的文件不许 `getBoundingClientRect` / `offsetWidth` 类 / `ResizeObserver`，`data-yield-item` 只许它打。
- ★3 以前定过什么：冻结摘要是早期「开着面板钮宽不跳」的做法，但面板定位只算一次、之后不跟随，冻结已经不挣什么；重量时机原是手写清单 `fitKey`（梯子长度、摘要候选、模型值、方式值）。三条路（补清单 / 纯排版 / 删掉）里选删掉：①删冻结（`frozenSummary`、`setFrozenSummary`、`pillText` 分支）；②删 `fitKey`，ResizeObserver 看底栏那一行、参数条、行的每个直接子格（参数段、右边图标排、行尾、生成钮）和每个 `data-yield-item` 自己的尺寸，任一变了从第 0 级重量；保留「尺寸签名和观察器上一次看到的一样就不重量」，挡住量的过程自己触发自己。签名比的是「上一次看到的」，不是「量停那一刻的」：试过后者，分镜批量表里带字生成钮那行在宿主排版晚一拍定下来时多让了一级（设计实验室 3 格和 main 不同），换回前者后 0 格不同。成熟库对照见方向检查第 4 节（React Spectrum 量真画出的每一项）。
- ★4 全状态：静止态任何宽度、中英、暗色不变；面板开着改值时摘要实时显示新值，放不下当场少一个值（如英文 600 宽「720p · 10s」）；关面板后按梯子停在该停的那级，不压、不出界；分镜行 598 / 650 只多了「开着实时变」；文案无增减。
- ★9 验收与反例（实现线自验，验收线只核这张表）：
  - 特征测试 T1「开着改值变长 → 关 → 无出界」：main 红（开着画「Auto · 720p · 5s」而真值 10s，关后出界），修后绿。
  - 特征测试 T2「切语言摘要不变、方式名变宽 → 重量」：main 红（切英文后摘要出界、模型方式格压提示词工具），修后绿。
  - 特征测试 T3「重量后签名不变 → 不再触发」+「面板开着连改三次让级不在两级间抖」：main 绿、修后绿（选错的信号：真抖就停，不加特例）。
  - 走查：开面板 → 改值 → Esc 循环 3 次，中英各跑，每次关后查相邻控件不相压、参数条不出界：main 英文红（第 1、3 次压图标，第 2 次让多到只剩「10s」），中文绿；修后中英全绿。
  - 门岗反例：在 `ComposerSendButton.tsx` 加 `getBoundingClientRect` / `offsetWidth` / `new ResizeObserver`、在 `NodeFloatingToolbar.tsx` 打 `data-yield-item` → eslint 4 条红；还原 → 绿。
  - 设计实验室静止态：和同机 main 比，0 格变化（165 格）。
  - 回滚：revert 这一个提交。
