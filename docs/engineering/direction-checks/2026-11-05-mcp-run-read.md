# Run 读取按工具绑定面板

协调裁定：自写登记 `mcp-protocol` 命中 30 天 19 个 fix，文件本身近 14 天只有 1 个 fix；本次采用换与删，不新增按 target 隐藏面板的特例，符合 P1 协调代批例外。外部工具总数没有冻结数字，允许拆出 `nomi_run_read`；内部工具数量不变。

## 0. 一句话根因与规范三行

规范链接：[MCP Apps 稳定版 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#resource-discovery)、[OpenAI 数据与 UI 分离](https://developers.openai.com/plugins/build/chatgpt-ui#separate-data-processing-from-ui-rendering)、[工具声明参考](https://developers.openai.com/plugins/reference#tool-descriptor-parameters)。

我们的偏差：工具声明将整个 `nomi_read` 绑定到面板，调用结果却只有部分 target 含面板数据；稳定规范没有按本次结果省略字段来关闭工具已声明界面的机制。

偏差理由：把所有只读查询汇成一个工具时，错误地把宿主按工具声明的呈现当成按结果数据决定的呈现；官方建议仅呈现工具声明 UI。

## 1. 归类表

| 问题 | 直接原因 | 类 |
|---|---|---|
| 读项目、模型、画布出现空 Run 面板 | 名称级声明与 target 级结果判断分离 | 界面承诺没有由同一边界执行 |
| 有凭据但不可用模型被推荐 | 结果文本与计数从 keyStatus 重算 | 投影重建已有事实而失真 |

## 2. 为什么会出现

目录测试核对 UI 声明，结果测试核对 Run 数据，两者没有逐调用交叉验证；模型测试只有凭据缺失与成功样本，未覆盖 `usable:false` 且凭据正常的行。⑫点了=以为的适用于读工具实际呈现；⑪能选到适用于可用集合；⑩参数冻结不涉及本次只读契约。

## 3. 可验证预测

任一非 Run target 都能重复触发空面板，比较 tools/list 声明与其 tools/call 结果即可复现。任一模型行只要凭据正常，即使 `usable:false` 仍会被计入可用，双语结果测试可复现。无关宿主与模型名称不会改变这两个机制。

## 4. 靶子独立性

验收以已批准的非 Run 无面板、Run 保留面板及原始 `usable` 行为准，测试驱动真实 SDK 协议与结果投影；不从修复代码生成期望，不把纸面字符串检查当行为复现。真实外部客户端与模型回合另交协调验证。

## 5. P0 与依赖

UI 绑定是通用标准，采用官方 MCP Apps 的工具级绑定；沿用已安装的官方 MCP SDK v2。领域目录投影不能由 SDK 替我们决定哪些 Nomi 操作返回 Run，因此保留目录装配，不重写协议或增加依赖。登记 `mcp-protocol` 的其它替换计划不属于本次修改；退出条件是未来标准/SDK 能直接消费领域目录，仍保留动态描述、审批及结果脱敏边界。

## 6. 三条路

| 选项 | 做什么 | 代价与结论 |
|---|---|---|
| 沿原方向修 | 同一工具按调用关闭面板 | 未找到稳定标准依据，不采用 |
| 换一种做法 | run/run_events/artifact 迁到 Run 只读工具，只给它和 run_start 绑定 UI，同提交删除旧 target | 外部工具 +1；采用官方分离模式，协调已批准 |
| 删掉 | 整个 nomi_read 不再绑定 UI，不新增工具 | 读取 Run 丢面板，不符合批准结果 |

## 7. 用户要权衡的核心

为让普通读取不弹空面板且保留 Run 预览，宿主需发现一个新的只读工具，并可能首次询问该工具权限。

## 设计卡

类别：其他，修复外部读取契约；不改变面板界面、不发起生成、不改存量文件格式。

### ★0 先查别人

1. MCP Apps Resource Discovery（上文链接）以 `Tool._meta.ui.resourceUri` 绑定工具与 UI，确认采用工具级边界。
2. OpenAI Separate data processing from UI rendering（上文链接）仅给呈现工具声明 URI，确认普通读取与 Run 读取分开。
3. OpenAI 工具声明与结果参考（上文链接）将 outputTemplate 定为声明兼容别名，确认省略一次结果元数据不能撤销 UI 声明。

### ★1 用户怎么用

外部 AI 连接 → 取目录 → 读项目 → 读模型选型 → 读画布 → 读或发起 Run → 看 Run 面板。真实任务为查询已有项目、挑可用模型、继续已有制作任务；不读取真实资料，不调用付费接口。量具：`nomiMcpApps.test.ts` 逐工具逐 target 的 SDK 调用要求 UI 声明与成功结果投影一致率 100%；非 Run UI 绑定率 0；`mcpToolResults.test.ts` 中英可用集合与 `usable === true` 行一致率 100%。真实宿主表现与模型回合尚未验证，不拿夹具通过率代替。

★1b：保留面板样式，新增只读工具中英标题、描述与错误恢复指路；修改模型不可用的中英文原因和下一步。★1c：项目、模型和设置不迁移。重连宿主重新拉 tools/list；已连接模型使用旧 target 时返回参数错误，错误与目录描述指向新工具，不保留兼容 target。用户给 nomi_read 的总是允许权限不覆盖新工具，第一次读 Run 可能再确认一次；不绕宿主权限。

### ★2 谁说了算

`mcpToolCatalog.ts` 拥有目录、target 路由及 schema，`mcpProtocol.ts` 用同一个工具名集合控制声明与结果面板。`mcpToolResults.ts` 的模型清单只消费 `usable`，不从凭据推断。实施前 door-map 已盘点协议与结果的导出符号，继续核具体读取者、技能、指南和走查调用；所有外部传输汇到相同 SDK Server。

### ★3 一致与复用

保留已批准的读写分名、现有领域方法与参数形状；拆工具仅移动 Run 三个 target。沿用 `nomi_run_*`、`nomi_*_read` 命名家族，不增兼容分支。模型清单就地删除错误的重复判断，思路取自 #1388，感谢贡献者。

### ★4 全状态

非 Run 空、加载、成功、失败均不声明面板；Run 空事件、进行中、成功、取消中、过期与失败沿用现有投影，错误仍为工具错误。模型不可用保留原因，凭据正常但不可用提示检查接入，缺凭据才指向配置。旧 Run target 的参数错误给出新工具名；没有退回旧行为。

### ★9 验收与回滚

实现前：面板声明工具逐合法 target 调用、非 Run 目录无 UI、旧 Run target 错误能自恢复，以及模型 `usable:false`/缺失/true、全不可用/缺凭据的中英矩阵先红。实现后相同测试回绿，跑工具面、引用、预算、可达性及相关目录测试和 build；现有免费/fixture 工具评测先跑，付费命令交协调。反例覆盖非 Run 项目、模型、画布，Run 三种读取、启动、空事件、错误。回滚整组目录/引用/结果变更，不能仅回滚工具名。真实外部 AI 未验证需明示；四类独立验收不适用（不改面板、新 UI 或执行路径）。

## 特征测试清单

`nomiMcpApps.test.ts`、`nomiMcpProductionRuns.test.ts`、`mcpWireContract.test.ts` 已有目录与 Run 投影特征；补齐目录/成功结果的一致性矩阵。`mcpToolResults.test.ts` 已有双语文本与结构化投影特征；增加与原始 usable 相悖的反例。红绿原始输出保存在交付证据中。
