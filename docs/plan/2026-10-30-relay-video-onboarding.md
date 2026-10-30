# 中转媒体接入：证据、能力与交付共用一份合同（设计卡草稿）

状态：整体方案按刀验收；第二刀已获协调授权实施（2026-10-30），当前收据见第二刀一节。
范围：本刀协议与物化；能力投影、发现与界面归并行线。不新增依赖，只本地提交、不推送。
各刀按协调的协议子集与文件所有权实施；本卡不提供界面样张。

改动名：中转视频接入与主动发现。类别：[花钱][长跑][可打断][新界面][Agent 行为][数据格式][新增功能 / 性能]。

## ★0 先查别人

2026-10-30 实抓官方原文，全文、正式出处链接与抓取收据留在私有报告§5及其证据目录；按本机纪律，公开稿只保留可追溯位置，不写供应商/竞品名与商务信息。

| 出处 | 它怎么做 | 影响哪个决定 |
|---|---|---|
| 私有报告§5-1：模型目录的模态与过滤（07:43:28Z） | architecture 输入/输出模态与 supported_parameters 分开列；默认列表可能只含文本，需要显式过滤发现其他输出 | 确认：列表不是全量能力或协议证明；空列表不等于没有视频；身份、类别和协议分别存证据 |
| 私有报告§5-2：网关健康检查（07:43:29Z） | 进程 liveness/readiness 不调用模型；模型 health 默认会发真实测试请求，并记录最近检查、成功时间 | 改变：不能把“检测连接”当作免费试生成；分连接、合同、真实产物三层验收，自动检查只读层 |
| 私有报告§5-3：现役 provider registry（07:43:32Z） | registry 集中注册 provider，custom provider 为不同模型类型明确提供模型实例与别名 | 确认：连接能力决定协议，模型名只做身份；不按域名猜端点，不另造一套运行时 |

## ★1 用户怎么用

当创作者拿到一个中转地址和 Key、想让刚上的模型出一镜时，我想直接接入并知道失败在哪里，以便继续创作，不用理解网关实现。

目标三步：①填地址与 Key，保存并只读检测；②选/手填模型，核对证据支持的能力与协议；③在画布确认可见参数并生成一次。没有可靠类别/协议证据时，第二步只问一个问题：“有这个模型的接口文档链接吗？默认：先保存连接，暂不启用生成；补上文档后继续。”已有可靠文档就直接采用明确模式，不让创作者猜接口路径。带图模型需要的首帧放回画布既有输入位，不另弹一轮问题。

真实任务：新文本生视频模型；只有首帧输入的模型；标准视频接口只返回鉴权文件字节的中转。当前仅做同形状本地演练，三项真服务均 unverified。模型商务、具体型号与预算在私有报告。

指标按目标→信号→比例：三步完成→准备好一镜→成功接入且落素材库/尝试接入；诊断准确→phase 与允许动作吻合→正确分类/注入失败。量具：`tests/ux/relay-video-onboarding.walk.mjs`、`tests/ux/relay-video-onboarding-real.rehearsal.walk.mjs` 与对应 `.paid.mjs`。基线以本轮报告为准；目标为支持合同样本全部成功、不支持合同全部在 POST 前明确拒绝。真实成功率未验证：缺真实付费样本。

不做：供应商专属分支；把一个模型族的首尾帧、音频等能力借给新型号；靠多次付费 POST 猜协议；本批产品实现。

### ★1b 连带界面

设置显示“连接可用 / 模型已保存，尚未生成验证”；模型详情显示能力出处；画布只列合同允许模式；Agent 回执与任务列表共用 phase/accepted/allowedActions；下载失败显示“服务商已生成，取回未完成。重新取回会继续处理这一个任务”。英文同义；未知提交只允许核对原单。中英文案草稿见私有报告。

## ★2 谁说了算

连接地址与凭据绑定归 catalog/credentialBinding；模型能力归已存在的 customCapabilityContract；wire 归 Mapping/HttpOperation；受理事实与 taskId 归现役耐久 Run；物化归共享 generationOutputMaterializer。消费者是 picker、session、Agent 模型说明、画布、任务列表。每种事实一份，外部文档/清单只是带来源的证据。用户意图必须显式，不按改卡/改参数推断“再花一次”。前轮 door-map 已给出的门继续适用；本轮新增证据文件列在私有报告。

## ★3 一致与复用

复用标准 Fetch/FormData/stream、vendorHttp 绑定鉴权/重定向、现有 capability contract/archetype、结果落盘与 Run 收据。保留已有明确声明的 URL 返回合同。注册与认证晋升收敛一份能力投影；同一声明缩减模式时，撤掉它先前发布的旧模式，不把“整份覆盖”做成只增不减；其他模型和用户另行编辑的合同先比对归属，冲突可见，不静默抹除。删除媒体 chat 空壳与代码生成的隐式默认协议。存量用户声明不静默重写。标准视频 profile 与 JSON URL profile 按连接明确声明的协议形状选择（草案元数据`mediaProtocols`），不加新网关和依赖；未知连接不因品牌或“兼容”二字自动采用标准面。

## ★4 全状态

| 状态 | 用户看到 / 下一步 |
|---|---|
| 空 | “还没有模型。填写连接，或提供模型文档。” |
| 加载 | “正在获取模型列表”，可取消；不伪造进度 |
| 已保存 | “模型已保存，尚未生成验证”，到画布准备一镜 |
| 成功 | 结果能播、资产在库、收据能指向本次任务 |
| 失败 | 一句话含哪一步、证据支持的责任与下一动作；未知责任明说尚不能判断 |
| 部分成功 | “已取得任务编号，视频尚未取回”，只给查询/取回 |
| 取消中 | “正在停止取回；已受理的服务商任务仍保留”，保留任务号 |
| 过期 | “结果地址已过期。查询原任务后重新取回”，不自动生成 |
| 能力不可用 | “Nomi 尚不支持文档要求的结果格式。保留设置，查看所需协议”，可导出脱敏诊断 |

实现文案走 i18n zh/en。本卡不创建界面；样张由协调在 Claude Design 画布出，再生成 board 清单。

## 5 中途表

每格依次是可见反馈 / 花费事实 / 收据去处。金额与退款不猜；查询/取回不新建订单。

| 状态 | 停止 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 发现/合同 | 停止发现/无生成提交/连接记录 | 保留配置/无生成提交/连接记录 | 检测未完成/无生成提交/脱敏原因 | 回配置/无生成提交/连接记录 | 复用同一检测/无生成提交/同一记录 |
| 待确认 | 关闭草稿/无生成提交/草稿 | 保留草稿/无生成提交/草稿 | 可编辑/无生成提交/草稿 | 回草稿/无生成提交/草稿 | 只确认一项/至多一次提交/attempt |
| 提交未知 | 核对中/可能受理/耐久收据 | 原单保留/可能受理/耐久收据 | 未知/可能受理/耐久收据 | 核对原单/不重发/耐久收据 | 返回原句柄/不重发/同一收据 |
| 已受理 | 停本地等待/上游可能继续/任务号 | 后台保留/上游已受理/任务号 | 稍后查询/不重发/任务号 | 恢复查询/不重发/任务号 | 返回原句柄/不重发/任务号 |
| 取回 | 取消中/不新建/任务号及临时文件清理 | 保留重取入口/不新建/任务号 | 可重新取回/不新建/任务号 | 仅 GET 重取/不新建/任务号 | 复用下载/不新建/任务号 |
| 已完成 | 成品在库/不新建/资产与收据 | 成品保留/不新建/资产与收据 | 本地能播/不新建/资产与收据 | 本地能播/不新建/资产与收据 | 显式新生成才新 attempt/需新授权/新收据 |

## 6 外部数据与失败

模型列表只有身份：不能推端点；architecture 是扩展类别证据，model_spec 必须版本校验，不认识就标未知，不能静默当已验证。文档可能把页面 slug 和实际 model ID 写成不同拼法；存真实 wire ID，不拿 slug 代替。

本轮三种异步形状必须分别登记：`POST /v1/videos`→`GET /v1/videos/{id}`→鉴权 `/content` 字节；`POST /v1/video/generations`→同路径查询→JSON URL；`POST /v1/videos/generations`→文档明确的查询→JSON URL。后二者是扩展合同，不能因“OpenAI 兼容”自动猜。创建、查询、结果三个角色必须完整。标准 t2v 的 multipart 可仅含文本字段；现役 schema 强制文件字段，必须在共享编码合同修正，不能假造参考文件凑格式。

依据：前轮报告的现行规范核对（不在本轮重复）；本轮私有文档原文与 mock 记录。标准外扩展走已有声明卡，无证据不发布。视频结果类型必须从 audioResponse 中独立出来，URL/鉴权字节都进同一物化边界；先持久化任务号再下载。HTML、JSON 错误页、错误 MIME、损坏视频、超大文件、慢流、重定向都不能成为成功资产。

## ★7 性能（预算是设计值，本轮不冒充实现基线）

新增操作：列表加载/筛选/改类型/确认能力/取消发现；视频取回、取消与重启恢复。10/100/1000 个模型三档；长视频用 256 MiB 和 2 GiB 合成流测共享物化边界。

预算：用户操作可见反馈 p95≤150ms，1000 模型不阻塞主线程>50ms；列表网络之外的归一+投影 p95≤100ms，初次可操作≤1s。下载峰值额外 RSS≤64MiB，不能随全片大小线性增加；取消到读写停止 p95≤1s，临时文件在停止后清理。

补充只读微基线：现役`runModelDiscovery`在Node进程内、无网络/IPC/React、20次预热+100次采样，10/100/1000条p95分别约0.0047/0.0269/0.2726ms（2026-10-30，本机并行负载下；私有报告证据`discovery-bench.json`）。只证明身份归一的局部成本，当前错误分类依然存在，不算界面、正确性或正式性能场景过门。

量具：实现线给现役 `tests/perf/scenarios/` 登记 `relay-discovery-scale`（10/100/1000）和 `relay-media-materialization`（两档流、取消）；用 `pnpm run perf:scenarios -- --id <id>` 跑基线。本批没有产品性能改动，场景尚未实现；未验证：缺量具，不给假中位数/p95，不凭本卡放行实现 PR。当前 `vendorHttp.ts:36-46,256` 将媒体响应按约34.33MiB上限整段读入再解释，这只是现役 JSON 边界，不能拿它当长视频流式下载的成功基线。

## 8 真实条件

本轮 macOS + 隔离资料 + loopback，中文/英文截图由走查产出并人眼读取才计通过。Windows、真付费、真实站点协议与质量、最小窗口、键盘全程均 unverified。不得拿 schema/单测绿灯代替。本线付费共步骤草稿尚未通过mock整程：首跑停在接入helper，修正测试夹具后的补跑排锁25分钟超时；不可直接拿真钥匙运行。先补齐中英演练及真实修复。付费脚本依赖修复构建标记 `relay-video-artifact-v1`，当前没有该标记时应在接触凭据前拒跑。

## ★9 验收清单与反例（实现前合同）

1. 三种视频协议、ID 清单/architecture/合法或未知 model_spec、无视频词别名、跨连接同名、清单缺模型手填：身份不丢，不误发 chat，未证明协议不标已生成验证。
2. 新卡/认证晋升/重交卡/旧目录：相同能力事实；参数与引用槽不丢；只有带图能力的新模型不虚构 t2v；未知媒体不得 chat fallback。同一声明从两模式减为一模式时，原声明的旧模式不再可派发；其他模型与独立手写合同不受影响。
3. 创建/查询/结果完整：合法三段结果、仅字节结果与 JSON URL 均进资产库并真解码；纯文本字段 multipart 无参考文件也合法；内容回 HTML/JSON 错误、错误 MIME、损坏/超大/慢流/跨源 redirect、落盘失败/重启重取均保留原单，只 GET。控件最低参数与实发一致：1秒不能显示成默认5秒；分辨率必须可见。
4. create 回包晚、断网、丢任务号；同意图重复调用、微改参数/卡、重启、多宿主并发：POST=1；明确新 attempt 才另算，不用 prompt hash 合并用户有意的第二次生成。此项由已有防重复线实现，本线不碰其文件。
5. 旧显式 URL 合同、图/音频/文本/3D/工作流原行为保持；无能力证据则可见拒绝，不能向另一协议发第二次付费试探。
6. 接入失败去敏事件包含 phase/errorClass/protocolShape/acceptedState/build，不含 Key、地址、模型自由文本或提示词。反馈 intake 能按阶段聚合，开销不得阻塞创作。
7. 合同矩阵 CI 走真实处理/HTTP/落盘路径；Agent 轨迹任务从空连接→声明→准备一镜→确认→资产，工具结果出错会停，不只测 happy script。
8. 性能两场景达预算；中英截图/最小窗口；真付费由协调在专用工作树只一次，先运行共步骤 rehearsal。

复现用 `it.fails`：当前缺口断言预期正确行为、实际失败故测试绿；修复后意外通过会翻红，届时改成普通 `it`。不能只删失败断言。独立验收由协调另派、报告未取得；不得在本轮写“已解决”。回滚按每条实现 PR 的独立 commit revert；只撤代码生成的默认 profile，不破坏用户手写合同与已受理收据。

### 功能分类（未来实现）

- [x] 新界面 / 改交互
- [x] 花钱
- [x] 长跑 / 可打断
- [x] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
- [x] 新增功能 / 性能

## 快速发版切法（建议，需协调分配）

不再按旧报告预设版本延后。先把能出片的共享边界做齐，再做接入体验；下面是文件所有权边界，不能两线同改。

| 刀 | 独占文件面 | 依赖 / 是否等界面拍板 |
|---|---|---|
| 能力投影 | `electron/catalog/declaredProviderRegistration.ts`、`electron/providerAdapter/serviceCatalog.ts`、`electron/providerAdapter/promotionMeta.ts`、`electron/catalog/agentModelEntriesFromCatalog.ts`、`electron/shared/customCapabilityContract.ts`、`electron/shared/modelPublication.ts` | 卡与晋升共用能力事实、去 chat 空壳；无布局变化可立即开工；不碰 runtime/validator |
| 协议与物化 | `electron/providerAdapter/{types,validator,builtinOpenAiCompatibleDraft}.ts`、`electron/catalog/{types,newapiTransport,multipartOperation}.ts`、`electron/runtime.ts`、`electron/tasks/taskResultQuery.ts`、`electron/vendor/vendorHttp.ts`、`electron/capabilityCore/generationOutputMaterializer.ts` | 标准视频与鉴权字节、URL 合同；与第一刀约定类型后并行；无新布局可立即开工 |
| 发现与反馈 | `electron/ai/onboarding/{modelListResponse,modelListProbe,onboardingIpc}.ts`、`electron/integrationCertification/httpConnector.ts`、`electron/providerAdapter/existingConnection.ts`、`electron/catalog/modelKindHeuristic.ts`、`src/desktop/onboardingBridgeTypes.ts`、`src/ui/onboarding/modelDiscovery.ts`、`src/ui/onboarding/useModelDiscovery.ts`、`src/ui/onboarding/OnboardingWizard.tsx`、`src/ui/onboarding/ModelPickerScreen.tsx`、i18n onboarding 文案、`electron/feedback/` | 先逻辑归一与事件 schema；布局/一个问题的呈现等协调样张，不抢前两刀的写门 |

防重复线独占 `electron/capabilityCore/modelOnboarding/dispatch.ts` 与 `electron/productionRun/`，本卡只约定共享状态，不分派修改。`tryModel.ts` 的错误阶段调整交防重复线，避免两线同改。

最低发版条件：能力投影完整 + 两种用户所需结果形状走通 + 已有防重复线通过同意图反例 + 一次新模型真付费产物验证。新增型号不靠写三个永久档案来过关；标准面不足以表达的参考/扩展先明确不支持。UI 简化可下一刀，但接不上时原因必须说对。

## 第二刀：协议与物化（实现合同，2026-10-30）

协调已授权按 AI 接入主路径实施，无新布局。Agent 读文档交声明卡，执行器忠实执行，缺证据停止发送。

### 标准对齐（R5.5）

| 规范链接 | 我们的偏差 | 理由 / 决定 |
|---|---|---|
| https://developers.openai.com/api/reference/resources/videos/methods/create | 旧默认单数 video/generations，multipart 强制文件 | 无领域理由，删除未知连接的视频默认推断；显式连接声明 openai-videos-v1 才产出标准 /v1/videos，t2v 允许纯文本 multipart |
| https://github.com/openai/openai-node/blob/master/src/resources/videos.ts | 标准 SDK create 用 multipart，downloadContent 返回 Response；现役结果执行器却只读 JSON | 无领域理由；保留原生 Fetch/FormData，新增媒体文件响应声明，GET 流式落临时文件后交现役解码发布边界；不新增 SDK 依赖 |
| https://developers.openai.com/api/reference/resources/videos/methods/retrieve | 完成元数据无 URL 时当作无成品 | query 与 result 分离；先保留任务号，再 GET content |
| https://developers.openai.com/api/reference/resources/videos/methods/download_content | 鉴权 MP4 当作文本 | 无领域理由；限制 MIME/大小/期限，解码成功才发布 |
| https://doc.newapi.pro/api/openai-video/ | 同一网关有多协议，旧默认不能证明本站的协议 | 保留用户显式 mapping，声明给哪个路径就执行哪个，不尝试第二条 POST |

上述 OpenAI 页面已标明服务停用，是协议参考而非真服务可用性证明。官方 SDK 源码和公开文档本轮重新抓取；私有取证保留全文。文档给出的其他三段式 URL 路由按声明执行，不按站点名字分支。

### 和能力投影线的共享类型约定

仅在 HttpOperation 增加可选 mediaResponse: { kind: 'binary'; contentType: 'video/mp4' }；不改变 AdapterModeDraft 的 create/query/result、parameters、referenceParam，第一刀继续原样复制 HttpOperation。mediaResponse 只允许 video 模型的 GET result，不能用于 create/query；不借 audioResponse。连接可显式声明 mediaProtocols: ['openai-videos-v1']；已确认的旧 JSON 单数协议用 video-generations-json-v1 显式选择；未知连接不自动选择视频协议。catalog 版本联合类型那一行不改。生产 Run/dispatch/tryModel 文件不动。

### ★9 本刀清单（实现前）

- [ ] 标准三段 + 复数 generations URL + 旧用户单数 URL，生产函数、真 loopback HTTP、可解码落库；每条 POST=1。
- [ ] 文本 multipart 不上传文件；文件字段半对、空 multipart、媒体声明放错 stage/kind 一律拒绝。
- [ ] HTML/JSON 错误、错误 MIME、坏 MP4、超大文件、慢流、鉴权重定向、落盘失败、取消：不得发布资产，任务号保留。
- [ ] 重启清缓存重建后只 GET 重新取回；未知协议在任何 POST 前停止，原有显式 mapping 不改写；POST 失败不换路由。
- [ ] 把本刀四条 it.fails 改普通 it；红灯保存；删字节分支矩阵必须红，再原样还原。
- [ ] 长视频 256MiB/2GiB 流：额外 RSS ≤64MiB，取消 ≤1s，落盘时间记录；高负载 noisy。
- [ ] 中英文隔离窗口，AI 交声明卡→画布→资产可播；共步骤零费用演练先过，付费脚本仅供协调执行。
- [ ] gates / 推送前快检退出 0；独立验收由协调负责，未合入不写已解决。

反例必须保留失败计数：缺 taskId 不伪造服务商编号；thumbnail 不是 video；Bearer 不随 redirect；过期地址只 GET 原单；显式旧 URL mapping 不静默迁移；未知连接不以模型名/品牌选择路由。create 不走媒体响应下载，不能下载前丢掉受理收据。

依赖生命周期：保留现役 Fetch/FormData/Node 流与项目资产解码边界，不安装 SDK。协议实现没有 SDK 版本依赖；后续只有该协议无法由通用执行器表达时再评估依赖替换。

### 第二刀当前验收记录

四项既有复现已从 it.fails 转普通 it：修复前 4 failed / 5 passed / 6 expected fail；修复后 9 passed / 6 expected fail。剩余 expected fail 属于发现/能力投影线。新增独立协议矩阵当前 18 passed，走声明处理函数、真 loopback HTTP、现役解码与项目落库，包括工作区暂不可用后的恢复。测试文件落在现役 Vitest tests/**/*.test.mjs 默认车道，CI quality-gate 的 test:unit:shard 必跑；不另建无人调用的 JSON 矩阵。

限制：字节结果必须有项目身份，无项目的调用在花钱前拒绝；试模型入口的项目身份由其独占线处理。性能脚本 tests/perf/relay-media-materialization-bench.mjs 已准备，统一登记需要现役 scripts/perf-scenarios-lib.mjs 新量具适配（不在本刀文件范围），未越界修改。字节分支删除变异为 7 failed / 10 passed，源码逐字节还原后 17 passed。相关回归 11 文件、249 passed / 6 expected fail。中英真窗、付费共步骤演练、统一性能基线和最终 gates 仍须取得实际收据才能勾选。

入口复核补充：`newapiTransportFor` 数门 4 扇。`catalogCommit.draftShapeForKind` 的 video 兜底与 `relayNativeWireUpgrade` 仍会取旧默认，均在本刀独占范围外，未改动。不能把本刀 builtin/no-mapping 的拒发推广成全产品路由已证据化；该缺口交协调分配后再结账。

第二刀最终诊断收据：五份类型检查全绿；最终协议矩阵18 passed，删除字节分支7 failed / 11 passed，源码逐字节还原后18 passed。原始性能量具分离上游后正常退出0（5轮×256MiB/2GiB），load5约18.74–19.51，noisy。256MiB额外RSS中位/p95约2.97/100.58MiB，2GiB约3.89/24.09MiB；传输写盘约199.88/281.55ms和1892.54/6055.23ms；取消约2.43/32.05ms和3.01/11.02ms。首轮RSS超过64MiB，未判达标；独立冷2GiB、正式场景登记和完整物化性能仍缺。没有真窗、共步骤演练或完整gates收据，不能合入。


### 第二刀续做裁定与停点（2026-10-30 20:0x）

用户对协议档＋封闭三段骨架拍板：「按你的推荐走」。新增范围是 catalogCommit 的视频默认生产者和 relayNativeWireUpgrade；先特征测试，再删除猜测路径，保留全部存量合同。目录行和报文没有可靠作者标识，不能分辨自动模板与显式手写，所以不按形状迁移、不另造能力缺失原因；已存的猜测路由也保留，这是保守迁移的明确限制。

代码拥有的 openAiVideoMode() 固定 /v1/videos → 查询 → /content 与四个标准状态词。卡只交档名还需改严格 schema 和登记/晋升消费者（能力线所有），本版采用裁定允许的类型化字段退路；更换卡格式留 0.25，不宣称 AI 已被限制为只能选档。

续做前反例：无文档证据的熟悉模型名/已探到原生端点仍不能产生视频 mapping；已存显式 query.headers 和 meta 不被刷新；同样形状的旧模板不被认作默认而重写；HTTP 400/404/429/502/503 连续查询仍只用原任务 query，不改目录、不换路重查。先红后绿：迁移保留4红、视频草稿3红、失败查询2红；现已14绿（含启动不探测凭据1项）。

20:0x方案原拟改共享状态边界，20:5x已裁定移出本线：硬证据推断保留，不将最小复现当作已证实事故。本线只核两档文档状态的显式映射，未知继续现役有界容忍；全局规则另行以真实录包复盘拍板。

续做提交 `9c70b1ff8` 后，协议HTTP矩阵18项再次全绿，加本轮定向14项共32绿；不代表完整门岗。draftShapeForKind的一跳包装 modelRetype 同样汇入无视频默认的共享边界；其脚本生成的门已纳入根因合同。表外状态与后续验收仍按上述停点处理。


### 第二刀20:5x范围更正

协调裁定2b移出本线，不修改共享解析器或调用点。先前表外状态最小复现仅说明现有语义，不作为已证实事故。后续单独用脱敏真实录包复盘，再拍板全局规则。本版两个代码档只核文档状态覆盖；“AI只能选档”和“全局状态封闭”均未实现。录包反例：响应含prompt、Key、路径、带签名URL、error.message时，一律只保存允许的状态/形状，不能靠通用字符串打码留下任意内容；二进制正文不得录入；采集失败不得触发再次POST。性能反例：每个大小的每轮必须冷客户端，不能用暖2GiB摊薄首轮开销；安静仍超64MiB时停报。

录包落点是隔离走查输出目录的 `relay-responses.sanitized.jsonl`。使用现有 mainRequire 注入测试观察器，沿用网络闸，不改生产请求；64KiB JSON读取上限、4项数组投影、限定状态token、匿名任务号、固定媒体URL、error保留空值/真假及数值code，删除自由文本。二进制只记MIME/HTTP状态。付费脚本关闭通用原请求体日志，只保留模型匹配布尔值和时长/分辨率/音轨，录包写失败也不能阻断或重发请求。协调真付费后人工核脱敏，再放进现役CI夹具；当前仅本地HTTP演练数据，不冒充供应商录包。

录包保真反例补充：null/空URL不能变成非空占位，false/空error不能变成真值；error.code=0和已知媒体扩展名应保留，避免脱敏投影制造“成功/失败”的硬证据。


### 第二刀安静窗口冷客户端基线（20:5x续做收据）

10个独立冷客户端，256MiB/2GiB各5轮，上游分别独立进程；load5范围6.13–6.23，noisy=false。量具执行时源码为 ddd0c45b6（生产文件保持此前协议实现），使用Node标准生产streamProfileMediaToFile。RSS每5ms取样并记录结束值，指标是导入生产模块后、首次fetch前的初始RSS之上的增量；不含解码/发布、真实网络或窗口按钮取消。

| 负载 | 额外峰值RSS 中位/p95 MiB | HTTP传输写盘 中位/p95 ms | 取消 中位/p95 ms |
|---|---|---|---|
| 256MiB，5个冷进程 | 104.17 / 107.56 | 218.42 / 447.34 | 5.34 / 18.61 |
| 2GiB，5个冷进程 | 124.30 / 140.66 | 1364.80 / 2882.38 | 4.49 / 5.69 |

RSS预算64MiB未通过，取消预算1s通过。量具退出0表示采样完成，预算结论为over-budget。此前暖2GiB诊断不能抵扣冷进程峰值。按协调20:0x裁定“安静窗口里还超，就修（流式、背压），或者停下报告”停在第4步；尚未定位RSS分配来源，未变更生产下载实现。没有运行后续中英真窗/共步骤演练，也没有完整gates/快检收据。本线仍不可合入。

正式perf-scenario：未验证：缺量具（统一场景没有文件流 / 内存驱动）。原始命令：`node tests/perf/relay-media-materialization-bench.mjs --runs 5 --out "$EVIDENCE_DIR/relay-media-cold.json"`，按本机门岗锁执行；原始数据与预算摘要在执行者证据目录。独立冷进程量具不替代统一场景登记。


### ★7 22:1x拆分量具合同（采样前）

按协调裁定先拆分，不把旧冷峰值归因为初始化。每档5个新客户端：①只1KiB首fetch（消费正文、不写盘）；②同一新客户端先1KiB预热，再量256MiB/2GiB下载。分别记录rss、heapUsed、external、arrayBuffers的基线/峰值增量、前后load5；无强制GC，无大文件预热。预热后下载RSS≤64MiB时，引用裁定原话更新预算：“预热后单次下载额外 RSS ≤64MiB；首个 fetch 的一次性初始化单列，只记数、不设预算”。超过则定位接收/桥接/写盘，只在本线取回边界修；共享vendorHttp或新包需停报。

反例：只有1KiB预热不能漏计进程内第一次大文件的内存；不能拿拒绝超限的main路径当成成功下载低内存对照；不同指标不能相加重复算（arrayBuffers包含于external）。main以协调工作树同SHA的origin/main d13bba332为基准；其URL取回fetchProviderMedia/hardenedFetch缓冲正文，字节上限200MiB。保留上限，以相同请求规模记录拒绝；main没有对应鉴权/content文件执行路径。本线与main传输函数及其未改的依赖校验blob一致后，在同宿主隔离进程测阶段差异，不修改main源码或共享大小政策。

若预热下载仍超64MiB，同批次以新客户端/同1KiB预热对照：直接Web reader丢弃、Node桥接后丢弃、现有生产写盘，并记录响应头到达时增量。可另探标准BYOB reader；不支持或未读完都不能当低内存成功。诊断只区分阶段和消费方式，不改生产、共享HTTP或GC参数。

量具执行条件：获锁后最多25分钟等五分钟负载<10，期间不创建测量客户端；超时以75和noisy空样本收据退出。用同一A锁保护冷却与测量，避免退出后再排重活导致永远取不到安静样本；不修改门岗锁实现。
