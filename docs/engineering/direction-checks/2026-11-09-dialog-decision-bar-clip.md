# 方向检查：弹窗的决定栏在小窗口里被裁（2026-11-09）

命中（`node scripts/fix-churn.mjs`）：`src/ui/community/FeedbackReportCard.tsx` 文件第 4 个 fix、`FeedbackShareHost.tsx` 第 3 个、`src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx` 第 3 个；目录 `src/ui/community/`、`src/workbench/generationCanvas/spend/`、`src/design/`、`src/ui/onboarding/` 按概念目录命中。没有自写登记条目命中。

谁写的：本文由实现线 I-min-window-dialog-clip 写，**不是独立线**。独立的那一份是另一条线 11-01 写的 `docs/engineering/direction-checks/2026-11-01-feedback-manifest-copy.md`，它的 §6 已经把「发送固定在底部、清单单独滚动」定为下一次清单变长时的做法；这一刀就是那个触发点。结构性结论（规则 A）由用户 11-09 拍板、认过措辞，写进 `docs/design/nomi-design-system.md` §3.5。要不要另派独立线再写一份，由协调定。

来源：夜跑分诊 #076（Linux 夜跑 `feedback-delivery.walk.mjs` ② 11-02 起连红）。

## 0. 一句话根因

弹窗的可用高度和滚动归属没有主人：Mantine Modal 默认整块内容一起滚、只有标题粘顶，按钮写在内容里就会被滚出去，于是每个弹窗各写一个高度数字去压内容，字一长、窗口一矮就又被裁。

## 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| `8b7edf76e` 反馈卡清单全是中文 | 条目没译文 | 不同类（文案） |
| `ee8152ad0` 英文清单那一行收短 | 英文多一行，「发送」只剩上半截 | 滚动归属没有主人 |
| `66d2b5284` 清单变长把发送挤出窗口 | 清单加 `max-h-[calc(100vh-24rem)]` | 滚动归属没有主人（魔数第 1 份） |
| 夜跑 #076（本次） | Linux 英文字体更宽，24rem 不够，「发送」被裁 | 滚动归属没有主人 |
| 本次修前取证：花钱确认整批内容最多那档 | 「忽略 / 生成 14 项」被滚出 648px 上限 | 同一类，另一个弹窗 |
| `fad4bc724` `ff4749326` `92ba23d70`（花钱目录） | 首帧挂载、重发确认文案、恢复事实 | 不同类（不碰高度和滚动） |
| `01302c918` `3ea46adf0`（反馈目录） | 队列保留、回执折行 | 不同类 |

## 2. 为什么这一类会一直出现

外壳（`DesignModal`）只转交 Mantine，不管「谁滚」；弹窗作者只能在内容里各写上限：反馈卡 `100vh-24rem`、`SkillDetail` `100vh-96px`、模型设置详情 `100svh-16px / 48px`、设置弹窗 `100svh-48px`、花钱确认 `88vh`，共 5 份。每份都是按某种字体、某个语言、某个窗口量出来的，任何一个变了就会再裁。门岗只在 1440×1000 普查弹层几何，没有最小窗口那一档。

三条体验铁律：⑫ 点了=以为的——按钮看不全，用户不知道它在那儿、以为卡坏了。⑩ ⑪ 不适用（不碰模型参数）。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 反馈清单再多收一项，中文最小窗口也裁「发送」 | `feedback-delivery.walk.mjs` ② 在中文轨变红 |
| 花钱确认整批（参考卡 + 十几镜）在最小窗口里「生成 N 项」被滚出去 | 修前取证 `docs/evidence/2026-11-09-min-window-dialog-clip/before/spend-confirm-max-*.png` 已经是这样 |
| 新写的弹窗把按钮写进内容里，同样被裁 | 阶段②普查最小窗口档 |

## 4. 靶子独立性检查

走查断言量的是真实窗口里按钮和滚动容器的几何，不读文案、不依赖本线写的数字；本线没改判据，只把「发送」的定位从卡内改成按窗口找（它搬进了弹窗的决定栏）。外壳结构测试 `src/design/overlays.structure.test.tsx` 是本线新写的，三个改坏反例逐条红过（`docs/evidence/2026-11-09-min-window-dialog-clip/counterexample/unit/`）。没有「修对了反而掉分」的先例。

## 5. P0：这是我们独有的吗

不是。头尾固定、中间滚是通用弹窗布局：Atlassian Modal dialog（body 滚、header / footer 固定）、Fluent 2 `DialogBody`（`maxHeight: calc(100dvh - 48px)`，动作在内容之下）、Material `mdc-dialog--scrollable`。不换库：沿用 Mantine 8.3.18 Modal 算好的上限（`calc(100dvh - 2 × 5dvh)`），外壳只把滚动挪到中间那块、加一个决定栏插槽。出处见设计卡 `docs/plan/2026-11-09-min-window-dialog-clip.md` ★0。

## 6. 三条路对比 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 沿原方向修 | 把 24rem 调大、英文再收短 | 一行 | 下一种字体 / 语言 / 弹窗又裁；同一处第 4 刀 | 不选 |
| 换一种做法 | 外壳 `DesignModal` 接管：标题栏、决定栏（`actions` 插槽）不滚，中间滚；需要清单单独缩的弹窗传 `innerScroll`；删掉各弹窗的高度魔数。阶段①迁 3 个代表弹窗，阶段②迁其余并给普查加最小窗口档 | 外壳一处 + 每个弹窗迁一次；花钱确认卡迁入后要付费走查和独立验收 | 外壳改动波及全部 13 个 `DesignModal` 调用点；内容不超高的弹窗外观不变由 `confirm-dialog` 修前 / 修后图和实验室走查守 | **选**（用户 11-09 拍板规则 A） |
| 删掉 | 清单不写这么细 | 清单是同意书，少写就是少说实情 | 高 | 不选 |

## 7. 用户要权衡的核心

一次把「谁滚」收进外壳、所有弹窗跟着迁，换来以后任何窗口、任何语言决定栏都看得全；代价是弹窗外观有几处统一（反馈卡多一个「取消」、花钱确认卡换成标准外壳），要看图认。

## 特征测试清单

- `src/design/overlays.structure.test.tsx`：决定栏在滚动区之外、三段成列、默认不成列 / `innerScroll` 才成列。
- `tests/ux/feedback-delivery.walk.mjs` ②：最小窗口中英两轨「发送」不被裁、留言框点得到。
- `tests/ux/spend-confirm-a11y.walk.mjs` + `SpendConfirmDialog.test.tsx` / `SpendConfirmHost.test.tsx`：花钱确认的焦点、回车、Esc、层级 9100 不变。
- 阶段②：弹层几何普查加最小窗口档（读主进程导出的最小窗口值）。
