# C1 尺子：参数列

Owner/concept：`generation.model-switch-params`；第 0 步仅测试/设计，无产品行为修改。
设计卡：[`2026-11-09-model-params-write-time.md`](../../docs/plan/2026-11-09-model-params-write-time.md)。

```sh
pnpm exec vitest run tests/model-params/contracts.test.mjs
```

可选 `NOMI_MODEL_PARAMS_REPORT=<本线自己的绝对路径>` 保存 JSON 读数；CI 不要求该环境变量。
每个入口恰三格：`legal`（写完立即合法或明确拒写）、`explanation`（实际规整有正确旧/新值和非空理由）、`open`（已存不合法值可见标记且只读）。
一格聚合该轴全部样本，任一反例即红；当前红格固定登记为 Vitest `it.fails`，修好该格就从固定集合移除，意外通过会硬红；不根据本次结果自动生成已知缺口。
夹具/加载/生产调用异常归普通基础设施测试，不能靠 `.fails` 放过。没有 `skip` 或 retry。

| 入口 id | 实际写边界 | 枚举轴 | 打开读面 |
|---|---|---|---|
| canvas-model | buildNodeModelChangePatch | 同类型模型两两 | 画布项目解析/参数条 |
| canvas-mode | applyHumanModeChoice + effectiveModeParams | 模式两两 | 画布项目解析/参数条 |
| canvas-variant | applyArchetypeVariantSwitch | 变体两两 | 画布项目解析/参数条 |
| storyboard-model | planModelSelection → updateShotAt | 同类型模型两两 | 分镜项目解析/行标记 |
| storyboard-kind | shotKindPatch → updateShotAt | 图片↔视频 | 分镜项目解析/行标记 |
| storyboard-mode | ShotComposerBar 的真实 onModeChange | 模式两两 | 分镜项目解析/行标记 |
| storyboard-reference-mode | StoryboardShotRow 的真实 onSwitchMode | 模式两两 | 分镜项目解析/行标记 |
| storyboard-duration | ShotComposerBar 的真实 onChange | 全控件值 | 分镜项目解析/行标记 |
| agent-patch | previewStoryboardPatchShots | 所有模型两两/跨类型 | 分镜项目解析/行标记 |
| agent-node | buildPlannedNodeMeta | 全模式/变体控件值 | 画布项目解析/参数条 |
| agent-draft | admitPlanCandidate + archetypeCompileOptions（起草共享准入） | 全模式/变体控件值 | 真实 generation read handler + 内存合同存储 |
| deterministic-planner | planStoryboardFromScript | 视频模式控件值 | 分镜项目解析/行标记 |
| first-frame | shotKindPatch，video↔image-video | 全视频模式，开/关 | 分镜项目解析/行标记 |

目录来自 `applyBuiltinSeeds` 的空目录种子，按 `(vendorKey, modelKey)` 取档案并特化；不读用户真实目录或 Key，不接网络。
种子包括默认值、每个选项、min/max、边界外一档、布尔两档以及意图秒数 3/5/8/12/20。字段逐个变化，不做无关字段的笛卡尔积。无档案或未声明范围单列「未验证：缺量具」，不编造上游约束。
模型选择器限同类型；跨类型由类型入口和 Agent patch 覆盖。图片停留秒数与模型 duration 分别判断；默认模型清空时由真实 storyboardShotToCreateNodesArgs 确认配置的 fallback 身份，不在测试里修正秒数。

观测规则：
- 只用 owner `isParamValueAllowed` 判合法；不在尺子里再造规整函数。只检查本次目标模式声明的参数，以及不应保留的来源参数。
- 存储缺省参数按目标档案默认读取；显式存值保持原样，不调用产品修正器给测试擦错。
- 说明读取原生变更回执，今天 canvas 的 changeset 有旧/新值但没有理由，不能当作完整说明。其它写边界今天没有结构化调整回执，不能由测试自行生成解释。未来实现接共享结果时适配其真实返回值，须同时保留旧/新值与理由校验。
- 打开先从隔离文件读 JSON，再走 normalizeRecord。画布读取 resolveRenderedControls + 真 InlineParameterBar；分镜读取 validatePlan、真实策略引擎/shotDurationWarnings 和真行组件。可见标记来自实际可访问状态/警告文本，按问题字段及旧值匹配，不能把引擎中未显示的 issue 冒充行标记。
- 起草打开通过真实 generation handler 的 read，检查原生参数/时长诊断，并统计合同存储 patch；读取时自动清残留也不能冒充只读成功。
- 文件字节、传入对象、同步 fs 写入口和 operation store patch 同时核对。多个 writer 共用同一读面时缓存相同输入的观察，避免重复渲染；每行是该入口的合同覆盖数，不是独立读实现数量。
- 普通阳性检查证明真实项目夹具可重开、现有分镜时长警示确实可被观察；没有用缺失的虚构 `issues` 或 `parameterAdjustments` 字段制造红灯。

范围：单元/合同层量具，不代表真实 App、网络模型、Windows、性能或旧版本用户资料验收；第 1–4 步按设计卡补齐产品闭环。Agent 起草在本尺子量共享准入而非调用付费生成。
七热点产品变异仅用于自验，必须逐字节还原，不提交产品变异。
