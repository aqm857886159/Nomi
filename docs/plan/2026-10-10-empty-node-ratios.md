# 空节点排版随宽高比变形（设计卡，10-10）

改动名：空节点视觉中心排版（B）+ 三档收矮 + 样张比例派生    线/负责人：D-ratio / 协调会话    类别：[其他]

来源：用户 2026-10-10 原话「图片节点上面的 logo 和引导，会根据不同比例导致排版变化，这个设计没考虑到」。三方案样张（现在 / A 上下居中 / B 视觉中心）见 `docs/evidence/2026-10-10-empty-node-ratios/`，用户选 B。拍板记录见 `docs/design/2026-10-08-approved-designs.md` 第 ⑧ 节。

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在画布上放一个空的图片或视频节点，我想一眼看到「生成从哪里开始」，不管节点是方的、竖的还是扁的。以便不用猜排版。做法：内容块中心放在卡高 45%，离顶至少 44px，水平居中；卡矮到放不下整块时，依次收成紧凑（图标 + 「类型 · 状态」一行 + 动作）和只留第一行。不做：不改动作内容、不改状态小标文案、不做 ResizeObserver 测量。已知坑：卡高未知的调用处（见 `NodeEmptyState` 的 `height` 参数）只能按完整档加 CSS 兜底定位。真实任务：在画布上放 1:1、9:16、21:9 的空图片节点，看 logo 与引导是否随比例落在同一视觉位置；放一个带「已去掉，不生成」小标的节点，看小标是否压到图标。 | 截图 `docs/evidence/2026-10-10-empty-node-ratios/zh-light.png`、`en-dark.png` |
| ★2 谁说了算 | 档位唯一 owner = `src/workbench/generationCanvas/nodes/render/nodeEmptyStateLayout.ts` 的 `emptyStateTier`（纯函数）；块位置与样式唯一 owner = `NodeEmptyState.tsx`。卡高来自节点的 `node.size.height`（节点模型唯一来源），调用方只把它传下去。 | `node scripts/door-map.mjs emptyStateTier` |
| ★3 一致与复用 | 复用现有 `NodeEmptyState`，不另写一套空态组件；比例清单复用生产 `COMMON_RATIO_ORDER`（`aspectRatio.ts`），样张不抄第二份。没有现成的「卡内按高度收矮」库可用，这是领域内的排版规则（块高、44px 小标让位都是 Nomi 节点的实测数字），自写。 | `src/devlab/designLab/emptyNodeRatios/labRatios.ts` |
| ★4 全状态 | 完整 / 紧凑 两档（「只留第一行」已删：用到的节点渲染高度下限 120 > 紧凑阈值 108）；卡高未知 = 完整档 + CSS 兜底；音频条 compact 横排不走档位（不动）；加载 / 失败 / 取消等状态由各占位自己负责，本次不改。 | `nodeEmptyStateLayout.test.ts`（边界 8 条） |
| ★9 验收与回滚 | 验收：另一条线跑 `pnpm run test:unit -- nodeEmptyStateLayout labRatios` 与 `pnpm run check:design-lab`，并在 darwin 上录基线后对照截图。回滚：revert 本分支提交（NodeEmptyState 与调用处同一提交，无并行版）。 | PR 正文「测试」「独立验收」 |

## 阈值（实测块高）

- 完整块 114px、紧凑块 56px。
- 完整 ≥ 166 = 44 + 114 + 8；紧凑 < 166（渲染高度下限 120）。紧凑阈值 108 = 44 + 56 + 8，低于下限，所以紧凑档对所有现有节点成立。
- 档位输入是渲染有效高度（resolveNodeVisualSize），不是存的 size.height：存的 240×103 渲染成 240×120。
- 比协调会话最初给的「约 150 / 约 90」高，是因为把 44px 离顶让位算进去了。

## 连带界面

- 空图片 / 空视频 / 空文本 / 空剪辑 / 空白板 / 全景上传 / 角色道具场景上传：全部走同一个 `NodeEmptyState`，视觉都会按 B 移动（这是本次要的）。
- 音频条 compact 不动。
- 设计实验室里其他引用 `NodeEmptyState` 的屏（canvas-handles、node-quick-actions、version-cards 等）的视觉基线会过期，需要在 darwin 上重录；本次不在 Windows 上录。

## 按钮普查（ui-click-census）

空节点动作行里的配方按钮（唯一定义在 `quickActions/nodeTryRecipes.ts` 的 `RECIPES`，组件 `NodeTryList` 只读它）。七字段：

| 按钮（测试 ID） | 设计来源 / 组件 | 变体 / 状态 | 无障碍角色 + 名称 | 用户动作 | 预期界面状态与副作用 | 证据 |
|---|---|---|---|---|---|---|
| 文字生图（`image.text`） | 拍板稿 EmptyStates「试试」/ `NodeTryList` | 默认；有模型且有文生图方式时可用 | button，名称「文字生图」 | 点一下 | 有模型：切到文生图方式（一步撤销）；无模型：不切换；两种都选中节点并聚焦提示词 | docs/evidence/2026-10-10-empty-node-ratios/zh-light.png |
| 参考图生图（`image.reference`） | 同上 | 可用条件：节点能收图（连线判据） | button，名称「参考图生图」 | 点一下 | 往上游接一张图片节点（一步撤销），切到收图方式，聚焦提示词 | 同上 |
| 首帧生视频（`video.firstFrame`） | 同上 | 可用条件：能收图 且 有首帧方式（无模型时只看能收图） | button，名称「首帧生视频」 | 点一下 | 有模型：切到首帧方式并接图；聚焦提示词 | docs/evidence/2026-10-10-empty-node-ratios/zh-light.png（视频行） |
| 首尾帧生视频（`video.firstLast`） | 同上 | 可用条件：能收图 且 有首尾帧方式（无模型时不限） | button，名称「首尾帧生视频」 | 点一下 | 接首帧和尾帧两张（一步撤销），聚焦提示词 | 同上 |
| 文字生视频（`video.text`） | 同上 | 可用条件：有模型时需要文生视频方式；无模型放行 | button，名称「文字生视频」 | 点一下 | 有模型：切到文生视频方式；无模型：不切换，聚焦提示词 | 同上 |

## 能力不可用（ui-capability-unavailable）

- **没有可用模型时**（没装模型、目录为空）：动作行**照常显示**同样的按钮（`modelAllows` 在没有生成方式时直接放行），按钮没有灰掉，也没有说明原因。点击只会选中节点、聚焦提示词，不会弹出任何「为什么没反应」的提示。
- 这是已知缺口，不是这次样张能解决的：按 ★4「能力不可用要说原因、下一步」，应该在动作行给出「没有可用模型，去设置添加」之类的一句话，或灰掉并写原因。未做，留给后续线。
