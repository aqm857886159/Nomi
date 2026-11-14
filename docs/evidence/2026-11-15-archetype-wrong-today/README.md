# 证据：档案「今天就是错的」五处（2026-11-15）

设计卡：`docs/plan/2026-11-15-archetype-wrong-today.md`。截图不进仓库（隔离资料目录真窗，中文浅色 + 英文暗色，零花费、没点 ↑），在 PR 正文里按文件名列出。

## 请求体矩阵（`electron/parity/officialWire.bodies.snapshot.json`）

重录后只有 8 格变了（每格画布、Run 两路，共 16 路），全是第 4 处：GPT Image 2.5 / 2.6 改图默认比例「自动」，以前发 `size: "auto"`，现在不发。

```
gpt-image-2.5-flare|i2i|n=1     gpt-image-2.5-flare|i2i|n=16
gpt-image-2.5-sunburst|i2i|n=1  gpt-image-2.5-sunburst|i2i|n=16
gpt-image-2.6-flare|i2i|n=1     gpt-image-2.6-flare|i2i|n=16
gpt-image-2.6-sunburst|i2i|n=1  gpt-image-2.6-sunburst|i2i|n=16
```

其余逐字节不变。Veo / 可灵图生的 body 本来就不发比例（以前在目录里丢）；H3 的 webhook 默认是空、以前就被补丁删掉；Seedream 文生默认 1:1；第 5 处只改发送前拦不拦，不改请求体。

## 方式 × 变体默认参数（`electron/parity/modeParamsVariants.snapshot.json`）

只有 Veo 3.1（APIMart）图模式 7 格少了 `aspect_ratio`：画布 fast / quality / lite × reference / frame 共 6 格，加 Run 路 image_to_video 1 格。这些格的 body 不引用比例，发出去的请求不变（上面的矩阵为证）。

## 生成物（`electron/catalog/archetypeWireDefaults.video.generated.ts`）

只少两处 `aspect_ratio`：Veo i2v（`*`）、可灵 3.0 APIMart i2v。生成器在 main 上还会顺带吐出一批 `nsfw_check` 漂移（主线生成物没重跑），这一刀没收进来，原样还给主线。

## 老用户回放（真实旧数据）

`electron/catalog/archetypeWrongTodayOldCatalog.test.ts`：读 `tests/fixtures/old-user-data/curated/v0.24.1-apimart/model-catalog.json`（0.24.1 落盘的目录），走升级 `applyBuiltinSeeds`，再用升级前后的映射真造请求体（不出网）。6/6 绿：

- 夹具前提：老目录 H3 两条映射引用 `{{request.params.webhook}}`，GPT 2.5 改图引用 `{{request.params.size}}`。
- H3 文生 / 图生：老节点存着回调地址，升级前发 `webhook`，升级后不发。
- GPT Image 2.5 Flare 改图：存着 auto，升级前发 `size: "auto"`，升级后不发；存着 16:9 照发。
- 可灵 3.0 / Veo 3.1 Fast 图生：升级前后都不发比例（不回归）。

Seedream 4.5 文生节点存着 auto：真实旧存档里没有这种节点，`archetypeMeta.test.ts` 用 0.24.1 节点形状构造 meta：发送前修成 1:1，存的值不动，改图的 auto 照留。

## 反例

`counterexamples.log`：七次改坏全红，还原全绿。最后一行是 Seedance 三个素材方式一起改回必填；只改 i2v 一个方式时，图会被现算成全能参考 / 首尾帧，所以要三个一起改坏才能复现。
