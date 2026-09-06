# Agent 面板 v4 · 设计定稿（2026-09-06 用户拍板：「画布的设计没有问题」）

状态：✅ 已拍板 · 待实施（设计实验室先行）

画布：https://claude.ai/code/artifact/87799f18-02a5-400a-abaa-28aaa097e6ed（12 板）。源文件在 `docs/design/mockups/2026-09-06-agent-panel-v4/src/`（`build.mjs` 读 `src/theme/nomi-tokens.css` + `_agent.css` 生成 `*.dc.html`；改设计改 `*.body.html` 重建，不手改产物），每板预览 PNG 在 `preview/`。

## 底子（三样，缺一不可）
1. **Nomi 设计系统**：token 原样引用（`--nomi-*`），Tabler icon，密度优先，暗色 = token 翻转（`data-mantine-color-scheme="dark"`）。
2. **MiniMax Design 实测**（`docs/research/2026-09-06-minimax-design-agent-usage/`）：任务卡带完整状态、附件读取轨迹、复杂操作的确认与恢复闭环；我们要赢的：每张卡带花费、停止真停、错误带原因、真实 token。
3. **AI Elements（Vercel，Apache-2.0）+ Beautiful UI（MIT）**：解剖和长相；思路参照 Claude Code 自己（一行收据 / 思考行秒数 / 权限模式 / 清单 / 上下文环）。

## 拍板清单
| # | 决定 | 备注 |
|---|---|---|
| 1 | **只有 8 个积木**：用户气泡 · 助手文本 · 一行收据(Tool) · 任务卡(Task) · 介入槽(Confirmation+Plan) · 队列行(Queue) · 收起坞 · composer(+Context 环) | 原 21 形态全是这 8 个的状态组合；状态只改行尾，位置与 icon 不动 |
| 2 | **权限只有一个控件，三档「每步问 / 自动改 / 全自动」**，默认「自动改」 | 照 Claude Code default / accept edits / bypass；直接对应 `approvalPolicy.mode = step / safe-auto / project` + `spend = confirm / within-budget`，不新造。「改选中」删除（范围由选中 chip 决定） |
| 3 | **介入槽按钮只有「确认 / 不要」**，槽头「不再问 →」= 当场抬一档 | 工作方式与介入档合并为一个概念；不可逆与花钱永远逐次问 |
| 4 | 工具调用**内联在对话流**，不置顶；默认收起，› 展开输入/输出；失败留原行不弹窗，付费标「未扣费」 | |
| 5 | composer：一个「+」收任何文件；无语音；**模型钮只显示模型名（无 icon）**并管图片/视频/音频三类默认预设；Skill = 引用 chip | |
| 6 | **composer 高度**：初始一行 ≈ 84px；随内容逐行长；上限随面板高度 derive（≥800→40%，640–800→30%，<640→6 行，收起坞 6 行）；封顶内部滚动且滚轮不外泄；Enter 发送 / Shift+Enter 换行 / IME composition 不发 | 现役空框两行半高要改回一行 |
| 7 | **过程反馈 7 时刻**：发出 → 思考(shimmer+秒数) → 调工具(同行变收据) → 完成/失败(只换行尾) → 流式(光标) → 打断/排队 | 每刻只一个东西动，动的旁边有动词，动词配固定 icon |
| 8 | **icon 标动的对象**（文稿 / 时间轴 / 节点 / 图 / 视频 / 音频 / 剪辑 / 转场字幕音量 / 技能 / 起草 / 导出），状态只用 spinner ✓ ⚠；禁用：机器人头、闪光、芯片、沙漏、纯转圈 | 画布评论修正：读取时间轴用 timeline icon |
| 9 | **Markdown 沿用 `NomiMarkdown` compact 档**，面板档显示决定：标题降粗体行、代码块加复制+超 12 行折叠、内外链区分、**图片不渲内联走任务卡**、超长折 60%、流式不预测闭合、不做数学/mermaid | |
| 10 | 多候选 = 任务卡里点一张采用，不是介入槽；反问 = 介入槽一行文字 + 选项 chip；计划卡 = 介入槽可展开 | |
| 11 | **收起态 = 右上角一枚 Nomi logo 钮 + 状态叠在 logo 上**（空闲不叠 / 运行中呼吸点 / 待确认数字角标（介入槽条数）/ 刚完成短暂勾号 2.4s / 失败警示角标）；点它展开，hover 冒一行状态字；底部 composer 坞保留 | **2026-09-06 用户改**（改的是本表原先那条「收起坞 = 右侧 32px rail + 两颗 icon」）。理由：收起的意思是把屏幕还给内容，一条满高的 rail 还占着一整列，而它上面「对话 / 面板设置」两颗 icon 指的是同一个动作。血统沿用 Nomi 一直延续的那枚角标（`src/ui/app-shell/CollapsedAiChip.tsx`：同一枚 `NomiLogoMark`、同一句「有动静才冒角标」），用 v4 的 token 与构件重做，不复活旧组件。状态词表单一 owner：`src/workbench/ai/v4/agentPanelV4DockStatus.ts::V4DockStatus`，优先级 待确认 > 失败 > 运行中 > 刚完成 > 空闲。历史/展开等动作留在**展开态**头部 |

## 可行性（实查 file）
收据 ← 无损历史 message parts（#515）；任务卡 ← productionRun 投影 `nomi_get_run`；介入槽 ← `InterventionSlot`（#507/#514）+ `propose_edit_plan`；权限 ← `electron/shared/projectAgentContracts.ts`；撤销 ← `undo_timeline_edit`；token ← `src/workbench/ai/agentUsageStore.ts`；收起坞 ← `src/workbench/ai/v4/AgentPanelV4Dock.tsx`（下沿 composer 坞 `V4CollapsedDock` + 右上 logo 钮 `V4CollapsedLogoDock`，血统 `ResidentCollapsedDock` / `CollapsedAiChip`）；Markdown ← `src/workbench/common/NomiMarkdown.tsx`。要补的四段：反问 kind、队列暴露 + 插队/删、代码块复制折叠、图片→chip。

## 落地纪律
- AI Elements **vendor 进仓改成 token**（它是 React 19 + Tailwind 4 + shadcn + AI SDK 5，我们 18 + 3 + Mantine + AI SDK 4），不装包、不并行两套样式；栈升级另立项（先 React 19 + AI SDK 5，Tailwind 4 最后；Mantine 7.13 对 React 19 支持未查）。
- 设计实验室按「积木 × 状态」注册（`design-lab.html?screen=agent-panel`），截图与画布逐板对账，用户拍板后才更新基线。
- 迁移：旧面板整体隐藏（不可达）→ 真机走查 → 同一轨里删旧。不留并行版。
- 最终验收用真实用户 case（真项目/真素材/真模型调用），见 `docs/lessons/`。
