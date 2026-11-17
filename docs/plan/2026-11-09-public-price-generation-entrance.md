# 公开估价投影的生成调用点登记

## 设计卡（登记与测试，不改产品行为）

| 格 | 决定与量具 |
| --- | --- |
| ★1 用户结果 | 保住发送前估价与实际任务所选型号、档位和参数一致；不能因查看估价生成媒体或传出 Key。量具：vendorPricePreview.test.ts 的图片/视频投影到公开 GET 链，check:generation-entrances 的真实仓库对账。真实供应商、付费未验证：本轮禁止。 |
| ★2 唯一主人 | 最终参数仍归 selectTaskMapping / applyHeadlessParamDefaults / buildProfileHttpRequest；只读传输仍归 readVendorPricePreview 的 publicPrices。door-map 分别发现 onboardingIpc.ts::priceQueryFromRequest（write）和 onboardingIpc.ts::readVendorPricePreview（read），各一扇，无新增入口。 |
| ★3 复用与三条路 | 沿原方向：按已有 catalogCommit 的纯渲染 reason 登记并补边界测试，采用；换成现有 publicPrices/modelListProbe GET：前者已经是下游，只接收投影结果，后者读模型列表而不投影任务参数，不能替代投影，另算会复制映射；删除投影：丢失准确的发送前估价，不采用。未新增通用能力。 |
| ★4 出站与失败 | buildProfileHttpRequest 只返回内存对象，不调用 fetch，apiKey 固定空串；它投影的是 POST 生成报文，绝不把这个报文发出去，不能称构造函数本身构造 GET。priceQueryFromRequest 仅提取有限报价字段，拒绝不支持的请求/路径/变换；下游只向种子 api.apimart.ai / api.apib.ai 发 /api/pricing/model、/api/pricing/models/all 的无 Key GET，redirect:error。失败保留 null，不生成、无付费重试。 |
| ★9 验收与反例 | 动手前要求：原门岗在真实仓库复现未登记调用点；登记后原判据和阳性对照均绿；真实投影不出站，图片/视频下游只 GET、无头/体/Key；生成 mapping 不能控制价格端点，坏 method/path 不报价。跑同目录测试、typecheck、排锁快检和正文六项预检。回滚只撤销登记与测试，无存储迁移。 |

## 根因与边界

症状：完整门岗把新增 buildProfileHttpRequest 调用报告为未登记生成调用点。直接原因：估价模块复用该构造器却漏填已有 ledger 的 reason。类根因：纯投影调用同样进入生成入口普查，必须显式裁决用途，不能以「没有发请求」跳过登记。现有 check:generation-entrances 已拦住遗漏，保持判据、计数及矩阵不变，只新增一个精确 site/count/reason；不是新增 landing exception。

本轮无生产代码变更，无新增或替换的生产防线，因此不伪造以测试充当结构性修复的生产根因合同。已有结构边界为同步纯投影返回 VendorPriceQuery（不返回生成报文）和 publicPrices 固定 GET（无入参控制 method/headers/body），测试核实这两层的连接。

独立核对的同类调用：electron/catalog/catalogCommit.ts 只用构造器校验目录而不出站，已有 reason；electron/capabilityCore/apimartGenerationProvider.ts 分别构造批准形状和实际传输形状，已有矩阵关联，不能把它当纯估价豁免。真实生成仍在原入口矩阵范围。

查证：electron/catalog/profileHttpRequest.ts 的 buildProfileHttpRequest → electron/ai/requestPipeline.ts 的 buildHttpRequest 都只构造/返回对象；onboardingIpc.ts 的价格 IPC 只把投影交给 readVendorPricePreview。无第三方行为或依赖升级，无新状态或存储格式。
