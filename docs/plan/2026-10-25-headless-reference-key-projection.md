# 设计卡：headless 参考键投影改为声明驱动

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：headless 参考只投进声明过的参考位
线/负责人：Mac Codex 修复线 / fix(headless-reference-key-projection)
类别：[花钱][其他]

## ★0 先查别人

- [OpenAPI Format Registry](https://spec.openapis.org/registry/format/uri) · 把 `uri` 明确声明为字符串格式，消费者按字段 schema 解释它而不是按字段名猜 · 确认 Nomi 的请求键要把媒体类别作为声明事实，不能用 `image` / `video` 字样推断。
- [OpenAPI Specification 3.0.4](https://spec.openapis.org/oas/v3.0) · 用 Parameter / Schema / Media Type 描述参数如何排列和编码，工具据接口描述生成调用逻辑；规范的目标就是消除调用方猜测 · 确认 body 引用键和参考类别必须在同一份声明桥接上，投影函数只消费声明。
- [JSON Schema non-JSON data](https://json-schema.org/understanding-json-schema/reference/non_json_data) · `contentMediaType` 与 `contentEncoding` 直接描述字符串承载的媒体内容，消费者按声明选择解码 / 传输 · 确认 `headlessReferenceKeys` 与无槽标准输入键要在旁边显式写媒体类别，不能再从键名正则猜。
- [官方生成式 SDK 开发指南](https://docs.aws.amazon.com/sdk-for-go/v2/developer-guide/aws-sdk-go-v2-dg.pdf) · 每个操作由生成的具体 Input shape 承载参数，调用者填操作声明的字段，SDK 不把任意字符串字段当成文件 · 确认自定义中转仍可保留 headless 便利投影，但只有声明过的字段可承载参考；没有声明时应拒发并要求显式参数名。
- 本仓库已有声明边界：`electron/shared/videoCapabilities/types.ts:9-51` 的 typed controls / reference slots、`electron/shared/modelArchetypes/referenceKeys.ts:22-70` 的参考键集合、`electron/catalog/archetypeInput.ts:75-121` 的消费路径 · 确认实现应把声明表接到 `referenceReachability`，删掉 `classifyReferenceKeyDetailed` 正则，而不是复制一份供应商键名表。

## ★1 用户怎么用

当 headless / MCP 调用方只给参考素材、没有写 body 参数名时，我想让请求只把素材投到模型声明过且媒体类别相符的参考位，以便发出的请求与调用意图一致并在花钱前暴露未知契约。

步骤：
1. 调用方给 `referenceImages`、`referenceVideoUrls` 或 `referenceAudioUrls`。
2. 选择一个已发布模型与模式，不额外填写供应商参数名。
3. 主进程读取该模式 / mapping 的 body 引用键与共享声明。
4. 对声明过且类别相符、且当前没有值的键做投影；已有值（含 `false`）保持不动。
5. 若没有一个声明过的同类参考位，发送前返回明确错误，调用方改为显式参数名。
6. 记录请求体，确认参考只出现在声明位。

不做：不改变渲染层已经显式写入的参数，不修改出站 URL 序列化，不为单个供应商增加分支。已知坑：未登记的自定义中转键不会被猜测，必须在调用中写明参数名或补充声明。

真实任务：①只给音频参考调用含音频参考槽的模型；②只给图片参考调用图生图 mapping；③只给视频参考调用视频参考 mapping。主指标：带参考请求中「参考 URL 仅出现在声明且同类键」的比例，量具为 `electron/catalog/referenceKeyProjectionCensus.test.ts` 与免费演练抓包，基线为 0/现状错投格，目标 100%。质量指标：内置 mapping 的真实参考位照投，量具为 `scripts/reference-key-census.ts` 与 `referenceSentWithinInUse.property.test.ts`；护栏指标：布尔 / 数量 / 枚举 / 尺寸 / 音色键被覆盖的比例为 0，量具为同一普查与特征测试。未验证：真实用户遥测量具缺失。

## ★1b 连带界面

- Agent / MCP 回执：无声明同类参考位时，中英文错误都说明“这个模型的请求体没有声明 <类别> 参考位，请在调用里写明参数名”；不新增编辑器。
- 发送前拒发：保留现有错误卡与拒发建议入口，建议只依据声明表派生的承载力；中英文文案走现有 i18n，文案不涉及费用断言。
- 目录 `list_models`：参考承载力跟随声明表，误认的开关、数量、尺寸、音色键不再点亮支持类别。

## ★2 谁说了算

参考键媒体类别与可投影性由 `electron/shared/modelArchetypes/referenceKeys.ts` 的声明表负责：档案槽 `inputKey` 从槽 kind 得到 image / video / audio；`combineSlotsInto` 从参与槽的类别声明；`headlessReferenceKeys` 与 `TRANSLATED_REFERENCE_INPUT_KEYS` 在声明旁显式写类别；APIMart 别名组在组声明旁写类别。`GENERIC_REFERENCE_KEYS` 继续由同一表派生，`referenceReachability` 只读这张表。主进程是状态 owner，`taskParams.ts`、`modelCatalogListing.ts` 和拒发建议是消费者；渲染层显式参数不经过 headless 投影。每个键只保留一份声明事实，没有通过“东西不见了”猜用户意图。

## ★3 一致与复用

复用 `ModelParameterControl`、`ArchetypeReferenceSlot`、`headlessReferenceKeys`、`combineSlotsInto`、`APIMART_REFERENCE_PARAMETER_ALIASES` 与 `bodyReferencedParamKeys`。不复用正则分类，因为它复制了声明事实并把开关、数量、尺寸、音色误当参考。只新增共享声明读取函数，不新增供应商特例或第二套键表。证据：`git grep` 与 `node scripts/door-map.mjs`。

## ★4 全状态

- 空：没有参考素材时不生成投影，现有参数原样保持。
- 加载：沿用当前生成任务加载状态；声明读取为纯同步派生。
- 成功：请求体中参考只落在声明过且同类的键。
- 失败：没有声明同类参考位时，在任何网络请求前拒发，错误给出显式参数名的下一步。
- 部分成功：同一请求含多类参考时，已声明类别可投影；缺声明类别整体拒发，不静默丢掉该类。
- 取消中：沿用现有取消状态和回执，不新增投影状态。
- 过期：沿用现有任务过期回执，不重试未知声明。
- 能力不可用：模型没有声明同类参考位，显示中英文“请求体没有声明 <类别> 参考位，请在调用里写明参数名”，下一步是补参数名或选择有声明的模式。

## 5 中途表

| 状态 | 停止 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 纯函数投影前 | 无网络请求，回执无 | 无网络请求，回执无 | 无网络请求，回执无 | 无网络请求，回执无 | 现有去重 / 任务门处理，不重复投影 |
| 已拒发 | 立即结束，显示明确错误；不产生供应商请求 | 错误留在现有任务回执 | 错误留在现有任务回执 | 重启后可按显式参数名重试 | 现有提交门去重，不能绕过拒发 |
| 已发出 | 本刀不改变取消链；沿用现有任务状态、回执与花费语义 | 沿用现有任务恢复语义 | 沿用现有失败 / 重试语义 | 沿用现有恢复语义 | 沿用现有提交门 |

## 6 外部数据与失败

- 模型档案 / mapping body：规范依据为仓库内 `ModelArchetype`、`ModelParameterControl`、`bodyReferencedParamKeys`；声明缺失时拒发并要求显式参数名。
- headless / MCP 输入：来源是调用方显式参考 URL；不符合 URL / 媒体类别声明时不投影，交给现有拒发链。
- 自定义中转：没有声明的非通用键不会被正则猜测；调用方必须在请求中显式写参数名，错误不得甩锅 API key。
- 外部供应商 body：只按已声明的 body 引用键投影；未知的新键先让普查 / 键表完整性测试变红，不静默承载。

## ★7 性能

不适用：这是已有 headless 投影路径的判据替换，不新增用户操作、异步链或数据规模；新增的是一次纯内存声明查找，随 body 引用键数线性增长。现有投影与目录派生测试覆盖运行时间，未新增 perf 场景。

## 8 真实条件

- [ ] Windows：unverified，本任务在 Mac 工作树执行。
- [ ] 英文界面：unverified，本刀无新增界面文案结构。
- [x] 最小窗口：不适用，纯主进程函数。
- [x] 真规模：用内置 246 条 mapping 普查。
- [x] 干净安装：任务书要求的 `pnpm install --frozen-lockfile` 已完成。
- [ ] 真付费：unverified，任务书明确不跑；协调付费抽样待跑。
- [x] 键盘全程：不适用，纯函数与脚本。

## ★9 验收与回滚

验收清单（实现线先自验，独立验收线逐项复核）：

1. `pnpm exec tsx scripts/reference-key-census.ts --out docs/evidence/2026-10-25-reference-key-census/census.json` 重跑；内置目录 `falsePositiveKeys = 0`，真参考位数量按并 main 后结果照投，若数字变化在报告说明。
2. 只给音频参考：`audio` / `generateAudio` / `audio_setting` / `video_require_audio` 原值不动，音频进入声明位；无声明音频位时发出前拒绝，并写明“请求体没有声明音频参考位，请在调用里写明参数名”。
3. 只给图片参考：`num_images` / `image_size` 不变；只给视频参考：`video_start_seconds` / `num_frames` / `frame_rate` 不变。
4. 已有 `true` / `false` 的键都不被链接覆盖；`hasNonEmpty(false)` 必须为真。
5. 自定义中转的通用参考键照投；非通用写法拒发并要求显式参数名。
6. 目录承载力逐行对比，只有普查 26 行中的误认行变化，其余行不变。
7. 渲染层和 MCP 显式给参数名的调用逐项回归，headless 投影只影响“只给参考、没写参数名”路径。
8. 特征测试必须先红后绿；`referenceSentWithinInUse.property.test.ts` 的键表完整性门照跑；声明表新增 / 改动的每个键有测试。
9. 免费演练：用假上游对普查点名的真实目录行各发一次 headless 只给参考请求，保存请求体，断言参考落声明位、误认键原值不动；证据写入 `docs/evidence/2026-10-25-reference-key-projection/`。
10. 检查：改动文件 vitest、eslint、增量 typecheck、根因合同、概念 owner、测试文案门岗与免费演练全通过；不跑 `pnpm run gates`。
11. 反例：保留正则兜底、声明表靠键名猜媒体、未声明时静默丢参考、改出站 URL 写法、供应商特例分支，均必须有代码 / grep 证据为否。
12. 反例来源覆盖：新的驼峰键、布尔 / 数量 / 尺寸 / 音色键、无槽 headless 键、旧 stored extras、显式参数键、自定义 mapping、渲染层 archetypeInput 与 MCP 显式参数；每类都以声明表 / 拒发测试收口。

付费抽样方案（只写不跑）：协调在线上最便宜且有图生图声明槽的内置目录行跑一次，给一张图片参考；观察发送请求体只含声明图片位、没有 `num_images` / `image_size` 等控制键，再检查产物标记中的固定修复字面量“这个模型的请求体没有声明”。该字面量来自本刀新增的拒发错误，付费入口用它核构建包含修复；若构建中找不到它，必须拒跑并记录未知。

回滚：`git revert <本提交>`；本刀无迁移、无开关。独立验收报告由协调线提供，当前写为“待协调派验收线”。

### 功能分类
- [ ] 新界面 / 改交互
- [x] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

## 第 2 轮补充（用户 10-25 选 A）

本轮把目录承载力和发送前容量都改为模型自己的声明优先：先读选中模型、模式的 `ArchetypeReferenceSlot.max` / `asArray`，没有对应槽时才回落到共享键形态。火山 Seedance 2.0 / 2.5 的角色参考分别是 9 / 30 张；RunningHub Seedream 4.5、Nano Banana、GPT Image 2 的 `imageUrls` 分别是 1 张。超过声明上限在 headless 投影前拒发，错误写明“这个模型最多收 N 张/个类别参考”，不截断。

★9 新增验收：

1. 遍历全部 seeded mapping：有模型槽声明时，`bodyReferenceSupport(..., modelContext).multiImage` 必须等于该模型槽容量；无声明才允许键名形态推断。
2. 固定对账火山 2.0 / 2.5 = 多图 9 / 30，RunningHub 三个图片模型 = 单图 1；普查每个容量变化键记录 `capacitySource` 和 `max`。
3. headless 给 RunningHub 三个模型两张图必须在模板投影前报“这个模型最多收 1张图片参考”；不得静默截断或调用假上游。
4. 反例把 `imageUrls` 的全局多图声明直接用于 RunningHub 时，模型容量测试必须变红。
