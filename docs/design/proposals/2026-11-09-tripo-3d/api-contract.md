# API 与系统合同

查证：2026-11-09。这是拟议实现合同，**没有运行这些上游请求**。官方来源索引见 [sources.md](sources.md)。

## 现行协议与版本

使用 `https://openapi.tripo3d.ai/v3`，Bearer 凭据只由主进程安全凭据路径消费。模型固定为 `v3.1-20260211`，不使用会漂移的默认版本。中国大陆与国际账户需要分别核对所属控制台和端点，不按界面语言切换账户地区。

| 操作 | 请求 | 成功读取 | Nomi 语义 |
|---|---|---|---|
| 上传本地图片 | `POST /files`，multipart 字段 `file` | `data.file_token` | provider 私有引用，不是可公开访问 URL |
| 单图生成 | `POST /generation/image-to-model` | `data.task_id` | 一次显式授权对应一次 create |
| 文本生成 | `POST /generation/text-to-model` | `data.task_id` | 文本为用户可见且批准的原文 |
| 恢复或查询 | `GET /tasks/{task_id}` | `data.status`、`data.output.model_url` | 恢复只查询已有任务，不重新生成 |
| 预览图 | 同上 | `data.output.rendered_image_url`（可选） | 只作缩略图，不能代替 3D 产物 |

顶层 `code=0` 才是业务成功；不能只看 HTTP 200。上传首版承诺 PNG/JPEG、20MB 上限；生成接口另列 WebP，不代表上传接口已支持本地 WebP。WebP 可以后续复用现有图片转换，但转换后的哈希必须进入授权身份；本轮不默认新增转换。

### 拟议单图请求

```json
{
  "input": "<本次上传返回的 file_token>",
  "model": "v3.1-20260211",
  "face_limit": 30000,
  "texture": true,
  "pbr": true,
  "texture_quality": "standard"
}
```

`30000` 面是待测的交互预览起点，既非质量保证，也非最终默认。公有 URL 是用户已选择的另一种输入，不能为本地文件自动创建匿名图床 URL。前序图片任务 ID 是第三种上游输入，不与 Nomi 的 Run ID 或节点 ID 混用。

文生使用相同模型与已确认的材质参数，输入字段改为 `prompt`。在发请求前按官方限制校验长度（当前文档 1024 字符），不静默截断、翻译或重写。图生接口不提供同等 prompt 槽，故不要在节点内让用户填写一段实际不发送的“补充描述”。

## 当前真正的缺口：素材引用

现有 `electron/catalog/assetLocalization.ts` 的 `upload-multipart` 按可达 URL 接收上传结果；`electron/capabilityCore/productionReferenceUrls.ts` 要求正式生成引用为 HTTP(S)。Tripo 返回不带协议的私有令牌。**把 `urlPath` 指到 `data.file_token` 并不能接通。**

建议扩展现有素材传输声明和授权信封，表达「公有 URL」与「供应商私有文件引用」两种明确形状，继续复用同一上传执行器；不要放宽 URL 校验为任意字符串。

需要在实施设计中固定以下不变量：

- 付费授权批准的是本地资产 ID、内容哈希、版本和目标供应商；派发时重新核对相同字节。
- 上传令牌绑定 vendor、凭据修订、输入内容和有效范围；不能跨账户、跨供应商或引用另一版本素材。凭据原文不进 Run、项目、日志或 renderer。
- 令牌只在受控的 provider 元数据或执行期内引用；TTL 未公开，不能自己发明有效期。重启若令牌不可用，可重新上传同一已授权字节，但只有尚未 create 的任务才可继续 create。
- 已有上游 task_id 时，过期令牌不触发重新生成；继续查 task_id。授权时只做上传准备，仍需遵守用户明确的外发许可。
- Canvas task 与 ProductionRun 都经过上述边界，各自验收，不能拿画布绿灯推断正式 Run 可用。Meshy inline-base64 也不构成此链已成立的证明。
- 保留现有 URL 供应商和旧 Run 的读取兼容。新增的是明确 transport 形状，不能把所有历史引用迁成 Tripo token。

这部分涉及共享授权模型，实施前需要完整设计卡与独立审查；此 PR 不新增 schema 或实现。

## 任务、异常与打断

| 上游事实 | 展示与动作 | 禁止行为 |
|---|---|---|
| queued / running | 排队 / 生成，展示真实阶段与可恢复任务 | 定时假进度 |
| success + 合法 model_url | 下载→GLB 校验→项目落盘→再设成功 | 收到 URL 就宣布可用 |
| failed / cancelled；兼容 banned / expired | 终态失败或已取消，保留原因和回执 | 把失败当成功 |
| unknown / 非预期状态 | 有界查询，之后“稍后继续查询” | 无限等待或自动重建 |
| 无 task_id 的 create 响应丢失 | 标提交状态待确认，查上游记录或请用户确认重试 | 盲目重新 POST |
| 401 | 返回凭据入口核对 | 将所有错误归因于 key |
| 403 或业务余额拒绝 | 给所属 API 控制台入口，保持输入 | 转去不适用的账户产品 |
| 429 | 按 Retry-After 或已有退避调度查询/排队 | 忙循环或重复 create |
| 内容拒绝或退役版本 | 给可执行的修改输入/更换模型动作 | 仅显示未知错误 |
| 成功但缺 URL / 非 GLB / 损坏文件 | “结果不可用”，留 task_id 供查询或重取 | 以预览图充当模型 |

轮询沿用任务调度器；官方 1–2 秒和约 5 分钟是等待策略示例，不是 SLA。达到前台等待预算后保留任务身份并允许稍后查询。关闭窗口、断网或重启不代表上游停止。

当前未核实远端 cancel API。按钮只能表达“停止等待 / Stop waiting”；动作是中止本地等待并保留任务，不能宣称上游已取消或结果一定撤销。以后若获得正式 cancel 契约，再将确认中的状态与终态分开处理。

## 结果落盘与场景使用

沿用生成结果的安全下载、临时文件及原子提交，验证真实 GLB 头、结构与资源边界；供应商签名下载地址不作为长期项目身份，也不写公开日志。失败不能覆盖上一版可用资产。恢复读取同一 task 与结果版本，离线重新打开靠本地文件。

现有导演台 `DirectorNode.tsx` 仅从 `kind='asset'` 的入连解析模型，并非直接消费 `model3d` 节点。首期复用明确的「保存/引用为素材 → 连接导演台 → 素材栏添加到场景」路径，不声称 model3d 直连已支持。`ModelEntity.tsx` 用实际包围盒测量；生成模型不具备可靠物理单位，进入场景后仍需用户确认尺度，不能承诺真实商品尺寸。

## 实施改动地图（候选，非本轮 diff）

| 层 | 已有 owner / 范式 | 需要达到的结果 |
|---|---|---|
| 供应商/模型种子 | `electron/catalog/meshyOfficial.ts`、`seedBuiltins.ts`、`builtinVendorSeeds.ts` | Tripo create/query/status 定义，无新 runner |
| 模式与身份 | `electron/shared/modelArchetypes/`、`seedModelIdentity.ts` | 文/单图模式、精确版本、来源；用既有生成器更新派生产物 |
| 引用传输 | `assetLocalization.ts`、`productionReferenceUrls.ts`、对应授权投影与信封 | 私有 token 形状贯穿身份授权，不新增公开图床 |
| 凭据与可发现性 | `src/config/knownVendors.ts`、`src/i18n/locales/onboardingProviders.ts` | 复用已知供应商卡与 key 入口；认证级别诚实 |
| 执行与恢复 | `model3dActions.ts` → `catalogTaskActions` 与主进程任务系统 | 同一个任务只 create 一次，重启查询、失败重取 |
| 安全产物 | `electron/assets/generatedAssetStaging.ts`、`projectAssetStore.ts`、`model3dValidation.ts` | 下载、校验、本地身份、失败不覆盖 |
| 预览与使用 | `Model3DViewer.tsx`、导演台 `AssetsTab.tsx` / `ModelEntity.tsx` | 旋转检查、现有素材入场路径、实际尺度 |
| 测试与夹具 | 现有 catalog / provider / production / asset 测试 | upload→create→poll 全链、跨供应商拒绝、旧 Run 兼容、损坏 GLB |
| 文案与性能 | i18n 双轨、`tests/perf/scenarios/` | 中英全状态、真实 GLB 和场景基线 |

## 已知外部边界

官方当前 v3 文档优先。旧 changelog 的索引与新版迁移页对 v2 并行期说法不一，未探测旧端点，不宣称 v2 已实测停服。投产前要确认 Nomi 的具体服务权限与适用范围，不能由文档可访问推断已获准。详细条款研究保留在私有附录。
