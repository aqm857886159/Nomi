# 盘上状态有第二个读者时，写方不派失效信号 = 「导进来了却用不上」

> 📎 教训 · 首次记录 2026-09-07 · 状态：现行
> **触发场景**：用户说「我加进去了但用不了 / 找不到」；或你要给某份**盘上/进程外**的列表加一个新的读者（面板、弹层、菜单）。

**结论**：同一份进程外状态（磁盘、主进程、IPC）**只要有第二个读者**，写方就必须派一个失效信号，所有读者监听它重读。只让写方自己 `reload()` 是不够的——它刷新的是它自己那份 React state，另一个读者的 state 一动不动，而且**两边同时在屏幕上**，用户一眼就看见矛盾。

**为什么会踩**：2026-09-07 真机探针实拍：在技能库面板导入一个技能，左边卡片立刻出现；同一屏右边 Agent composer 的 `/` 技能菜单里**一个字都没有它**。根因不是谁写错了，是两个读者各自 `listWorkbenchSkills()` 一次就不再管：

- `src/workbench/skillLibrary/useWorkbenchSkills.ts` — 导入成功后 `reload()`（只刷自己）
- `src/workbench/ai/v4/useAgentPanelV4Data.ts` — `useEffect(..., [])` 里读一次，此后永不重读

于是「导进来了却用不上」，用户只能靠重启 App 撞见。五门全绿、单测全绿、既有 `skill-import-formats.walk.mjs` 也全绿——因为**没有任何一条走查跨过「写入面板」与「使用面板」这条缝**：那条走查只验文件落不落得了盘。

同一模式在本仓已经有正解在跑：模型目录用 `nomi-model-catalog-changed`。技能库缺的就是它的对应物。

**怎么用**：
- 加第二个读者时先问：**写方在哪？它派信号了吗？** 没有就先补信号（本仓范式：`src/workbench/skillLibrary/skillLibraryChanged.ts`），不要在新读者里自己想办法轮询。
- 信号派发点放在**写方那一处**（导入/删除/落盘之后），不要让每个读者各自猜什么时候该重读。
- 走查要跨面板：验完「东西进来了」，必须接着验「在**用它的那一面**看得见、用得上」。只验落盘的走查会一直是绿的。
- 群反馈里的「加进去了但用不了」优先当这一类查，别先怀疑格式解析（同族判断见 [`group-says-broken-usually-means-undiscoverable.md`](group-says-broken-usually-means-undiscoverable.md)）。

**出处**：PR `fix/skill-import-real-use-20260907`；回归闸 `tests/ux/skill-import-real-use.walk.mjs`（去掉 `onSkillLibraryChanged` 订阅即当场报红，已实测）。
