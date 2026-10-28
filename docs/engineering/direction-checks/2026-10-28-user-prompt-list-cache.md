# 方向检查：「我的库」提示词列表在渲染层归谁（RW）· 2026-10-28

> 触发：`node scripts/fix-churn.mjs src/workbench/promptLibrary/useUserPrompts.ts src/workbench/api/promptLibraryApi.ts` 命中——
> `useUserPrompts.ts` 近 14 天已有 2 个 fix（这刀第 3 个）；`promptLibraryApi.ts` 已有 3 个（第 4 个）；目录 `src/workbench/promptLibrary/` 已有 3 个（第 4 个）；
> 概念「库条目删除前取完整快照、撤销按同一份快照原样恢复」已有 3 个（第 4 个）。文件本身命中，不属于「协调代批」的例外，必须交用户拍板。未命中自写登记。
>
> **用户 2026-10-28 拍板：「按推荐补」**——即第 6 节的「补：加固半成品」：不上 SWR；不上主进程广播；抽屉每次打开重读一次兜底；
> 用守卫测试防第二个写入者悄悄出现。

## 0. 一句话根因

「我的库」这份列表在渲染层没有唯一的家：缓存住在 React hook 的文件里，写入口住在更下层的 API 文件里，下层写完没法也没义务通知上层；
于是每多一个绕过 hook 的写入口，就多一个「已存入、屏上却没有」的洞。

## 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 本单：浏览器「提取提示词」成功后抽屉里没有新条目（同路径还有「保存选中文字」、画布「选区存为提示词」、素材面迁移三处） | `useUserPrompts.ts` 的模块级 `cached` 只被 hook 自己的 add / update / remove / restore 刷新；直调 `promptLibraryApi.addUserPrompt` 的 4 个发起处不经 hook | 缓存所有权和写入口分居两层 |
| `f1068e169`、`edb12ed63`（10-24，撤销丢字段、恢复借新增通道） | 删除 / 恢复在渲染层按字段自己拼 | 同一份库数据在多层各拼各的（沿用 `docs/engineering/direction-check-prompt-library-undo.md` 的类） |
| `9de82f660`（10-24，门岗三处） | i18n、类型位置、概念登记 | 门岗收尾，非本类 |
| `905924ed6`（10-24，卡面元信息配色） | 目录口径带进来的 | 非本类 |

## 2. 为什么这一类会一直出现

库数据的 owner 在主进程 JSON 存储；渲染层却有 hook 模块缓存、hook 实例 state 两份表示和 8 个发起处（4 个直调 API、4 个经 hook 的），
谁新增发起处谁就得记得刷新那份缓存，结构上没人强制。落在铁律 ⑫「点了=以为的」：点「提取」后标签页写「已存入提示词库」，打开抽屉却没有——
说假话，用户会再提取一次、多花一次钱。写入口全收口在 `promptLibraryApi.ts` 的 4 个函数（全仓没有第二处调桥的写方法；主进程只有 `promptLibraryIpc.ts` 引用
存储的写函数；四个写通道都用 `assertTrustedSender`，只认工作台主窗口，运行期只有一个渲染层上下文在写），所以修共用层不增加改动面，入口再多也是同一处。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 下一个新增的、不经 hook 的「存为提示词」入口，抽屉照样不刷新 | 挂 hook → 直调 `addUserPrompt` → 看 hook 列表。HEAD 上实测红：抽屉开着时列表不变，关掉再开仍不变（同一台测试台上「经 hook 自己的 add」的对照是绿的，说明测试台没问题） |
| 抽屉开着时发生的任何直调写入，屏上都不变 | 同上，hook 先挂载 |
| 以后出现主进程写入者（比如 Agent 工具存提示词），已挂载列表不变 | 守卫测试：存储的写函数只许 `promptLibraryIpc.ts` 引用；出现第二个引用方就红，逼着去加广播 |

## 4. 靶子独立性检查

尺子不是本线写的：`composerMountBudget.test.tsx`（10-16 起，管点卡挂载 0 次读盘）是别人写的预算门；真窗口走查由另一条分支的演练脚本给。没有「修对反而掉分」的先例。
已出现过一次「尺子对、补丁错」：先前的半成品把 hook 的 `load(false)` 改成 `load(true)`，让点卡挂生成框每次都读盘，`composerMountBudget` 因此变红——预算是对的，补丁错了。

## 5. P0：这些是我们独有的吗？现成方案有哪些

「一份列表 + 写后发布 + 订阅」是通用能力，不是我们独有的。现成方案三个，都在仓库里：React `useSyncExternalStore`（同形先例：`src/utils/canvasGesturePreference.ts`、
`src/config/modelCatalogCache.ts`、`src/workbench/common/useVendorPreference.ts` 等）、SWR（`src/workbench/library/localProjectStore.ts` 同形）、主进程广播（技能库先例：
`electron/skills/skillLibraryBroadcast.ts` + `src/workbench/skillLibrary/skillLibraryChanged.ts`）。本单不新增自写登记：用 React 原语 + 一个模块级变量，不是自写框架。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐 + 拍板

| 选项 | 做什么 | 代价 | 风险 | 推荐 / 拍板 |
|---|---|---|---|---|
| 接入：SWR | 列表交给 `useSWR(KEY)`，API 层写后 `mutate(KEY, items, { revalidate: false })`；删 hook 私有缓存与 state | 重写 hook；要把 SWR 默认的聚焦重读、断网重连重读、过期重读、出错重试、2 秒去重逐项关掉，才保得住「点卡挂生成框 0 次读盘」；测试要重置全局缓存 | SWR 默认方向是「多读」，与 0 次读盘的预算相反，漏关一项就是又一次预算红；没做原型，行为未验证 | 备选，未选 |
| **补：加固半成品** | 一个共享缓存模块（唯一持有者）+ API 层读写口经同一个出口校验并发布 + hook 用 `useSyncExternalStore` 读，删私有 `cached` / `state.items` / `apply`；`load(false)` 语义不变（缓存有就不读）；抽屉打开时重读一次（自愈，只此一处）；发布带发起序号，晚到的旧应答丢掉；守卫测试 | 5–6 个文件（缓存、API、hook、抽屉一行、测试、守卫，外加合同与登记） | 低：行为面小，生成框路径不变。残余：将来出现主进程写入者时要加广播（守卫会红着提醒）；抽屉开着期间主进程写入要到下次打开才看见 | **推荐，用户 10-28 拍板选这个** |
| 重写（限一个模块）：主进程广播 | 写盘层 `persist()` 后广播 `nomi:prompt-library:user-changed`；preload 加订阅；渲染层收到就重读 | 约 6–8 个文件：写盘层、preload、bridge 类型、接线点、主进程测试替身、IPC 相关门岗 | 今天没有主进程写入者可兜；与 API 写口发布并存就是两个来源，要防重复 / 乱序 | 等第一个主进程写入者出现再做 |
| 删 | 不适用（没有可删的功能） | | | — |

## 7. 用户要权衡的核心

这份列表是继续让每个入口自己记得刷新，还是收口到 API 写口自动发布；以及要不要为「将来可能出现的主进程写入者」现在就付广播的钱。
**拍板：收口到 API 写口自动发布；不现在付广播的钱，用守卫测试让第二个写入者不能悄悄出现。**

## 特征测试清单（动结构前先锁住）

- 已有：`src/workbench/generationCanvas/nodes/composerMountBudget.test.tsx`（点卡挂载 0 次读盘，必须保持绿）；`src/workbench/api/promptLibraryApi.test.ts`（映射、删除快照 → 恢复）；
  `electron/promptLibrary/userPromptStore.test.ts`、`electron/promptLibrary/promptLibraryIpc.test.ts`（主进程）。
- 没钉住：`useUserPrompts` 在 HEAD 上没有任何单测。动结构前先在 HEAD 上写了「hook 已挂载 + 直调写口」的特征测试，跑出现状红格（3 条里 2 红 1 绿，绿的是经 hook 自己 add 的对照），再改结构；
  同一份测试台随实现提交进 `src/workbench/promptLibrary/useUserPrompts.behavior.test.tsx`，在新结构上是绿的。
