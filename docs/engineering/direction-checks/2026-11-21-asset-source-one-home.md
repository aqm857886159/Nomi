# 方向检查：素材算不算进了项目、原件是哪份、来源记在哪，只在主进程素材库一处定

全图：一张图或一段视频从本机、内置浏览器、连接器、别的项目、工作流库、外部助手进到项目里，「它是不是本项目素材、原件是哪一份、来源记成什么」。交接处表（`docs/engineering/seams.json`）里没有素材身份 / 来源这一格，属表外。设计卡：`docs/plan/2026-11-20-asset-source-one-home.md`。
复盘来源：由没参与过前几轮修补的一条只读线，在 2026-11-20 基线（origin/main `48ad810e8`）上静态读码与提交差异写出，再与方案对照；它没有跑测试、窗口或真任务，下面的行号以该基线为准，预测以实现线跑出的对拍表为准。

### 0. 一句话根因
身份 / 来源这一类反复修，是因为「各入口可以拼元数据、存储按字节复用、调用者再拼回执」仍是三个决定点，缺一份覆盖首次写入和复用的统一落库合同；不是清洗函数写了三份（`electron/assets/localFileImport.ts:184`、`:271`，`electron/assets/uploadContentStore.ts:100-106`，`electron/assets/projectAssetStore.ts:445`、`:548`，`electron/capabilityCore/core.ts:108-132`）。

### 1. 归类表：提交 → 直接原因 → 类
`fix-churn` 重跑：`electron/assets/projectAssetStore.ts` 近 14 天 2 个 fix，下一刀是第 3 个；`src/workbench/assets/` 目录 8 个 fix、涉及 6 个生产文件，其中 2 个只改该目录的测试，不能说成 8 次用户事故。窗口内没有 revert-fix。

| 提交 / 日期 | 修的是什么（已读该提交差异） | 归类 |
|---|---|---|
| `da261bfea` / 11-08 | 已有配音字节误走用户导入门、缺生成期望类型；收回通用写口并配对类型 | 同一个毛病再修：调用者能表达错误的落盘语义 |
| `3c0e2022c` / 11-13 | 删目的地址拦截层，素材库只去掉一个出网选项及转传 | 别处带坏：出网策略造成取回受阻，对素材热点是跨域连带，不是来源丢失复发 |
| `9feea8bea` / 11-17 | 逐项列举引用漏掉分镜 / 普通参考 / 助手输入，改整份项目扫描 | 同一个毛病再修：存活事实不全 |
| `4aecaf531` / 11-17 | 主干结果落地改口，存活对照测试仍调旧口 | 别处带坏：只改测试 |
| `b1f499159` / 11-17 | 会话字段归类表移到载荷组成处 | 同一个毛病再修：防漏机制移到事实产生处 |
| `0ed522f3f` / 11-17 | 空格 / 括号 / 编码地址仍漏判，补归类类型见证及探针 | 同一个毛病再修：存活表示与验收覆盖不足 |
| `4a1329146` / 11-17 | 删版本改成只摘版本、保留原件 | 同一个毛病再修：版本与文件回收意图混在一起 |
| `a40cfac61` / 11-17 | 失败重排保留旧撤销位置，挤出后反复重试 | 同一个毛病再修：删除寿命 / 重试时机，非来源问题 |
| `9ae6ca2ad` / 11-17 | 选区主人改型，普查测试删类型见证 | 别处带坏：只改测试 |
| `bad48c7d9` / 11-18 | 素材库删文件漏看可达版本撤销，补延后并沿原日志期限回收 | 同一个毛病再修：存活还包括可达撤销 |

结论：热点足以停线复盘，但这 10 个提交不全是同一根因——出网拦截与删除寿命是别的领域。

### 2. 谁在判、读哪份事实；为什么还会出现
| 层 / 职责 | 定位（基线行号） | 读的事实 / 边界 |
|---|---|---|
| 渲染：拖入、素材库引用、时间轴、节点 `@` | `src/workbench/assets/assetLibraryMaterialize.ts:28`、`:38`、`:48`；`src/workbench/assets/assetLibraryUsage.ts:78` | 来源项目 + 目标项目；别的项目先复制、投影回执；5 个消费文件 |
| 渲染：工作流独立材料化 | `src/workbench/library/WorkflowLibraryContent.tsx:39-62`、`:263` | 逐个复制并按 sourceUrl 改写；没有复制通道时 failed=0，与上一行的失败计数不同 |
| 渲染：展示与去重 | `src/workbench/assets/useAllProjectAssets.ts:60-104`；`src/workbench/assets/useAssetPool.ts:27-42` | 显示 id 不是主进程 assetId，URL 去重不是字节去重 |
| 渲染：上传与助手附件 | `src/workbench/api/assetUploadApi.ts:80`、`:111`；`src/workbench/ai/composer/useComposerAttachments.ts:74`、`:116` | 前端只做预检 / 占位，实际 id / hash / 类型来自落库回执 |
| 渲染：分镜关系 | `src/workbench/creation/storyboard/shotRow/shotReferenceSlots.ts:87`、`:148` | 只管替换 / 去重 / 解绑 / `@`，不材料化、不写 sidecar |
| 渲染：存活 / 回收 | `src/workbench/assets/assetResultDeletion.ts:218-324`；`src/workbench/assets/projectLivenessContent.ts:47`、`:71` | 整份保存内容 + 未发输入 + 会话材料，可达撤销另判延后 |
| 主：IPC、本机 / 访达 / 外部助手 | `electron/assets/assetsIpc.ts:54-198`；`electron/capabilityCore/core.ts:68-132`；`electron/assets/localFileImport.ts:213` | 三种本机调用都走本机导入，但它只构造 kind / originalName；外部助手回执另拼类型 |
| 主：复制 / 远端 / 本项目原件 | `electron/assets/projectAssetStore.ts:317-600` | 复制读源 sidecar；远端导入读载荷里的来源证据 |
| 主：来源与目录清洗 | `electron/assets/projectAssetStore.ts:445-522`；`electron/assets/assetPaths.ts:85`、`:100`；`electron/browser/media/browserViewMedia.ts:489`、`:557` | 来源白名单在素材库，捕获隐私清洗在 `assetPaths`；浏览器两处先自己清洗再交移动 |
| 主：浏览器 / 连接器材料化 | `electron/browser/media/browserViewMedia.ts:500`、`:563`；`electron/connectors/tikhubConnectorService.ts:102-198` | 各自取源与取消，但不应由入口裁决落库来源 |
| 主：内容复用 / 引用身份 | `electron/assets/uploadContentStore.ts:13-133`；`electron/assets/assetReferenceIdentity.ts:4`、`:27` | 上传族按大小 + 真实 hash 复用旧 meta，不看来源 |
| 主：普通 / 生成发布与 sidecar | `electron/assets/projectAssetStore.ts:72-392`；`electron/assets/assetSidecar.ts:15`、`:29` | 写 / 复制 / 移动 / 生成原子发布都能落 meta；sidecar 帮手不校验来源 |
| 主：预览 / 迁移旁支 | `electron/assets/assetPreview.ts:240-246`；`electron/workspace/buildArtifactMigration.ts:54-89` | 预览补字段、一次性迁移按 kind + 文件名落 sidecar；不是来源许可的主人，但数门时不能漏 |
| 主：修复 / 示例材料化 | `electron/assets/localFileImport.ts:292-355`；`electron/onboarding/demoAssetSeed.ts:45-65` | 视频自愈副本、示例素材也要消费统一落库结果 |

为什么还会出现：素材相关两条概念登记（`asset.local-file-import`、`asset.library-drop-materialization`）的 `forbidden_derivations` 为空，「converged」不禁止另一处写；验收门 `scripts/check-asset-evidence.mjs` 只看远端 / 移动调用后几行有没有来源字段，既漏本机导入，也不查复用时的持久化。最早该拦的是设计 / 实现合同，不是「人没注意」。体验铁律落 ⑫「点了 = 以为的」：成功导入应有真实项目原件及来源。

### 3. 不改结构的话，接下来会冒出什么
| 预测 | 怎么验证 |
|---|---|
| 同一张 PNG 先本机导入、后带页面来源导入，第二次的来源仍消失 | 隔离项目顺序导入，读真实 sidecar 与回执；不能只测清洗函数 |
| 工作流库插入：同项目素材每插一次多一份；新的复制壳仍可能报假成功 | 数 `listProjectAssets`；拔掉复制通道重放工作流，核失败计数与目标项目 URL |
| 外部助手导入转码后的视频，回执仍报旧类型 | MKV 经外部导入，回执类型对照真实 MP4（不付费） |

### 4. 靶子独立性检查
- 复盘线未参与实现，依据提交差异与实际输出合同独立推导；没找到本范围因评测掉分回滚的提交（不把没找到当从未发生）。
- 靶子有实洞：旧 `projectAssetStore.sourceEvidence.test.ts:61-74` 标题说拒收谎报的 `cleared`，断言却同时接受 `rights_unknown` / `cleared`，什么都不做也绿；`:243-277` 只直接调清洗函数，证明不了真实旧 sidecar 的读取。先把验收收紧到真实边界，不按测试名认定产品行为。

### 5. P0：这些是我们独有的吗
项目原件身份、生成版次 / 引用 / 撤销语义是领域约束（`docs/engineering/self-written.json` 领域目录）。文件读写与 hash 复用继续用 Node `fs` / `crypto` 与已有的内容寻址目录，类型配对与私有发布复用素材库已有实现，不新增数据库 / 存储框架；通用库替不了 Nomi 决定「同字节不同来源算不算一条」和撤销寿命。

### 6. 三条路对比 + 推荐
| 路 | 做什么 / 创作者看到什么 | 老素材 / 外部助手回执 | 代价与复发位置 |
|---|---|---|---|
| 沿原方向修：各入口各自补 | 本机导入补来源、浏览器补复用、外部助手补类型、工作流补失败 | 不搬旧文件、不改旧 id；外部助手改读落库类型 | 改动小，但五处分散，下一个入口 / 复用分支还会漏；只能当过渡，不满足「每个概念收成一个家」的已定方向 |
| 换一种做法：主进程素材库一处定（推荐） | 素材库在材料化 / 复用决定前统一接收来源事实，签发原件身份 + 规范来源 + 真实类型回执；同字节且来源等价只留一份，来源冲突另起记录、不覆盖许可；不知道就明说不知道 | 旧路径 / id / 字节不迁、不自动合卡；缺来源不伪造成「本机」或当前取证时间；外部助手只投影落库回执 | 一次连齐「来源 / 身份合同 → 全部写门与复用 → 全部回执 → 删旧壳」；复用已有内容存储与生成暂存，不整条重写；风险在冲突口径与旁路，要硬验 |
| 删掉：入口编排整块不要 | 先删工作流自带的复制循环，接同一个材料化；再删浏览器两处提前清洗 | 只删壳不改外部助手回执，旧类型问题仍在 | 能减少入口自判，但不补本机导入与复用合同就达不了标，只能作为推荐路同提交删旧的那部分 |

推荐的门：外部载荷、路径、磁盘 sidecar 在主进程入库 / 读取边界解析一次，只有素材库决定项目身份 / 来源并出回执；本机导入、内容复用、渲染层只消费规范结果，不再各自清洗、重判归属或拼身份。项目世代 / 取消与真实字节校验留在原边界（`electron/assets/generatedAssetStaging.ts:198-230`），不把「门内可信」变成取消中也能落盘。

当时建议让第二处写不出来：规范结果只在素材库构造，并封住重导出与直写 `.meta` 的旁路；2026-11-21 用户定删除无法兑现这一保证的旁路扫描，实际保留的只是定稿函数导入限制和素材库写侧定稿。

验收：本机导入丢来源、复用丢新来源两条必须在改坏版上红；跨项目复制（2026-09-25 起各落点先复制）必须仍能成功，「全部拦下」不得通过；不误伤样本用本项目原样 / 跨项目复制与旧的未知来源证据，读磁盘作答案。不新增一层文字门。

复查约定：本 PR 与合入后第 7 天重查上面三条预测、来源写者数量和新增 fix；预测仍成立或第二处仍能写，就重开升档。

三路共同遵守：老用户的旧素材与未知来源原样保留；图床只看设置、入库不另询问；不新增素材出机路径。解绑与已有存活主人不动；主进程排队中的认领不计活引用，属寿命范围（`src/workbench/assets/projectLivenessContent.ts:21-24`），不扩题。

### 7. 用户要权衡的核心
以前的修补不全是同一个毛病，但同一份素材的身份和来源还在不同入口各自决定。要拍板的是：现在一次把这些决定收进主进程、删掉重复编排，并接受「来源不同，不能只因图一样就合成一张卡」；旧素材留原地，缺来源继续诚实记「不知道」。

## 特征测试清单（动结构前先锁住）
- 入口对拍表：`electron/assets/assetSourceExits.parity.test.ts`（修前在基线上录好，修后与之 diff）。
- 已有：`electron/assets/projectAssetStore.sourceEvidence.test.ts`（本刀改名为 `electron/assets/assetSourceEvidence.test.ts` 并收紧）、`src/workbench/assets/assetLibraryMaterialize.test.ts`、`src/workbench/assets/assetLivenessScan.test.ts`、`src/workbench/assets/projectLivenessContent.census.test.ts`、`src/workbench/assets/assetLiveness.realStore.test.ts`、`src/workbench/assets/assetDeletionMatrix.test.ts`。
- 老用户夹具：`tests/fixtures/old-user-data/assets/v0.24.0-generated`、`tests/fixtures/old-user-data/asset-sources/v0.24.1-uploads`、`asset-sources/v0.24.1-connector`（后两份由 0.24.1 的真函数落盘，生成器在 `tests/fixtures/old-user-data/generators/`）。

用户拍板（2026-11-21）：都按推荐——主进程素材库一处定，删入口重复编排

## 和原方案对照

复盘写完后才拿去和实现方的设计卡（`docs/plan/2026-11-20-asset-source-one-home.md`）对照。

**一致处**
- 一处定：卡里的家是素材库的私有兄弟文件 `electron/assets/assetSourceEvidence.ts`——`finalizeAssetMeta` 在每一次写 sidecar 前把调用方给的来源当原始事实重新清洗（捕获族 `originalUrl` 置空 + 来源白名单），`reconcileReuse` 是同字节复用的唯一判定。只有素材库四个文件能 import（ESLint `asset-source-owner`）。
- 入口只交事实：本机导入（字节 / 原生两条路）交 `{source:'user'}`，视频自愈副本带原件来源；浏览器捕获与提示词参考交 `{source:'browser', pageUrl}`，不再自己清洗；连接器经 `importRemoteAsset` 的主进程参数交证据；渲染层 IPC 载荷里的 `sourceEvidence` 一律不读。
- 回执投影落库结果：外部助手导入的 `contentType` / `sizeBytes` 只取落库记录，拿不到就报错，不再按扩展名猜。
- 删重复编排：工作流库自带的复制循环删掉，和素材库拖入共用 `materializeProjectFile`（本项目原样、别的项目先复制、缺通道 / 复制失败 / 落错项目都算失败）。⑥ 用户另拍板「改，不再多一张」：同项目的工作流插入不再多复制一份。
- 来源冲突不合卡、补来源抬不高许可：已有记录缺来源 → 补上；来源相同 → 复用；来源不同 → 另起一条，旧记录不动。
- 老数据原样读：没来源的老素材升级后仍是「不知道」，不回填；字段名、目录布局、IPC 声明形状都不变。
- 2026-11-21 用户定「删检查，留 PR」：已删除按源码写法识别 sidecar 旁路的扫描、反例及只读例外登记；素材库定稿与复用的产品逻辑保留。`eslint.config.mjs` 仍限制外部导入定稿函数，概念登记仍禁止两条旧清洗函数在主人外重新定义。
- 靶子收紧：§4 指出的两处旧测试改成读磁盘 sidecar 的真实入口断言；惰性迁移那条换成 0.24.1 真连接器夹具的跨项目复制。

**不同处**
- 差异③（同一页同一张图在内置浏览器捕获两次）：复盘推荐「来源等价就合成一份」；协调裁定保持现状、每次一条。理由：合并要把同步的 `moveAssetFile` 改成异步，两处调用都是 `return moveAssetFile(…)` 外面包着 `finally` 删下载临时目录，必须同时改成 `return await`，否则会新增「临时目录在移动完成前被删」的出错点；`electron/assets/generatedAssetStaging.ts` 的注释写明写入边界保持同步、调用方靠「返回时文件已落好」安排时序；收益只是少几张卡，遥测里没有「同页同图重复捕获」这一项，频率不知道。不改可见行为，所以不进用户那一轮；有创作者反馈重复卡再议，届时先补遥测看频率。
- `rightsStatus`：复盘建议读旧 sidecar 时把 `rightsStatus:unknown` 转成 `rights_unknown`；卡改为删掉这条迁移分支、弃用字段和门岗豁免。查实写它的连接器只存在于 2026-09-01 到 09-03 之间的开发提交，首个发布版 v0.22.0 发出时已经不写；分支本身也是空转（缺省值就是 `rights_unknown`）。门岗规则本身留着，新代码写 `rightsStatus` 照旧红。
- 读侧「规范视图」：复盘建议素材库统一把旧 sidecar 读成规范视图；卡只在写侧一处定。原因同上：去掉 `rightsStatus` 后，已发版本落过的 sidecar 没有需要转换的旧形状，读者直接读即可；新增一层读视图没有要转换的东西。
- 公开写口：写口签名未改；经素材库写入时先过 `finalizeAssetMeta`。同进程其他代码仍可直接写 sidecar；`listProjectAssets` 读时原样展开 sidecar、不经主人重新定稿。今天没有花钱、外传或 Agent 信任判断读来源字段；将来需要此类判断时，先补读时经素材库重新定稿（协调另记待办）。
- 助手附件「已有原件再走通用导入」：复盘列为可删的编排；卡查实已有素材走的是远端导入里的本项目原件分支，id / hash 本来就由主进程出，没有可删的。

**实现线跑出的结果**
- 入口对拍表修前 13 行、修后 15 行：变的只有 ①本机导入两条路、②老上传补来源、④外部助手回执、R7 渲染层载荷来源不再照收；新增 R8（移动入口自称 `cleared` 落 `reference_only`）、R9（同字节不同来源另起一条）；其余行（含 ③）修前修后相同。
- 「什么都不做」版：①②④ R7 在基线上是断言失败；⑥ 的目标测试在基线上是缺导出（不是断言），基线行为由真窗口截图佐证（同项目插入后素材面板 1 张 → 2 张）。
- 「全部拦下」字面版（存活判定一律「在用」）：修后与基线同为 3 个文件 44 条红、全是断言失败。来源侧一律拦下（定稿一律丢来源、同字节一律不复用）：3 个文件 35 / 56 红，全是断言失败。
- 反例：清洗放行、读渲染层来源、来源不同也复用、不补来源、复制重盖时间、本机导入不交来源、回执用猜的类型、同项目也复制、撤销日志挤出时不复判引用，各自改坏都红、还原都绿。

## 补：撤销自写扫描登记

2026-11-21 用户定删除该旁路扫描及其根因合同；自写登记 gate-family 不再包含这条扫描。保留 ESLint 对定稿函数导入的限制和 `check-asset-evidence` 对废弃 `rightsStatus` 的约束。
