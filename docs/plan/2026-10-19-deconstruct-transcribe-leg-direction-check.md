# 方向检查：拆解两条腿的模型解析与结果形状（2026-10-19）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

触发（2026-10-25 复核）：`fix-churn` 命中 `electron/video/deconstructVideo.ts`（14 天第 6 个，`electron/video/` 目录第 9 个）、`electron/audioTaskRunner.ts`（第 3 个）、`src/config/modelCatalogCache.ts`（第 3 个，`src/config/` 目录第 8 个）、`electron/catalog/executableModel.ts` 的目录可执行判据概念（第 3 个）、`electron/desktopStrings.ts#deconstruct`（第 4 个；词典文件 `#tasks` 第 8 个）。本轮不再增加特例分支，而是把模式资格和转写出口收回共享边界。

### 0. 一句话根因

「哪些模型能跑某个模式」和「一次转写交回什么形状」都没有唯一 owner：主进程按 kind 挑、渲染层按模式列；每家供应商的转写 mapping 自己决定读哪个音频参数、回什么时间戳形状——于是每换一个入口、一家供应商就冒一次「对白为空 / 选了却跑不了」。

### 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 199ff9d26 读图腿可选模型 | 读图腿只有自动挑 | 腿解析没有「显式 / 自动 / 失败原话」三态（已在读图腿修，转写腿本次补齐同形） |
| 881f90625 429 不重试 | 拆解并发读图撞限流 | 不同类（重试策略），不计入 |
| b733d254a 字段语言 | 提示词没要求界面语言 | 不同类（提示词），不计入 |
| 724d93b7d / cdfdf7889 模型清单缓存 | 读失败清空、首帧无值 | 不同类（缓存时序），不计入 |
| 76cc745a0 / 25a01ee8b 音频错误 / 付费出口 | 错误原因丢失、付费出口分叉 | 出口收口（同方向：执行器出口是唯一边界） |
| 本次 | 转写腿按 kind 挑；Scribe 读错音频参数、只回逐词；评测只授权读图模型 | 模式资格两份判据 + 转写结果形状随供应商漂 |
| 2fda8a539（10-19）| 分镜表补齐拍板稿的远档卡片、源视频行和固定列 | 分镜表界面 / 画布布局（不同类；未改转写判据） |
| 4ea28f23b（10-21）| 文本任务切换 pi-ai 单次调用核心 | 文本任务调用时序（不同类；仅碰词典的共用文件） |
| 7c66c1f0b、ddf304f0d（10-22）| 参考提交阶段与任务结果码收口 | 资产提交 / 任务错误阶段（不同类；未改转写判据） |
| 9de82f660、57cc560f9（10-24）| 提示库撤销与导出素材探测失败收口 | 提示库 / 导出素材（不同类；仅碰词典的共用文件） |
| d2ad49331（10-25）| 出站参考媒体 URL 统一序列化 | 外部引用 URL 边界（不同类；未改转写判据） |

### 2. 为什么会一直出现

模式资格是「可用性之上的角色过滤」，`modelAvailability.ts` 明说角色过滤住在各 picker 里——于是每个新读者（拆解转写腿）都自己写一份。转写结果的形状只由 Whisper `verbose_json` 隐式定义，没有一个出口把别家形状收拢。铁律 ⑪「能选到」：chip 能选到的 ≠ 引擎能跑的，正是缺档案级的单一可选项来源。

### 3. 不改结构会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 再接一个只回逐词的转写供应商，拆解对白与 SRT 又整列空 / 一条 cue | `electron/catalog/transcriptSegments.test.ts` 的逐词用例 |
| 新功能按模式挑模型（如配音腿）再写一份 kind 级挑选，选中音乐模型 | `git grep "kind === kind" electron/catalog` + `deconstructLegResolution.test.ts` 的全顺序类测试 |
| 评测再加一条腿却忘了授权，量具报「产品没有模型」 | `evals/deconstruct/metrics.test.mjs` 的「有说话无对白判不达标」 |

### 4. 靶子独立性

评测 `evals/deconstruct` 与被测拆解是同一条线写的，且本次正是靶子自己错了（只授权读图模型、空对白不判红）。先修靶子：授权点名的转写模型、有说话无对白判不达标；修后真付费跑出 dialogueShotRate 0.667 / CER 0.258。

### 5. P0

模式资格、转写形状都是供应商适配与目录领域（`electron/catalog/` 领域目录内）。逐词收句是对官方 `words[]` 形状的适配，没有现成库值得引入（几十行纯函数，单测钉住）。

### 6. 结构性结论（交协调会话）

- 已做：`rowServesMode` 成为模式资格唯一判据（主进程与渲染层同调同投影）；删掉 kind 级 `findExecutableModelAnyVendor`；转写执行器出口统一音频来源与 `segments` 形状。
- 建议（不在本 PR）：其余按 kind 挑模型的入口（`findExecutableModelForTask` 的空 modelKey 分支）后续也改按模式问；本机转写在 chip 里预告首次下载体积（改界面，走设计管线）。

### 7. 特征测试清单

- `electron/video/deconstructLegResolution.test.ts`：自动候选必须发布 `transcribe`，显式不可用返回 `requested-unavailable`，`cloud` 排除本机引擎。
- `electron/catalog/transcriptSegments.test.ts`：逐词 / `audio_event` / 无时间戳的出口形状。
- `src/config/modelCatalogCache.test.ts`：chip 选项与 `rowServesMode` 的同一投影。
