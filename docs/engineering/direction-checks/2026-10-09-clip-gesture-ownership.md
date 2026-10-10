# 剪辑节点 / 时间轴手势：类根因复盘（方向检查，RW）

> 触发：`node scripts/fix-churn.mjs src/workbench/generationCanvas/nodes/ClipNodeTimeline.tsx` 在本分支第二个 fix 提交时报「近 14 天已有 2 个 fix，这一刀是第 3 个」。
> 如实交代这两个「fix」是什么：一个是 09-28 `fix(react19)`（JSX 类型对齐，不动行为），另一个是**本分支自己的第一个提交**（d8ab1bca8，同一件事的第一步）。开工时这个文件是「未命中热点」；第二个提交是同一未合入改动的收尾，没有别的线补过它。
> 所以这份复盘不是「停下别补」，而是对本分支整件事的类根因说明；同一概念的后续提交共用它。结构性结论仍交协调会话 / 用户拍板（见 §7）。

## 0. 一句话根因

「一次按住指针的手势」在时间轴 / 剪辑节点里没有唯一入口：capture、window 监听、打断收尾、命中宽度、屏幕像素换算、选中准入各写各的，写全的只有一处，所以任何一次系统打断、缩放档变化、新手势入口都可能再出一种「拖不动 / 卡在拖动中」。

## 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 播放头压在片段上拖不动（卡点 1） | 播放头线 `pointer-events-none`，scrub 主动排除片段 | 命中所有权没有层叠表 |
| 未选中节点里按住片段，选中态跟不上（卡点 2） | 选中只在松手 click；拖动会吞掉 click | 手势准入与选中分离 |
| 手柄要先选中、缩放后命中区域对不上（卡点 3） | 只给选中片段渲染；宽 `clamp(12/zoom,16,28)` 设计像素 | 命中宽度不按屏幕像素 |
| 拖动被打断后卡在拖动态（卡点 7，全局时间轴） | `TimelineClip` / `TimelineTextTrack` 只摘 `pointerup` | 手势生命周期各写一份 |
| 节点拖动 / 画布平移 / 片段手势谁接管（卡点 8） | 靠各处 `stopPropagation` | 所有权规则散在组件里 |

## 2. 为什么这一类会一直出现

生命周期是「谁写的手势谁补收尾」，没有入口强制：`ClipNodeTimeline` 有 6 种收尾监听，`TimelineClip` 只有 1 种，`scrub` 又是另一套。新手势抄哪一份是掷硬币。命中宽度同理：每个手柄各自 clamp，没人定「屏幕上至少多宽」。

三条铁律：⑫「点了 = 以为的」——用户按住片段 / 播放头 / 手柄，实际接管的对象与眼前看到的不一致；本类类检查是走查矩阵 `tests/ux/clip-gesture-ownership.walk.mjs`（卡点 × 缩放 50 / 100 / 150%）与结构测试 `src/workbench/timeline/timelineGesture.structure.test.ts`（禁止手写第二份）。⑩ ⑪ 不适用（无参数 / 模型选项）。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 下一个时间轴手势（预览区文字拖动、转场手柄）继续抄旧监听，漏 blur / lostpointercapture | `git grep -n "addEventListener('pointerup'" -- src/workbench` |
| 手柄 / 抓取带在非 100% 缩放下再次小于可点击大小 | `CLIP_GESTURE_ZOOMS=50,100,150 node tests/ux/clip-gesture-ownership.walk.mjs` |

## 4. 靶子独立性检查

走查不是实现线写的判据复述：断言读的是 DOM 状态（`data-dragging`、播放头盒子位置、持久化帧），打断用真实 DOM 事件复现；基线在 main 上先跑红（36 步红 23）再修绿。不存在「修对了反而掉分」的先例。

## 5. P0：这些是我们独有的吗？现成方案

自写登记 id：`timeline-pointer-session`（`docs/engineering/self-written.json`）。评估了 `@use-gesture/react`（已在 lockfile）：它把 pointercancel 当成松手、不处理 blur / lostpointercapture / Esc，与「松手提交、打断回滚」的时间轴撤销语义冲突，见 `docs/plan/2026-10-09-clip-gesture-ownership.md`「先查别人」。打断监听复用画布已有租约 `beginCanvasDragging`，没有自写第二份。哪天换：use-gesture（或 dnd-kit）提供区分 release / cancel 并覆盖 blur、lostpointercapture、Esc 的会话原语时。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入 use-gesture | useDrag 包住三种手势 | 外加一层包装补 blur / lostpointercapture / Esc，不比自写短；多一个直接依赖 | cancel 被当 release，半截拖动被提交 | 否 |
| 补 | 给 `TimelineClip` 等再各补监听 | 5 个文件各补 | 下一个手势继续漏 | 否 |
| 换（本分支） | 一个会话入口 + 复用租约，旧实现同提交删 | 8 处迁移 | 迁移回归（走查 + 单测覆盖） | 是 |
| 删 | — | — | 手势是产品功能，不能删 | 否 |

## 7. 用户要权衡的核心

手柄「悬停即现、不用先选中」换来的是窄片段上手柄占掉身体一部分（未选中 8px、已选中最多 16px、最多占片段 34%）：要不要为了不误触手柄，把窄片段的命中下限（第二片）一起做进来。

## 特征测试清单（动结构前先锁住）

- 画布内片段移动 / 裁剪 / scrub 的既有行为：`tests/ux/clip-node-editing.walk.mjs`（吸附、一次拖动一次撤销、Esc 取消不留变化）；
- 会话生命周期：`src/workbench/timeline/timelineGesture.test.ts`（松手、四种打断、卸载、回滚不留 redo）；
- 命中几何：`src/workbench/generationCanvas/nodes/clipNodeGestureModel.test.ts`。
