# #975 G1/G2 与 NF-1119-0001

### ★0 先查现有做法

- `electron/catalog/catalogModelAvailability.ts:32` 免密目录项直接就绪，确认正式生成可复用该判据。
- `electron/catalog/assetLocalization.ts:296` inline 通道生成媒体 data URI，确认封存和请求投影应接收同一交付值。
- `electron/shared/modelArchetypes/variantResolution.ts:57` 仅专属线上 key 可推断变体，确认家族短名不能替创作者选付费档。
- 出口：electron/capabilityCore/productionReferenceUrls.ts:50 · 无效参考返回结构化封存错误让创作者替换素材后重试 · 确认继续沿用授权前封存报错并向含糊型号返回目录可点名句柄。

### ★1 用户任务

声明本机供应商 → 挂项目内参考 → 确认就绪 → 封存请求 → 正式提交与查回。另一个任务是 Agent 点名 Wan 2.7 角色参考并确认回执里的目录身份。目标是声明生产测试的免密及内联样本全部到达接收端，句柄与模式测试的已声明样本全部命中；无效参考、未知名、含糊档位零误发。量具是 `declaredProviderProduction.test.ts`、`productionReferenceUrls.test.ts` 和 `modelHandle.test.ts`。真实服务商成功率未验证，缺原现场环境。
- ★1b 复用现有就绪、错误和候选回执。
- ★1c 继续读取原目录、参考身份和授权快照，无需迁移。

### ★2 所有权与门表

目录负责凭据健康，内置直连另有认证保护。素材通道和交付值判据供封存及投影共同消费，授权快照负责重放。档案拥有变体与模式的线上 key，模型句柄层查启用目录，传输按已选模式投影。任务与结果仍由正式运行持有。

`scripts/door-map.mjs` 的扫描结果（按 path 与 symbol 去重）见根因合同 `doors`。扫描前的入口如下。

```text
read electron/agentLane/laneModelRead.mts resolveModelHandle
read electron/agentLane/laneVerbTransport.ts resolveDraftShotModels
read electron/agentLane/laneVerbTransport.ts draftShotToPlanShot
read electron/agentLane/laneVerbTransport.ts draftShotToCandidatePatch
read electron/agentLane/laneVerbTransport.ts draftShotToFlatCreate
read electron/capabilityCore/agentPanelSpendConfirmTestUtils.ts resolveProductionReferenceUrls
read electron/capabilityCore/apimartGenerationProjection.ts assertReferenceParameters
read electron/capabilityCore/apimartGenerationProvider.ts placeRunReferences
read electron/capabilityCore/apimartGenerationProvider.ts resolvedReferenceUrls
read electron/capabilityCore/apimartGenerationProvider.ts assertReferenceParameters
read electron/capabilityCore/apimartGenerationProvider.ts assertReferencesReachBody
read electron/capabilityCore/appIntegrationProductionActions.ts reworkReferenceUrls
read electron/capabilityCore/canvasModelIdentity.ts resolveModelIdentity
read electron/capabilityCore/canvasModelIdentity.ts nearestModelHandles
read electron/capabilityCore/generationDomain.ts createGenerationProviderBootstrap
read electron/capabilityCore/generationDraftAdmission.ts semanticCandidateFromParams
read electron/capabilityCore/generationPlanPatch.ts resolvePatchedModel
read electron/capabilityCore/generationProviderBootstrap.ts createCatalogGenerationProvider
read electron/capabilityCore/liveGenerationRuntime.ts createGenerationProviderBootstrap
read electron/capabilityCore/mcpGenerationMultiShot.ts semanticCandidateFromParams
read electron/capabilityCore/modelSpecRead.ts resolveModelIdentity
read electron/capabilityCore/modelSpecRead.ts resolveModelHandle
read electron/capabilityCore/productionReferenceUrls.ts localizeProductionReferenceUrls
read electron/capabilityCore/productionReferenceUrls.ts resolveProductionReferenceUrls
read electron/capabilityCore/semanticGenerationCandidate.ts resolveModelForTask
read electron/capabilityCore/semanticGenerationCandidate.ts resolvedModelNameOf
read electron/parity/generationParityTestUtils.ts createGenerationProviderBootstrap
read electron/productionRun/prepareProductionGenerationAuthorization.ts resolveProductionReferenceUrls
read electron/shared/agentCapabilities/modelHandle.ts nearestModelHandles
read electron/shared/agentCapabilities/modelHandle.ts resolveModelHandle
read electron/shared/agentCapabilities/modelHandle.ts resolveModelIdentity
read electron/shared/agentCapabilities/verbs/draftShotsProjection.ts resolveModelForTask
read electron/shared/agentCapabilities/verbs/draftShotsProjection.ts resolvedModelNameOf
read electron/shared/modelArchetypes/builtInCatalog.ts WAN_27_IMAGE_ARCHETYPE
read electron/shared/modelArchetypes/builtInCatalog.ts WAN_27_IMAGE_PRO_ARCHETYPE
read electron/shared/videoCapabilities/registry.ts WAN_3_0_APIMART_ARCHETYPE
read electron/shared/videoCapabilities/registry.ts WAN_3_0_PRIME_APIMART_ARCHETYPE
read electron/shared/videoCapabilities/wan30Apimart.ts WAN_3_0_APIMART_ARCHETYPE
```

复扫新增入口见合同，包含共享交付判据、计划改写与家族建议。

### ★3 一致与复用

沿原方向修。沿用 #975 的声明连接归属与 #1541 的单一模型名查表。切换入口或移除声明接入会丢失正式运行的参考交付。复用目录可用性、内联解析、已声明变体和模式。

### ★4 状态

空参考按原模式走。加载、取消中、部分成功与过期继续由运行时呈现。成功返回供应商任务与目录句柄，坏参考在封存前报错，能力不可用返回现有就绪原因或可用型号。

### 5 中断与重试

本次测试检查封存值等于上游收到的值。重试继续沿现有授权绑定和持久化路径，恢复行为由既有运行时负责。

### 6 外部输入

声明卡的鉴权和通道交给现有目录。缺密钥、坏 URI、超限和错误供应商都应在提交前被拒；近似的家族建议来自启用目录。

### ★7 性能

纯后端修复。内联验证先按长度拒绝超限，再解码，并在一次请求投影内复用结果。实际桌面延迟未验证。

### 8 真实条件

本机 Node HTTP 回环与测试项目夹具。原报告的 Windows 客户端、真实账号、真实模型与付费均为 unverified。无需拍板图，界面无改动。

### ★9 验收与回滚

先用原实现跑红，修完重跑。检查免密提交没有 Authorization、固定参考字节到达请求体、Bearer 旧样本仍通、HTTP 上传仍通。反例覆盖损坏、非媒体、超限及未声明内联通道。检查启用的 Wan 目录行、R2V 模式提示、跨供应商歧义、标准和 Prime 候选以及虚构型号。用结构测试、双引擎矩阵与任务指定门岗回归。回滚使用本次修复提交的 revert。按任务范围进行本地自验，独立验收待合入流程。

### 红灯与系统改进

修前定向测试 9 失败、46 通过。最早可拦在验收矩阵，旧样本只检查了带密钥和 HTTP 上传的路径，模式对拍从目录主行开始，对不上游使用独立线上 key 没有检查。修复后所有入口复用目录、交付值和档案上的判据。回环双模式保留原始 PNG 字节，五入口对拍核对 Wan 角色参考，同测 Qwen 变体和原有 Bearer、HTTP 路径。2026-12-08 复查已有回归与新反馈，重复症状的目标是 0。

短名以共同家族名给候选。唯一型号的识别串仍使用各档独立声明，沿用档案自解析检查。内联体积沿用单张模型参考图的 20 MiB 上限。

## 方向复盘

全图见本卡 ★2 和 `docs/engineering/seams.json` 的档案接缝。正式参考封存与派发见合同门表。

### 0. 类根因

出站消费者分别推断目录事实，声明能够表达的条件比 Run 和 Agent 准入认得的多。

### 1. 归类

| 案例 | 直接原因 | 类 |
|---|---|---|
| #975 G1/G2 | 启动与派发必填 key，封存和投影只认 HTTP | 运行边界重复推断供应商规则 |
| `975e9dca3` | 参考交付证据未贯穿发送 | 授权素材与出站证据 |
| `973bd3dbe` | 上传 413 的渠道证据被覆写 | 运行边界重复判断参考状态 |
| NF-1119-0001 | 模型查表遗漏档案的线上模式与变体 | 目录身份在入口降级时丢失 |

### 2. 结构原因

铁律 ⑩ 由定向断言比较封存与实际送达的参考、点名与实际生效方式。铁律 ⑪ 由档案身份和五入口对拍覆盖。⑫ 不适用，本次入口是 Node API。

### 3. 预测

如果继续维护两套参考判据，声明的两种带图模式仍会在真请求之前失败。量具是声明生产回环。若各入口继续各自认线上型号，同一 Wan 角色参考会在起草、改计划或宿主创建间漂移。量具是名字与模式对拍。目标与复查日见本卡系统改进。

### 4. 独立性

独立复核只看基线代码、审计事实和红灯，确认 R2V 是模式而 KIE Prime 是变体，并建议复用现有鉴权、交付和档案判据。现有标准/Prime 自解析门岗曾抓住共享短名冲突，因此短名留在家族建议里。未见修对后被旧评分扣分的样本。

### 5. 这一整块归谁

这一整块：目录供应商的正式出站与名称准入。
归谁：凭据健康在 electron/catalog/catalogModelAvailability.ts:31，资产通道在 electron/catalog/assetLocalization.ts:660，模型句柄在 electron/shared/agentCapabilities/modelHandle.ts:120。
我们哪里绕开了它：原 generationProviderBootstrap.ts:67 自查密钥，原 productionReferenceUrls.ts:49 与 apimartGenerationProjection.ts:55 自判协议，原 modelHandle.ts:99 查表只看目录行原名。

### 6. 取舍

| 方向 | 代价与风险 | 结论 |
|---|---|---|
| 就地补特例 | 新供应商与异形参考继续逐个跌出 | 不选 |
| 复用现有拥有者 | 装配、封存和发送共享规则，计划消费声明选择，需跑出口对拍 | 采用用户指定的共同边界 |
| 移除能力 | 本地适配器或已发布模式失去正式入口 | 不选 |

### 7. 核心权衡

创作者可以沿用目录声明，含糊的付费档仍需点名。特征桩见 `declaredProviderProduction.test.ts`、`productionReferenceUrls.test.ts`、`modelHandle.test.ts` 与 `modelNameModeParity.test.ts`。逃逸结账以 ⑩、⑪ 的上述回归为证，原现场仍未验证。
