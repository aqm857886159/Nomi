# 设计卡：档案一个口（给模型 + 档 → 已按档收窄的档案）· 刀 A 只换入口

> 2026-11-15。前置：#1531（`fix/archetype-wrong-today`，Veo 3.1 图模式比例、GPT Image 2 改图「自动」）。四类：碰**花钱**（发送口、Run 付费口都走这个入口），9 格全填。
> 这一刀**只换入口**：创作者看到的、发出去的请求一律不变（两份请求体快照 + 参数尺快照一字不改）。档 × 方式的声明和发送口拒绝是下一刀（见末节「下一刀」）。

## ★0 先查别人

- LiteLLM `get_supported_openai_params` / `drop_params`（https://docs.litellm.ai/docs/completion/input）· 支持哪些参数按**确切的模型名 + 供应商**查，不按供应商查 · **确认了**：收窄的钥匙是「模型 + 档」，不是「档案」——入口的参数就是这两样。
- fal endpoint schema（https://fal.ai/models/fal-ai/veo3.1/fast/image-to-video/api）· 每个「档 × 方式」是独立 endpoint，各有自己的 schema，没有「先拿全集再收窄」这一步 · **改了**：不照搬按档拆行（违背 06-16「一个模型 + 变体选择器」），借它的结论——**收窄只在一个地方，调用方拿到的永远是已收窄的**。
- OpenRouter models API（https://openrouter.ai/docs/api-reference/list-available-models）· 目录型变体是独立条目，路由型后缀只是请求修饰 · **确认了**：名单层可以一行一模型（并集），详情按档给——并集口保留，但要显式写出来。
- 仓库内先例：`electron/shared/modelArchetypes/index.ts` `ArchetypeModelLike.vendorKey` 注释「曾有 5 个调用点漏传 → 发送路拿到未特化档案；类型层逼所有调用点显式表态」· **确认了**：档也做成必传、无缺省，同一个做法。

## ★1 用户怎么用

当我在画布上切 Veo 3.1 / Seedance 的档、在分镜行改参数、让 Agent 起草镜头时，我想每一处看到的参数都是**这一档**真有的，以便显示的 = 发出去的。

这一刀创作者**没有任何可见变化**：同样的模型菜单、档位、参数行、方式菜单、请求体。变化在代码里：以前「拿档案」和「按档收窄」是两步，调用方可以只做第一步（#1531 就是发送口漏了第二步）；现在只有一个入口，档必传，拿到的就是收窄好的。

不做什么：不改任何档案声明；不按档收方式（下一刀）；不改界面、文案、布局；不加门岗、拦截、提示。

真实任务：Veo 3.1 三档、Hailuo 2.3 两档、Seedance 2.0、可灵 3.0 的参数面板 + 方式菜单，分镜 3 行——和 main 逐张对比，一致。

指标：
- 主：档案入口个数 9 → 1（另一个显式「全部档」口）。量具：`node scripts/door-map.mjs resolveArchetypeForModel` + 结构测试 `electron/shared/modelArchetypes/archetypeSingleEntry.structure.test.ts`。
- 护栏：绕过入口（按 id 查表 / 整表遍历 / 私有副本）的生产调用点 11 → 0。量具：同一个结构测试。
- 质量：请求体零变化。量具：`electron/parity/officialWire.bodies.snapshot.json`、`electron/parity/modeParamsVariants.snapshot.json`、参数尺快照，一字不改。
- 按档收窄的写法 4 → 1。量具：结构测试「读 `paramOverrides` 只在入口一处」。

### ★1b 连带界面

无。模型菜单、档位分段、参数行、方式菜单、分镜行参数格、Agent 模型详情的文字都不变（真窗口 zh 亮 / en 暗与 main 逐张对比）。

### ★1c 老用户

节点存档形状不变（`archetype.{id, modeId, variantId}`），不写迁移、不读新字段；退回上一版照常打开。入口对老节点按它自己记着的档收窄（`variantRecordedInMeta`：记的档案就是这个档案才算），和以前 `currentArchetypeVariant` 的口径一样。证据：`tests/fixtures/old-user-data/` 的 0.24.1 真实旧存档跑一遍升级回放；另查「带档模型 + 这一档收窄掉的参数」形状的节点有没有。

## ★2 谁说了算

- 新概念「这个模型这一档的档案」→ 唯一 owner：`electron/shared/modelArchetypes/entry.ts`（`index.ts` 原样转出）的 `resolveModelArchetype(model, { variant })`。`variant` **必传**：`{ variantId, modelId }`（两个键都要写）、按解析出的档案再定的函数形、或显式 `EVERY_VARIANT`。顺序固定：基础档案 → 供应商 → 型号名作用域 → 方式的锚点消费 → 档（`resolveArchetypeVariant`，已登记 owner，不动）。
- 换档用 `rescopeArchetypeVariant(archetype, variant)`：从这份档案的全部档版本重新收窄，不在已收窄的上面再叠一遍。
- 全目录问题用 `everyBuiltInArchetype()`。
- 删的并行版（同 PR）：`registry.ts` 私有 `profileFor` + `specializeForProvider`；`referenceChannels.ts` 私有 `builtInArchetypeById`；`recommendation.ts` `effectiveVideoModes` 里的内联 `paramOverrides`；`modelSpecProjection.ts` 的手搓特化链；`getArchetypeById` / `MODEL_ARCHETYPES` / `specializeArchetypeForVariant` / `resolveArchetypeForModel` 不再从 `modelArchetypes/index.ts` 导出（表本身挪到 `builtInCatalog.ts`，只给入口、脚本、测试读）。
- 「全部档」口的生产使用点是结构测试里一张只减不增的名单。

## ★3 一致与复用

以前定过什么：
1. 06-16 「一个模型 + 变体选择器，不拆多行」——算数，入口保留一份档案多档。
2. 09-26 变体唯一 owner `resolveArchetypeVariant`——算数，入口调它。
3. 11-12 方式参数唯一 owner `effectiveModeParams`——算数；它的「主进程漏了变体特化」就是这一刀要收掉的那一类。
4. 06-24 「删 `vendorParams`」——被后来改动盖掉，不复活。
查不到：有没有人做过单一入口又退回去——`git log --grep=revert`、`-S` 都没找到。

三条路：
- 沿原方向修（各调用点补一句收窄）：同类会从第 N+1 个调用点回来，不选。
- **换做法（选）**：一个入口、档必传、表不导出；结构测试守。
- 删掉（按档拆成独立档案）：推翻 06-16，模型菜单 1 行变 3 行，不选。

## ★4 全状态

不涉及新状态：入口同步、无加载 / 失败态；认不出 → null，调用方照旧走「通用」回退。

## 5 中途表

只读解析，无副作用：停 / 关窗 / 断网 / 重启 / 连点都与今天相同。

## 6 外部数据与失败

不涉及外部数据。档案声明一字不改。

## ★7 性能

不是新增功能，没有新的用户操作。风险是入口每次返回新对象、打破以档案对象为键的 WeakMap 缓存（`archetypeMeta.ts`）。要求：同一组输入返回同一个对象（结构测试锁引用相等）。量具：`pnpm run perf:scenarios -- --measure-only` 的模型菜单 / 参数行场景，前后各两次对比 main，不写基线。

## 8 真实条件

Windows：unverified；英文界面 + 暗色：真窗口对比；真规模：perf 场景；真付费：0 发（请求体快照不变即证据）。

## 拍板图清单

不适用：无界面差异（真窗口与 main 逐张对比为证）。

## ★9 验收与回滚

| # | 反例（改坏什么） | 应该红的测试 |
|---|---|---|
| 1 | 生产代码新加一处按 id 查表 / 整表遍历 / 私有副本 | `archetypeSingleEntry.structure.test.ts`「入口目录之外的生产代码不碰档案表」 |
| 2 | 多一个「全部档」口使用者 | 同上「全部档口的使用点是一张只减不增的名单」 |
| 3 | 入口的档给了缺省值 / 变可选 | `tsc`（`@ts-expect-error` 失效）+ 结构测试签名断言 |
| 4 | `modeParams.governedKeys` 改读收窄后的档案 | `modeParams.test.ts` 手搓档案用例：某档把一个键从全部方式里收掉，存着的旧值仍要被剥掉 |
| 5 | 入口每次返回新对象 | 结构测试「同一组输入返回同一个对象」 |
| 6 | 加回一份删掉的私有表（如 `builtInArchetypeById`） | 结构测试 1 |
| 7 | 读 `paramOverrides` 的第二处 | 结构测试「按档收窄只在入口一处」 |
| 8 | 任何请求体变了 | 两份请求体快照 + 参数尺快照 |

回滚：单 PR，`git revert <merge>` 即回；无存量迁移。

## 下一刀

- 档 × 方式：给 `variant` 加 `modeIds`，入口同时收方式（Veo 3.1 Quality 无参考图、Lite 只文生、Hailuo 2.3 Fast 要首帧），能力表 `variant:` 记号双向对账。
- 发送口拒绝：taskParams / Run provider / MCP 对上游文档写死必拒的组合在发送前拒，回执带可切的档。
- 方式菜单 / 分镜方式格：被挡方式置灰 + 原因（要出图拍板）。
- Agent 模型详情：每档给 `modeIds`。
- 收掉这一刀留下的「全部档」口里能按档问的（`apimartModelHealth` 指纹、引导页自写能力编辑器）。
- 入口返回 branded 类型，让 `declaredModeParams` / `modeForInputs` 拿基础档案编译不过。
