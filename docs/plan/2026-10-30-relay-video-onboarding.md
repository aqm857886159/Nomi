# 中转媒体接入：证据、能力与交付共用一份合同（设计卡草稿）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

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

## ★7 性能（现行取回预算按10-31 00:3x裁定；历史收据另列）

新增操作：列表加载/筛选/改类型/确认能力/取消发现；视频取回、取消与重启恢复。10/100/1000 个模型三档；长视频用 256 MiB 和 2 GiB 合成流测共享物化边界。

预算：用户操作可见反馈 p95≤150ms，1000 模型不阻塞主线程>50ms；列表网络之外的归一+投影 p95≤100ms，初次可操作≤1s。取回预算：单路256MiB/2GiB额外RSS p95各≤160MiB，两档p95差≤32MiB；4×256MiB同时下载的进程额外RSS p95≤实测单路256MiB p95×2。各5轮，只认安静样本，超标停报、不再改预算。取消到读写停止p95≤1s，临时文件在停止后清理。Windows弱机：未验证：缺 Windows 测试机。

补充只读微基线：现役`runModelDiscovery`在Node进程内、无网络/IPC/React、20次预热+100次采样，10/100/1000条p95分别约0.0047/0.0269/0.2726ms（2026-10-30，本机并行负载下；私有报告证据`discovery-bench.json`）。只证明身份归一的局部成本，当前错误分类依然存在，不算界面、正确性或正式性能场景过门。

取回量具已接入现役统一跑法：relay-content-fetch-256m、relay-content-fetch-2g、relay-content-fetch-4x256m，实测基线与原始证据见本卡末节。发现列表的性能归并行线，不在本刀冒认。原有JSON/URL缓冲取回与新增声明文件响应的流式路径区分；拒绝大文件不能当成功下载的低内存基线。

## 8 真实条件

本轮 macOS + 隔离资料 + loopback，中文/英文截图由走查产出并人眼读取才计通过。Windows、真付费、真实站点协议与质量、最小窗口、键盘全程均 unverified。不得拿 schema/单测绿灯代替。本线付费共步骤草稿尚未通过mock整程：首跑停在接入helper，修正测试夹具后的补跑排锁25分钟超时；不可直接拿真钥匙运行。先补齐中英演练及真实修复。付费脚本依赖修复构建标记 `relay-video-artifact-v1`，当前没有该标记时应在接触凭据前拒跑。

## ★9 验收清单与反例（实现前合同）

1. 三种视频协议、ID 清单/architecture/合法或未知 model_spec、无视频词别名、跨连接同名、清单缺模型手填：身份不丢，不误发 chat，未证明协议不标已生成验证。
2. 新卡/认证晋升/重交卡：相同能力事实；参数与引用槽不丢；只有带图能力的新模型不虚构 t2v；未知媒体不得 chat fallback。同一声明从两模式减为一模式时，原声明的旧模式不再可派发；其他模型与独立手写合同不受影响。（原文这一项还把“旧目录”列进来要求相同能力事实：**第 6 轮撤销**，升级时不动老模型，旧目录不被改投影，见本文末尾“第 6 轮”。）
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

## 第一刀：能力投影（实现前合同，2026-10-30）

本刀方向已获批准：主路径是 Agent 读文档、交声明卡、试跑，再到现有画布生成；声明卡不能在登记或晋升后丢失能力。只修投影，不改接入布局，不接管协议执行、结果物化或试跑防重复。以下清单在产品代码改动前记录，尚未实现或验收。

### ★9 子清单

1. **一份能力事实**：登记与认证晋升调用同一投影，产出 kind、现有 `customCapabilityContract` 和对应 wire。对照新卡、同名内置档案、无档案模型、重交卡与认证晋升；产品 modeId 与 transport taskKind 分工明确。媒体不得投成 chat；文本维持原有行为。
2. **参数保真**：声明的 duration、resolution、比例及其他合法参数，其类型、选项、范围、默认值进入合同，Agent、画布控件及实发一致。1 秒不得显示为 5 秒；分辨率必须可见。不能表达的字段组合在目录事务写入前给出字段原因，事务失败不留半张卡。
3. **声明整份替换**：两模式缩减为任一单模式，旧声明拥有的模式立即撤销，不再通过旧 mapping 或泛用路由派发。反向扩充与再次缩减均覆盖；别的模型、跨连接同名模型及独立手写合同保持。归属无法证明或用户已编辑的冲突明确拒绝，不能静默覆盖。
4. **必需引用**：仅带图模式只有 i2v，单图必需槽 `min=1/max=1`，首帧进入已有输入位；未带图在 POST 前拒绝，带图恰好到声明的参数。不得虚构 t2v、尾帧、多图、音频或全能参考。
5. **旧数据**（**第 6 轮撤销**）：~~按原 active revision 恢复完整投影，限定 vendor/model/revision 归属、核对当前 wire 与用户编辑；幂等、重启可用，不再认证、不发 POST。找不到原卡、revision 损坏或形状表达不了时保留原记录并标“需要补充能力说明”，中英可见，不按名称借用档案。~~ 现役说法：升级时不动老模型，不恢复、不标缺失、不迁移；老行照常能用，不自动变准，要准确的参数条走 AI 重新交卡。对应验收见“第 6 轮”。
6. **AI 路径验收**：Agent 交卡的真实处理函数为入口；两模式与仅带图两类 loopback 模型，从声明到既有画布。隔离资料、假凭据、不出网、不付费；中英分别截图参数、必需输入位和模型说明，截图逐张人工读取。真实大脑、线上服务、付费结果仍独立标 unverified。
7. **旧行为与门岗**：显式 URL 合同、图/音频/文本/3D/工作流不改协议、不追加探测。四条本刀 `it.fails` 先改普通测试观察目标断言失败，修复后保留普通测试转绿。跑 schema-v3 checker、gates 和推送前快检，记录退出码与尾行；独立验收由协调安排。

### 动手前反例

- 故意丢 parameters，登记/晋升对照矩阵必须红；故意保留旧模式，两种缩减方向都必须红；试验后按字节恢复产品文件。
- 不透明 ID、撞内置档案名、跨 vendor 同名、切换语言：合同以声明为准，身份不变，不出现 chat。
- i2v 缺 referenceParam、引用形状与 wire 不一致、参数默认值超界或不存在于选项：提交前带字段原因拒绝且无目录写入；不能靠默认参数或假参考图过关。
- 先登记双模式、再独立改其中一条 wire 或能力合同、再重交卡：不能以“归属于旧声明”为由吞掉独立编辑。
- （**第 6 轮撤销**，没有迁移了）~~旧 revision 存在/缺失/损坏/属于别的连接或模型/未包含当前模式；重复启动；用户原有显式合同：只恢复可证明的缺失，不制造新能力，网络 POST=0。~~ 对应反例改为：旧版本真实落的目录升级后，逐模型逐模式 POST=1，路径和请求体与主线一字不差，见“第 6 轮”。
- 新卡提交包含一个有效模型和一个不可表达模型：整次事务拒绝，不能留下第一个模型或 vendor 的部分修改。

### 共享类型边界（协调 10-30 17:5x 裁定）

第一刀使用现有 `AdapterModelDraft`、`AdapterModeDraft`、`CustomCapabilityContractV1`、`Mapping`，不修改 `HttpOperation`、multipart、结果响应类型。第二刀独占 wire 编码与结果类型，投影按完整操作对象传递，不能再另列白名单丢掉它新增的合法字段。单图引用先以现有 `referenceParam/referenceShape` 表达；超出既有表达力的形状明确拒绝，不加供应商分支。

### 范围核对：旧目录迁移入口已归本刀（第 6 轮撤销）

> **第 6 轮撤销**（用户 2026-10-31 裁定“升级时不动老模型”）：本节关于目录迁移的记录全部作废，代码已删——没有 `migrateDeclaredCapabilities`、`migrateStoredCatalog`、`readProviderAdapterRevisions`，没有“能力缺失”印记，目录版本不升（仍是 13）。现役说法见本文末尾“第 6 轮”。下面保留当时的记录，作废的句子加了删除线；仍然现役的只有：创建任务经过的 `taskParams.ts` 参数准备门调用共享能力断言，`executableModel.ts` 保持原样、已受理任务的查询不被拦，声明参数与引用的编译方式。

~~静态追踪确认：目录加载经 `catalogStore.readCatalogShared → catalogMigrations.migrateCatalogForward`；原始 revision 保存在 `ProviderAdapterStore`，不在 `Model.meta`。现有六个独占文件没有覆盖这条加载与一次性迁移接线。只在登记/晋升里补投影不能修复从未再次交卡的旧模型；只在 Agent 说明里补也不会回到画布与派发。~~

~~要满足第 5 项，需协调分配一次性迁移与接线（至少 `electron/catalog/catalogMigrations.ts`，以及原始 revision 的只读供给与可见状态的既有出口；具体补充文件须先查清并认领）。若采用目录版本迁移，还涉及第二刀独占的 `electron/catalog/types.ts`。当前不越界改这些文件，不在共享纯读函数里偷读文件、改目录或只导出一个无人调用的迁移函数。实现前先交协调核定这段所有权。~~

~~协调已将 catalogMigrations.ts、catalogVersion.json、catalogStore.ts 的迁移接线及 store.ts 的只读 revision 供给归本刀；types.ts 仅目录版本联合那一行归本刀。~~ modelAvailability.ts 增加 capability_incomplete 原因与缺失字段（现在只对带归属记录、合同却解析不出的新交卡行出现）。Agent 模型说明负责引导重交；picker/i18n 留第三刀，故本刀不再以新增 UI 为前置。~~版本迁移幂等，至少验证原卡可恢复、原卡不可恢复、完整目录不变三类。~~ 派发前的拒绝按本次裁定落实；不改变已受理任务查询的模型解析。

第一刀实现接线核对：~~普通读取与启动种子均调用 migrateStoredCatalog（一次装配原始 revision 的同一入口）；不在纯迁移默认参数里读资料。~~ 为落实裁定中的“派发前按它拒发，拒发信息说清缺什么”，在创建任务经过的 taskParams.ts 参数准备门调用共享能力断言；executableModel.ts 保持原样，避免已受理任务查询被误拦，未改 runtime。声明参数与引用的旧平铺模板在投影时编译到现役 request.params 通道；每模式控件默认值同源生成 create.defaultParams，冲突在事务写入前拒绝。paramMap 的 from/fromMany 依赖复用 consumedCanonicalKeys，现有图片 multipart / JSON / chat carrier 继续走原线。


### 第一刀第 3 轮：实现前 ★9 扩围合同（协调 23:5x）

现有工作流能力生成边界为 `electron/catalog/comfyuiWorkflowImport.ts::buildImportedWorkflow/buildComfyImportModelMapping`；本轮认领该文件和 `comfyuiCandidateLifecycle.ts`，不改 runtime、validator 或第二刀类型。工作流控制项（含媒体输入）从该边界产生完整 draft，候选晋升只转交，不另拼简化草稿；共享 projectDeclaredModel 接受每模式明确控制项并使用同一参数覆盖不变量。引用参数缺失仍拒绝，不按连接名、模型名或供应商分支。

| 产出/调用链 | 能力来源 | 晋升入口 |
|---|---|---|
| 声明卡登记 | 完整卡 | registerDeclaredProvider → projectDeclaredModel |
| 认证协调器及重放 | revision.draft | providerAdapterCoordinator.replayPromotions → catalog.promote |
| 工作流认证/素材化 | buildImportedWorkflow/buildComfyImportModelMapping | materializeCertifiedComfyAssets → promoteCertifiedComfyCandidate → defaultCatalog.promote |
| 集成认证会话 | 同一工作流候选 | integrationSession 的 promote 回调 → promoteCertifiedComfyCandidate |
| 生产 parity 量具 | 受控完整 draft | generationParityTestUtils → defaultCatalog.promote |

门图对 promote 属性名跑，限定到 ProviderAdapterCatalogPort 实例逐一核对；带点的名字脚本计零不当没有调用者。类级矩阵清单登记上述调用者，枚举已导入、新导入、编辑、编辑失败保留旧版、i2v 控制项和必需槽。原 ComfyUI 生命周期测试原样转绿。故意从工作流生成的模式删 referenceParam，矩阵必须红，按字节还原。

补三件的验收及反例：

1. 原卡：登记同一目录事务保存本模型原始 modes/parameters、sources、omitted、openapi 等完整输入；输入对象之后被修改不影响耐久原文。~~原 revision 缺失仍能从保存卡恢复；无任何原文仍标能力缺失。~~（**第 6 轮撤销**这两句：原卡继续写，现在没有读者，用途是以后重交卡和向人解释。）整卡任一模型拒绝时，原卡与目录同回滚。~~反例：去掉原卡保存，恢复矩阵红；串模型或被独立修改的 wire 不覆盖。~~（恢复矩阵随迁移删除；独立修改的 wire 不被覆盖由归属判定表的测试守。）
2. 中性参数：显式中性键经现役 paramMap 翻译为 wire；共用 consumedCanonicalKeys/wireReferencedParamKeys 的 paramConsistency 不变量覆盖声明与工作流，不只测固定三个维度。线缆别名不成为用户控件；已显示的控件没有消费路径必须在写入前拒绝。反例：duration 控件、wire 只读 seconds 且无翻译表，提交红且事务无写；合法翻译后请求中 1 秒/360p 与控件一致。工作流已登记的自有参数原键保真。
3. 就绪：声明成功写现役 adapter.evidence=self-check，表示静态合同收下但未生成验证；现有未试跑读者能显示，Agent 模型说明同时明示未试跑。不伪造 media evidence，不改 try_model。反例：删 evidence 或冒写生成验证，矩阵红；失败声明没有就绪记录。
4. 完整操作复制：已有 HttpOperation 整对象传递，不列字段白名单；用额外合法 mediaResponse 字段的投影保真测试核对第二刀兼容约定。

真窗构建与走查走槽 B；load5<10 且（非 Claude 前台或 HIDIdleTime≥600 秒），不设前台豁免，不改启动 helper。每步队列最多 120 分钟。主路径中英各三任务及每张截图人工读；真实大脑与付费仍未验证。已知第二刀 build marker 守卫红不修，不拿它掩盖任何其他红。账本首次推送按协调例外改 reviewed，列全部真实产品提交与类级检查，保持未 fixed。

多素材工作流的补充实现前反例：现役画布一旦识别显式合同，就只按合同槽出输入，不能仅保存旧 image-url 参数却只投第一张图。生成边界将同类多输入编成现有数组槽，逐节点模板使用该数组的明确序号；单图仍走首帧，视频/音频使用既有数组参考槽。共享编译器校验所有槽的字段、数量与 wire，必需图片声明仍需 referenceParam/referenceShape。反例用两图加视频/音频的工作流，检查每个模板输入与现役画布槽链；去掉一个引用事实必须拒绝。此处不改 renderer，也不引入供应商判断。

### 第一刀第 4 轮：实现前合同（协调 10-31 裁定）

上一轮全量测试留下两个停点。这一轮再加一条：旧路由不能成死路。下面先写合同和反例，再写失败测试，最后才改产品代码。

#### 停点 1：标准草稿的文生视频读了没声明的首帧

已核事实：

- `NEWAPI_VIDEO_CREATE_OP.body.image` 读 `request.params.image_url`，文生和图生共用这一个 op。
- 这个值只由 `taskTemplateParams` 填（`firstReferenceImage`）。请求不带参考时它是 undefined，模板整键丢弃。所以纯文生视频本来就发不出 `image`。
- 画布文生模式的合同没有槽，渲染层按合同清掉参考。只有绕过画布、自己带首帧又走 `text_to_video` 的调用才会用到这个键。

修法修在生产者：`buildOpenAiCompatibleDraft` 的文生模式去掉顶层参考读取，判据是现役参考键表，不是键名、供应商或模型名。图生模式不变。`promotionMeta.ts` 的校验不放松。

不改 `newapiTransportFor("video")`：`catalogCommit` 的 reconcile 按 `params` 补缺键，文生 op 没了 `image`，它会往 body 补一个 `image_url` 字段，真实请求反而变形。

为什么不影响已有中转：

- 目录里已经存着的路由不改写，只有重新验证通过的才换成新形状。
- 纯文生请求，新旧报文逐字节相同。
- 带着首帧走文生的无界面调用，以前把 `image` 发给文生路由；现在由现役第三道闸在花钱前拒发，并指向图生模式。
- 图生视频的 `image` 不变，`relayConformanceVideoAudio` 继续钉住。

#### 停点 2：归属判定表

判定只收在 `assertDeclaredReplacementOwnership`。按事实判，不看供应商、模型名。不新增生命周期状态。

| 现有路由 | 认证晋升 | 声明重交 |
|---|---|---|
| 带 `modeId` | 拒绝，路由不动 | 拒绝，走出口 |
| wire 和这次要写的一样（不算启用开关） | 可替换 | 可替换 |
| 有归属记录，digest 对得上（不算启用开关） | 可替换 | 可替换 |
| 有归属记录，digest 对不上 | 拒绝：独立编辑 | 拒绝：独立编辑，走出口 |
| 没有归属记录，本轮认证验过这个 taskKind | 可替换 | 不适用 |
| 没有归属记录，本轮认证没验过这个 taskKind | 保留原样，不进这次的归属记录，也不发布 | 不适用 |
| 没有归属记录，声明重交 | 不适用 | 拒绝，走出口 |
| 其他模型、其他连接 | 不进判定，不动 | 不进判定，不动 |

能力合同：有归属记录且 digest 对不上，或没有归属记录且和这次不同，两种写入都拒绝。文本模型不走媒体路由，现有行没有判定，也不动。

没验过的那一格是本轮补的：改了 Key 的连接会被撤下发布，下一次认证落在原连接上。常见情形是文生图通过、改图没通过。这时整次拒绝，等于验过的路由也发布不了；主线的做法也是留着失败模式的旧路由。

#### 第 3 条：旧路由不能成死路

场景：用户在旧版本接过中转，留下旧版猜的路由，没有归属记录。Agent 读文档交了一张正确的卡，wire 不同。这是接不上的主要人群。

拒绝保留。回给 Agent 的结果改成结构化：

- `code: "route_conflict"`，不再是「改字段再交一次」。改卡改不好这件事。
- `conflicts`：一次列全每个模型的每条冲突（模型、taskKind、modeId、原因、现有和新的 method + path）。
- `consequence`：不改会怎样。这张卡没生效，模型继续发到现有路由。
- `exits`：下一步能做什么，每步是可以直接调的工具和参数。

两个出口都是现有动作，不加参数、不加流程：

1. `replace_model`（要用户确认）：`nomi_read target=models` 取指纹 → `nomi_remove_provider` 只删冲突的模型 → 同一张卡重交。连接、Key、其他模型不动。
2. `separate_connection`：同一张卡换一个新的连接名重交，不传 `vendorKey`。旧模型和手改路由全保留，新连接要再存一次 Key。

矩阵用真实工具入口把这两个出口都走一遍（schema 校验 + dispatch），覆盖没有归属记录、独立编辑、带 `modeId`、能力合同被改、声明不完整重交五种。

#### 跑测试时查出来的第四件：拒绝不能留在恢复日志里

`promote` 现在会拒绝，而恢复日志把抛错当成「可能已提交」，条目停在提交中。之后任何模型的认证都要先重放它，再抛一次，于是**别的模型也发布不了**，一直停在验证中。这是本线前几轮引入的。复现已有：`promotionRejection.integration.test.ts`。

修法只动 `serviceCatalog.ts`：运行失败后 `catalog.fail` 已把模型写成 `state: failed`，失败的运行不再持有发布租约，重放得到 `no-lease`，条目转 aborted。第一次拒绝仍然抛，用户看到真实原因，运行转 failed。

只靠终态写入还差一个窗口：恢复日志跨连接共用，进程死在「拒绝之后、终态写入之前」，这条连接的租约就留着，重启后每条连接的认证都先撞它。所以拒绝时在 `promote` 这一次调用里就交回租约。矩阵用「另一条连接 + 重启」钉这一格。

#### 编译错误清掉后露出的第五件：认证过的中转行掉出型号名矩阵

`vendorScopedModelId.matrix` 以前卡在收集阶段，一条都没跑过。编译错误清掉后，前提那格「用户自建中转的行进了格子」红了。原因：这一线起，认证晋升给中转行写了能力合同，合同优先于共享档案，而合同产出的档案上没有型号名；矩阵只收档案上有型号名的行，所以中转行全部掉出去，后面的格子对它们是空转。

修法一行：合同产出的档案说明它来自哪一行（`catalogModelKey` 就是这一行自己的 key）。这是事实，不是为了过测试造的名字：作用域收窄时它照样被去掉，生产路径行为不变；矩阵因此重新覆盖合同行，宿主归一和画布发出两条路都真核到出站型号。

合同不是所有中转行都有。走直连手填的行没有合同，仍按身份解析共享档案，只给参数、不给型号名。这条路本线没改，但矩阵的夹具不再产出这种行，所以补一格钉住。

这件事的产品含义要明说：中转行认证通过后，参数来自它自己的合同，不再来自同名共享档案。这是本线一开始定的方向（画布显示的要和实发一致），不是这轮新决定，写进报告让协调知道它的连带面。

#### 手填对照走查的结论

同一条走查在 `origin/main` 的构建上中英都能走完，所以「自检后启用超时」是这条线上一轮引入的：新编译器拒了标准草稿，自检过不了。停点 1 修好后，这条线上中英都转绿，不用另修。

主线走得完，不等于主线是对的。卡只声明文生时，主线的模型还发布着图生模式，请求里也没有卡声明的清晰度；这条线上两处都对。

这条走查还露出一件没修的事：外部进程交卡时窗口开着，渲染层不刷新。模型本来就在列表里的话，画布继续用旧合同，参数条是「16:9 · 5s」，真实请求 `duration` 发 5（卡的默认是 1），界面没有提示。交卡后刷新窗口再建节点，参数条变成「360p · 1s」，请求发 1。所以目录是对的，旧的是渲染层。裁定把「picker 要 reload」留给后续，这里补一句：它不只是模型看不见，还可能按旧参数花一次钱。

另一件：确认窗对声明了内联图片的连接仍提示「上传到公共临时托管」，实际走的是内联。`resolveAssetUploadConsent` 不读连接的 `assetIngestion`。不是这条线改的，留后续。

#### ★9 子清单（第 4 轮）

1. 真实标准草稿三扇门（`genericCompilation`、`builtinDraftForUndocumentedEndpoint`、`buildOpenAiCompatibleDraft`）接进 `promotionCallerMatrix`，门从 door-map 普查取数。文生模式不读参考键，图生必需首帧 min=max=1。
2. `electron/parity/vendorScopedModelId.matrix.test.ts` 原样转绿，文件不改。
3. `promotionMappings.test.ts > replaces an existing exact mapping when the new candidate verifies` 原样转绿，文件不改。
4. 判定表每格一条矩阵，认证和声明两种写入都走真实目录事务。
5. 第 3 条先红：现状是 `provider_failed` + 「改字段再交」。修后两个出口真走通；其他模型、其他连接逐字节不变；已存 Key 不丢。
6. 拒绝后再认证别的模型能完成，恢复日志不再卡住；被拒模型的路由不变。
7. 手填对照走查：同一条走查在 `origin/main` 的构建上对照一次，判明是本线引入还是既有。
8. 改到的走查中英真跑，截图逐张读；`pnpm run gates`、推送前快检尾行进报告。

#### 反例（第 4 轮，按字节还原）

- 把文生模式的参考读取放回去：标准草稿矩阵红。
- 声明重交按验证通过处理（放行没有归属记录的路由）：判定表、出口矩阵红。
- 认证晋升不放行本轮验过的路由：`promotionMappings` 原测试和判定表红。
- 带 `modeId` 的路由放行：判定表红。
- 出口少给模型列表：出口矩阵红。
- 失败的运行继续持有租约：恢复日志矩阵红。
- 拒绝时不当场交回租约（等终态写入）：重启那一格红。
- 没验过的旧路由被覆盖、被认领进归属记录、被弄丢：判定表红。
- `route_conflict` 退回成「改字段再交」：出口矩阵红。
- 合同产出的档案不说它来自哪一行：型号名矩阵前提那格红。
- 启用开关算进 wire：判定表红。
- 能力合同不判：判定表、出口矩阵红。
- 替换出口不要用户确认：出口矩阵红。

不做：按供应商或模型名分支；放松 `promotionMeta.ts` 校验；新增「确认后替换」参数或流程；改 `service.ts`、`providerAdapterCoordinator.ts`、`promotionJournal.ts`；改既有测试。能力页英文轨的自定义模式标题仍是中文、外进程交卡后 picker 要 reload，两件写进报告留后续。

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

- [x] 标准三段 + 复数 generations URL + 旧用户单数 URL，生产函数、真 loopback HTTP、可解码落库；每条 POST=1。
- [x] 文本 multipart 不上传文件；文件字段半对、空 multipart、媒体声明放错 stage/kind 一律拒绝。
- [x] HTML/JSON 错误、错误 MIME、坏 MP4、超大文件、慢流、鉴权重定向、落盘失败、取消：不得发布资产，任务号保留。
- [x] 重启清缓存重建后只 GET 重新取回（主进程运行时这一层，冷进程测试为证）；未知协议在任何 POST 前停止，原有显式 mapping 不改写；POST 失败不换路由。**不覆盖、已知问题**：真实画布 Run 路上，关窗或重启后由观察者接手时取回失败一次，免费「重新取回」就失效，主按钮还会再下一单（POST=2）。这是既有问题，不是本 PR 引入，另开 PR 修（验收 B4）；窗口一直开着时失败再好，GET 照常，POST=1。
- [x] 把本刀四条 it.fails 改普通 it；红灯保存；删字节分支矩阵必须红，再原样还原。
- [x] 长视频256MiB/2GiB流：额外RSS p95各≤160MiB、两档p95差≤32MiB；4路256MiB并发p95≤单路实测p95×2。每组5轮、取消≤1s、记录落盘；高负载noisy，超标停报。
- [x] 中英文隔离窗口，AI 交声明卡→画布→资产可播；共步骤零费用演练先过，付费脚本仅供协调执行。
- [ ] gates / 推送前快检退出 0；独立验收由协调负责，未合入不写已解决。

反例必须保留失败计数：缺 taskId 不伪造服务商编号；thumbnail 不是 video；Bearer 不随 redirect；过期地址只 GET 原单；显式旧 URL mapping 不静默迁移；未知连接不以模型名/品牌选择路由。create 不走媒体响应下载，不能下载前丢掉受理收据。

依赖生命周期：保留现役 Fetch/FormData/Node 流与项目资产解码边界，不安装 SDK。协议实现没有 SDK 版本依赖；后续只有该协议无法由通用执行器表达时再评估依赖替换。

### 第二刀首轮验收历史（已由后续裁定与收据更新）

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

拆分首批收据：30样本正常结束，但末段load5从9.85升到10.22，整批noisy，不给整批预算结论。首1KiB额外RSS中位/p95 1.12/2.66MiB；预热256MiB为102.19/105.69MiB，预热2GiB为119.22/134.86MiB。256MiB的5轮均load5<10，2GiB末2轮跨阈值，不能借整体noisy掩盖已有下载增量，也不能将其解释为首fetch初始化。main保留200MiB上限，10次大请求均策略拒绝。

量具反例补充：初始load5<10不保证整批安静。下一批在<8时才入场，样本noisy判据仍为>=10，RSS预算仍64MiB；25分钟等待上限不变。任何下载超64均继续阶段诊断，哪怕后续样本noisy也保留定位数据、不给硬预算结论，避免被噪声分支跳过定位。


### ★7 拆分与阶段诊断最终收据（10-31）

同一量具60个独立客户端、各组5轮；每客户端独立生产者，1KiB预热后量下载，无强制GC。Node v24.13.1 / bundled Undici 7.18.2，Apple M5 darwin arm64。load5全程7.67–8.03，noisy=false。采样源码ee1ec0274；main对照固定为收据中的56c3c1542（不依赖后续移动的远端引用），取回函数及依赖共7个文件相对该SHA逐项无diff。main保留200MiB限制，大请求全部拒绝，不能以其小内存作为成功下载基线；main无鉴权/content对应路径。

以下均为导入相同生产宿主模块后的阶段峰值增量，5ms采样加结束采样；每格为中位/p95，5轮的p95等于本组最坏值。arrayBuffers包含于external，不相加。

| 实现/阶段/规模 | RSS 中位/p95 MiB | heapUsed 中位/p95 MiB | external 中位/p95 MiB | arrayBuffers 中位/p95 MiB | 结果 |
|---|---|---|---|---|---|
| relay-stream/cold-init/1KiB | 1.06/1.19 | 0.54/0.55 | 0.18/0.18 | 0.05/0.05 | initialized |
| relay-stream/warm-download/256MiB | 103.50/111.98 | 2.24/3.06 | 79.20/88.57 | 76.61/79.54 | downloaded |
| relay-stream/warm-download/2048MiB | 123.11/131.34 | 1.94/2.98 | 86.44/92.30 | 84.97/86.35 | downloaded |
| main-url-buffer/cold-init/1KiB | 1.31/1.36 | 0.81/0.81 | 0.00/0.00 | 0.00/0.00 | initialized |
| main-url-buffer/warm-download/256MiB | 0.50/0.52 | 1.01/1.22 | 0.13/0.13 | 0.06/0.06 | policy-refused |
| main-url-buffer/warm-download/2048MiB | 0.50/0.52 | 1.15/1.26 | 0.13/0.13 | 0.06/0.06 | policy-refused |
| receive-drain/warm-download/256MiB | 119.84/126.81 | 3.40/3.69 | 94.90/104.78 | 91.95/97.28 | drained |
| receive-drain/warm-download/2048MiB | 123.42/129.67 | 3.40/3.69 | 93.44/103.30 | 93.35/97.23 | drained |
| bridge-drain/warm-download/256MiB | 108.67/123.42 | 3.30/5.40 | 85.39/100.14 | 80.92/89.80 | drained |
| bridge-drain/warm-download/2048MiB | 124.09/136.23 | 4.94/5.33 | 96.38/100.13 | 95.03/100.05 | drained |
| byob-drain/warm-download/256MiB | 115.89/118.45 | 4.99/5.32 | 92.55/98.28 | 86.47/92.49 | drained |
| byob-drain/warm-download/2048MiB | 125.67/134.62 | 5.03/6.15 | 97.28/105.28 | 97.22/105.22 | drained |

生产写盘：256MiB传输/落盘中位/p95 227.40/280.79ms，取消3.51/5.40ms；2GiB为1656.36/4138.25ms，取消3.52/11.44ms。取消≤1s通过，RSS≤64MiB失败。响应头到达时RSS增量最大0.41MiB，主要增量出现在正文消费阶段；首1KiB仅约1MiB，不能采用“首fetch初始化解释了超标”的结论，也没有满足裁定中更新预算口径的前提。预算不放宽，尚不可进入后续窗口/演练步骤。

原生运行时源码核对：Node bundled Undici 7.18.2在Fetch正文接收时为每块构造`new Uint8Array(bytes)`再enqueue，并在desiredSize<=0时返回（有背压）。[Node BYOB文档](https://nodejs.org/docs/latest-v24.x/api/webstreams.html#class-readablestreambyobreader)说明缓冲转移语义；诊断使用独立ArrayBuffer、消费后复用，没有池Buffer。受控对照能将超额出现阶段缩到原生Fetch正文接收/消费，不能据此把全部RSS精确归因到某一分配点；没有拍脑袋加GC、节流或供应商分支。

接收/消费阶段在没有Node桥接、没有写盘时已超64MiB；BYOB复用64KiB缓冲也超。未将诊断方案接入生产，未改vendorHttp/appFetch。下一步建议在共享HTTP出口做原生Fetch分配剖析及通用流式接收方案评估，涉及本次禁止的共享层，按22:1x第3项停在第4步带数交回。不能宣称已证明Fetch无背压或内存泄漏。

原始量具命令不变；原始数据/统计/四指标表由执行者证据目录保存。统一perf-scenario仍为“未验证：缺量具（统一场景没有文件流 / 内存驱动）”，没有改共享driver。先前noisy批次单独封存，不与这60个安静样本合算。


### ★7 新预算与续做合同（协调10-31 00:3x，动手前）

协调依据实测裁定：首fetch约1MiB，主要是正文消费期间尚未回收的临时缓冲；256MiB/2GiB p95约112/131MiB，没有按文件8倍增长，JS堆只多几MiB。main旧URL取回整文件缓冲并在200MiB拒绝大文件；现有流式路径允许大文件，不为本地回环极端吞吐下几十MiB瞬时开销改共享HTTP层。因此替换原先拍定的64MiB预算，守「峰值有界、不随文件变大、不随个数线性涨」。保留历史失败数据，不把新预算写成原预算通过。

新合同：单路256MiB、单路2GiB，额外RSS p95各≤160MiB，二者p95绝对差≤32MiB；新增4×256MiB同时下载，每组5个新客户端，进程级总额外RSS p95≤同机单路256MiB p95×2。只认load5<10的安静样本。超标停报，不再改预算。取消≤1s、记录落盘时间的约束不变。Windows弱机：未验证：缺 Windows 测试机。

实现前反例：四路必须同进程同时接收/落盘，不能四个独立进程的RSS取平均；必须证明4个上游大响应同时活跃，全部完整落盘，不能先后排队冒充并发；四路峰值不是单路数值乘4；高负载/丢样/少于5轮不登记安静基线。单路与并发使用相同宿主、1KiB预热、隔离数据目录、生产流式函数，内存只量客户端。不得用GC/节流改读数。

通用性能驱动约定：在perf-scenarios-lib新增一个明确的node JSON驱动，现有UI驱动和场景不改。通过通用Node包装脚本在子进程执行仓库内量具，传统一runs/out参数，消费统一JSON metrics（每指标一组有限数值），无供应商/中转判断；新增通用内存MiB、传输/取消ms指标。无结果、非零退出、坏JSON、noisy、非数值/丢样须拒绝，不能过滤成好样本。三条取回场景各5轮、budgetStatistic=p95；单路主指标RSS，并发主指标为相对同批单路p95的内存比值（预算2），同时保留RSS原值。2GiB与并发场景每次都在新客户端补5轮256MiB参考；量具自动拒绝参考超160MiB、跨规模p95差超32MiB或并发p95超参考两倍，不能只靠正文人工检查。原始检查先比RSS，再算比值，避免比值四舍五入掩盖轻微超标。按协调本次明确授权写入实际基线；不伪造pending基线，不改现有UI场景。

后续顺序：并发实测通过→通用驱动/三场景统一实测→merge最新origin/main→槽B构建/中英两协议窗口/中英共步骤免费演练→完整gates/快检。起窗为load5<10且（前台非Claude或HIDIdleTime≥600秒），继续使用安静启动器，不设置前台放行。试跑无项目身份时二进制结果在花钱前拒，作为已知限制，交独占线处理。共享responseParsing/taskResultReading及调用点状态仍不动。


四路先行收据：5个新客户端，4个大响应同时活跃，逐个完整落盘256MiB，每轮总1GiB，load5 7.57–7.68，noisy=false。使用现役统一线性插值统计，旧单路256MiB中位/p95为103.5/110.3MiB，2GiB为123.1/130.8MiB，差20.5MiB；四路为135.8/139.3MiB，比值1.263，低于220.6MiB上限。不同统计口径不混用：此前原始诊断5轮用保守nearest-rank（p95=最坏），协调引用112/131；统一场景使用现役线性插值，所有比较重算同口径。此项通过后开始通用驱动；当前不是统一场景基线，也未通过窗口/gates验收。


### ★7 统一场景基线（10-31，已实测）

按本次协调明确授权，从三次`pnpm run perf:scenarios -- --id <id> --measure-only --out <file>`的原始JSON登记基线。三个执行头均ddddcc680，dirty=false，同一源码树；25个独立客户端（15个目标样本、10个同批参考），每组5轮，load5全程4.77–7.89，全部安静。机器darwin arm64 Apple M5 x10 / 24GB，Node v24.13.1；日期为10-31台北（原始报告UTC日期10-30）。没有改旧UI场景。

| 场景 | 主指标 | 中位 / p95 | 预算 | RSS中位/p95 MiB |
|---|---|---|---|---|
| relay-content-fetch-256m | rssMiB | 106.0 / 107.7 | 160 | 106.0 / 107.7 |
| relay-content-fetch-2g | rssMiB | 119.0 / 130.4 | 160 | 119.0 / 130.4 |
| relay-content-fetch-4x256m | memoryGrowthRatio | 1.3 / 1.3 | 2 | 142.9 / 151.7 |

单路两档p95差22.7MiB≤32；2GiB同批参考p95 107.3，差23.1。四路同批参考p95 113.5，原始RSS比值151.7/113.5=1.337≤2（统一比值表按0.1显示）；即使对第一场单路107.7比较也只有1.409倍。每个并发样本上游最大活跃响应=4、收到并写完总1GiB。原始RSS关系检查在比值四舍五入前执行。

传输/临时写盘中位/p95：256MiB为212.5/297.7ms，2GiB为1948.4/3369.5ms，四路总1GiB为774.7/853.0ms；两单路函数取消p95为12.2/26.4ms，均≤1s。不包含TLS、解码发布或界面取消。Windows弱机：未验证：缺 Windows 测试机。

三条基线去掉pending，按授权标approved。原始结果含统一指标数组、同批参考及25个客户端原始样本：[性能原始证据](../../tests/perf/evidence/2026-10-31-relay-media.json)。每条JSON指标都与量具日志逐个核对，未过滤坏样本、未重算成有利口径。新预算达标，不代表原64MiB预算被修好；没有修改共享HTTP层。真窗/演练及完整门岗仍须后续取得收据。

第二刀真窗续验：首轮中文在新卡投影可用但模型菜单缺席处失败，0 POST。重载会丢失节点选中，走查须用真实命中点重新选中；补只读的节点/按video过滤目录证据，不能直接写节点模型或修改投影/picker来过验收。反例：目录行可用而菜单仍无目标时仍记失败，不声称出片。

英文复测证明：重载后的菜单DOM已含opaque-gamma，但适应视图自动258%造成composer/选项出屏，点击等待失败。因此几何量具改用现有缩放UI明确100%，不强制点击、不放宽可见性或延长超时；菜单初次缓存缺席及重载需求仍如实记。

第二刀补齐重启验收量具：既有清taskCache只证明缓存重建，不足以称冷进程重启。追加独立Vitest子进程：相同隔离settings/projects，仅读已持久化的poll身份，初始taskCache为空；只GET原任务，真实解码落库，父进程核POST仍1及MP4逐字节一致。反例：不复制进程内项目/任务状态，不在子进程重新create/交卡；磁盘恢复或取回失败必须红，不能写成已验证。此项只扩充本刀测试，禁止为过验收改共享状态解析器。

冷进程补验已过：19项矩阵全绿；独立子进程初始taskCache=0、只读磁盘身份后GET取回并解码落库，父进程核对POST仍1与MP4逐字节相同。新增矩阵再次删掉runtime字节分支：8 failed/11 passed、exit1；源码SHA256逐字节还原后19 passed、exit0（resume4-cold-mutation-restore.json）。全程没有修改产品实现或状态解析器。

### 第二刀最终真窗与演练收据（10-31）

槽B构建退出0。标准`/v1/videos`＋`/content`和文档声明的复数generations＋URL，两条各中英，共4次最终真窗均退出0，含安静守卫；前台loginwindow，load5为5.35–6.21，空闲3415–3537秒。每次交声明前POST=0，点击生成后POST=1、上游任务=1；真实项目资产落库，H264解码、nomi-local播放readyState=4、videoWidth=16。夹具是16×16/0.2s蓝色视频，不冒充真实供应商画面或时长验收。声明通过隔离stdio MCP调用生产提交处理函数，未使用真实LLM。

共用付费步骤的零费用演练中英各退出0，均通过现有可见能力编辑器配置1s/360p/无音轨，真实按钮发1次模拟POST、1个模拟任务，落库可播；脱敏录包每次4行。实际付费次数=0。所有历史失败与最终成功的266张PNG（含自动feel）逐张view_image亲读；初次几何/弹层/录包origin修复及安静守卫红灯均保留，最终未改守卫、未设前台放行。

明确限制：声明后模型列表需要重载；主走查画布仍显示旧首尾帧槽且缺中性参数控件，演练通过可见能力编辑器补最低参数，能力投影由独占线补齐。本刀证明正确声明的编译/执行/物化，未证明真实AI自主读文档全流程。试跑缺项目身份的二进制结果仍花钱前拒；全局状态封闭、只准选协议档、真实付费与独立验收未完成。完整gates与推送前快检另以真实收据登记。

### 第二刀完整门岗红灯后的同责收口（动手前）

首次完整gates实际退出1：107道中100通过，7阻断（体积、i18n、hooks、concept-owner、lint、boundary-owner、generation-entrances）。不改判据、容差、baseline；检查器自动收紧的i18n表逐字节恢复HEAD。视觉实验室136差异/21通过属于现役本机参考，检查本身退出0，不冒充像素全绿。

同责处理：runtime冻结665，现720。将文件响应的校验/下载接线和已物化回执归一化移入现有generationOutputMaterializer，同提交删原内联实现。请求构造仍只在runtime共用buildProfileHttpRequest一次：文件响应先校验角色，延迟消费该共同构造出的请求，避免第2个构造点；JSON/process/multipart语义不变，标准三段仍只生成一次。空multipart与半文件对同属不完整声明，用一个准确的既有错误类别，删除新增并行文案分支；不改翻译表。走查文案从uiText取两轨键值，不复制字面量。测试显式引用Node内建对象，JSON解析错误保留cause；CJS观察器沿仓库现有process.getBuiltinModule模式取fs（项目Node>=22.19，Electron内置Node24），不加依赖或lint豁免。

本次删旧/加测试必须补正常登记：旧noteRelayQueryOutcome自动换通道不变量已被20:0x裁定反转，记retirement，不伪造改锚；已存在relay/媒体取回/性能场景概念登记现役共享边界。录包JSON数据测试保留readdir与断言，在现役SCAN_GUARDS正常登记数据目录与源码依赖，进入推送前批量测试，不加NOT_SOURCE_SCANS特例、不改识别器。路径预查fix-churn未命中新热点；暂存检查若出现裁定外新热点照任务停报。

反例：不能压行、抬665上限、恢复默认路由或为不同端点新开builder；不能删录包测试/改写readdir躲扫描；不能加白名单或lint-disable；不能把退役写成无因消失。19项生产HTTP矩阵及字节分支删除反例必须保持红绿；重核请求构造入口、typecheck、完整gates和快检。改动的中英走查和演练再真跑并逐张读图。性能量具所量streamProfileMediaToFile与vendorHttp正文接收保持字节相同，旧正式性能数据保留其实际测量头，不冒充新采样。

### 第二刀第三轮：验收 V-relay-protocol 后的三处修复（10-31，用户「都按推荐」）

只修验收抓到的 B1 / B2 / B3；B4 与 M1–M8 不在本轮。
- B2 合法 MP4 因标签被拒：字节路改问 URL 路的 `isAllowedContentType` 加同一份按种类的白名单，只拒明确不是视频的类型；没表态的 octet-stream / 空类型进发布边界的字节校验（说谎的 HTML、JSON 仍被拦，矩阵有行）。
- B3 总时限掐断下载：文件响应拿到响应头后，整次请求的 120 秒总定时器让位给取回预算那一份数字（空闲时限 + 按声明大小放宽的总上限，2GiB 一档并进同一个公式）；JSON / 二进制响应不动，配对测试钉住。
- B1 门岗可绕过：概念门认退役要有棘轮参照上的凭据，`readLedger` 强制 reason；三种绕过写法进测试表。
- 验证：验收线复现 B2 两条、B3 一条转绿，B1 复现退出 0；B4 四条仍红（未动，预期）。协议矩阵 35 项、`vendorHttp` 33 项、门岗 node 测试 121 项通过；受影响的 445 个测试文件全过；类型检查退出 0；构建后中英零费用演练退出 0（POST=1，成品落库可播放）。
- 已知问题（不在本轮）：①B4，关窗或重启后取回失败一次，主按钮再下一单，既有问题，另开 PR。②渲染层等待短于主进程现在合法的下载：画布轮询一格最长 5 分钟，字节路不广播「开始落地」，所以超过约 5 分钟的下载（256KiB/s 的最慢速度下约 75MiB 以上）渲染层先判「可找回」而主进程还在下载；`generationPhaseDeadline` 读过未改，另开线处理。

## 两刀合并收据（10-31，协议那一刀进主线之后）

只并主线、解冲突、清合并后的红，两刀的决定都没改。产品文件没动，下面的改动都在测试夹具和走查里。

**走查现在一条线走两刀。** 声明卡 → 画布上投影出的控件（能力投影）→ 一次 POST → 查询、取回、落库（协议与物化）。共用步骤不再经过手工补能力表单，`_relayVideoCapabilityUi.mjs` 保持删除：主线给它的三处改动（键盘开默认值开关、存盘后用 proveProbe 判缺席、先关模型详情再关设置）都服务于这条绕路，绕路没了就都用不上。先关详情那一步在 `relay-capability-projection.walk.mjs` 里本来就有。

**定位节点合成一个。** 缩放走现有 UI、点节点用真实命中点（协议线）；语言按当前轨取词条、缩到 60%（能力线）。100% 时带输入位的模式和模型列表会出屏，重载后适应视图会放大到出屏，两种情形 60% 都盖住。

**手填对照不在接入走查里了。** 协议线把手动自检那段删了：没有协议事实的视频模型没有默认通道，自检走不到启用。第 4 轮 ★9 第 7 条是合并前的记录。合并后这条走查从保存连接直接到 AI 交卡。合并后的构建上补走过一次手填：手填 ID、类型选视频、自检，0 次 POST，模型不发布，卡上说「这类模型没有通用的接口标准」；紧接着 AI 对同一个模型交卡，直接发布，手填失败不留后患。

**合并后清的三处红。**

- `vendorScopedModelId.matrix > 自建中转的行在两侧清单里都列着`：主线已经给夹具带上协议事实（`483057c9a`），合并后本来就绿，文件没动。判据是夹具该带事实，不是断言该放松：把夹具的协议事实拿掉，这一格照样红（1 failed | 503 passed，和试合并时同一句报错），所以发布规则还在起作用。
- `tests/relay-onboarding/contracts.test.mjs` 14 条 `path is not defined`：合并把主线的 `import path` 那行换成了这边的 `import { Buffer }`，`path` 没了，`Buffer` 重复。恢复主线文件头。
- `tests/relay-onboarding/protocol.test.mjs`：夹具卡撞编译规则。改夹具，编译规则没动。`content` 形状的尺寸控件改中性键 `resolution`，multipart 的 `seconds` 读 `duration`、`size` 读 `resolution`；`legacy-url` 的 `size` 读 `resolution`。原断言 `{ seconds: '4', size: '1280x720' }` 一个字没改，只是这两个值现在来自可见控件的默认值，不再是卡里的字面量，比原来严。纯文本字段的字面量 multipart 仍由 `contracts.test.mjs` 那条直接校验，没有丢。

**合并露出的两件（用户 2026-10-31 批了一轮窄修，已修，见 `docs/engineering/direction-checks/2026-10-31-relay-capability-narrow-fix.md`）。** 都是花钱之前就停住，不多扣钱，不丢数据。下面是当时的现象：创建门两句和运行入口那句现在带机器码，画布上指去模型接入；中性键的提示改成线缆字段读中性键，同步样例改用中性键。

1. 声明撤掉的模式被创建门先拦下：`assertDeclaredCapabilityForTask` 抛 `Declaration does not publish taskKind: …`，主线 `483057c9a` 为同一种情形加的测试在合并后红（`protocol.test.mjs > a model that only declared image-to-video…`）。声明不完整那一句同类。真窗实测：窗口开着时 AI 把文生撤掉，再点生成，0 次 POST、没有确认窗，卡上是「这次生成没有发出去，停在了这台电脑上」，列的原因是网络、密钥、素材，主按钮重试，重试还是这张卡；运行几秒内落成错误，不会卡死，刷新后目录是对的。画布这条路上提交箱会把这句包成 `submission_not_sent`，分类器看这个码在看文案之前，所以只改文案（比如前缀 `Model is not configured`）只修无界面路径，画布上还是这张卡；主线那句走画布按同一条包装链也是这张卡。带机器码 `model-config` 才两条路都指去模型接入。
2. 中性键规则的提示走不通：拒绝信息让卡改用 `create.paramMap`，而交卡 schema 是严格的，不收这个键；接入套件自己的同步样例卡（参数键 `size`）照抄也被拒。直接让线缆字段读中性键可以过，但没有地方告诉 AI。

## 第 6 轮：升级时不动老模型（用户 2026-10-31 裁定）

补还是换：这是第一刀能力投影的第 6 轮，方向由用户亲自裁定。**这一轮是删，不是补。**

### 裁定

- **升级时不动老模型。** 老模型和 0.24.0 一模一样照常能用，不自动变准；想要准确的参数条，走 AI 重新交卡。目录版本不升（仍是 13），退回 0.24.0 时目录还能写。
- **替换的过程中要考虑老用户的迁移。** 这是长期要遵守的一条：以后任何替换旧实现的改动，验收标准都包括老用户视角，用旧版本真实落下的数据，不用手写的形状。

### 为什么

第一刀带了一个目录迁移：升到 14 时用新的严格编译器去编旧 revision，编不过就盖“能力缺失”印记，盖了就不发布、不让发。最后一关验收用旧版本真实落的目录复现：

| 旧目录 | 主线（`03c4c8fb3`） | 带迁移的分支头（`bd40dc0b5`） |
|---|---|---|
| 0.24.0 向导接的：图片 2 + 视频 3 | 5 行都在，都发请求 | 视频 3 行消失、被拒 |
| 0.20.0 向导接的：图片 2 + 视频 3 | 5 行都在 | 5 行全消失 |
| 0.24.0 开机体检切过原生报文：6 行 | 6 行都在 | 视频 4 行消失 |
| 0.24.0 AI 交卡：1 行 | 在 | 消失 |
| 0.24.0 向导接的音频：2 行 | 在 | 在 |

向导重新验证也变差：主线上老视频行重新验证失败，老行照常能用；分支头上老行先被下架，验证失败后变成停用。根因复盘见 `docs/engineering/direction-checks/2026-10-31-relay-capability-old-models.md`。

### 做了什么

- 撤掉把 13 个走查夹具改成“写当前目录版本”的提交：它摘掉了唯一的报警。
- 删迁移：`catalogMigrations.ts`、`catalogStore.ts`、`catalogVersion.json`、`types.ts`、`providerAdapter/store.ts` 与主线逐字一致；没有 `migrateDeclaredCapabilities`、`migrateStoredCatalog`、`readProviderAdapterRevisions`，没有“能力缺失”印记，登记和晋升也不再清它（没有发布过的版本写过它，不留清理代码）。
- `missingDeclaredCapabilityFields` 只剩“有归属记录、写过媒体合同、但合同解析不出”那一支（新交卡的模型在设置里点了“恢复默认”的已知情况，没改）。
- `derivePublishedExecution` 的合同过滤只管带归属记录的行（新交卡）。手写了半份合同（只写文生、路由还有图生）的老行按主线发布，不再丢图生。第一刀 ★9 第 3 项“声明整份替换”的现有测试不放宽。
- `declarationSource`（登记时存下的原卡）继续写：原卡以后补不回来。现在只写不读，没有读者；它是以后重交卡和向人解释时用的原卡。
- 真实旧目录进 CI：`tests/fixtures/old-user-data/`（五份旧版本真实函数落的目录和三个生成脚本，全是假 Key）和 `electron/catalog/upgradeKeepsWorkingModels.test.ts`；期望值从主线录，`expected.json` 里写着录自哪个提交。
- 删掉迁移测试：`declaredCapabilityMigration.test.ts`，以及 `declarationDurability.test.ts` 里断言迁移的三条；`canvasRefusalCard.test.ts`、`routeConflictExit.test.ts` 去掉对印记的引用，断言不放松。

### ★9 验收清单（第 6 轮）

1. 五份旧目录加“手写半份合同”一格：每个模型在列表，已发布模式不少于主线，每个模式 POST=1，路径和请求体和主线录的一字不差。
2. 上面五个文件和主线无差异；目录版本仍是 13，读旧目录不产生 `model-catalog.v13.bak.json`。
3. 代码、概念登记、根因合同里没有 `declarationCapabilityIssue`、`migrateDeclaredCapabilities`、`migrateStoredCatalog`、`readProviderAdapterRevisions`（本文和方向检查页的历史说明除外）。
4. 新交卡的路不变：新交卡相关的测试整组全绿，只删了上面点名的迁移测试。
5. 三条老用户的路都有测试：什么都不做；向导重新验证老视频行失败（老行还在、还能发）；AI 重新交卡（第一次 `route_conflict` 且什么都没写，确认前老行照常 POST=1，走替换出口后新卡生效、别的模型不动、Key 还在）。
6. 撤掉夹具改动的提交在历史里，走查夹具回到原样。

反例（改坏 → 看红 → 按字节还原）：让 `missingDeclaredCapabilityFields` 对没有归属记录的老行也返回缺失字段；把发布过滤放回对所有带合同的行；`expected.json` 里改一个字；在 `catalogMigrations.ts` 里加回一步“给老行盖字段让它不发布”。

### 已知限制

老模型不会自动变准：参数条保持上一版的样子。要准确的参数条，让 AI 重新交一张卡；路由已经存在时它会先被拒、什么都不写，老模型继续发，确认替换后只重建这个模型，连接、Key、别的模型不动。其他遗留（新交卡的模型点“恢复默认”之后的状态、画布旧参数超出新卡范围、手写合同未发布行的提示文案）不在这一轮。
