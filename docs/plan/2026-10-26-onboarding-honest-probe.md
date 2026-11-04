# 设计卡：接入页说真话与免费连接自检

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：接入页免费自检与诚实状态词
线/负责人：fix/onboarding-honest-probe / Codex
类别：[花钱][新界面]

### 功能分类
- [x] 新界面 / 改交互
- [x] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

| 格 | 结论 | 证据 |
|---|---|---|
| ★0 先查别人 | ① 一款商业 API 平台的官方 Models API 用带鉴权的 `GET /v1/models` 列出可用模型，不调用生成接口；确认自检应优先走模型列表。② 一款开源模型路由服务的官方 Models API 用 `GET /api/v1/models` 和 Bearer token 返回模型及价格元数据；确认自建中转的免费路应复用同一类 GET。③ 一款原生对话 API 的官方文档把 `GET /v1/models` 定义为列出可用模型，并把可生成消息的接口另列；确认仅在主机名明显属于该协议时才返回 Anthropic 判断，不能用免费 GET 猜 OpenAI chat 与 Responses。 | [商业 API Models API](https://platform.openai.com/docs/api-reference/models/list)、[开源路由 Models API](https://openrouter.ai/docs/api/api-reference/models/get-models)、[原生对话 Models API](https://docs.anthropic.com/en/api/models-list)；结论改变了探测端点、自动判断范围和按钮文案。 |
| ★1 用户怎么用 | 当创作者在接入页填写自建中转地址与 key，我想点“测试连接”确认地址、认证和模型列表请求能通，以便在真正生成前发现配置问题。步骤：填写地址 → 填 key（或选择无 key）→ 选择模型/协议 → 点测试连接 → 读“连接正常”或可行动错误 → 首次在画布生成作为真实试跑。真实任务：OpenAI 兼容自建中转；Anthropic 兼容中转；只接图片/视频模型的 ComfyUI/网关。这里不做真实生成、不猜 OpenAI chat 与 Responses、不把连接自检写成已出片。主指标：自检请求不发 POST；信号：环回夹具记录的方法/路径；指标：四分支 POST=0。质量指标：中英状态词不出现 verified/tested/已验证/已测试；信号：词表测试；指标：命中数=0。护栏指标：协议不匹配错误继续指向“接口协议”；信号：错误文案测试；指标：四类错误均含下一步。缺少真实供应商额度量具：付费账单不验证。 |
| ★1b 连带界面 | 设置页模型详情：`readyVerified` 显示“自检通过，还没试跑 / Checked — not tried yet”；自动适配完成也显示“还没试跑”；模型状态和卡片状态只说“自检通过 / Self-check passed”。接入向导测试按钮旁不再展示“会发送一次测试请求”的花钱提示；成功结果只说连接或可达性，自动协议只在 Anthropic 主机名判断时显示。 | `src/ui/onboarding/ModelAdapterStatusSection.tsx`、`src/ui/onboarding/OnboardingWizard.tsx`、i18n 词表；中英走查截图与词表测试。 |
| ★2 谁说了算 | 免费连接自检策略 owner = `electron/catalog/credentialProbePolicy.ts::credentialProbePlan`；模型列表出站 owner = `electron/ai/onboarding/modelListProbe.ts::fetchModelList`；接入 IPC 只投影策略和结果，不重新判断费用。`spend.pending-identity` owner 仍为 `electron/shared/contracts/pendingSpendConfirm.ts::PendingSpendConfirm`，本次只删新手 ComfyUI 无用令牌及登记文字。单一事实各一份；没有用状态消失来猜用户意图。 | `node scripts/door-map.mjs credentialProbePlan probeOneProtocol runTestGeneration runTask mintSpendGrant --roots=electron,src`；门表和根因合同。 |
| ★3 一致与复用 | 复用已有 `credentialProbePlan`、`fetchModelList`、`buildAuthHeaders`、`upstreamErrorText`、`isComfyuiVendor`；删除 `probeOneProtocol`，不留并行协议探测。状态文案只改已有 i18n 键，不另造词表。 | `git grep`；`check:self-written`；`electron/ai/onboarding/modelListProbe.ts`、`electron/catalog/credentialProbePolicy.ts`。 |
| ★4 全状态 | 空：按钮可点，说明是可选自检；加载：显示“正在检查 / Checking”；成功：显示“连接正常 / Connection successful”或“地址可访问 / URL reachable”，不声称生成；失败：保留 HTTP/网络原因并指向检查地址、key 或接口协议；部分成功：模型列表成功但没有可选文本模型时说明只检查了可达性；取消中：沿用 AbortController 超时后的错误态，不新增生成任务；过期：自检结果不持久化为生成证据，回到未试跑状态；能力不可用：桌面桥缺失显示“当前环境无法运行 / Desktop runtime unavailable”，下一步是使用桌面端重试。所有文案走中英 i18n，不写“没扣费”断言。 | `check:i18n`、连接测试单测、隔离 Electron 走查截图。 |
| 5 中途表 | 状态 × 打断：空/加载时关闭窗口→没有请求或请求由 AbortSignal 终止，回执在向导状态；成功后关闭→结果只留当前 UI，不转成生成证据；失败后关闭→不写连接配置，回到表单可重试；断网→网络失败原因，重试按钮仍在；重启→保存仍只保存本地连接，下一次测试重新走 GET；连点→按钮 loading 禁用，最多一个请求。所有情况都是 GET 模型列表或无请求，试跑/付费生成仍由画布真实操作触发。 | `onboardingIpc.test.ts`、隔离走查；人工核对。 |
| 6 外部数据与失败 | 用户地址、key、额外 header、代理是外部输入；模型列表 API 规范以 OpenAI/Anthropic/OpenRouter 官方链接为基准，解析失败显示可操作错误且不把响应体当成功；404/405 只提示检查地址/模型列表路由；真实生成阶段若协议不对沿用现有“在接口协议中切换”错误。未知失败不归咎于 key。 | `modelListProbe.ts`、官方文档链接、`upstreamErrorText`。 |
| ★7 性能 | 不适用：本次只把一次连接按钮的出站从 POST 探测改成已有 GET 模型列表，并删除一条循环请求；没有新增交互类型或性能预算。 | 现有 `modelListProbe` 单测；无新性能场景。 |
| 8 真实条件 | macOS 英文/中文两轨隔离资料走查：设置页模型详情“自检通过”态、向导测试连接成功态；环回 HTTP 夹具记录收到的请求。Windows、真实供应商、真实付费、干净安装未跑，标记 `unverified`。 | 截图路径写入交付报告；走查脚本/人工。 |
| ★9 验收与回滚 | 验收清单：①强制 openai-compatible、强制 openai-responses、自动普通主机名、自动 anthropic 主机名/只可达性四分支均只收到 GET、POST=0；②自动普通主机名不返回 Responses/chat 协议结论，Anthropic 主机名只返回 anthropic；③中英 `readyVerified`、`verified`、`modelState.verified`、`cardStatus.verified` 不出现已验证/已测试/verified/tested，且 readyUntested 改说“自检”；④ ComfyUI 候选 key 通过 `isComfyuiVendor`，新手页不再铸 grant；⑤登记例外过期模拟今天后门岗退出非 0。反例：恢复 `probeOneProtocol` 或 POST→测试红；恢复“已测试，可以使用”→词表测试红；把到期日改到昨天→到期测试红。回滚：按实现提交整体 revert；没有数据迁移。独立验收：待协调派验收线。 | 改动单测、`check:concept-owners`、到期门岗测试、`git diff --check`、截图 Read 证据。 |

### 系统改进
- 删掉 `probeOneProtocol` 和自动逐协议 POST 探测，结构上不再有该出站路径。
- `nomi:onboarding:test-connection` 统一由 `credentialProbePlan` 选择免费模型列表路；普通自建中转默认 `openai-compatible`，不再从 GET 猜 chat/Responses；Anthropic 仅按现有 hostname 判据返回该判断。
- 扩展现有 `check:concept-owners` 门岗读取 `spend.pending-identity` 的例外到期日，到期即红；不新起门岗脚本。
- `isComfyuiVendor` 已核实候选 key（`comfyui-local--candidate-*`）命中 `comfyui-local-` 前缀，删除无消费令牌不会改变本地 ComfyUI 付费行为。
