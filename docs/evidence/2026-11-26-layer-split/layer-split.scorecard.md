# 体验成绩单：图层分离 PR1：改图 ▾ → 图层分离，派生节点 → 一次花钱 → 画板里可编辑的层 → 完成成新一版

- 改动：图层分离 PR1：改图 ▾ → 图层分离，派生节点 → 一次花钱 → 画板里可编辑的层 → 完成成新一版
- 验收 head：`a28f3c313`（实现线 I-SE-layer-split；真截图与走查在提交 a28f3c313 的构建上跑（已合入 origin/main 35d9ce445），假 APIMart 替身，0 花费）
- 场景 id：`canvas-image-generate`
- 谁验：I-SE-layer-split（实现线自测；独立验收线待协调指定）（实现线自测）
- 日期：2026-11-26；成绩单整理：I-SE-layer-split，按本次走查日志、反例红绿日志与性能场景原始结果填写

**用户这次能完成：**在一张满意的图上点「改图 ▾ → 图层分离」，右边多出一个定好方式的节点；点发送花一次钱，拆出的底图和透明图层落进画板，每层能选、拖角等比缩放、删掉、接着画，点「完成」成为新一版；没有能拆图层的模型时，菜单第二行告诉你去接哪一家，点了打开接入页

**能力变化：**新增：改图菜单「生成新图」组第一项「图层分离」（IconStack2）、生成框一格「图层分离 · 30 层 · 自动」与参数面板（8 / 16 / 30 / 自定义、清晰度、识别文字、≥50 层的提醒）、发送键约价按层数上限印「≤」，悬停写清按上限预扣、按实际层数结算、拆出的层落成一张可编辑白板，节点下方「N 层」、性能场景 inline-whiteboard-split-100-open；改变：画笔每一笔自建一层，当前层被删 / 锁住时也能落笔（今天落不下去）；去掉：无

## 结果

- 机器：完成 **4 / 6**（失败 2 条，原样列在下表，不丢）
- 首次尝试成功：null（未采集：需要真人首次操作，AI 不代填）

| 尝试 | 结果 | 说明 | 证据 |
| --- | --- | --- | --- |
| layer-split 走查（换模型后「拆图层」没跟过去） | **失败** | 在 5.5 和 5.0 Pro 之间换模型，图层分离落成了普通改图；已修，archetypeMeta.layerSplitCarry.test.ts 守住 | src/workbench/generationCanvas/nodes/controls/archetypeMeta.layerSplitCarry.test.ts |
| layer-split 走查（删层后画笔） | **失败** | 删掉当前层后画笔落不下去（今天所有画板都有）；已修，whiteboardStateOps.test.ts 三条守住 | src/workbench/generationCanvas/nodes/whiteboard/whiteboardStateOps.test.ts |
| layer-split 走查 walk9 zh 浅色 / en 暗色 1100×690（「≤」之前的构建 e3fff40be） | 通过 |  | tests/ux/layer-split.walk.mjs |
| layer-split 走查 walk10 zh 浅色（最终构建 a28f3c313） | 通过 |  | tests/ux/layer-split.walk.mjs |
| layer-split 走查 walk10 en 暗色 1100×690（最终构建 a28f3c313） | 通过 |  | tests/ux/layer-split.walk.mjs --locale en --theme dark --size 1100x690 |
| 付费走查免费演练（no-key） | 通过 |  | tests/ux/layer-split-real.paid.mjs（NOMI_PAID_REHEARSAL=no-key） |

## 机器测的

来源：walk-log
设备 / 窗口 / 语言：Mac（Apple M5，24GB），开发构建（electron .），隔离资料目录 / 默认窗（中文浅色）与 1100×690（英文暗色） / zh-CN 与 en，浅 / 暗。边界：假 APIMart 替身（底图 + 2 层、一层带字；5.5 假价目 30 层自动 = 8.46 积分），不花钱

| 主指标 / 指标 | 现状 → 当前 | 单位 | 样本数 | 口径 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 从满意的图到派生出定好方式的节点的点击 | null → 2 | 次 | 1 | 脚本计数（真事件，非采集器） | 「改图 ▾」→「图层分离」；改前没有这个入口（只能整张重生成或去别的软件抠图） |
| 一次图层分离发给供应商的请求 | null → 1 | 次 | 1 | 脚本计数（真事件，非采集器） | 替身记下的 POST 数（vendor-requests.json）；派生那一步 0 次 |
| 打开 100 层拆出的画板到能操作 | null → 372 | ms | 5 | 实测（采集器） | perf:scenarios inline-whiteboard-split-100-open，中位数；p95 373.3，预算 1000，提交 5973ebce8（工作树干净），原始结果 docs/evidence/2026-11-26-layer-split/perf-inline-whiteboard-split-100-open.json |
| 图层面板列出 101 行 | null → 29.4 | ms | 5 | 实测（采集器） | 同一场景，中位数；p95 35.2，只打印不设预算 |

## 真人给的（和上面分开记）

- SEQ（1–7）：null（未采集）
- 误点：null · 回退：null · 求助：null · 首次尝试成功：null
- 说明：还没有真人试过

## 护栏

| 护栏 | 结果 | 证据 / 说明 |
| --- | --- | --- |
| 派生不花钱：点「图层分离」只建节点，不发请求 | 通过 | 走查 LS02 + vendor-requests.json；deriveFromNode.run.test.ts「★9-1」 |
| 线缆拆不了就不发：不悄悄发成一次普通改图 | 通过 | electron/catalog/taskParams.modeInputRoutes.test.ts |
| 约价不冒充实价：按上限印「≤」，算不出不印数、不印 0 | 通过 | sendCostFormat.test.ts、vendorPricePreview.test.ts；走查断言键上「≤8.46」与悬停那一句 |
| 普通改图、普通画板、老节点照旧 | 通过 | canvasModeOldUser.* 在真实 0.24.1 旧数据上 73 条全过；sendCostFormat.test.ts 原有用例全过 |
| 老画板数据（真实旧版本） | 未验证 | tests/fixtures/old-user-data/ 里没有带画板的旧项目；只读不改形状，手写形状由 whiteboardStateOps.test.ts 覆盖 |

## 最大摩擦点与决定

- 摩擦：拆完以后图层面板仍挂在工具条下面，要自己点开；行上没有缩略图，层多了靠名字找
- 决定：面板挪到节点旁、有可编辑层时默认打开（D-1126-se-default-open-B）、缩略图与排序都进 PR2（D-1126-se-split-prs）
- 协调决定：待协调验收

## 没验证的

| 缺口 | owner | 复查条件 |
| --- | --- | --- |
| 真付费一次（2 层 · 1K · 1 张源图）：回来的层是裁好的小图还是整幅透明图、z_index 方向、按输出张数实扣 | 协调会话（C-E10） | 协调跑 tests/ux/layer-split-real.paid.mjs 那一次 |
| 真人首次尝试 | 协调会话 | 下一次有人试用时补 SEQ 和人工事件 |
| 停靠 Agent 的 1100×690、1440×900、Windows、键盘全程、干净安装 | 独立验收线 / PR2 | PR2 面板挪位后一起重跑 |

## 证据路径

- tests/ux/layer-split.walk.mjs
- tests/ux/layer-split-real.paid.mjs
- docs/evidence/2026-11-26-layer-split/side-by-side/INDEX.md
- docs/plan/2026-11-26-layer-split.md ★9
- docs/design/boards/2026-11-26-layer-split/LayerSplit.board.json
- tests/perf/scenarios/inline-whiteboard-split-100-open.json

> 这一页不出总分：机器数、真人数、护栏、未验证各看各的。
