# 方向检查：批量出图不卡死

## 0. 一句话根因
本机拒绝与服务商失败混进 unknown，动作、刹车和模型健康因此失真；整方案比对把系统自动引用当成人改稿，队列与节点状态不同源，画布 Run 没接到已有的人工释放出口。

## 1. 归类表：bug → 直接原因 → 类
| bug | 直接原因 | 类 |
|---|---|---|
| 批量出资产后停住 | 09-20 的整方案比对早于 10-05 的自动引用，任意一镜变化拦整批 | 比对范围越过动作所有权 |
| 撞限后整表卡住 | quota 计入连续失败，单卡依赖整表 busy | 调度与交互状态混用 |
| 结果不明重启仍不能重发 | 0.24 的画布 Run 未接人工放行，nodeIdOfJob 不认 origin | 既有出口漏入口 |
| 排队被改或重复生成 | 队列不写 node.status，引用和单发看不到排队 | 多份状态来源 |

## 2. 为什么这一类会一直出现
不变量没有落在共享边界：编辑器和 Agent 各自比整份方案；同节点去重未在提交咽喉集中；错误 kind 无法表达本机拒绝；释放只认制作元数据。
落在体验铁律 ⑫（点了=以为的）：逐入口的实际观察和假服务商 POST 次数由设计卡 ★9 的 A1–D3 核对。逃逸账本仅在类检查和真实走查有证据后结账。

## 3. 不改结构会冒出什么
| 预测 | 验证 |
|---|---|
| 另一个镜头被自动补引用仍会阻止当前镜 | A4/A5/A10 |
| 换一个入口单发同一排队节点仍会重复派发 | B3 的分镜、画布入口 |
| 老的画布结果不明 Run 仍找不到重发节点 | C4/C6/C7 |

## 4. 靶子独立性检查
合同由协调会话提供，用户 11-02 已批准；实现线只按原文自验，不改合同凑绿。独立验收留给另一条线。实现测试和反例均由本线执行，不能替代独立验收。

## 5. P0：这些是我们独有的吗
分镜目标/节点绑定、一次批准的输入、按镜头花钱和人工核对是 Nomi 领域约束。复用现有 autoReferencePlan、cancelEntry、Run 账本、job.reconcile、NodeErrorReport 确认条与稳定 JSON；不引入库、不自写新的队列或状态机。
队列/重试通用能力的对照已在原设计卡 ★0（client-go、LiteLLM、AWS、Temporal、InvokeAI）；本刀不重做它们，因为只修领域边界接线。
自写登记：本次 fix-churn 未点名自写登记 id，故无被触发登记需要保留或替换。

## 6. 接入 / 补 / 重写 / 删对比
| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入框架 | 整体换运行与队列 | 越过合同 | 请求/状态机迁移 | 否 |
| 补 | 各调用方分别忽略自动引用/锁 | 小改但继续分叉 | 另一个入口复发 | 否 |
| 换 | 共享窄比对、kind 替换、提交口去重、已有出口接通 | 覆盖所有调用与反例 | 需确认保护仍在 | 是 |
| 删 | 删掉内容保护 | 最少代码 | 用户改稿仍按旧输入花钱 | 否 |

## 7. 用户要权衡的核心
让不相关镜头继续，同时仍挡住这一镜自己改过的旧批准；结果不明只允许人工核对后重发。
这是换和删，不再加特例。用户 11-02 已批准碰热点（包括 classifyError.ts、NodeErrorReport.tsx、taskApi.ts）。

## 特征测试清单
设计卡 ★9 的类级测试先红后改；原始输出与逐条反例放交货报告。尚未执行的项目不得写通过。

## 热点原始输出
```text
【方向检查 · RW】这一刀碰的地方已经被反复修，先别再补：
  · src/workbench/creation/storyboard/StoryboardPlanEditor.tsx：目录 src/workbench/creation/storyboard/ 近 14 天已有 5 个 fix（只涉及 5 个文件，算同一概念），这一刀是第 6 个
  · src/workbench/creation/storyboard/exec/storyboardRowActions.ts：目录 src/workbench/creation/storyboard/exec/ 近 14 天已有 3 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/capability/storyboardPresent.ts：目录 src/workbench/capability/ 近 14 天已有 7 个 fix（只涉及 6 个文件，算同一概念），这一刀是第 8 个
  · src/workbench/generationCanvas/runner/generationRunController.ts：目录 src/workbench/generationCanvas/runner/ 近 14 天已有 18 个 fix（只涉及 5 个文件，算同一概念），这一刀是第 19 个
  · src/workbench/generationCanvas/nodes/NodeErrorReport.tsx：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/api/taskApi.ts：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/api/taskApi.ts：目录 src/workbench/api/ 近 14 天已有 8 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 9 个
  · src/workbench/observability/classifyError.ts：文件近 14 天已有 9 个 fix，这一刀是第 10 个
  · src/workbench/observability/classifyError.ts：目录 src/workbench/observability/ 近 14 天已有 11 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 12 个
  · src/workbench/observability/narrate.ts：文件近 14 天已有 7 个 fix，这一刀是第 8 个
  · src/workbench/observability/narrate.ts：目录 src/workbench/observability/ 近 14 天已有 11 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 12 个
  · 概念「画布付费生成（一镜一个单镜 Run）」：含 6 个文件，近 14 天已有 6 个 fix，这一刀是第 7 个
  · 概念「生成错误怎么说成人话（错误 → 人话与动作）」：含 4 个文件，近 14 天已有 11 个 fix，这一刀是第 12 个
动作：停止派 / 打修补，先做「类根因复盘」（模板 docs/engineering/direction-check-template.md，产出一页文档），结构性结论交用户拍板（例外：只因概念 / 目录 / 自写登记口径命中、文件本身没命中，且改法是换或删、不新增分支——由协调代批、事后报用户）；复盘前先写特征测试钉住现状。
提交 fix 时在信息里加一行 `Direction-Check: <复盘文档路径>`（git commit-msg 会校验）。
```
