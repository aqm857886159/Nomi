# 方向检查：参数准入（起草时的两类静默，铁律 ⑩）

> 触发：提交 hook 的 RW 统计——概念「参数准入」（owner `electron/capabilityCore/executionContract.ts#compileParameters`）近 14 天第 10 个 fix；`mcpGenerationVideoResolve.ts` 第 7 个、`generationTransportAdapters.ts` 第 6 个。
> 交给协调会话拍板；本页只陈述，不改产品方向。

### 0. 一句话根因

参数准入的 owner（`compileParameters`）只在**封印 / 预览 / 改草稿**时跑，**新建草稿**那扇门只核模型身份；中间那一段各站各自解读参数，而拒绝的话在桌面 lane 的传输层又被兜底码吞掉——Agent 写错了，没有一处当场、清楚地告诉它。

### 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 本次：海螺 8 秒（节点回落 6，卡与请求写 8） | create 不跑准入；节点构造器自己丢非法值回落默认 | 起草不准入 |
| 本次：Veo / GPT Image 说了时长被悄悄丢 | 同上；卡投影按参数表清残留 | 起草不准入 |
| 本次：ContractCompilationError 到 Agent 只剩 `generation_not_started` | 传输层 `safeFailure` 不认这类错 | 拒绝到不了模型 |
| 820759673 / dbc751447 比例上 draft_shots | 比例没有语义位置、模型猜键名 | 语义字段缺翻译层（已修） |
| be8add09b 参数准入收成一份 | 准入判据有几份 | 判据多份（已修） |
| bc1bd37c1 拒绝真的到达模型眼前 | refuseToModel 之外的拒绝被兜底 | 拒绝到不了模型（上次只修了 ModelFacingRefusal 一档） |
| 5302577af 准入对全部 kind 按档案校验 | 非视频不校验 | 准入覆盖面 |
| a15941a2f 卡上改动同一条并入规则 | 卡与 Agent 两条并入 | 判据多份（已修） |
| cf9e7c009 变体 owner | 变体两处推导 | 一事实多 owner（已修） |

十个里三类反复出现：**起草不准入**、**拒绝到不了模型**、**语义字段缺翻译层**。

### 2. 为什么这一类会一直出现

写入口（多镜 create / 单镜 create / 改草稿）里只有「改草稿」调了 `admitPlanCandidate`；其余两扇门把参数原样落盘，到封印才核。于是每发现一个语义字段（比例、时长，下一个可能是张数 / 清晰度）就要在 `normalizeAuthoredCandidate` 里加一道专门的翻译，而「拒绝送不到 Agent」是另一条独立的漏口，每次只修一档错误类。

- ⑩ 说的=摆的：直接命中（`tests/experience-laws/intentShownEqualsDrafted.test.mjs` 首跑 3 条）。
- ⑪：不适用。⑫：不适用。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| Agent 在 `parameters` 里写一个不在档里的清晰度（如 4K 给只收 720p/1080p 的模型），起草照收，封印时才拒；中间卡上显示的值与节点不一致 | ⑩ 宿主矩阵加一行「parameters.resolution 越界」 |
| 下一个语义字段（张数 / 清晰度）上 draft_shots 时，又要在 `normalizeAuthoredCandidate` 里加一道专门翻译 | 看下次加语义字段的 diff |

### 4. 靶子独立性检查

宿主矩阵走的是生产宿主链（投影 → 计划处理器 → Run → 落地线缆 → 节点构造器 → 卡投影），用真内置目录；判据「Agent 说的 = 每站摆的，或当场拒」与实现无关。

### 5. P0：这些是我们独有的吗

是。「Agent 的语义字段 → 某家模型的参数键与档位」是 Nomi 的花钱领域约束；没有通用库知道 Nomi 的档案与付费卡。判据复用仓内 owner（参数表 `acceptedParameterSchema`、错误形状 `ContractCompilationError`、传输兜底 `safeTransportFailure` 的 `ownMessage` 口），不新写判据。

### 6. 对比与推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 无：没有通用库描述「Agent 语义 → 供应商参数档位」 | — | — | 不适用 |
| 补（本提交） | 时长按 #1023 比例那道的形状在 `normalizeAuthoredCandidate` 核；传输层认 `ContractCompilationError` 并原样送出正文 | 一个文件 + 两行接线 | 只覆盖时长与比例两个语义字段；`parameters` 里其它值仍到封印才核 | **现在做**（协调会话已定方向） |
| 重写（限写入口） | 三扇写入口在语义翻译之后都调 owner `admitPlanCandidate`，起草即准入；语义翻译只负责把模型面的话翻成真实键 | 改两扇门，跑一遍现有 create 夹具（可能有夹具写了档外参数） | 草稿更严，剧本拟镜等宿主自填的参数若不合法会在起草时拒 | **推荐下一刀做**，由协调会话排 |
| 删 | 删节点构造器里的「非法值回落默认」 | 旧数据打开时要换成明说 | 中 | 随「重写」一起做 |

### 7. 用户要权衡的核心

现在只修时长这一个语义字段、换来改动小；还是让「起草」这一步就跑完整的参数准入，换来这一类不再回来、但草稿会比今天更严格。

## 特征测试清单

- `electron/capabilityCore/generationAuthoredDuration.test.ts`（无时长 / 档位 / 范围 / 空表 / 类型 七条）。
- `tests/experience-laws/intentShownEqualsDrafted.test.mjs` 的 `duration-out-of-steps` / `no-duration-param` / `still-with-duration`（变异：换回旧 `mcpGenerationVideoResolve.ts` 或旧 `generationTransportAdapters.ts`，各 3 条红）。
