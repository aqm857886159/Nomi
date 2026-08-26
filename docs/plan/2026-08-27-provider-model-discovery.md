# 模型列表发现：Kie 反馈与同类入口修复

## 用户任务与范围

用户在已接入 Kie.ai 后点「获取更多模型」，只看到已接入的少量模型及 `No message available`，不知道是 Key 错、服务故障还是没有列表接口。本次修共享发现链路及新建/已有连接入口，不扩大为适配整个模型市场。工作树 `Nomi-provider-model-discovery-20260827`，分支 `codex/provider-model-discovery-20260827`，基线 `origin/main@7dab8ee8`。原共享工作树与 ComfyUI PR 不动。

## 已核实证据

- Kie：公开无鉴权 GET `/models`、`/v1/models`、`/api/v1/models` 均 404，占位 message 为 `No message available`。不能据此判断用户 Key 有效或生成接口不可用。官方 [Market quickstart](https://docs.kie.ai/market/quickstart) 指向按模型的生成接口；[索引](https://docs.kie.ai/llms.txt) 未提供本次探测所用的列表接口。
- Replicate：[HTTP reference](https://replicate.com/docs/reference/http/#models.list) 明确 GET `/v1/models`、Bearer、`results` / `owner` / `name` / `next` 分页；现解析器只认 `data[].id`，这是可修的格式不兼容。
- RunningHub：[resource/list](https://www.runninghub.cn/runninghub-api-doc-cn/api-437269263) 是工作流模型资源，不是托管生成 API 目录，不混入本模型选择器。
- 方舟：管理面 ListFoundationModels 需要不同地址和 AK/SK 签名，不能拿用户推理用 Bearer Key 改打管理 API。
- 源码：`modelListProbe.ts` 多候选只保留最后错误、200 错误体可能变空列表、query 凭证可能拼进错误 URL；`modelListResponse.ts` 不认 Replicate；`vendorHealth.ts` 只看 HTTP 状态可能漏业务错误或网络失败；两处模型选择入口失败会清空候选，已有连接入口未捕获 IPC rejection/旧请求返回。

## 取舍

| 方案 | 用户所见 | 代价/判断 |
| --- | --- | --- |
| 按供应商名字硬写支持/不支持 | 可少一次请求 | 自定义中转和改地址会被误判，拒绝 |
| 按实际接口响应判定，补官方已证实的列表格式 | 不支持、鉴权、网络错误明确区分；保留已接入模型 | GET 探测零生成额度；采用 |
| 抓网页当完整可调用模型目录 | 数量看似很多 | 模型 ID/参数/权限未证实，拒绝 |

## 实现合同

1. 共用发现结果增加 `failureKind`（unsupported/auth/rate_limit/network/invalid_response/upstream）与成功 `partial` 标记；HTTP 状态与安全上游原因保留。UI 不按错误文案猜类别。
2. 规范化 URL，版本路径不重复；404/405 全部不支持才归 unsupported；任何真实鉴权、限流、网络/服务错误不被后续 404 或空列表覆盖。HTTP 200 业务错误也识别；有效空列表和无有效 ID 的坏结构分开。
3. 支持标准 data、字符串列表及 Replicate owner/name 列表，分页限制与 `partial` 如实呈现；不跨 origin/path 转发认证，不无限分页，不用缺页数据冒充完整成功。所有请求错误脱敏。
4. 新连接、已有连接、健康检查、可达性测试消费同一分类。健康检查尊重已保存 authType、自定义头/query 和缓存失效；没有发现能力不等于连不上或鉴权成功。
5. 原布局不变，现有状态提示区域展示中英文分类信息：不支持时说明这是已接入目录、不是供应商完整模型库；不会用本地目录遮盖鉴权/网络错误。失败保留候选及选择，重试可恢复；关闭/切连接使旧异步结果失效。手动录入仍可用，录入不等于适配/生成验证完成。

复审补充验收（仍在上述合同内）：分页提前结束也必须保留此前最强错误；嵌套 `error.details` / `node_errors` 必须在共享提取器截断前脱敏；自定义请求头按 HTTP 大小写不敏感规则覆盖默认值，新建、保存后、健康检查与测试连接一致。生产走查增加自定义鉴权头在保存与冷启动后的实际请求断言。

## 六视角自检

- CTO：修一个共享原语，不增供应商专用 UI/平行实现。
- PM：用户关心能否找更多，明确目录范围和下一步，非全市场适配承诺。
- 设计：沿用截图中的列表/状态区，不增加配置控件，光暗双模式。
- 前端：选择不丢、异步隔离、i18n；实际入口走查。
- 后端：凭证留主进程，分页不越域，业务状态不吞，探测不生成。
- 用户：已有模型继续用；拉取失败不让重新输入 Key，不把资源库混成生成模型。

## TDD 与验收门

- 先 RED：多路径鉴权优先、200 业务错误、空列表冲突、404+网络、占位错误、query 脱敏、版本路径、坏 ID、Replicate 分页/边界。
- 入口回归：保存的凭证只在主进程使用，类型透传，健康分类及缓存；UI 状态/候选保留/过期请求。
- 真实生产 Electron + 隔离 userData + 本地 HTTP：J1 Kie 式 404 保留目录和手填；J2 标准/Replicate 列表选择→保存→重启仍在；J3 鉴权/限流/网络失败→保留选择→重试恢复，切换连接不串数据。截图本人打开检查光暗主题、错误可读性和操作完成状态。HTTP fixture 不冒充真实供应商权限/生成验证。
- 独立 spec/code review，修完阻断；全量 `check:filesize` → `check:tokens` → `check:i18n` → `lint:ci` → `typecheck` → `test` → `build`，另运行新 walkthrough。
- 验证后只提交本任务文件，push 任务分支、开 PR，不合并/发版。回滚为撤销本 PR，不迁移/改写用户目录数据。

## 基线

2026-08-27：6 文件 / 56 测试通过（parser、probe auth、health、existing connection/action IPC、renderer existing connection contracts）。实现与最终证据另补报告。
