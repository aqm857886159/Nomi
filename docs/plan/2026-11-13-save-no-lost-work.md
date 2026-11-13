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
2. 存盘 / 读盘逐项：`normalizePayloadWithQuarantine`，坏项隔离、其余照存；只有骨架坏才整份拒绝。原样内容写 `.nomi/quarantine/<时间>-<种类>-<安全名>-<哈希前 12 位>.json`：原子写（临时文件 → 改名）、同哈希只认内容完整的那份、不限条数不限大小。
   - **先隔离、后覆盖**（第 2 轮，验收 C3）：隔离区写成功之前不覆盖 project.json；隔离区写不进（Windows 杀毒占住 EPERM 等）→ 这次保存整次失败，沿用原有的保存失败提示，关窗被拦，内容还在窗口里；打开时被隔离、还没写进隔离区的项留在盘上，下一次保存先补写它。
   - 读后写回的每一处（验收 C1）：列表页改名**不再改写内容**——只换名字 / 时间 / 版本号，载荷原样回写；其余读盘入口（打开、删素材、交付）读到的隔离项先进「欠隔离」账，下一次写盘之前必须先写进隔离区。
3. 原子性不变：主进程整文件原子写；`tests/system/saveKillInFlight.test.mjs` kill -9 证明盘上是旧完整版或新完整版。
4. 一句提醒（第 2 轮重写，验收 C3；显示位置按协调裁定改为现有提示件 toast）：逻辑在 `src/workbench/project/projectQuarantineAnnounce.ts`（非界面），由 `projectPersistenceService` 在自动保存成功后、打开成功后各问一次；显示交给现有 toast：提醒色（warning，不是报错），**不自动消失**（`ttl: false`，要创作者自己关或点按钮——自动保存在后台，错过了就没有第二次），不截断（toast 正文换行、过高时在自己的文字区滚动）。不另造显示组件，`NomiStudioApp.tsx` 与 main 一致。原来的红色保存失败提示位置、样式、文案都不变。「只说一次」：保存时同一份内容盘上已另存过就不再说（跨会话也不说）；打开时项目文件里还带着它的，每次会话第一次打开说一次（只记在内存里）。说清哪份分镜（标题）、第几镜（从 1 数）、哪一项（界面叫法，绝不露字段路径）、其余已存好、项目里是上一版还是没有、原样另存了一份；带一个「打开所在文件夹」的文字按钮（复用已有 `revealFile`，隔离文件不存在或没有桌面桥时不出现）。一批几项只出一条 toast，合成「有 N 处」一句。无新弹窗 / 面板。

## ★4 不做

不改主进程存盘路径（重试 / 睡眠不动）；不加设置项；不给共享 toast 件加参数（用它现有的 `ttl: false`）；不给这条提醒做固定的家（关掉后只能去文件夹找，留给协调和用户定）；浏览器预览没有隔离目录（写隔离区是空操作）。

## ★9 验收清单与反例

- A1 写入口：删掉 setter 守卫、删掉 patch_shots 映射、upsert 放出原始 zod 文本，各自对应测试红。
- A1b（第 2 轮）restore 守卫删掉 / `propose_storyboard_plan` 的拒收映射删掉 / upsert 回 zod 原文 → 各自新测试红。
- A2 store 外直接写 `storyboardDesignsByDocumentId`（属性、简写、计算键、取出来原地改）→ `check:storyboard-owner` 红；拦不住的：先存进本地变量再改（要数据流）。
- A3 一份坏分镜 + 一处画布改动 → 画布改动落盘、revision+1、原样项进隔离区；整份拒存复活 / 不写隔离区 / 日志带内容 → 红。
- A4 保存在飞时 kill -9 → 盘上旧完整版或新完整版；把原子写换成直接覆盖 → 红。
- A5 盘上已有坏项的项目照常打开并提示一次；读侧整份拒绝复活 / 打开时不提示 → 红。
- A6（第 2 轮）改名把坏项抹掉 / 隔离区截到 20 条 / 隔离区改回直接写（kill -9）/ 先写 project.json 后写隔离区 / 隔离区写失败时 project.json 已被覆盖 → 各自测试红。
- A7（第 2 轮）提示句露出字段路径、镜号从 0 数、保存后或打开后不调提示 → 测试红；toast 改成 error / 会自动消失 / 25 项出 25 条 / 没有桌面桥还出按钮 → `projectQuarantineAnnounce.test.ts` 红；退出重开同一个带坏项的项目不再提示、同一会话重复提示 → `projectRepository.itemQuarantine.test.ts` 红。

反例的红绿日志在报告里。
