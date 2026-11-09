# 模式与比例的单一事实源

类别：其他；纯修复，不增加界面、操作或执行能力。实现只删重复比较、扩充已有比例解析和维护走查判据。三笔实施提交；本卡在实现前确定，按协调收窄更新。

## ★1 用户怎么用

当创作者指定模式或画幅时，要让草稿、授权与请求保留这个意图。流程：说出目标 → Agent 从目录选模型与模式 → 宿主按模式定种类 → 语义比例落到真实参数 → 查看草稿/确认卡 → 授权后提交。真实任务：首尾帧生视频；火山 Seedream 2560×1440；只收冒号比例的模型生成 16:9。

指标及量具：指定模式冲突拒收率，`mcpGenerationVideoResolve.test.ts` 重放十个历史形状，目标 0/10；Seedream 比例拒收率，`semanticAspectRatio.test.ts` 重放十二个历史形状，目标 0/12；请求体变化率，`officialWire.matrix.test.ts` 的 NOMI_OFFICIAL_WIRE_DUMP 逐格 JSON 对比，owner职责拆分后目标 0%；默认模型判据，`agent-default-model-real.test.mjs` 换序/删除反例与发送时序测试，目标全通过。真实模型遵从与 39 题评测未验证，由协调另跑。

★1b：现有 Agent 拒收出口中删掉 modeId 与 taskKind 冲突的两句英文；未知模式仍走原有问题码。其他界面文案不变。比例 owner 的消费者包含画布控件；本线不另做 Seedream 可见界面改版。

★1c：不迁移或重写存量工程。旧草稿无 modeId 时保留 byId/byTask/推荐逻辑。旧节点迁移代码、条件、验证及既有显式比例优先均不改。分镜几何保持自己的 slash/decimal 读取合同。

## ★2 谁说了算

模式事实 owner：`videoModeForPlan`；传输种类 owner：`modeTransportFor`。给 modeId 时不再比较第二份 taskKind。比例解析和宽高 owner：`electron/shared/aspectRatioValue.ts`；本刀仅扩充 owner，消费者的解析收口另列。

`door-map` 主链修前13扇/20处，修后13扇/25处：mcpGenerationVideoResolve 的 videoModeForPlan；generationPlanPatch 与 mcpGenerationTools 的 normalizeAuthoredCandidate；semanticAspectRatio 的 resolveAspectRatioGeometryChoice、aspectRatioValue 的 resolveAspectRatioChoice / readAspectRatioGeometry；aspectRatioValue 自读 parse/normalize；generationListMediaFacts、nodes/aspectRatio、parameterControlModel、NodeParameterControls、videoAspectSeed 读 parse/normalize。相同 owner 的多个读者不能合并为一个业务入口。

向上一跳：应用内 Agent 与外部 MCP 经 generationTransportAdapters / mcpGenerationTools 进入同一个 normalizeAuthoredCandidate；草稿补丁经 generationPlanPatch；Run 契约编译经 videoCompileOptions/videoModeForPlan。检索未找到另一处拿作者 taskKind 拒绝已选合法视频模式的比较；映射查找的 taskKind/modeId 是路由匹配，不是作者冲突拒收。

不在本刀：比例解析收口 + 守卫另列。扫描涉及 9 个文件，其中 taskParams.ts 是正在由另一 PR 修改的热点，避免在此刀重叠；四个原授权消费者与分镜几何都不改。

## ★3 一致与复用

方向来源：`docs/engineering/direction-checks/2026-11-08-generation-request-chain.md`；共享 owner 的原决策：`docs/plan/2026-10-05-agent-aspect-ratio-semantic.md`。保留创作者模式/画幅，三条路中选择删除重复比较、扩充已有 owner 的像素写法；不新增供应商分支，不新增尺寸策略或依赖。

数字解析只有一条正则。`readAspectRatioGeometry` 读冒号、命名档与 WxH/W×H/W*H；`normalizeAspectRatioToWH` / `parseAspectRatioValue` 保留界面合同，像素串不作比例 chip、不进比例组，画布调用方不改。宿主 `resolveAspectRatioGeometryChoice` 只保留几何完全一致的合法选项，复用既有同档选择后返回原始供应商值；无完全一致值则拒并列出原始合法值，绝不选近似档。

分镜例外：现役 propose_storyboard_plan、规划模型 schema、外部 JSON、旧工程读取接受 16/9 和 1.78；离线生产边界重放两值均保留，现有预览为 240×135，owner 返回 null。写入边界统一前不删其读法；owner 不扩此两种格式，shotFrameGeometry.ts 不改，守卫草稿已拆出，不在本刀。

### 外部规范对齐（核对日期 2026-11-09）

| 规范链接 | 我们的偏差 | 偏差理由 |
|---|---|---|
| [火山方舟图像 API](https://docs.volcengine.com/docs/82379/1541523) | 未验证：原页超时，依据 `seedreamVolcengine.ts` sources 的既有官方事实记录：4.5 像素积 3686400..16777216、比例 1/16..16；现有声明只暴露十个合法像素档 | 保留已声明档位与同档选择，不扩大到任意上游可用像素尺寸；2560x1440 是现有合法档，原样发 |
| [APIMart Seedream 4.5](https://docs.apimart.ai/en/api-reference/images/seedream-4.5/generation.md) | 无：size 是冒号比例，resolution 分开；官方 2K 映射列出 16:9 对应 2560x1440 | 像素意图转成所声明比例 size=16:9；不把火山像素串传给此渠道 |
| [APIMart Seedream 5 Pro](https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation.md) | 官方支持比例/精确像素；我们仍只选现有声明的合法项 | 保留当前目录合同与 resolution，不增加自由像素输入 |
| `electron/parity/officialWire.matrix.test.ts` 与 `tests/fixtures/vendor-official/apimart/doubao-seedream-4.5.json` / `doubao-seedream-5-0-pro.json` | 这些靶子量参考字段、模式与两路一致，不完整覆盖 size | 不把参考事实误当尺寸规范；size 另用上述官方原页和已有火山事实核对 |

## ★4 全状态

有意改变：创作者说16:9，模型只有像素档时，宿主选几何完全一致的对应档（如Agnes 2.0的1280x720），不再仅因size是像素串就拒；没有完全一致值仍拒并列合法值。不把1344:768当作16:9。画布的旧展示、排序、控件去重、meta写回与census 280/112不变。

空：未指定比例时原样保留。加载/取消中/过期：解析是同步纯函数，不增加状态。成功：模式定种类、比例落到合法原值。失败：未知模式、非法比例、同档不明仍走既有拒收。部分成功：本层原子解析，不新增部分写入。能力不可用：无比例控件仍报告原原因和合法下一步。中文/英文既有出口复用，未新增词条。

## ★9 动手前验收合同

1. 给了合法 modeId、taskKind 写反：不拒，normalize 输出模式声明的传输种类；十个历史形状逐条重放（firstlast 两条、omni 五条、first 一条、ref/edit 各一条）。未知 modeId 仍拒。
2. 未给 modeId、只给 taskKind：byId/byTask 与推荐照旧；没有有效模式仍拒。
3. 2560x1440、2560×1440、2560*1440：owner 解析相同；火山 Seedream 精确合法 size 原样保留；只收冒号的模型落 16:9。十二个历史 Seedream 比例拒收逐条重放。
4. abcx、0x720、2560x、零/负数等非法形状不认且宿主拒收；冒号、全角冒号、说明后缀和 portrait_4_3 不变。slash/decimal owner 不认。
5. 当前/默认像素同档与 several_sizes 行为保留；多个完全一致档位仍按原同档规则选择；只有一个完全一致档位时沿用原唯一候选规则，可与默认分辨率不同。合法选项外不任意写像素。
6. 消费者均不改。owner 修改后 officialWire 与画布参数面板/meta 相关现有测试必须全绿，请求体与基线逐格零差异；有差异或画布测试红则不提交 owner，停下列差异和做法代价。
7. 不在本刀：比例解析收口 + 守卫另列。守卫原稿、误报反例与 9 文件15处扫描结果离线封存，不提交；仓库仍有多份解析的限制明示。
8. 默认模型从本次隔离目录及其默认设置读取，不依赖固定模型 id；换序不变、移除固定 id 后随目录选择；发送前卡不算，发送后读取节点付费卡；判据纯函数单测，付费脚本不跑。
9. typecheck、改到文件所在目录全部单测、officialWire、pre-push-contracts 与正文预检完成；真实上游/付费/39 题未验证，正文明确标注。

## 已知限制

分镜方案里写成 16/9 / 1.78 的比例，画布与生成侧的 owner 不认；分镜写入边界统一成冒号写法另列。

仓库里另有 9 个文件各自解析比例，收口与扫描守卫另列。

## 已批准的职责拆分与验证

此前未区分几何与界面分类的试验有七条画布红灯，未提交。协调批准职责拆分后，现有画布回归与census原断言恢复；宿主几何匹配按上面新合同执行。officialWire 249格/498路与基线零差异。③整体拆出；④独立维护走查判据。

## 铁律⑩像素档观察核对

同样种子目录与宿主链下，Seedream4.5的16:9意图实际落成草稿parameters.size=2560x1440，节点meta.size同值；来源是共享owner的resolveAspectRatioGeometryChoice精确匹配与既有同档选择。观察辅助原用界面parseAspectRatioValue，排除了像素串。方案选择观察器改读readAspectRatioGeometry，不改产品分类合同、不新增正则；ratio-pixel-x改land并精确核草稿像素几何。现有十档仅有1:1、4:3、3:4、16:9、9:16，补21:9拒收并核原始合法值。

★9补充：草稿/节点尺寸必须2560x1440且几何等于所说16:9；无21:9必须拒并列合法像素值；卡片仍按生产nodePointerSummaryFacts读口核对，禁止用节点尺寸替代卡片读口掩盖缺失。完整原始observation还显示card.aspect=null；若改观察器后只剩card.aspectRatio:dropped，属于卡片真实读口缺失，须按范围外产品代码停点上报。界面比例分类与owner不改。
