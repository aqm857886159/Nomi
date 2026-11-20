# 素材算不算进了项目、来源记在哪：只在主进程素材库一处定（设计卡）

> 四类（路径命中「长跑」：`electron/assets/localFileImport.ts` 文件名含 import；本刀在那里只改交来源的三行），9 格全填，另填 ★0；`WorkflowLibraryContent.tsx` 命中「改交互」，拍板图走已登记例外（见文末「拍板图」）。不新增界面元素、不改样子、不改存储字段名、不改 IPC 声明形状。
> 状态：用户 2026-11-21 拍板「都按推荐」（热点方向）与⑥「改，不再多一张」，已按本卡实现，自验结果见文末「结果」；复盘定稿 `docs/engineering/direction-checks/2026-11-21-asset-source-one-home.md`。行号以 `48ad810e8`（origin/main）为准。格子：05-ui、05-sb、05-agent（按原图编号）。
> 差异编号 ①–⑥ 对应动手前静态普查的六条「找不到理由的差异」，有意差异 ⓐ–ⓖ 对应普查里列明出处的七条。

## 先查别人（★0）

- [Git 对象模型](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects) · blob 只存字节、按内容寻址同字节同键；名字和其它元数据放在 tree 里，不揉进字节身份 · 确认：字节复用继续按 sha256（`electron/assets/uploadContentStore.ts:41` 已是这个形状）；「来源」是字节之外的另一层事实，复用字节不等于来源相同。
- [C2PA 2.2 规范 §1.1 / §10.3.2.2](https://spec.c2pa.org/specifications/specifications/2.2/specs/C2PA_Specification.html) · 资产再加工时既有来源保留；相同清单重复到来时忽略，不同清单以新标识追加，不覆盖旧的 · 决定差异②：已有记录缺来源才补、来源相同就复用、来源不同不覆盖旧记录（另起一条记录，等于今天的行为）。
- [Electron 安全清单 §17 / §20](https://www.electronjs.org/docs/latest/tutorial/security) · 主进程不信渲染层载荷，不把原始能力暴露给渲染层 · 决定：来源事实只收主进程调用方经参数给的；渲染层 IPC 载荷里的 `sourceEvidence` 一律不读（今天渲染层没有任何发送方，`git grep sourceEvidence -- src` 为 0）。
- [ESLint no-restricted-imports](https://eslint.org/docs/latest/rules/no-restricted-imports) · 限制某模块的命名导入（含别名）· 复用仓库已有写法 `eslint.config.mjs:783`（素材文件删除归属）、`eslint.config.mjs:818`（失败词条归属）；名字之外的写法（命名空间成员、动态导入解构、裸 `fs` 写 `.meta`、覆盖回执字段）交给概念扫描，照 `scripts/concept-owners-scan.mjs:524` 的符号跟踪写法。
- 出口：不涉及：本改动不新增界面、不改任何「创作者继续做下去」的路径；工作流插入在复制失败时仍保留原引用继续插入（`src/workbench/library/WorkflowLibraryContent.tsx:263-268` 的行为不变，只是缺复制通道时如实计失败），各入口给创作者的动作与改动前逐项一致（对拍表守）。

## ★1 用户怎么用

当创作者从本机、网页、找参考、别的项目、工作流库把一张图或一段视频带进项目时，我想让「它是不是本项目的素材、原件是哪一份、从哪来」只有一个说法，以便导出署名、助手引用、删除回收看到的都是同一份事实，而不是本机拖进来的没有来源、二次导入把后来的来源丢掉、外部助手拿到的类型和磁盘上的文件对不上。

- 真实任务：①从访达拖一张 PNG 进画布（字节导入与原生路径导入两条路）；②同一张 PNG 之前已在项目里（老版本导入、没记来源），这次又带着来源导入；③在内置浏览器同一页面把同一张图捕获两次；④外部助手用导入工具导入一段会被归一成 MP4 的 MKV；⑤从工作流库插入一个保存自别的项目、带素材的工作流；⑥同一张图只在分镜参考 / 普通节点参考里用着，从素材库删除它。
- 不做：不新建整条入库总门（生成暂存、原子发布、取消、预览不动）；不改分镜解绑与 `@` 同步；不改助手附件的选择与消息预检；不改模型可用性、托管、价格；渲染层剪贴板贴进来的 data URL / 网址图不推断来源（主进程核实不了，仍记「不知道」，写进报告「没做的」）。
- 已知坑：不能把有意差异抹平——ⓐ跨项目先复制 / 未信任认领拒收；ⓑ数组槽拒重 / 单槽替换；ⓒ解绑不等于物理删除；ⓓ批量导入部分成功 / 消息整体拒收；ⓔ缺省值各有动作；ⓕ多余字段各边界拒；ⓖ浏览器与本机来源强制「仅参考」、连接器按证据白名单。
- 量具：新增对拍测试 `electron/assets/assetSourceExits.parity.test.ts`（同一组输入逐个入口比「落没落、原件是哪份、来源记成什么、回执说什么」，修前在主分支录一份、修后再录一份并 diff）；工作流 / 素材库材料化对拍在 `src/workbench/assets/assetLibraryMaterialize.test.ts`；「什么都不做」「全部拦下」两版各一份 diff 存证据目录。真实窗口：批卡后用共享驱动起假供应商窗口，逐个点导入入口。
- 指标：目标=同一份字节、同一来源，在任何入口落成同一条记录、记同一个来源；信号=对拍表里「原件 / 来源 / 回执」一致的行占比（有意差异行除外）；护栏=界面出口（画布、素材库、时间轴、分镜上传、助手附件、工作流库）对同一输入的说法和动作修前修后逐项相同，行数不少于普查的全部例子（ⓐ–ⓖ + ①–⑥）。

### ★1b 连带界面
不新增露出点。已有露出点：素材库卡片与计数、画布节点、工作流插入后的提示、外部助手导入工具回执、找参考面板的「仅参考」标注。来源字段目前没有任何界面直接读（`git grep usageStatus -- src` 只剩注释）；助手侧 `electron/harness/context/provenance.ts:42` 只认 `cleared` 为可信，本机 / 浏览器来源都是「仅参考」= 不可信，与「没记来源」同结论；而且生产代码里没有任何地方产出 `project_asset` 来源标记（`git grep project_asset -- electron src` 除 `provenance.ts` 自身与测试外为 0），助手上下文里带不带来源都不出现；素材库「我的 / 参考」筛选按落盘路径判（`src/workbench/assets/assetProvenance.ts:22`），不读来源。所以差异①不改任何显示、不改助手看到的内容。创作者看得见的只有一行：差异⑥同项目的工作流插入不再多一张卡（用户 2026-11-21 拍板「改，不再多一张」）；③协调定保持现状。

差异④谁看得见：只有经本机工具调用导入素材的外部助手（MCP 客户端调 `importProjectAsset`，`electron/capabilityCore/core.ts:68`），且只在导入的视频被归一化（非 MP4 容器转成 MP4）时——回执里 `contentType` 由按扩展名猜的 `video/x-matroska` 等变成 `video/mp4`，`sizeBytes` 由导入前的原文件大小变成落盘后的真实大小；图片和本来就是 MP4 的视频回执不变。Nomi 自己的界面不读这个回执。

**差异③两边的代价（交用户比）**
| | 合成一份（独立复盘推荐：来源等价就合，冲突才另起） | 不合（我推荐：保持现状） |
|---|---|---|
| 创作者看到 | 同一页同一张图捕获 N 次，素材库 1 张卡 | 捕获 N 次 = N 张卡、N 份文件（每多捕获一次多 1 张）；频率没有数据，遥测里没有「同页同图重复捕获」这一项 |
| 要改的代码 | `moveAssetFile` 改异步：door-map 1 扇门（`electron/browser/media/browserViewMedia.ts`），2 处调用（`:500`、`:563`）；两处都是 `return moveAssetFile(…)` 外面包着 `finally { fs.rmSync(download.cleanupDir) }`，改异步必须同时改成 `return await`，否则临时目录会在移动完成前被删（新的出错点）；还要在移动前先算内容哈希、按「同族 + 来源等价」查已有记录 | 不改 |
| 和既有设计的关系 | `electron/assets/generatedAssetStaging.ts:4` 的注释写明写入边界保持同步、调用方靠「返回时文件已落好」安排时序；改异步要给这一条另写理由 | 一致 |
| 会丢什么 | 第二次捕获的 `title` / `captureQuality` / `animated` 不落盘（合进第一次那条）；同图不同页（`pageUrl` 不同）仍是两条 | 无 |
| 不做的后果 | — | 重复捕获多出的卡要创作者手删；不影响生成、引用和删除判定 |

**裁定（协调，2026-11-20）**：保持现状、不合卡。独立复盘推荐「来源等价就合，冲突才另起」；协调按上表定不合——收益是少几张卡、频率没有数据，代价是把同步写入边界改异步并新增「临时目录在移动完成前被删」的出错点；不改可见行为，所以不进用户那一轮。待办：有创作者反馈「同一张图捕获出重复卡」再议（届时先补遥测看频率）。

### ★1c 老用户
- 已发版本的 sidecar 一律原样读：没有来源的老素材升级后仍是「不知道」，不在升级时回填成「本机导入」；只有当创作者以后再把同一份字节带着已知来源导入时，才给那条老记录补上（差异②）。
- `rightsStatus` 迁移分支删掉：发布过的版本没有一份 sidecar 带这个字段（见 ★2 删表的两个提交号与查法）；就算有人手里有 2026-09-01 到 09-03 之间的开发构建数据，删前删后都落成 `rights_unknown`（缺省值相同），读出来没有差别。
- 字段名、目录布局（`assets/imported/sha256/<hash>/`、`assets/imported/`、`assets/generated/`、`assets/reference/`）都不变；退回上一版读到的是同样的 sidecar，多出来的 `sourceEvidence` 旧版本本来就会读（字段早已存在）。
- 夹具核对：`tests/fixtures/old-user-data/assets/v0.24.0-generated`（生成素材 sidecar，无来源）跑列表 / 跨项目复制，修前修后同为「无来源」；`tests/fixtures/old-user-data/projects/v0.24.1-storyboard` 跑存活判定（分镜绑定引用的文件保留）。仓库里**没有登记的老上传 sidecar 夹具**（`v0.24.1-pending-asset` 只有未落地目录）；`uploadContentStore.ts` 自 0.24.1 起没改过，能从 0.24.1 标签的代码生成一份——要不要生成并登记，交协调定（见「待协调」）。

## ★2 谁说了算

**家（一处）**：主进程素材库。新私有兄弟文件 `electron/assets/assetSourceEvidence.ts`（只许素材库自己的四个文件 import）放三件事：
1. `finalizeAssetMeta(rawMeta)`：每一次写 sidecar 之前都过它——捕获族 `originalUrl` 置空（原 `sanitizeAssetMetaForKind` 搬进来）+ 把调用方给的 `sourceEvidence` 当**原始事实**重新清洗（原 `sanitizeSourceEvidence` 搬进来、不再导出）。调用方写什么都只是输入，落盘的来源结论只由这里出。
2. `reconcileReuse(existingMeta, incomingMeta)`：同字节复用时的唯一判定——同一复用族（`upload/imported/local` 一族；浏览器捕获不进复用，差异③协调定保持现状）且来源不冲突才复用；已有记录缺来源、这次有 → 补上；相同（比较除时间戳外的全部白名单字段）→ 原样复用；不同 → 不复用、另起一条记录，落在同一个 `sha256/<hash>/` 目录下的 `名-2.扩展名`（`uploadContentStore.ts:44-46` 现有的同目录改名规则，布局不变），旧记录来源不动、补来源抬不高 `usageStatus`。今天生产路径到不了「不同」这一支（上传族来源只可能是「无」或「本机」，渲染层又不再能交来源），由 R9 守住。
3. 来源事实类型 `AssetSourceFact`（只导出类型）：`user` / `browser{pageUrl}` / `connector{connectorId, …}`。

`projectAssetStore.ts` 仍是唯一写入关口：`writeAsset`、`copyAssetFile`、`copyProjectAsset`、`moveAssetFile`、`importRemoteAsset`、生成两步发布全部先过 `finalizeAssetMeta`；`uploadContentStore.ts` 的复用改为调 `reconcileReuse`（入参多一个 incoming meta）；`generatedAssetStaging.ts` 的 `sanitizeAssetMetaForKind` 换成 `finalizeAssetMeta`。

**各入口只交来源事实（投影）**：
| 入口 | 交什么 | 现在 |
|---|---|---|
| 本机导入 `importLocalFile`（画布拖入、素材库、分镜上传、助手附件文件、访达复制粘贴、外部助手导入、浏览器面板本机导入） | `sourceEvidence: { source: 'user' }` | 字节、原生两条路都不交（差异①） |
| 视频自愈副本 `ensurePlayableAsset` | 原件 sidecar 里的来源（同一份东西的可播版） | 不交 |
| 浏览器捕获 / 提示词参考 `browserViewMedia` | `{ source: 'browser', pageUrl }`，不再自己调清洗 | 自己调 `sanitizeSourceEvidence`（`electron/browser/media/browserViewMedia.ts:489`、`:557`） |
| 连接器 `tikhubConnectorService` | 连接器证据，经 `importRemoteAsset` 的**主进程参数** `options.sourceEvidence` | 放在载荷里 |
| 渲染层 `nomi:assets:import-remote-url` | 什么都不交（载荷里的 `sourceEvidence` 不再读） | 载荷里有就照收（渲染层可自称连接器「已获授权」，今天无发送方） |
| 跨项目复制 `copyProjectAsset` | 源 sidecar 的来源（再过一遍清洗） | 原样拷 |
| 外部助手 `importProjectAsset` 回执 | 只投影落库回执的 `contentType` / `size` | 自己按扩展名算 `contentType`、`size` 回落到导入前的大小（差异④，`electron/capabilityCore/core.ts:108`、`:129`） |
| 工作流库插入 | 调素材库材料化的同一个逐文件函数 `materializeProjectFile` | 自带一份 `materializeWorkflowAssets`，缺复制通道当成功、本项目素材也再复制一遍（差异⑥） |

**存活判定**：不动。`src/workbench/assets/assetResultDeletion.ts` 的 `collectProjectFileReferences` / `isProjectFileReferenced` 自 2026-11-17 起整份扫描项目内容，分镜绑定、普通节点参考、助手输入都已算「有人用」（差异⑤在主分支已修，见 ★9 第 6 条的覆盖表）。

**门数（door-map，前 → 后，生产代码）**
| 符号 / 判定 | 前 | 后 |
|---|---|---|
| 来源清洗被调用的文件（`sanitizeSourceEvidence`） | 2（`projectAssetStore.ts`、`browserViewMedia.ts`） | 0 个外部文件（私有，只在 `finalizeAssetMeta` 内） |
| meta 清洗（`sanitizeAssetMetaForKind` → `finalizeAssetMeta`） | 2（`projectAssetStore.ts`×4、`generatedAssetStaging.ts`） | 2（同两处，旧名删除） |
| 「落盘来源由谁定」的判定点 | 3（远端导入、浏览器捕获、浏览器参考图各自清洗；本机导入两条路不定） | 1（`finalizeAssetMeta`） |
| 同字节复用的判定（`reuseStoredUpload`） | 1，不看来源 | 1，看来源（`reconcileReuse`） |
| 回执 `contentType` 的出处 | 2（落库回执、`core.ts:108`） | 1（落库回执） |
| 跨项目材料化编排（渲染层调 `copyProjectAsset` 的文件） | 2（`assetLibraryMaterialize.ts`、`WorkflowLibraryContent.tsx`） | 1（`assetLibraryMaterialize.ts`） |
| `materializeWorkflowAssets` 里的复制 / 判归属 | 1 | 0（只剩换地址的薄循环） |
| `materializeAssetLibraryItems` 消费文件 | 5 | 5（不变；概念登记从 3 补到真实的 5 + 工作流） |
| sidecar 直接写入点（`writeAssetSidecarMeta`、裸写 `.meta`） | 主人 4 个文件 + `assetPreview.ts`（合并预览字段）+ `electron/workspace/buildArtifactMigration.ts:86`（一次性迁移） | 不变，但主人之外的两处变成扫描登记的「有理由例外」，其余任何地方写不出来 |
| `importRemoteAsset` / `moveAssetFile` / `importLocalFile` / `copyProjectAsset` 调用文件 | 3 / 1 / 3 / 4（含 IPC） | 不变（签名源码兼容；`moveAssetFile` 保持同步，差异③不合卡） |

**删什么 / 为什么能删 / 现有调用方怎么过**
| 删 | 为什么能删 | 调用方怎么过 |
|---|---|---|
| `projectAssetStore.ts` 导出的 `sanitizeSourceEvidence`（`:445`） | 搬进 `assetSourceEvidence.ts` 变私有，由 `finalizeAssetMeta` 唯一调用 | `browserViewMedia.ts` 两处改交事实；测试 `projectAssetStore.sourceEvidence.test.ts` 改为经 `finalizeAssetMeta` 断言同一组输入输出（断言不删） |
| `assetPaths.ts` 的 `sanitizeAssetMetaForKind`（`:100`） | 搬进 `finalizeAssetMeta`，没有第二个 meta 清洗 | 4 处 + `generatedAssetStaging.ts:211` 改调新函数；`assetPaths.test.ts` 对应断言随迁 |
| `browserViewMedia.ts:489-494`、`:557-562` 两段自己清洗 | 入口只交事实 | 行为由对拍表守：落盘结果与今天一致 |
| `importRemoteAssetToStore` 读载荷 `sourceEvidence`（`:548`） | 来源只收主进程参数 | 渲染层无发送方；连接器两处改走参数 |
| `core.ts:108` 的 `contentTypeForExtension` 作回执、`:129` 的 `?? sizeBytes` 回落 | 回执一律投影落库结果；`storedAssetRecord` 恒带 `size` | 外部助手回执形状不变，只有归一化视频那一行的 `contentType` 变真（差异④） |
| 清洗函数里的 `rightsStatus` 迁移分支（`projectAssetStore.ts:454-459`）、`AssetSourceEvidence.rightsStatus` 弃用字段与注释（`electron/connectors/connectorDefinition.ts:171-172`、`:225-229`）、`scripts/check-asset-evidence.mjs` 里 `deprecated-rights-status` 为这两处开的豁免 | 没有任何发布版本写过 `rightsStatus`：写它的连接器由 `334c160e0`（2026-09-01）引入、`437d768d8`（2026-09-03）改掉，查法 `git tag --contains <提交> \| grep '^v' \| sort -V \| head -1`，两个都是 `v0.22.0`，即同一版首发、发出去时已经不写了。分支本身还是空转：缺省值就是 `rights_unknown`，命中这一支结果相同 | 无读者：`git grep rightsStatus -- electron src scripts` 除这几处只剩 `bridgeConnector.ts:55` 一行注释（同提交改）和 `projectAssetStore.sourceEvidence.test.ts` 里专测这条迁移的用例（:9 头注、:31-45、:84、:243-277、:281-290 注释），用例随分支一起删或改写成「主进程给的 connector 证据原样落盘」；`check-asset-evidence.mjs` 的 hint 里「迁移读取不计入」一句同提交删。规则留着，任何新代码写 `rightsStatus` 照旧红。`docs/fixes`、`docs/plan`、`docs/research` 里的历史记录不改 |
| `WorkflowLibraryContent.tsx:39-62` 的 `materializeWorkflowAssets` | 素材库材料化已有同一件事的逐文件判定；抽出 `materializeProjectFile` 两边共用 | 唯一调用 `:263`；成功改写 URL、失败计数与提示词条不变；同项目素材原样用（差异⑥，用户拍板「改，不再多一张」）。`materializeWorkflowAssets` 这个名字留着，只剩「逐文件调 `materializeProjectFile`、把复制品地址换进模板」的薄循环，复制、判归属、取复制通道都不在它里面 |
| 助手附件（`src/workbench/ai/composer/useComposerAttachments.ts:84-96`）的「入口自造身份」 | **不删，没有可删的**：已有素材走 `importRemoteAsset` 的本项目原件分支，回执 id / hash 由主进程出（`electron/assets/projectAssetStore.ts:553-562`）；`resolveProjectAgentAttachmentClaims` 门数 3 个文件不变 | 无 |

**交接处（只引用，不新造、不升格）**：存活判定的重开清扫走 `src/workbench/project/projectPersistenceService.ts`，命中已登记的 `draft-save`（checked=false，照表引用，不据此宣称已验）。分镜解绑不碰，不涉及 `archetype-panel-request`。

**要改的文件清单**
- 生产：`electron/assets/assetSourceEvidence.ts`（新）、`electron/assets/projectAssetStore.ts`、`electron/assets/assetPaths.ts`、`electron/assets/generatedAssetStaging.ts`、`electron/assets/uploadContentStore.ts`、`electron/assets/localFileImport.ts`、`electron/browser/media/browserViewMedia.ts`、`electron/connectors/tikhubConnectorService.ts`、`electron/capabilityCore/core.ts`、`src/workbench/assets/assetLibraryMaterialize.ts`、`src/workbench/library/WorkflowLibraryContent.tsx`、`electron/connectors/connectorDefinition.ts`（删 `rightsStatus` 弃用字段与注释）、`src/desktop/bridgeConnector.ts`（`:55` 注释里的 `rightsStatus` 改成现字段，只改注释）。
- 门岗 / 登记：`scripts/concept-owners-asset-source.mjs`（新，扫描本体；协调批了另起文件，不往 `concept-owners-scan.mjs` 里加）、`scripts/check-concept-owners.mjs`、`scripts/check-concept-owners.node-test.mjs`、`scripts/check-asset-evidence.mjs`（删 `deprecated-rights-status` 规则的两条豁免：迁移读取与类型声明都删了，规则本身留着拦新写入）、`eslint.config.mjs`（追加自己一段）、`docs/engineering/concept-owners/asset.project-source-evidence.json`（新）、`docs/engineering/concept-owners/asset.library-drop-materialization.json`（消费者补齐、加写口）、`docs/engineering/direction-checks/2026-11-21-asset-source-one-home.md`（新，热点复盘：没参与过的线先独立写，用户拍板后按公开格式定稿，并加「和原方案对照」）、本卡。`scripts/pre-push-scan-guards.mjs`：扫描测试写进已登记的 `check-concept-owners.node-test.mjs`，新扫描文件 `concept-owners-asset-source.mjs` 追加进同一条登记的 `files`（census 已过）。
- 测试：`electron/assets/assetSourceEvidence.test.ts`（由 `projectAssetStore.sourceEvidence.test.ts` 改名而来）、`electron/assets/assetSourceExits.parity.test.ts`（新）、`electron/assets/assetPaths.test.ts`、`electron/connectors/tikhubConnectorService.test.ts`（证据改走第二个参数）；`electron/assets/projectAssetImportDedup.test.ts` 没改——「来源」维度由对拍表 ② / R9 与 `reconcileReuse` 四条单测覆盖；`src/workbench/assets/assetLibraryMaterialize.test.ts`、`src/workbench/assets/assetLiveness.realStore.test.ts`（只加「撤销日志挤出到点」那一组用例，已写）、浏览器捕获 / 连接器现有测试随签名改；老用户夹具 `tests/fixtures/old-user-data/asset-sources/v0.24.1-uploads`、`asset-sources/v0.24.1-connector`（新，0.24.1 真函数落的；单放 `asset-sources/` 根，因为 `assets/` 下每个目录都被参考链接矩阵当成带临时链接的生成图遍历）、`generators/zzUploadSidecarGen.ts.txt`、`generators/zzConnectorSidecarGen.ts.txt`（新）、夹具 `README.md`（登记两行）。
- 不碰：`electron/catalog/`、`electron/providerAdapter/`、接入词条、`electron/shared/generationFailure*.ts`、`InlineParameterBar`、`electron/shared/videoCapabilities/paramValue.ts`、`docs/engineering/self-written.json`（扫描归已登记的门岗族，不新增自写条目）、`AGENTS.md`、基线图。

## ★3 一致与复用

- 以前定过：2026-09-03 来源取证 v2（`docs/fixes/2026-09-03-asset-source-evidence-v2.root-cause.json`：三类来源、浏览器 / 本机强制「仅参考」、连接器白名单）；2026-09-08 落盘桶即来源结构事实（合同 `2026-09-08-asset-provenance-bucket`）；2026-09-25 素材库跨项目先复制；2026-11-17 存活判定改整份扫描。用户 11-16 / 11-17 定「判定只在主进程一处，出口不再自己防守」「主进程之外自己判、构造或覆盖结论要在代码层写不出来」。原因都还在，照做。
- 三条路：沿原方向修（各入口各补一行来源）= 第七处入口又会漏，不选；换做法（来源只在写入关口一处定，入口交事实）= 选；删（不记来源）= 丢导出署名与助手可信度输入，违背已定的来源取证，不选。
- 复用：内容寻址目录、`AssetWriteContext`、生成两步发布、`resolveProjectAgentAttachmentClaims`、`isProjectFileReferenced`、`materializeAssetLibraryItems` 原样复用；不新造总门、不新增放行位（无 `allow*` / `skip*` 参数）。
- 热点：`node scripts/fix-churn.mjs electron/assets/projectAssetStore.ts` 文件级红（近 14 天 2 个 fix，本刀第 3 个；那两个是 `3c0e2022c` 出站地址层删除、`da261bfea` 配音落成生成素材，与来源无关），同时命中「助手输入媒体引用解析到原身份」「生成产物能不能解码」两个概念（各 3 个文件、2 个 fix）；`src/workbench/assets/` 目录级红；`scripts/check-concept-owners.mjs`、`scripts/check-asset-evidence.mjs` 因自写登记「门岗族」口径红。见「待协调」。
- P0：来源取证、按镜头引用的存活是领域事实，自写；同字节复用继续用已有 sha256 目录；归属限制复用 ESLint 内置规则；扫描扩现有概念扫描，不新增检查命令、不新增自写登记。
- 文件体积：`projectAssetStore.ts` 已 753 行（800 红线），清洗与复用判定放进新兄弟文件，主文件只减不增。

## ★4 全状态（界面逐态不变；下面是来源判定的出口）

空：无来源事实 → 不写 `sourceEvidence`（「不知道」）；加载 / 进度：导入进度事件不变；成功：回执形状不变；失败：准入拒绝、路径安全、项目已切换的报错与动作不变；部分成功：批量导入逐文件计数不变；取消中：导入取消照旧（`AssetWriteContext` 复验不动）；过期：老 sidecar 照读（★1c）；能力不可用：不涉及。文案不新增词条，不含「已授权 / 可商用」断言。

## 5 中途表（导入本身的打断行为不变；下面只写这刀新增的两步：定稿来源、复用时补来源）

| 状态 | 停 / 取消 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 本机导入落盘（定稿来源在写 `.meta` 之前，同一次同步写） | 照旧：`AssetWriteContext` 复验，项目切走即抛，不落 `.meta`；不花钱；回执无 | 照旧：暂存目录下次导入时收走；不花钱 | 不涉及（本机文件不出网） | 照旧：未完成的暂存被收走，已落盘的记录带来源 | 照旧：同字节按 `withUploadIdentity` 串行，第二次复用第一条（来源相同）；不花钱 |
| 复用老记录并补来源（`fillSource`：临时文件 + 原子改名） | 改名前取消：老 `.meta` 原样，照旧复用；之后取消：已补上，回执不发 | 改名是原子的：要么老 `.meta`、要么补好的，不会半截；临时文件在 `finally` 删，删不掉的残片没有对应的媒体文件，不算任何素材的 sidecar（与现有哈希缓存的写法相同） | 不涉及 | 同关窗 | 串行，第二次看到已补上的来源 = 相同来源，原样复用 |
| 工作流插入逐文件复制 | 照旧：换项目即取消，不实例化；已复制的文件留在目标项目（今天也一样） | 照旧 | 不涉及（项目间复制在本机） | 照旧 | 照旧：复制中再点被忽略（`copyingId`） |
花费：这几步都不花钱。回执：导入回执形状不变。

## 6 外部数据与失败

| 外部来源 | 规范 / 出处 | 我们的偏差 | 失败时创作者看到什么 |
|---|---|---|---|
| 本机文件（访达、拖入、外部助手给的路径） | Node `fs`；类型按落盘真实文件判 | 来源只记「本机导入」，不读文件里的元数据当来源 | 照旧：准入拒绝 / 路径不安全的现有报错 |
| 内置浏览器页面 | 页面地址经 `safeHeaderUrl` 取 | 只记页面地址与「仅参考」，自称 `cleared` 一律降为仅参考 | 照旧：捕获失败的现有提示 |
| 连接器解析结果（TikHub 分享链接） | 连接器证据白名单（`electron/connectors/connectorDefinition.ts`） | 白名单外的值丢掉，`usageStatus` 不在白名单落 `rights_unknown` | 照旧：连接器导入失败的现有提示 |
| 磁盘上的老 sidecar | 已发版本落盘的 JSON | 原样读，缺来源记「不知道」，不回填；读不成 JSON 的跳过 | 无新提示 |
| 外部助手（MCP）入参与回执 | 本机工具合同 `importProjectAsset` | 回执类型 / 大小只取落库记录；落库记录缺这两个字段就报错「素材已复制但没拿到落库后的类型和大小，请重试。」，不编 | 外部助手收到这句报错（Nomi 界面不显示） |
未知失败不归到创作者的 key：这些路径都不碰供应商钥匙。

## ★7 性能

①新增用户操作：无（不新增点击 / 拖动 / 输入）。②最坏规模：一个项目里成百上千份同大小的上传文件——同字节查找的遍历与哈希缓存不变，每个候选多一次纯内存比较（`reconcileReuse`）；只有老记录缺来源时多一次小 `.meta` 写。每次写 sidecar 多一次小对象清洗（`finalizeAssetMeta`）。③预算：导入耗时不变（不新增 I/O 轮次之外的等待；补来源只在第一次复用老记录时发生一次）。④重跑：没有新交互，不登记新场景；碰到的老场景只有 `asset-liveness-scan-worst`，本刀不改存活扫描（只加测试），数字不受影响。perf-scenario 写「不适用」并附理由。

## 8 真实条件

- Windows：unverified（本机 macOS）。
- 英文界面：窗口实点中 / 英各一轮，截图自己看过（见文末「结果」）。
- 最小窗口：unverified（不改布局）。
- 真规模：unverified（单元测试与对拍表用小夹具；老用户夹具来自 0.24.1 真函数）。
- 干净安装：驱动起的隔离资料（不碰真实资料）。
- 真付费：不涉及（假供应商、网络守卫开、没花钱）。
- 键盘全程：unverified（不改交互入口）。

## ★9 验收与回滚

**判据（只有一句）**：用普查全部例子（ⓐ–ⓖ + ①–⑥）做同一组输入，逐个入口对拍「落没落、原件是哪份、来源记成什么、回执说什么」；①「什么都不做」版（主分支 + 新测试）上目标测试必须红；②「全部拦下」版上目标测试也必须红；两版都由实现线自己做出来、跑给协调看。

**六条差异统一成什么**
- ①本机导入（字节 / 原生两条路、含转码后的 MP4）一律记 `{source:'user', usageStatus:'reference_only', capturedAt}`，与带同样事实的 data URL 导入结果相同。
- ②同字节复用：已有记录缺来源 → 补上这次的来源；相同 → 原样复用；不同 → 另起一条记录（旧记录来源不动）。本机项目 nomi-local 原件分支只认身份、不写盘，不补来源（它不是一次「带来源的导入」）。
- ③浏览器同页同字节重复捕获：**保持每次一条**（协调裁定，不改可见行为，理由见 ★1b），概念登记里写明理由。
- ④外部助手导入回执的 `contentType` / `sizeBytes` 一律取落库回执（MKV 归一后报 `video/mp4` 与真实大小）。
- ⑤已在主分支修好（整份扫描），本刀只补「撤销期到点」那一格的测试，不改代码。
- ⑥工作流插入与素材库拖入用同一个逐文件函数：本项目素材原样、别的项目先复制、缺复制通道计失败。「缺复制通道」那一支**桌面不可达**：桌面应用的 preload 恒暴露 `copyProjectAsset`（`electron/preload/mediaBridge.ts:41`），只有测试 / 非桌面宿主会进，所以创作者看得见的只剩「同项目的生成 / 浏览器类素材不再每插一次多复制一份」这一行，**用户 2026-11-21 拍板「改，不再多一张」**（修前截图见下，修后截图见文末「结果」）；失败提示用的是现成文案 `libraries.workflow.assetCopyFailed`（「部分素材未能复制，已保留原始引用」/ “Some assets could not be copied; original references were kept”，`src/i18n/locales/libraries.ts:120`、`:294`），不新增文案。不批则保留工作流旧语义并写明理由、只删重复的复制循环。
  - 截图（主分支构建，隔离资料 + 假供应商、网络守卫开，没花钱；每张自己打开看过）：
    - 插入前（中 / 英各一张）：同一项目里生成一张图、连同一个文字节点框选后「存流程」，此时素材面板 1 张卡。
    - 同项目插入后（中 / 英各一张）：在**同一个项目**里从流程面板点「放上画布」后，素材面板变成 2 张一模一样的卡；读回画布上两张图的地址，新插入的指向 `image-…-2.png`，即同项目又复制了一份文件——这就是待拍板的那一行（统一后不再多这一张）。
    - 复制失败（中 / 英各一张）：先删掉流程的来源项目，再在新项目里点「放上画布」，流程卡上方出现现成的红字「部分素材未能复制，已保留原始引用」/ “Some assets could not be copied; original references were kept”——这是统一后「复制失败」仍然落到的唯一提示位置，文案与位置都不变。

**有意差异（保留，各一条保持用例）**：ⓐ别的项目的素材经复制进来，助手认领别的项目的 id 拒收；ⓑ分镜数组槽同 URL 报重复、单槽替换；ⓒ分镜解绑只改绑定与 `@`、不删文件；ⓓ批量导入部分成功、助手消息有坏附件整体拒；ⓔ本机导入缺省 `upload` 且拒生成产物、远端导入缺省生成产物且要期望类型；ⓕ多余字段：外部助手路由拒、认领只许 id/version、来源白名单丢弃；ⓖ浏览器 / 本机自称 `cleared` 也落 `reference_only`，连接器白名单内照收。

**应过清单（每条 = 一个测试；改坏→红、还原→绿，日志进报告）**
1. 入口对拍表 `electron/assets/assetSourceExits.parity.test.ts`（主进程入口）：ⓐ ⓔ ⓕ ⓖ + ①②③④ 全部输入，修前（主分支）与修后各录一份并 diff；外部助手只有④那一行变；差异③那一行修前修后相同（保持现状）。另加两行：带连接器证据的素材跨项目复制（复制品来源与源一致，源用 5b 的 0.24.1 真连接器夹具）、清洗幂等（`finalizeAssetMeta(finalizeAssetMeta(x))` 与一次相同，时间戳不重盖）。渲染层出口（ⓑ ⓒ ⓓ、画布 / 时间轴 / 分镜上传 / 助手附件的显示）主进程测试看不到：这些路径的文件不在改动清单里，量具 = 现有渲染层测试原样过 + 窗口实点；⑥的对拍在 `src/workbench/assets/assetLibraryMaterialize.test.ts`。没有逐行对拍的那几个界面出口记「未验证：缺量具」，窗口实点补看。
   - **主分支已录**（`48ad810e8`，测试文件已写好、未提交）：13 条用例，红 5 条、全是断言失败（没有类型 / 引用错）：①字节路、①原生路径路（落盘无来源）、②老上传补来源（`v0.24.1-uploads` 复用了老记录但来源仍空）、R7（渲染层自称连接器 `cleared` 被照收）、④（MKV 归一成 MP4 后回执仍报 `video/x-matroska`；大小已与磁盘一致）。绿 8 条：出网拦截金丝雀、②同来源两次导入同一条记录、③同页同图捕获两次 = 两条浏览器来源记录、ⓖ分享链接导入的连接器证据、ⓐ 0.24.1 连接器老素材跨项目复制来源逐字段相同、ⓐ 0.24.0 生成老素材复制仍无来源、ⓕ外部助手多余字段拒、ⓔ本机导入拒生成产物。修后同一文件再录一份 diff，只许 ①②④ R7 这几行变。顺带查实：主分支复用老上传时已经会往 `.meta` 补 `contentHashCtime/Mtime/Size` 三个缓存字段，所以「其余字段一个不少」按「原有字段与值都在」判，不按全等。
2. 「什么都不做」版（主分支 + 新测试）：新测试只经主分支已有的入口调用（`importLocalFile`、`persistUploadBytes/File`、`importRemoteAsset`、`importProjectAsset`），红必须是断言失败，不是缺导入 / 类型错：①（本机导入无来源）、②（复用丢来源）、④（回执报 `video/x-matroska`）三条无条件红；⑥批了也红；扫描反例 R6（`core.ts` 现状的混合回执）在主分支红。⑤的格子在主分支是绿的（已修），如实写。
3. 「全部拦下」：目标里定义的是字面版，另加一版来源侧的，两版的跑法和结果写进 PR：
   - 字面版（目标原义：存活判定一律「在用」、永不回收）：`src/workbench/assets/assetLiveness.realStore.test.ts:127` 的 `unused-control`（期望延后 1、关项目后进回收站）红，`src/workbench/assets/assetDeletionMatrix.test.ts:245` 的回收格红。
   - **字面版已在主分支跑过**（`isProjectFileReferenced` 第一行改成一律返回「在用」，跑完原样还原）：`assetLiveness.realStore.test.ts`、`assetDeletionMatrix.test.ts`、`assetLivenessScan.test.ts` 三个文件 44 条红、全是断言失败——两组 `unused-control`（关项目到点、撤销日志挤出到点）、删除矩阵里每个「该进回收站」的格子、扫描表里每条「不算引用」；挤出到点那组的分镜 / 节点参考两格也红，因为全拦版在删除当场就判「在用」、不记待删，和「删时没人用、之后才挂上」的前提对不上。修后再跑一次，结果写进 PR。
   - 来源版（`finalizeAssetMeta` 一律丢来源 + 复用一律不复用）：①②测试红、连接器证据测试 `electron/assets/projectAssetStore.sourceEvidence.test.ts` 红、同字节复用测试 `electron/assets/projectAssetImportDedup.test.ts:26`、`:51` 红。
4. 结论不可在主人之外写出（扫描 `asset-source-bypass`，扩进 `check:concept-owners`；ESLint 另限命名导入）。主人 = `assetSourceEvidence.ts`、`projectAssetStore.ts`、`uploadContentStore.ts`、`assetSidecar.ts`、`generatedAssetStaging.ts`；登记的有理由例外 = `assetPreview.ts`（只合并预览字段）、`electron/workspace/buildArtifactMigration.ts`（一次性迁移写固定 `{kind, originalName}`）。认的是整类写法：
   - 写 sidecar：`fs` 写族（`writeFile*`、`appendFile*`、`rename*`、`copyFile*`、`link*`、`createWriteStream`、事务对象的 `writeFile`）目标里带 `.meta` 片段（字面量、模板、拼接、经变量）；或以任何形式拿到 `writeAssetSidecarMeta` / `mergeAssetSidecarMeta` / `finalizeAssetMeta` / 清洗函数（命名、别名、命名空间成员、动态导入解构、重导出）。
   - 「来自回执」的定义：主人登记的产回执调用（主进程 `importLocalFile` / `importRemoteAsset` / `writeAsset` / `writeGeneratedAsset` / `copyAssetFile` / `copyProjectAsset` / `moveAssetFile` / `storeAssetBytes` / `persistUpload*`；渲染层桥的 `importFile` / `importRemoteUrl` / `copyProjectAsset` 及登记的两个包装 `importWorkbenchLocalAssetFile` / `importWorkbenchRemoteAssetUrl`）的返回值，或 sidecar 读取；名单写在概念 JSON 里。字段值「出自回执」= 表达式（顺着本地 const 初值展开）只引用回执符号和字面量。
   - 覆盖结论：对来自回执的值，写 `sourceEvidence` / `usageStatus` / `contentType` / `contentHash` / `size` / `sizeBytes` / `url` / `relativePath` / `assetId`（属性赋值、`Object.assign`、展开后覆盖），或一个对象字面量从回执取了身份字段（`contentHash`、`assetId`）却给其它回执字段填非回执的值（混合回执，即差异④的形状）。
   - 反例表（各自改坏→扫描红、还原→绿）：R1 改名 `import { writeAssetSidecarMeta as saveMeta }`；R2 内联 `fs.writeFileSync(\`${dest}.meta\`, JSON.stringify({ … sourceEvidence: { source: 'connector', usageStatus: 'cleared' } }))`；R3 别名 `const metaPath = dest + '.meta'; const put = fs.promises.writeFile; await put(metaPath, …)` 与命名空间 `sidecar.writeAssetSidecarMeta(…)`；R4 属性赋值 `record.data.contentType = contentTypeForExtension(ext)`、`asset.data.sourceEvidence.usageStatus = 'cleared'`；R5 展开 / `Object.assign` 覆盖 `{ ...record.data, contentType }`、`Object.assign(record.data, { sourceEvidence })`；R6 混合回执 `{ assetId: record.id, contentHash: data.contentHash, contentType }`（主分支 `core.ts` 现状）。
   - 正例必须绿：连接器交证据事实、浏览器交 `{source:'browser', pageUrl}`、`provenance.ts` 读来源、`assetPreview.ts` 合并预览、迁移写 sidecar、助手附件从回执取 id/hash、修后的 `core.ts`、各处只读 `.meta`、`workspaceFileDelete.ts` 删 `.meta`。临时「任何 `.meta` 出现都报」须使正例红（证明正例真的被扫到）。
   - 全仓新规则命中目标 0（修后）；动手第一步先对主分支全仓 dry-run：除 `core.ts` 那一处（R6，本刀要修）外任何命中（尤其 `electron/catalog/`、`electron/providerAdapter/` 这两个不碰的目录）都先停下报协调，不靠改规则凑 0。已抽查（不是全部，全量靠 dry-run）：catalog 4 处、配音 / 剪辑 / 截图 3 处产回执调用点只从回执读 `url`（`trimVideo.ts:117` 的 `{ url, assetId: record.id, durationSeconds }` 全出自回执），助手附件 `useComposerAttachments.ts:84-96` 的 `url` / `size` / `contentType` 全出自回执，按上面定义都是正例。扫描测试写进已登记 SCAN_GUARDS 的 `scripts/check-concept-owners.node-test.mjs`，提交前跑 census。
5. 来源只由主人定（功能测试）：R7 渲染层 IPC 载荷带 `{source:'connector', connectorId:'x', usageStatus:'cleared'}` → 落盘无来源；R8 `moveAssetFile` 收到 `{source:'browser', usageStatus:'cleared'}` → 落 `reference_only`；R9 已有 `user` 记录、这次连接器 `cleared` 同字节 → 另起一条，旧记录仍 `reference_only`（补来源抬不高许可）。
5b. 收紧两处现有测试到真实边界（读磁盘 sidecar 作答案；改坏版必须红）：
   - `electron/assets/projectAssetStore.sourceEvidence.test.ts:61-74` 标题说「谎报 cleared 被拒」，断言却同时接受 `rights_unknown` / `cleared`（`expect([…]).toContain`），什么都不做也绿。改成两条真实入口、各一个确定答案：渲染层 IPC（`nomi:assets:import-remote-url` 的处理函数）载荷自称连接器 `cleared` → 读回落盘 sidecar **没有** `sourceEvidence`（= R7）；主进程连接器经参数交白名单内的 `cleared` → 读回落盘 sidecar 的 `usageStatus` **恰好是** `cleared`（有意差异 ⓖ 的「白名单内照收」）。改坏版：`finalizeAssetMeta` 放行载荷来源 → 第一条红；清洗把 `cleared` 降级 → 第二条红。
   - 同文件 `:243-277`「惰性迁移」只直接调清洗函数，证明不了真实旧 sidecar 读取。查实：写 `rightsStatus` 的连接器只在 2026-09-01（`334c160e0`）到 2026-09-03（`437d768d8`）之间存在，两者首发都是 v0.22.0，**没有任何发布版本写过 `rightsStatus`**，真实老数据走不到迁移分支。改成：用 0.24.1 自己的连接器导入（`tikhubConnectorService` 的 `importTikhubShareUrl`）落的真实连接器素材夹具 `tests/fixtures/old-user-data/asset-sources/v0.24.1-connector`（已生成并登记；只换出网——TikHub 链接解析、媒体取回——和钥匙解密，证据组装、落盘、清洗都是 0.24.1 真函数；生成器 `generators/zzConnectorSidecarGen.ts.txt`），跨项目 `copyProjectAsset` 后读回复制品的落盘 sidecar，`sourceEvidence` 与源 sidecar 逐字段相同（时间戳不重盖）。改坏版：复制时丢来源 / 重盖时间戳 → 红。迁移分支按删做（★2 删表）。
   - 落点（不重复写两份）：渲染层那条走**真的** `nomi:assets:import-remote-url` 处理函数（`registerAssetsIpc` 注册、只换发送方校验），和 0.24.1 连接器老素材跨项目复制那条，都放进对拍表（R7、ⓐ-copy-connector 两行，主分支已录：R7 红——落盘照收 `cleared`；复制那行绿）；`projectAssetStore.sourceEvidence.test.ts` 的 `:61-74` 换成「主进程参数交 `cleared` → 落盘恰好 `cleared`」一条，`:243-277` 随迁移分支一起删。
6. 差异⑤覆盖表（已在主分支，测试出处）：已加载删除 `assetLiveness.realStore.test.ts:136`、关项目到点 `:143`、重开清扫 `:152` × 分镜绑定 / 普通节点参考 / 助手输入；列表与分镜挂载 `src/workbench/assets/assetLivenessScan.test.ts:238`、分镜参考与旧条目不回收 `:264`；撤销日志挤出到点（`releaseEvictedAssetDeletions`）× 分镜绑定 / 节点参考原来没有专门用例 → 本刀只加测试，已写进 `assetLiveness.realStore.test.ts` 末尾一组：删的那一刻没人用（记待删），之后挂上分镜参考 / 节点参考，再经真画布编辑 81 步把删除那一步挤出撤销日志；到点时挂上的两格文件留在原路径、对照组进回收站且字节不变。主分支上 3 格全绿（⑤已修，如实写）；字面全拦版 3 格全红（见第 3 条）。
7. 老用户：`v0.24.0-generated` 夹具列表 / 跨项目复制修前修后同为无来源；`v0.24.1-storyboard` 存活判定保留；`v0.24.1-uploads`（0.24.1 真 `importLocalFile` 落的两份无来源上传 sidecar，字节路 + 原生路径路）原样读回仍无来源，再带来源导入同字节 → 补上（②），其余字段与时间戳不变。
8. 自查探针先装进程级 `globalThis.fetch` 拦截（非回环一律抛）并跑金丝雀。

**独立验收**：协调另派验收线（不是实现线），核本节清单与反例；PR 正文 `## 独立验收` 写「待派」。
**回滚**：revert 本提交即可（不改字段名、目录布局、IPC 声明形状，无迁移；补上的来源字段旧版本本来就会读）。
**声明**：批卡后起窗口验证（共享驱动、网络守卫、假供应商、不花钱）：本机拖入、素材库导入、浏览器捕获、工作流插入、素材库删除各真点一次，截图自己看过；外部助手导入走本机工具调用，不连真供应商。

## 已定（协调批复与用户拍板）

- 用户 2026-11-21：热点方向「都按推荐」——主进程素材库一处定，删入口重复编排；差异⑥「改，不再多一张」。复盘定稿与「和原方案对照」：`docs/engineering/direction-checks/2026-11-21-asset-source-one-home.md`。
- 判据：⑤ 在主分支如实写绿；「什么都不做」必红 = ①②④ + R6 扫描，四条都是断言失败。「全部拦下」以字面版为准，来源侧版作旁证。
- 差异④（外部助手回执值变真）批；渲染层载荷里的 `sourceEvidence` 不再读，批（声明不改，R7 守）。
- 热点三处口径命中（`src/workbench/assets/` 目录、两个门岗族脚本）由协调代批；`projectAssetStore.ts` 文件级命中交用户，已拍板。
- 扫描放新文件 `scripts/concept-owners-asset-source.mjs`，在 `scripts/pre-push-scan-guards.mjs` 已登记那条的 `files` 里补上；主分支全仓 dry-run 命中 3 处 = `core.ts:128`、`:129`（R6，本刀修）+ `browserViewMedia.ts:8`（导入清洗函数，本刀删）。
- 老上传夹具：已用 0.24.1 真函数生成并登记（`tests/fixtures/old-user-data/asset-sources/v0.24.1-uploads`，生成器 `generators/zzUploadSidecarGen.ts.txt`，办法写在夹具 README「素材来源」一节）。
- 差异③：保持现状不合卡（协调裁定，理由与待办见 ★1b）。
- `rightsStatus` 迁移分支：按删做，同提交删分支、弃用字段和 `check-asset-evidence` 的豁免（★2 删表、★1c）。
- 5b 两种收紧改法批了；⑥ 截图截完每张一句写进卡。

## 结果（实现线自验，2026-11-21）

**入口对拍表**（`electron/assets/assetSourceExits.parity.test.ts`）：修前 13 条（主分支红 5 条），修后 15 条全绿。修前修后 diff 只在 ①字节路、①原生路径路、②老上传补来源、④外部助手导入 MKV（回执类型变 `video/mp4`；落盘来源由空变 `user`，同①）、R7（渲染层载荷自称连接器 `cleared` → 落盘无来源）这五行，外加新增的 R8（移动入口自称 `cleared` → 落 `reference_only`、`originalUrl` 置空）、R9（本机导入后同字节连接器 `cleared` 导入 → 另起一条，第一条仍是 `user` / `reference_only`）。③同页同图两次捕获、②同来源复用、ⓐ两条跨项目复制、ⓔ、ⓕ、ⓖ 修前修后逐字相同。

**「什么都不做」版**（主分支 + 新测试）：①②④ R7 都是断言失败；R6 扫描在主分支红。⑥ 的目标测试在主分支是缺导出（`materializeProjectFile` 不存在），不是断言失败——主分支行为由修前截图佐证（同项目插入后素材面板 1 张 → 2 张）。

**「全部拦下」字面版**（`isProjectFileReferenced` 一律返回「在用」，跑完原样还原）：修后 3 个文件 44 条红 / 1475 条，全是断言失败、0 个类型错，与主分支相同。（vitest 把同文的报错折叠，日志里 `AssertionError` 文本只出现 19 次。）

**来源侧「全部拦下」版**（`finalizeAssetMeta` 一律丢掉来源、`reconcileReuse` 一律不复用，跑完逐字节还原）：对拍、`assetSourceEvidence`、`projectAssetImportDedup` 三个文件 35 / 56 红，全是断言失败、0 个类型错；还原后 56 条全绿。（`block-source-side.txt`）

**反例**（各自临时改坏一处 → 跑目标测试 → 逐字节还原 → 再跑一次绿）：
| 改坏 | 结果 |
|---|---|
| K1 `finalizeAssetMeta` 原样放行调用方给的来源 | 24 / 42 红 |
| K2 读渲染层载荷里的来源 | 1 / 15 红（R7） |
| K3 同字节来源不同也复用并补来源 | 4 / 42 红 |
| K4 复用时不补来源 | 1 / 15 红（②） |
| K5 复制时重盖来源时间 | 1 / 42 红（ⓐ复制） |
| K6 本机导入不交来源 | 4 / 15 红（①两行、②老上传补来源、R9） |
| K7 外部助手回执用按扩展名猜的类型 | 1 / 15 红（④） |
| K8 同项目也复制一份 | 1 / 8 红（⑥） |
| K9 撤销日志挤出到点时不复判引用 | 2 / 7 红（分镜绑定、普通节点参考两格） |
全部是断言失败、0 个类型 / 引用错，还原后逐字节相同、重跑全绿；K9 改的是 `src/workbench/assets/pendingAssetDeletions.ts`，跑完即还原，`git status` 里没有它。

**门岗探针**：临时文件往 `.meta` 写 → `check:concept-owners` 报 `asset-source-bypass`，删掉后绿；临时文件 import `finalizeAssetMeta` → ESLint `asset-source-owner` 报错，删掉后绿。概念登记 `asset.project-source-evidence` 的 `forbidden_derivations` 列了两个旧形状（`sanitizeSourceEvidence` 只许在主人文件里、`sanitizeAssetMetaForKind` 不许再出现）：临时文件定义 `sanitizeAssetMetaForKind` → `check:concept-owners` 红，删掉后绿。扫描单测（R1–R6 反例 + 正例）与全仓扫描都绿。

**门数（door-map，生产代码，前 → 后）**
| 符号 | 前 | 后 |
|---|---|---|
| `sanitizeSourceEvidence` 调用文件 | 2 | 1（只在 `assetSourceEvidence.ts` 内，私有） |
| `sanitizeAssetMetaForKind` | 2 | 0（删） |
| `finalizeAssetMeta` 调用文件 | — | 2（`projectAssetStore.ts` ×4、`generatedAssetStaging.ts`） |
| `reconcileReuse` 调用文件 | — | 1（`uploadContentStore.ts`） |
| 渲染层取 `copyProjectAsset` 的文件 | 2 | 1（`assetLibraryMaterialize.ts`） |
| `materializeProjectFile` 调用文件 | — | 2（素材库材料化、工作流插入） |
| `materializeAssetLibraryItems` 消费文件 | 5 | 5 |

**老用户**：`v0.24.1-uploads` 两份无来源上传 sidecar 原样读回仍无来源；带来源再导入同字节 → 补上来源，其余字段与时间戳不变；`v0.24.1-connector` 跨项目复制后来源逐字段相同；`v0.24.0-generated` 复制后仍无来源。

**体积**：`projectAssetStore.ts` 按门岗口径 886 → 794（冻结线同步下调）。

**如实写的**
- 同项目的工作流插入、而那份文件后来被删了：修后保留原地址照常插入，不再出「部分素材未能复制」的提示（修前是去复制、复制失败才提示）。
- 外部助手导入的素材现在落盘记 `user` 来源（它走本机导入，同①）。
- 撤销日志挤出那组用例里，「文件还在原路径」这种「不发生」的断言靠等 20 ms 判；改坏版（K9）稳定红。
- 「缺复制通道」那一支桌面不可达，只有单测覆盖。
- 门岗计行数按格式化后的口径，与 `wc -l` 不同。

**真窗口实点（修后，zh / en 各一遍，`NOMI_TEST_NETWORK_GUARD=1`、假供应商 fake-apimart、构建戳 = 当前源码）**：证据在 `/Users/aoqimin/Nomi-coord/tmp/L-home-assets/win-fix`（`win-*.zh-CN.light.png` / `win-*.en.light.png`，命令记录 `commands.jsonl`）。
- ⑥ 同项目工作流插入：生成一张图 → 加一个文字节点 → 全选存流程 → 流程面板「放上画布」。素材面板插入前 1 张、插入后仍 1 张（`win-B1` / `win-B4`；修前同一流程是 1 张 → 2 张，见 `u6/`）；`assets.list` 插入前后都只有那一条生成记录；跳到新节点后，插入的图片节点（`gen-v2-image-…`，和插入的文字节点同一批 id）地址就是原件 `assets/generated/…/image-….png`（`win-B5`），没有复制品。两种语言结果相同。
- ① 本机导入：画布「导入」的文件选择器选一张 PNG → 新素材卡落在画布、素材面板多一张（`win-C1` / `win-C2`）；`assets.list` 读回这条 `kind: upload`、`sourceEvidence.source: user`、`usageStatus: reference_only`，旁边那条生成图仍无来源（老行为不变）。两种语言结果相同。
- 界面元素、布局、文案和修前截图一致，没有新增或消失的控件。

## 拍板图

不适用：`pure-bugfix`——同项目的工作流插入不再多复制一份文件、素材面板少一张重复卡；不改布局、元素、文案，失败提示仍是现成的那一句。
