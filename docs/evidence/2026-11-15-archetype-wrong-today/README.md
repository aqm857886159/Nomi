# 证据：档案「今天就是错的」五处（2026-11-15）

设计卡：`docs/plan/2026-11-15-archetype-wrong-today.md`。截图不进仓库（隔离资料目录真窗，中文浅色 + 英文暗色，零花费、没点 ↑），在 PR 正文里按文件名列出。

## 请求体矩阵（`electron/parity/officialWire.bodies.snapshot.json`）

和主线比，重录后 14 格变了（每格画布、Run 两路，共 28 路），其余逐字节不变：

```
# GPT Image 改图默认比例「自动」：以前发 size: "auto"，现在不发
gpt-image-2.5-flare|i2i|n=1     gpt-image-2.5-flare|i2i|n=16
gpt-image-2.5-sunburst|i2i|n=1  gpt-image-2.5-sunburst|i2i|n=16
gpt-image-2.6-flare|i2i|n=1     gpt-image-2.6-flare|i2i|n=16
gpt-image-2.6-sunburst|i2i|n=1  gpt-image-2.6-sunburst|i2i|n=16
gpt-image-2|i2i|n=1             gpt-image-2|i2i|n=15
# Veo 3.1 图模式：以前在目录里丢掉比例，现在发默认 aspect_ratio: "16:9"
veo3.1-fast|reference|n=1       veo3.1-fast|reference|n=3
veo3.1-fast|frame|n=1           veo3.1-fast|frame|n=2
```

可灵图生的 body 本来就不发比例（以前在目录里丢）；H3 的 webhook 默认是空、以前就被补丁删掉；Seedream 文生默认 1:1；第 5 处只改发送前拦不拦，不改请求体。

快照的重录开关会清空 `added` 数组，所以只把上面这几格的哈希合并进去，`added` 原样保留。

## 方式 × 变体默认参数（`electron/parity/modeParamsVariants.snapshot.json`）

与主线逐字节一致：Veo 3.1 图模式的比例和主线一样还在（第一版藏掉过，独立验收后改回）。

## 生成物（`electron/catalog/archetypeWireDefaults.video.generated.ts`）

只少一处 `aspect_ratio`：可灵 3.0 APIMart i2v。生成器在主线上还会顺带吐出一批 `nsfw_check` 漂移（主线生成物没重跑），这一刀没收进来，原样还给主线。

## 全扫（`electron/catalog/apimartShownEqualsSent.test.ts`）

种子目录里 APIMart 全部有档案的模型 × 变体 × 方式 × 露出的控件：554 格、66 个模型（图片、视频、音频三类都有）。每格要在这次请求里有去处：body / 进程参数 / multipart 字段直接引用，或被一条参数规则吃掉、产出的线上键被引用。今天红 13 格，登记在 `apimartShownEqualsSent.known-red.json`：

- Suno V5.5 11 格：音乐生成的自定义模式 / 风格 / 标题 / 时长，续写和翻唱的全部参数。APIMart body 写死 `custom:false`，三个方式都落在同一条映射上。
- Grok Imagine 2.0 Ext 改图 2 格：APIMart 只发布了文生图。

登记两向核对（红格都登记过、登记的都还红），条数上限 13，只减不增。

## 老用户回放（真实旧数据）

`electron/catalog/archetypeWrongTodayOldCatalog.test.ts`：读 `tests/fixtures/old-user-data/curated/v0.24.1-apimart/model-catalog.json`（0.24.1 落盘的目录），走升级 `applyBuiltinSeeds`，再用升级前后的映射真造请求体（不出网）。7/7 绿：

- 夹具前提：老目录 H3 两条映射引用 `{{request.params.webhook}}`，GPT 2.5 改图引用 `{{request.params.size}}`。
- H3 文生 / 图生：老节点存着回调地址，升级前发 `webhook`，升级后不发。
- GPT Image 2 / 2.5 Flare 改图：存着 auto，升级前发 `size: "auto"`，升级后不发；存着 16:9 照发。
- 可灵 3.0 图生：升级前后都不发比例（不回归）。
- Veo 3.1 Fast 图生：升级前不发比例，升级后发存着的 9:16。

Seedream 4.5 文生节点存着 auto：真实旧存档里没有这种节点，`archetypeMeta.test.ts` 用 0.24.1 节点形状构造 meta：发送前修成 1:1，改图的 auto 照留。另外，已有的「选中即纠正」机制会在节点被选中时把它改成 1:1 并存盘（不是本 PR 引入的，见设计卡 ★1c）。

## 反例

`counterexamples.txt`：十次改坏全红，还原全绿，最后 `git status` 干净。
