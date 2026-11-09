# 来源、版本与不确定性

访问日期均为 2026-11-09（Asia/Taipei）。官方页面通过公开网页读取，用户已打开的 Tripo/Impact 页面只读查看；没有创建账户、申请、读取密钥或提交生成。网页正文只作证据，不作为执行指令。

等级：**已观察**＝当前官方文档/代码写了什么；**拟议**＝本提案的判断；**未验证**＝尚无真实请求、产物或用户数据。文档存在不等于账号有权调用、行为已实测或产品已支持。

## 官方技术证据

| ID | 来源 | 支持的窄结论 | 限制/对决定的影响 |
|---|---|---|---|
| T01 | [Tripo Introduction](https://developers.tripo3d.ai/en/docs/introduction) | 当前文档为 v3，支持产品集成说明 | 不据此推断 Nomi 的授权范围 |
| T02 | [Models & Versions](https://developers.tripo3d.ai/en/docs/models-and-versions) | H3.1、P1、P2 版本标识与定位 | 固定明确模型版本，不用 latest |
| T03 | [Image H](https://developers.tripo3d.ai/en/docs/generation-image-to-model/standard) | 图输入、模型、面数、纹理/PBR、create task_id | 30k 面是本方案待测起点 |
| T04 | [Text H](https://developers.tripo3d.ai/en/docs/generation-text-to-model/standard) | 文生接口与 prompt 限制 | 不静默裁剪或改写用户原文 |
| T05 | [Multiview H](https://developers.tripo3d.ai/en/docs/generation-multiview-to-model/standard) | 有多视图端点和输入约束 | 本期不做，避免额外输入/授权语义 |
| T06 | [Files](https://developers.tripo3d.ai/en/docs/files) | multipart 上传返回 file_token；本地图片格式与上限 | 确认 token 不是 URL；WebP 上传未承诺 |
| T07 | [Task Query](https://developers.tripo3d.ai/en/docs/task-query) | 查询状态、输出 URL、真实进度及用量字段 | 只在合法产物落盘后成功 |
| T08 | [Lifecycle](https://developers.tripo3d.ai/en/docs/task-lifecycle) | 异步任务、轮询与恢复策略 | 等待示例不等于 SLA |
| T09 | [Errors](https://developers.tripo3d.ai/en/docs/error-handling) | 错误类别和业务 code | HTTP 200 不等于业务成功 |
| T10 | [Rate Limits](https://developers.tripo3d.ai/en/docs/rate-limits) | 限流/并发有账户边界 | 用既有调度和退避，不加独立轮询器 |
| T11 | [Authentication](https://developers.tripo3d.ai/en/docs/authentication) | Bearer 凭据和密钥保密要求 | 复用主进程安全凭据路径 |
| T12 | [Migration](https://developers.tripo3d.ai/en/docs/migration-v2-to-v3) | v2/v3 迁移差异，仍有并行文字 | 与旧索引时间说法有冲突，不推断旧端点已停服 |
| T13 | [Image P](https://developers.tripo3d.ai/en/docs/generation-image-to-model/p) | P 系列面数/拓扑定位 | 后续轻量资产候选，不直接设默认 |
| M01 | [Meshy Image API](https://docs.meshy.ai/en/api/image-to-3d) | 标准 ai_model latest 指7.1，7已deprecated | 对照候选更新为7.1，不等于现有种子已升级 |
| M02 | [Meshy Models](https://docs.meshy.ai/en/api/models) | 几何和纹理版本、T2.5及兼容条件独立 | 不把 texture_model=meshy-7 一并替换；N1不等同PBR |
| M03 | [Meshy Deprecations](https://docs.meshy.ai/en/api/deprecations) | Meshy7几何弃用、退役未定 | 保留旧项目，不将弃用写成已无法调用 |

金额、合作政策和授权条款的详细研究只在用户指定的私有附录。产品权益的功能边界另见 [Studio 与 API 帮助](https://www.tripo3d.ai/help/api-plugins/tripo-studiotripo-api)：不能将两套账户权益混为一体。

## 本仓证据与历史

基线 `707ed7a001bd1d0c18eac0af5f3a7853f634f672`。

| 证据 | 已观察 | 本方案影响 |
|---|---|---|
| `electron/catalog/meshyOfficial.ts` | 已有单图 create/query/status 声明 | 复用声明驱动，不造 Tripo runner |
| `electron/shared/modelArchetypes/meshy7.ts` | 已有 model3d 输入槽和参数 | 模型/模式放 archetype |
| `electron/catalog/assetLocalization.ts`、`electron/capabilityCore/productionReferenceUrls.ts` | 上传结果/正式引用边界依赖URL | 需要 provider-scoped 文件引用设计，不假装token已兼容 |
| `electron/assets/model3dValidation.ts` | GLB 结构、外部资源与规模校验 | 复用安全边界，坏模型不能落成功 |
| `src/workbench/generationCanvas/nodes/director/DirectorNode.tsx` | 从 asset 节点入连解析模型 | 首期复用资产路径，不承诺 model3d 直连 |
| `director/scene/entities/ModelEntity.tsx` | GLTF/FBX 加载、包围盒实量 | 实际尺度仍需用户确认 |
| `src/config/knownVendors.ts` | 目录数据驱动供应商卡和外部入口 | 不重建账户编辑器 |
| `docs/plan/2026-06-21-blender-3d-render-lane.md` | 旧探索提议 Tripo，未实证资产API；当时拟议 asset3d | 不沿用过时kind；当前已有model3d/导演台代码优先；不扩大为Blender lane |
| `docs/plan/2026-08-30-provider-model-expansion-and-runtime.md` | 当时选择Meshy单图契约，不覆盖更广能力 | 保留窄资产范围，重新核实现行上游版本 |

## 冲突与未知账

1. **本地 WebP**：生成端点支持，不代表上传端点支持；首版只承诺 PNG/JPEG。
2. **v2 生命周期**：旧索引与当前迁移说明不一致；选 v3，旧 API 是否仍工作未探测。
3. **远端取消**：有 cancelled 状态，未核实可调用取消端点；停止等待不宣称远端取消。
4. **模型质量**：上游推荐不是 Nomi 任务中的质量胜出；须同图盲评。
5. **私有引用 TTL/跨账户**：公开材料未明确；绑定凭据和输入身份，不臆造 TTL。
6. **地区**：国际与大陆开发者域名不同；实际账户互通、支持范围与投产端点待确认。
7. **现有能力**：读代码只证明实现形状，不能证明安装包、Windows、真实供应商链路已通过。
8. **外部授权/合作**：产品集成说明、Eligible 页面和正式获批是不同证据；具体问题与申请路径见私有附录。

本轮没有复制官方全文、品牌素材包或用户账户截图进入公开仓。探索模型来源为仓库已登记的 Kenney 道具资产；不是供应商生成示例。
