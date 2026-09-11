# Agent 对话交互微细节研究：消息解剖 / 状态机 / 确认 / 错误 / 追问

> 2026-09-09 · 上篇[交互设计研究](2026-09-09-competitor-interaction-design-study.md)回答「界面为什么长这样」；本篇下沉到**一条消息内部**的颗粒度。
> 方法：OpenChatCut `src/components/chat/` 逐组件源码直读 + ChatCut 官方 known-errors/widget-forms/文档站规则实抓。全部带证据，推断标注。
> 用途：Nomi agent 面板（v4/laneViewModel）改进的交互规格输入——直接服务 P0-1·A2（审批卡）与后续对话体验。

---

## 一、一条 agent 消息的解剖（OpenChatCut 源码级）

| 元素 | 细节（全部源码实证） |
|---|---|
| 用户气泡 | 右对齐，maxWidth 86%，`pre-wrap`；**重试按钮在气泡下方**（running 时禁用变暗）——重试入口跟着发起者走，不在失败卡片里 |
| 工具行 | `7px 圆点（绿=成功/红=失败）+ 等宽字体工具名 + 参数摘要`；摘要有**固定优先级键表** `SUMMARY_KEYS=['query','itemId','templateName',…,'target']`，uuid 只取前 8 位，超 26 字符截断加 `…`；**整行 title=完整 args JSON**（hover 看全参，不占版面） |
| 工具聚合 | 同名工具聚合为 `● name · N 次 ▸`，**任一失败整组红点**；展开后缩进列逐条渲染，保留各自摘要 |
| Thinking | 默认折叠块，展开后 180px 高度内滚、斜体等宽 |
| 静默行 | `note` 角色=灰色系统字（如工具失败但整轮完成的提示）；`continue` 卡=「已连续执行 N 轮工具，先停一下确认方向。」——**agent 自发节奏控制进对话流** |
| 运行中 | liveTool 行：accent 色脉冲圆点+工具名+`partial` 流式参数片段；无工具时「思考中…」+**0.1s 步进的耗时计时器**（tabular-nums） |
| 完成反馈 | 流式中的回复**隐藏复制按钮，完成后才出现**；复制成功按钮点亮 1400ms——防复制半截文本的小设计 |
| Inspector | portal 弹层七态徽章（运行中/等待确认/等待回复/已完成/失败/已取消/已中断）五色；token 明细（含缓存命中率与未命中原因诊断）；工具结果最近 8 条；归档产物带 SHA-256。**无费用字段**（他们成本在别处显示） |

## 二、ProposalCard 精确解剖（我们计划卡的最直接模板）

- **header**：sparkles 图标 + 标题（缺省「编辑提案」）+「待确认」徽章 + summary + 右侧 `totalImpact`（hover 显影响范围）。
- **操作条**：`将执行 N / M 项` + 全选/清空（全开/全空时各自 disabled——状态可达性做进按钮）。
- **操作列表**：自定义 checkbox；未选项变暗；每项 = `action ×count`（count>1 才显示）+ target（超长 ellipsis+title 全文）+ 工具名 + 单项 impact。
- **预演 toggle**：「预览结果」→ 点击后文案变「预览中」+点亮圆点；Apply/Reject 前强制关预览；**全不选时 Apply 禁用**。
- **stale 三选**：黄色 alert「工程已在提案生成后发生变化：直接应用可能落错位置。」+ footer 变为 **取消 / 重新提案 / 仍然应用**。
- ApprovalDetails：只读明细网格（label 10.5px dim / value 11px code），附操作 ID 与参数摘要 digest；三项全空整块隐藏。

## 三、Composer 状态机（防误发做到按钮级）

- `canSend = 有文本 && !running && 附件导入完 && modelReady`；**四种禁用各有人话 title**（「请等待附件导入完成。」「正在读取模型配置…」等）——禁用永远带原因。
- running 时发送位换成**方形停止图标圆形按钮**（同位置换语义，不挪动）。
- 快捷键：Enter 发送 / Shift+Enter 换行 / Escape 关弹层 / **`/` 唤起技能补全**（`:skill:` 精确匹配 vs 松散匹配两级）；**选中技能不清空不注入文本，只设 creativeMode**——选择≠内容。
- `@` 引用 picker：锚定输入框、层级钻取（root→assets/timeline→track:id）、↑↓+Enter 键盘导航；chip=胶囊+类型图标+文本+×（title「移除引用」）。
- 附件：粘贴/拖拽双路，导入中有 pending 计数与 aria 状态行；拖拽 dragOver 高亮带层级计数。

## 四、错误呈现（OpenChatCut）

- 工具失败 = 红点 + 红色 `：{error}` **内联在行内**（不弹 toast 不跳转）；特判：结果是 `missing-model-packs` 时追加「去设置安装」按钮（带 settingsRoute）——**错误直达修复入口**。
- 整轮仍有产出时，失败用灰色 `note` 静默带过，不吓用户；运行记录里 `tool_outcome` **八分类**（校验失败/已拒绝/副作用前已中止/已过期/可重试/结果未知/终止失败…）——失败语义比「红/绿」细一层。
- `error` 角色 = `⚠ 文本` 红字行；停止/中断只在 Inspector 徽章体现。

## 五、ChatCut 的对话行为规则（文档原话级）

1. **known-errors 按失败域给行为红线**（不是文案模板）：Mutation 被拒→「不得强写或静默删冲突项」，改为判断顺序/分层/换轨或「问用户哪项该赢」；Generation 失败→**保留 provider 原始错误原文**、「不要重复烧 credit 重试、不要静默换模型」；Verification→「mutation 成功≠视觉证明」。
2. **widget-forms 的同意规则**：`explicit_consent` 必须**初始未选中**；「附件或另一个已提交字段永远不算同意」；相关字段**合并进一个表单**、提交后 agent 必须停下等答案；阻止性字段全部 required。
3. **Auto-Allow 设置**：按动图/视频/图片**三类独立开关** × Global/项目**两档作用域**；关掉即恢复确认流。确认卡四键：**Allow（本次）/ Allow all…（卡面写明范围）/ Deny / 调整字段**。
4. **沟通纪律**（talking-head-guide 原话）：「多个变量缺失时，用一个表单问，不要编号提问再补选项」；「每个大步骤后单独确认，不要把多个检查点捆进一条回复」；「解释内容、绝不解释索引」——禁用 `[sN]`/clip id 等内部地址，用用户原话引述；验证被阻断时「显式报告 blocker 并请用户去 live editor 自查」，**绝不许把失败验证伪装成完成**；汇报=结构证据+像素证据二者齐才可报成功。

## 六、映射到 Nomi agent 面板（P0-1·A2 及后续的规格输入)

| # | 采纳项 | 替代我们现状的什么 | 量级 |
|---|---|---|---|
| 1 | 计划卡=ProposalCard 结构：`将执行 N/M 项`+逐项勾选+单项 impact+totalImpact | 审批卡只列镜号需逐个展开（C0 摩擦①） | A2 主刀 |
| 2 | stale 三选+黄条文案（取消/重新提案/仍然应用） | 采纳桥已有 stale 语义，补 UI 三选 | A2 |
| 3 | Apply 前预演 toggle（预览中+点亮圆点） | 无 | A2 |
| 4 | 工具行参数摘要键表（优先级键+uuid 截 8+26 字截断+hover 全参） | lane 工具行（已有雏形，补摘要规则） | 小 |
| 5 | 失败内联红字+直达修复入口（missing-model-packs→设置按钮模式） | 错误 toast/黑盒 | 小 |
| 6 | `tool_outcome` 八分类进运行记录 | 现有 receipt 粒度 | 中 |
| 7 | 四种禁用各有人话 title；同位置换停止按钮 | composer | 小 |
| 8 | 对话守则四条进 lane prompt：合并表单一次问/每大步单独确认/解释内容不解释索引/失败保留 provider 原文不静默换模型重试 | system prompt 装配（A3 同点） | 小 |
| 9 | Auto-Allow 三类×两作用域设置（对应我们 capability 颗粒度的审批偏好） | 既有 trustLevel（key_confirm/budget_only/confirm_all）可作映射参考 | 中 |
| 10 | 「continue 卡」式自发节奏控制（连续 N 轮工具先停下确认方向） | 无 | P2 |
