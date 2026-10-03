# 0.24 技术栈线：框架对照欠账的归属与新到期日

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 范围：只定「每笔框架对照欠账跟哪一步走、什么时候到期」。不改任何产品代码，不删欠账，不抬任何基线。

## 为什么要这份文档

`docs/engineering/framework-boundaries.json` 里有 8 笔带到期日的欠账（4 笔参考实现对照，3 笔 React Flow 接触面，外加框架条目本身的复核日）。其中 `ai`、`xyflow-react` 两笔 2026-10-07 到期，到期当天 `check:framework-boundary` 变红，所有 PR 都合不进去。

这两笔欠账的前提已经变了：Agent 的底座是 pi，不是 AI SDK；对照报告（`docs/research/2026-09-29-agent-message-layer-conformance/report.md`）已经交出了「AI SDK 到底要不要接、先后顺序」的结论。技术栈这条线因此从 0.23 推迟到 0.24，欠账顺延，并且每一笔都绑到 0.24 里具体的一步上，不再是悬空的日期。

## 先查别人

这份文档不引入新实现，只重排已有欠账的归属与日期；排序依据是已经合入的调研，不是凭记忆。

- 仓库里已有：对照报告 `docs/research/2026-09-29-agent-message-layer-conformance/report.md:411`（第 8 节「顺序和大小」）给出了 A / B / C1 / Step 0 / D 的先后与风险，本文的 S1–S6 逐步照抄它的顺序。
- 仓库里已有：到期判据由门岗自己定义，`scripts/framework-boundary-lib.mjs:207`（债条目 `due < today` 即红）与 `scripts/framework-surface-lib.mjs:237`（接触面债同理），本文只改数据、不改判据。
- 生态：Vercel AI SDK 的版本线与迁移说明，https://ai-sdk.dev/docs/migration-guides ——v6 / v7 的取舍留给 S5，不在本文裁决。
- 生态：AI Elements 的安装前提（Tailwind 4 + shadcn），https://elements.ai-sdk.dev/ ——S6 先评估它与 token-only 设计系统的冲突，再决定接不接。
- 结论：用已有——只做日期顺延与方案绑定；没做：不重新评估技术选型，那是 S5 / S6 各自的方案要写的内容。

## 0.24 的顺序

前四步是 Agent 消息层本身，后三步才是技术栈。依据是上面那份对照报告第 8 节。

| 步 | 内容 | 欠账归属 |
|---|---|---|
| S1 | 付费卡①：批准范围 = 派发范围、回执读 Run 状态、参考图、失败文案 | 无（领域修复，换不换框架都保留） |
| S2 | 付费卡并进对话投影：不再轮询，卡的内容在投影时 join | 无 |
| S3 | 一次工具调用一条：一个调用合成一个 part，字段名对齐 `ToolUIPart` | 无 |
| S4 | 两台发动机收敛（主进程文本任务栈与 pi 运行时） | `pi`（G-06 旧形状 tool call 折旧、G-07 路径参数 containPath、G-10 以后的 conformance 缺口） |
| S5 | AI SDK 主版本裁决：v6 / v7 / 主进程不再装 `ai` / 暂不装 | `ai` |
| S6 | Tailwind 4，再评估 AI Elements；换之前先评估与 token 设计系统的冲突 | `@mantine/core` |
| S7 | 画布内核（React Flow）对照与接触面三笔债清账 | `xyflow-react` 及其接触面 `onError` / `colorMode` / `ariaLabelConfig` |

S5 到 S6 的先后不能颠倒：`package.json` 里只能有一个 `ai`，AI Elements 主干依赖 v6，先定 v6 还是 v7 才知道 AI Elements 能不能用。S6 之前不引入 AI Elements 的任何组件。

## 新到期日

| 欠账 id | 原到期 | 新到期 | 跟哪一步 | 为什么是这一天 |
|---|---|---|---|---|
| `pi` | 2026-10-15 | 2026-11-15 | S4 | S1–S3 合入后开 S4；pi 债剩下的是清掉 24 条缺口里还没销的那几条，S4 收敛两台发动机时一并落 |
| `ai` | 2026-10-07 | 2026-11-30 | S5 | S4 之后才有稳定的主进程边界可以谈 `ai` 升到哪一版；对照文档已有，债剩下的是裁决与落点 |
| `@mantine/core` | 2026-10-31 | 2026-12-31 | S6 | 和 Tailwind 4 / AI Elements 的评估同一窗口；组件层离「重造框架能力」最远，排在最后 |
| `xyflow-react` | 2026-10-07 | 2026-12-15 | S7 | 画布内核对照不阻塞 Agent 线，排在技术栈之后 |
| React Flow 接触面 `onError` / `colorMode` / `ariaLabelConfig` | 2026-10-15 | 2026-12-15 | S7 | 同上，三条挂在 `xyflow-react` 名下 |

`framework-boundaries.json` 里 `promotion.reviewDue`（2026-11-07）不动：它是 advisory 升红的复核日，不是欠账到期日。

另有两条与技术栈无关、但同在 2026-10-07 到期的欠账在 `docs/engineering/standard-formats.json`（MCP 配置块与 tools/list 的夹具欠账），属于 R31 外部格式规范线。本次只把它们顺延到 2026-10-31，保持原方案绑定（`docs/engineering-rules.md` R31），不改其他字段。

## 做法

1. 只改 JSON 里的 `due`，并在每笔欠账上加一个 `plan` 字段指向本文，`why` 末尾追加一句顺延说明。
2. 不删欠账、不改 `doc` 约定落点、不改任何基线文件。
3. 每笔欠账到新到期日仍然会红：这是承诺不是豁免。到那天要么交出对照与清账，要么带理由再顺延一次，并更新本文。

## 回滚

纯数据改动：`git revert` 这一次提交即回到 10-07，但回滚后 10-07 当天门岗会红。

## 验收门

- `pnpm run check:framework-boundary` 与 `pnpm run check:framework-surface` 本机绿。
- 反向验证：把时钟注入到到期日之后（见 PR 正文的做法），两道门必须仍然会红，证明顺延没有把到期检查关掉。
- `git diff` 里除 `due`、`plan`、`why` 追加句外没有别的字段变化；没有删除任何欠账条目。
