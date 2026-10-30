# 中转媒体接入：证据、能力与交付共用一份合同（设计卡草稿）

状态：调研与可执行复现；未批准实现。2026-10-30。
范围：测试、走查脚本和方案；本批不修改产品代码、不新增依赖、不推送。
实现前由协调确认协议子集、并行文件所有权和界面清单；本卡不提供样张。

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

## 第一刀：能力投影（实现前合同，2026-10-30）

本刀方向已获批准：主路径是 Agent 读文档、交声明卡、试跑，再到现有画布生成；声明卡不能在登记或晋升后丢失能力。只修投影，不改接入布局，不接管协议执行、结果物化或试跑防重复。以下清单在产品代码改动前记录，尚未实现或验收。

### ★9 子清单

1. **一份能力事实**：登记与认证晋升调用同一投影，产出 kind、现有 `customCapabilityContract` 和对应 wire。对照新卡、同名内置档案、无档案模型、重交卡与认证晋升；产品 modeId 与 transport taskKind 分工明确。媒体不得投成 chat；文本维持原有行为。
2. **参数保真**：声明的 duration、resolution、比例及其他合法参数，其类型、选项、范围、默认值进入合同，Agent、画布控件及实发一致。1 秒不得显示为 5 秒；分辨率必须可见。不能表达的字段组合在目录事务写入前给出字段原因，事务失败不留半张卡。
3. **声明整份替换**：两模式缩减为任一单模式，旧声明拥有的模式立即撤销，不再通过旧 mapping 或泛用路由派发。反向扩充与再次缩减均覆盖；别的模型、跨连接同名模型及独立手写合同保持。归属无法证明或用户已编辑的冲突明确拒绝，不能静默覆盖。
4. **必需引用**：仅带图模式只有 i2v，单图必需槽 `min=1/max=1`，首帧进入已有输入位；未带图在 POST 前拒绝，带图恰好到声明的参数。不得虚构 t2v、尾帧、多图、音频或全能参考。
5. **旧数据**：按原 active revision 恢复完整投影，限定 vendor/model/revision 归属、核对当前 wire 与用户编辑；幂等、重启可用，不再认证、不发 POST。找不到原卡、revision 损坏或形状表达不了时保留原记录并标“需要补充能力说明”，中英可见，不按名称借用档案。
6. **AI 路径验收**：Agent 交卡的真实处理函数为入口；两模式与仅带图两类 loopback 模型，从声明到既有画布。隔离资料、假凭据、不出网、不付费；中英分别截图参数、必需输入位和模型说明，截图逐张人工读取。真实大脑、线上服务、付费结果仍独立标 unverified。
7. **旧行为与门岗**：显式 URL 合同、图/音频/文本/3D/工作流不改协议、不追加探测。四条本刀 `it.fails` 先改普通测试观察目标断言失败，修复后保留普通测试转绿。跑 schema-v3 checker、gates 和推送前快检，记录退出码与尾行；独立验收由协调安排。

### 动手前反例

- 故意丢 parameters，登记/晋升对照矩阵必须红；故意保留旧模式，两种缩减方向都必须红；试验后按字节恢复产品文件。
- 不透明 ID、撞内置档案名、跨 vendor 同名、切换语言：合同以声明为准，身份不变，不出现 chat。
- i2v 缺 referenceParam、引用形状与 wire 不一致、参数默认值超界或不存在于选项：提交前带字段原因拒绝且无目录写入；不能靠默认参数或假参考图过关。
- 先登记双模式、再独立改其中一条 wire 或能力合同、再重交卡：不能以“归属于旧声明”为由吞掉独立编辑。
- 旧 revision 存在/缺失/损坏/属于别的连接或模型/未包含当前模式；重复启动；用户原有显式合同：只恢复可证明的缺失，不制造新能力，网络 POST=0。
- 新卡提交包含一个有效模型和一个不可表达模型：整次事务拒绝，不能留下第一个模型或 vendor 的部分修改。

### 共享类型边界（协调 10-30 17:5x 裁定）

第一刀使用现有 `AdapterModelDraft`、`AdapterModeDraft`、`CustomCapabilityContractV1`、`Mapping`，不修改 `HttpOperation`、multipart、结果响应类型。第二刀独占 wire 编码与结果类型，投影按完整操作对象传递，不能再另列白名单丢掉它新增的合法字段。单图引用先以现有 `referenceParam/referenceShape` 表达；超出既有表达力的形状明确拒绝，不加供应商分支。

### 范围核对：旧目录迁移入口已归本刀

静态追踪确认：目录加载经 `catalogStore.readCatalogShared → catalogMigrations.migrateCatalogForward`；原始 revision 保存在 `ProviderAdapterStore`，不在 `Model.meta`。现有六个独占文件没有覆盖这条加载与一次性迁移接线。只在登记/晋升里补投影不能修复从未再次交卡的旧模型；只在 Agent 说明里补也不会回到画布与派发。

要满足第 5 项，需协调分配一次性迁移与接线（至少 `electron/catalog/catalogMigrations.ts`，以及原始 revision 的只读供给与可见状态的既有出口；具体补充文件须先查清并认领）。若采用目录版本迁移，还涉及第二刀独占的 `electron/catalog/types.ts`。当前不越界改这些文件，不在共享纯读函数里偷读文件、改目录或只导出一个无人调用的迁移函数。实现前先交协调核定这段所有权。

协调已将 catalogMigrations.ts、catalogVersion.json、catalogStore.ts 的迁移接线及 store.ts 的只读 revision 供给归本刀；types.ts 仅目录版本联合那一行归本刀。modelAvailability.ts 增加 capability_incomplete 原因与缺失字段。Agent 模型说明负责引导重交；picker/i18n 留第三刀，故本刀不再以新增 UI 为前置。版本迁移幂等，至少验证原卡可恢复、原卡不可恢复、完整目录不变三类。派发前的拒绝按本次裁定落实；不改变已受理任务查询的模型解析。

第一刀实现接线核对：普通读取与启动种子均调用 migrateStoredCatalog（一次装配原始 revision 的同一入口）；不在纯迁移默认参数里读资料。为落实裁定中的“派发前按它拒发，拒发信息说清缺什么”，在创建任务经过的 taskParams.ts 参数准备门调用共享能力断言；executableModel.ts 保持原样，避免已受理任务查询被误拦，未改 runtime。声明参数与引用的旧平铺模板在投影时编译到现役 request.params 通道；每模式控件默认值同源生成 create.defaultParams，冲突在事务写入前拒绝。paramMap 的 from/fromMany 依赖复用 consumedCanonicalKeys，现有图片 multipart / JSON / chat carrier 继续走原线。


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

1. 原卡：登记同一目录事务保存本模型原始 modes/parameters、sources、omitted、openapi 等完整输入；输入对象之后被修改不影响耐久原文。原 revision 缺失仍能从保存卡恢复；无任何原文仍标能力缺失。整卡任一模型拒绝时，原卡与目录同回滚。反例：去掉原卡保存，恢复矩阵红；串模型或被独立修改的 wire 不覆盖。
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

不做：按供应商或模型名分支；放松 `promotionMeta.ts` 校验；新增「确认后替换」参数或流程；改 `service.ts`、`providerAdapterCoordinator.ts`、`promotionJournal.ts`；改既有测试。能力页英文轨的自定义模式标题仍是中文、外进程交卡后 picker 要 reload，两件写进报告留后续。
