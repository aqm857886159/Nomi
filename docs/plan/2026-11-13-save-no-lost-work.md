# 保存不丢作品（D-main-thread-unblock 第二刀 PR1）

设计卡全文：`/Users/aoqimin/Nomi-coord/tmp/D-main-thread-unblock/design-card.md`（协调会话私有仓）；方向检查：`docs/engineering/direction-checks/2026-11-13-save-item-quarantine.md`。

## ★1 要保住的结果

创作者在 Windows 上点生成、改分镜时，一处不合格的东西不能让整个项目存不下来。以前 15 分钟内 40 多次「项目保存失败」，改动全没落盘。

## ★2 三条路

- 沿原方向放宽草稿面：每次放一个字段，第三个特例，不选。
- 换做法（选）：写入口自己挡住，存盘和读盘逐项隔离当兜底，整份拒存路径同提交删。
- 删存盘校验：坏数据进盘，打开时整份不过，更糟，不选。

## ★3 做什么

1. 写入口：`setStoryboardPlan` / `addStoryboardDesign` / `restoreStoryboardDesign` 用 `storyboardDesignSchema` 自己判，不合格就拒绝、store 不变、日志只带字段路径。Agent 各个门返回同一份 schema 的字段路径和允许值（`capability_input_invalid` + `fields`）。
2. 存盘 / 读盘逐项：`normalizePayloadWithQuarantine`，坏项隔离、其余照存；原样内容写 `.nomi/quarantine/`；只有骨架坏才整份拒绝。
3. 原子性不变：主进程整文件原子写；`tests/system/saveKillInFlight.test.mjs` kill -9 证明盘上是旧完整版或新完整版。
4. 唯一一句可见文字：原有保存状态位置，「有一处没存上（<哪份分镜的哪一处>），其余都已保存。」，无新按钮 / 弹窗 / 面板。

## ★4 不做

不改主进程存盘路径；不加设置项；打开时被隔离的项没有界面文案（只准改一句话）。

## ★9 验收清单与反例

- A1 写入口：删掉 setter 守卫、删掉 patch_shots 映射、upsert 放出原始 zod 文本，各自对应测试红。
- A2 store 外直接写 `storyboardDesignsByDocumentId:` → `check:storyboard-owner` 红。
- A3 一份坏分镜 + 一处画布改动 → 画布改动落盘、revision+1、原样项进隔离区；整份拒存复活 / 不写隔离区 / 日志带内容 → 红。
- A4 保存在飞时 kill -9 → 盘上旧完整版或新完整版；把原子写换成直接覆盖 → 红。
- A5 盘上已有坏项的项目照常打开；读侧整份拒绝复活 → 红。

反例的红绿日志在报告里。
