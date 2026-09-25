# B4 钱与凭据批修

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实现与验证进行中，未提交、未推送。

## 范围与基线
指定分支 fix/spend-guard-credentials-20260909；pnpm install、delivery:preflight 已通过，基线 b657d5c6907e7fbc64291540c7cb21c9969b5626。
只改预算、凭据、供应商身份解析、分镜执行反馈及共享确认；不动 electron/agentLane/**、src/workbench/ai/lane/**、reactFlow/**，不改模型档案。
回滚：按 scoped commits revert，不覆盖用户凭据或改写主线。

## 根因三问与同类扫描
所有项判 recurring：可由其他供应商、节点、旧项目或再次输入复现。

|条目|症状|直接原因（已查/待证）|类根因 / owner|
|---|---|---|---|
|C49|全局预算留空阻止付费制作，普通生成授权不绑定报价|全局设置混入制作就绪条件；spendGrant 只限制次数，light 会静默跳过确认|删除全局 maxSpend，保留本次报价授权；共享 vendor 出口必须消费本次授权，批内超额需重新确认|
|C50|供应商失效后身份自动改变|useNodeModelAutoSelect effect 写回替代 vendor；catalogTaskResolve 同样自动迁移|显式选择与可用性恢复混为一谈；显示和执行都必须保留选择，仅给用户主动切换建议|
|C56|401 后旧 key 丢失且显示已保存|KnownVendorKeyConnectPage.save 先停用 vendor，随后同步写 key；没有前置探针|主进程区分明确无效与不可达；401 保留旧值，不可达加密保存为未验证，UI 等待结果|
|C38|同名模型选到别家|dedupeByModelKey 按偏好选，buildModelEntryIndex 裸键只按目录首次出现|展示与落地缺少共享偏好序解析；显式 vendor 仍必须精确匹配|
|C52|等待开始时分镜行点击无反应|候选：StoryboardPlanEditor 显示 designs[0]，runAction 却在 activeStoryboardId 空时静默 return；另有 resolve 闸在 try 外|展示对象与执行对象必须同源，每次点击失败都要可见；待夹具复现|
|C05/C06|确认卡没有金额|confirmGenerationSpend 未传 pricing/details；describeGenerationCost 只算数量和 ETA|同一确认必须展示目录报价或目录未标价；人民币与积分不能偷换|

## 入口证据（rg）
命令：rg -n 'runTask\(' electron src --glob '!*.test.*' --glob '!*.json'
- 画布：generationRunController.confirmAndRunNode → catalogTaskActions.runCatalogTask → taskApi.runTask → taskIpcHandlers → runtime.runTask。
- 分镜：storyboardRowActions.generateShotRow → confirmAndRunNode / confirmAndRunPlan → 同上。
- 批量：batchPlanPreview.confirmAndRunPlan → generationRunController 的波次调度 → 同上。
- Agent：applyCanvasToolCall 与计划执行经 generation runner；仍须补全函数级调用证据。
- MCP：capabilityCore/appIntegration → renderer capability 执行 → generation runner；仍须补全。
- 其他：video/deconstructVideo.ts 两个 runTask；main.ts 任务执行闭包；integrationCertification/integrationSession.ts；tasks/comfyCandidateTest.ts。
凭据：KnownVendorKeyConnectPage / VendorOnboardCard / CustomVendorManage → preload upsertVendorApiKey → main registerSyncIpc → rendererCatalogMutation → catalogStore.applyApiKeyUpsert；导入/认证主进程也直接用 store，须扫描防止遗漏。
供应商：useNodeModelAutoSelect / catalogTaskResolve.resolveExecutableNodeFromCatalog；Agent reloadModels 清偏好一族待核对。
模型：agentPanelV4ModelRows.dedupeByModelKey / plannedNodeMeta.buildModelEntryIndex / availableModels.listAvailableModelsForAgent。

## 先查别人
- 现役报价算法 `electron/productionRun/shotPricing.ts:113`：复用 deriveShotPrice 的 base + spec 参数加价，不另造算法。
- 现役授权消费 `electron/spendGrant.ts:79`：保留 node scope / 原子消费，在该边界加本次报价约束。
- 现役零额度凭据探针 `electron/ai/onboarding/modelListProbe.ts:147`：复用真实认证失败分类，不凭 200 响应猜 key 有效。
- 官方报价来源 https://apimart.ai/api/marketplace/models?keyword=gpt-image-2&page_size=10 ：2026-09-09 再抓起价 $0.0085，不能把目录点数当美元或 CNY。
复用本仓预算账本 budgetLedger、价格 deriveShotPrice、现有 onboarding reachability 探针、已有 vendorPreferenceContract；不新增框架、不改外部协议。
价格语义继续核对目录声明与现役报价代码；不把积分假造成人民币。2026-09-09 18:20 新任务书覆盖旧硬预算方案。
指定总账增补文件读取成功但未找到 C49/C50/C56/C38/C52/C05/C06 编号；实际证据为 Nomi-switch-gate/artifacts/human-20260909/report.md 第 295 行起，用例 5/7/13。

## 验收
六类夹具保留红→绿日志到 spend-guard-evidence；C49 schema-v3 根因合同；隔离 profile 节点生成：金额确认卡截图，确认后真实出图一次，总额 ≤¥0.5；另留取消/拒绝证据。
完成修复后按锁运行 gates，只有 exit 0 才 push 并建指定标题 PR。MONEY-LAST.md 与 scratchpad 回执 ≤20 行。


## 共享提交边界实扫（本轮续查）
- 普通画布 / 分镜单行 / 批量 / Agent 计划：`generationRunController`、`storyboardRowActions`、`batchPlanPreview` → `catalogTaskActions` → `taskApi.runTask` → `taskIpcHandlers` → `runtime.runTask`。
- runtime 真正付费四分支：同步音频、mapping create（缓存后）、无 mapping 的媒体、文本；自定义脚本下沉 `customCallDispatch.runCustomCallTask`，均在 vendor 请求前调用 `tasks/taskSpend.consumeTaskSpend`。
- 图层拆分：`image/decomposeLayers` 同样经过该边界；本地 ComfyUI 保留已有次数授权，依据现役本地供应商分类不弹虚假付费卡。
- MCP 旧生成入口：`capabilityCore/core.generateProjectNode` → `gateway.confirmSpend` → 上述 runTask；`withPreApprovedSpend` / headless 只能给旧次数 grant，没有报价时仍会在共享付费边界要求确认，不能静默穿透。
- MCP 现役制作 run：`appIntegration` → `productionGenerationSubmission` → `submissionOutbox` → `adapter.submit`，**并不经过 runtime.runTask**。已有持久化预算账本和绑定报价的 authorizationEnvelope；`prepareProductionGenerationAuthorization` 由 job.price.maximum 合计本次上限，未提供全局预算时直接取该合计。保留此 run-owned 报价授权，不伪称所有入口经过同一个函数。
- 制作审批：移除 `missingHardBudget`；用户批准的是当次 envelope 的 budget.maximum，批内由 ledger reserve 拦超额。设置规范化直接丢弃旧 maxSpend，所有设置读取者不再带它入 run；run-local 的 policy.maxSpend 表示本次批准额度，保留。
- 关键金额事实：`catalog/types.ts` 把 pricing 定义成点数；tokenPricing 明确 USD/百万 token。普通卡显示目录点数或“目录未标价”，不造 CNY 换算。真实出图上限的货币依据仍待核实。

## 本轮证据
- 原 credential-red.log → credential-green.log：401/网络失败不写入；网络失败裁决已由 B4-fix 纠正（下节），旧证据仅保留历史。
- provider-red.log → provider-green.log：断开后的 lineage 替代也必须由用户主动选择。
- storyboard-red.log → storyboard-budget-green.log：可见草稿身份与执行身份一致，resolve 异常进入统一反馈。
- spend-red.log → storyboard-budget-green.log：留空全局预算不再阻断制作就绪。
- quote-red.log → quote-green.log / shared-boundary-green.log：批内超报价再问，拒绝不提交，并发不能共花同一余额。
- amount-red.log → amount-green.log：有价显示数额，无价明确标识，取消不传递 quoteId。红灯使用 HEAD 版 spendConfirm 暂存回放后完整恢复当前文件。
- preference-red.log → preference-green.log：HEAD 版索引不按偏好排序时红，当前共享排序绿。
- 模型档案、冻结区未修改；所有真凭据只允许隔离 profile 的正常应用解密，禁止输出。

## 续查结论与真人证据
- 2026-09-09 远端刷新并 fast-forward 到 2baa00d5e；暂存恢复完成，无冲突丢失。
- 旧 `plan.attach` / repository 的 run-local maxSpend 仍存在，但 `productionRunDriverOps.ts:437` 已明确退休 legacy writer（`legacy_generation_writer_retired`），不会通向供应商提交。现役制作只走 semantic generation.single-shot + authorizationEnvelope；不复活旧写入器。
- 凭据验证补齐 providerProxyUrl；配置代理的连接必须沿同一路由验证，credential-proxy-red → green。
- 401 即使供应商还在目录中也显示带原因/修复提示的手动切换建议；provider-401-red → green，点击前 updateNode 零调用。
- 人工 UI 操作隔离 profile：节点生成卡 → 取消，未开始生成；APIMart 坏 key 被拒绝，旧加密凭据摘要完全一致；自动化设置无硬预算控件。
- 官方价格表（apimart-official-price.json）：gpt-image-2-ext（gpt-image-2）1K 每张 $0.0085，2K $0.014，4K $0.021。真实节点 APIMart / GPT Image 2 / 1K / 1 张，只确认提交一次，已生成橙子图片（human-07-real-generated-image.png）。按 ¥8/$ 保守换算报价 ¥0.068；没有账户最终扣款回执，不将报价称作实际结算额。
- 目录 pricing 缺失，所以真人卡如实显示“目录未标价”（human-03）；有价金额分支由目录夹具测试证明，不更改真实模型档案来制造金额截图。
- 批量 ETA 使用运行器同一 concurrency 归一化值，并将依赖波次串行等待计入估算。
- 真人走查还发现长供应商名称把建议 toast 文案挤成竖排；在 src/ui/toast.tsx 共享组件允许换行，说明与动作独立成行，已重建并截图 human-10。
- R30 真实模型回合：工具写对 1/1（全部工具 2/2 成功），用户任务完成 1/2。首轮 DeepSeek TLS 失败保留；GPT-5.5 成功新增 GPT Image 2 节点、未出图。输入 41,114 token、输出 465 token；无最终账单。小样本结果见 real-agent-metrics.json。

## 最终门岗纠正
完整 gates 发现 main 巨壳新增四行和三份合同空风险数组。凭据异步 IPC 注册归回现有 onboardingIpc，保持 sender guard 与结果 envelope，不新增注册器；补充本次验证的实际适用边界。credential-envelope-red → green 证明错误仍走统一结果格式。


## B4-fix：不可达不等于无效（主会话已裁决）
范围：仅纠正凭据保存、未验证投影、下次调用前复验和离线走查；报价/偏好与冻结区不动。
根因：把所有探针失败当作认证拒绝，导致本地优先配置受供应商在线状态绑架。401/403 拒绝且不写；不可达/超时保存加密候选并记录 verificationPending；联网复验成功仅清标记，不替代模型认证晋级。复用已有保存成功卡/状态徽标，文字为“已保存·未验证，联网后自动复验”，不新增控件。
实现：共享 candidate probe 返回待验证标记；catalog 加密记录持久化并投影非敏感状态；异步调用入口复验后再解析执行模型。按凭据/配置快照去重并发，旧探针不得清掉新 key 的标记。
验收：401 保留旧值、不可达保存带标、成功复验清标先红后绿；真实 Electron 无网络地址走保存；完整带锁 gates exit 0 后正常 commit/push，PR synchronize 复读已更新正文。
回滚：仅 revert 本轮 scoped commit；不覆盖用户密钥。

B4-fix 类型接线使 model-list 脱敏器进入 ES2020 编译面；等价改用 split/join 替换所有字面秘密，保留现有脱敏安全测试。供应商 DTO 新字段同时登记凭据分类表为非敏感。

复验同类补扫：认证 stage/register 会复制密钥到候选连接；复制必须携带 pending 标记，pending 凭据即使内部写 enabled:true 也不能发布 vendor。异步 defaultCatalog.load 在真实模型请求前复验，失败统一进入 run 错误终态；新增实存储 stage→load 夹具验证，不依赖调用者记住保护。

B4-fix 真人验收：隔离 Electron + 本地 HTTP 服务，先停服务保存、返回首页/重开确认持久徽标，再启动服务触发 online 自动探针；401 更换被拒后用旧 key 再探针成功。三张 b4-01/02/03 截图已逐项人眼对账：沿用真实保存卡与错误行，提示无截断；零付费请求。走查发现首页 available 分支漏传 pending，新增投影夹具先红后绿修齐。完整 gates 第一轮 contracts 73 通过/0 阻断，唯一单测失败是 key-only 页接口地址隔离断言；页面已只传 vendorKey，原断言保留且定向绿，最终完整门岗收据见 MONEY-LAST.md 顶部。
