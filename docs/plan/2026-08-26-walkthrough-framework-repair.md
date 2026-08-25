# 走查取证框架修复：三个「测早了」的根因（2026-08-26）

2026-08-25 一晚上三起事故。表面看是三个不相干的毛病，追到底是**同一个根因**：

> **证据是在被测物安顿下来之前取走的。**

三处都产出了绿灯，而三处都什么也没证明。假绿最坏的地方不是它错，是它**和真绿长得一模一样**——
没人会去复查一个通过的断言。所以这三条都必须修在框架层，让那种写法**写不出来**，
而不是写进文档提醒下一个人小心。

---

## 根因一：`expectAbsent` 第一次取样就判绿

### 病是什么

`tests/ux/_assert.mjs` 原本结尾是一句：

```js
await expect(locator, …).toHaveCount(0, { timeout })
```

Playwright 的 web-first 断言是**重试到条件成立为止**。这里期望值是 `0`，
而现场此刻的 count 恰好也是 `0` —— 于是它**第一次取样就通过**，
那个 15 秒的 timeout **一秒都没用上**。

它证的是「**此刻**没有」，不是「**一直**没有」。
任何 200ms 之后才挂载的东西，都能从这道门底下大摇大摆走过去。

### 为什么原有的 `provenBy` 挡不住

`provenBy` / `proveProbe` 那道门是 2026-08-18 加的，挡的是**瞎探针**——
在一个根本不可能出现坏东西的现场，断言「没看到坏东西」。

它对「取样太早」是**结构性失明**的：探针没问题、现场也对，
只是**测量发生在被测物安顿之前**。

两种假绿在日志里长得完全一样，都是一行绿色的通过。

### 实例（不是猜的，是实测到的）

`src/design/confirmDialog.tsx:70` 的 `ConfirmDialogHost` 是**一张常驻的 Mantine Modal**，
靠 `opened={Boolean(active)}` 开合，**不是每张卡新建一棵树**。

关卡时 `active → null`，`data-confirm-dialog-surface` 这个属性**当场消失**（断言立刻绿），
但此时：

```
div.mantine-Modal-inner    z-index 9300   opacity 1          textContent "取消确认"
div.mantine-Modal-overlay                 opacity 0.354547   （正淡出到一半）
```

弹层还在画退场过渡，而且两个按钮此刻**回落到了默认文案**——正好是「取消 / 确认」，右上角还有个 ×。
于是浅色证据图上透出一层半透明鬼影，压在托管披露正文上。

### 怎么修的

改成**两段式**，为的是别让每个调用点都白等：

| 段 | 做什么 | 失败语义 |
|---|---|---|
| settle | 仍用 Playwright 重试断言等它降到 0 | 东西**真的、持续地**在那儿 → 照常耗到 timeout 报红，快速失败语义**不变** |
| hold | 降到 0 之后，再连续取样 800ms（间隔 50ms，约 16 次） | 窗口内**冒出来一次就报红** |

常态下只多花 800ms，换来的是「异步挂载的东西再也溜不过去」。

`ABSENCE_HOLD_MS = 800` 的来历：足够盖住 React 提交 + 一帧动画 + Mantine 弹层挂载
（实测鬼影出现在关卡后 ~350ms），又不至于让 51 个调用点每个都白等好几秒。

窗口逻辑拆成独立导出的 `holdAbsent`，是为了**能被契约测试直接驱动**：
Playwright 的 `expect(locator)` 只认真的 Locator 对象，喂假对象会当场抛
`toHaveCount can be only used with Locator object`，于是第一段在单测里根本走不通。
硬给假对象套一层 Locator 协议的壳，测的就成了那层壳自己。

同时把 `claude/ux-f3-f16b` 分支上手搓的那份（等 unmount + 轮询窗口）
收进共享 helper —— **P1 加新必删旧，不留并行版**。

### 报错要怎么说

报错信息里明写「**别把窗口调小来让它变绿**——报红的是被测物晚到了，不是这把尺子太严」。
否则下一个人修这条红灯的方式，就是把窗口调成 0。

---

## 根因二：截图拍在动画中途

### 三个变种

- **(a) 主题翻转拍到半翻的屏**
  走查只写了 `data-mantine-color-scheme` 一个属性，
  而生产路径走的是 `applyNomiColorScheme`（`src/theme/colorScheme.ts:54`），它要写**四个**：
  `dataset.theme` / `dataset.nomiColorScheme` / `data-mantine-color-scheme` / `style.colorScheme`。
  少写三个 = 一部分 token 走暗色、一部分还停在浅色，再叠上 ~140ms 的 `--nomi-transition-fast`。
  拍出来的「暗色证据」**根本不是用户会看到的那一屏**（违反 R13 的眼见链：验证物必须 = 用户所见物）。

- **(b) 已关闭的弹窗还在画退场动画**（即根因一那张常驻 Modal）。

- **(c) toast 被拍在滑入动画中途**，让视口边缘切掉一半。

### (c) 最能说明问题

**同一个走查、同一个 commit，一次拍出被裁的图，另一次拍出安定的图。**

也就是说**证据本身是不确定的**。而不确定的证据，人眼对账时会对着假象下结论——
这比没有证据更糟。

### 怎么修的

新增 `waitForVisualQuiescence` / `screenshotSettled`。

判据盯**所见之物**，不盯某个类名（类名会变、会新增，而「还在动」这件事不会）：

1. **会结束的动画数**必须为 0；
2. **全屏浮层的几何与透明度指纹**（位置/尺寸/opacity）连续 3 帧不变。

滑入中的 toast 位置在变，淡出中的遮罩 opacity 在变 —— 两者都进指纹。

为什么不是 `waitForTimeout(500)`：固定 sleep 和「安定」之间**没有因果关系**。
机器快的时候白等，机器忙的时候仍然不够——(c) 那个变种就是这么间歇复现的。
这里等的是**条件**，不是时长。

### 实测踩到并修掉的两个坑

- **无限循环动画永远不会停。** loading 转圈（`.nomi-loading-mark`）、脉冲呼吸灯这些，
  既不能计入「在跑的动画数」，其**子树也不能进几何指纹**（转圈的 transform 每帧都在变）。
  不排除的话，helper 就从「防假绿」变成了「制造假红」——
  实测 `canvas-node-context-menu` 每张截图都卡满 5 秒超时。
  判据要盯「**这次动作引发的过渡**」，不盯「屏上有没有东西在动」。

- **接收者可能是 Locator 不是 Page。** 裁到局部的证据截图是走查里合法且常用的写法，
  但 Locator 没有 `waitForFunction`。改成用 `.page()` 取回所属页面再等安定——
  **安定是整页的属性**，只盯被裁的那一块会漏掉压在它上面的浮层（鬼影正是这么来的）。

### 顺带补的两个 helper

- `applyColorSchemeForShot`：按生产路径翻主题，四个属性一个不少，翻完等安定。
- `readComputedColorChannels`：读计算色并**解析成数值通道**再比。
  别拿字面串比——现代浏览器把颜色序列化成 `oklch(...)` / `oklab(...)`，
  而且过渡中途的插值帧会给出一个既不等于起点也不等于终点的第三种串。

### 迁移范围

**226 处**证据截图，**104 个**走查文件。

**失败路径的 39 处故意不迁**（`catch` 里那些 `*-FAIL.png` / `failure.png`）：
那时候 app 可能已经坏了或卡住了，等安定只会把真正的错误拖成一个 5 秒超时、把现场盖掉。
失败图要的是「**当场是什么样**」，不是「安定后什么样」。

---

## 根因三：门岗能从链里静默消失

### 病是什么

`package.json` 的 `gates` 是一条几十节的 `&&` 长链。
分支冲突十有八九就落在这一行，而解冲突时「取一边」会**静默吞掉一个 check**。

被吞掉的那个门岗**不会报错、不会警告，它只是再也不跑了**。
CI 照样一片绿。

**缺失的门岗和从未存在过的门岗，在 CI 输出里长得一模一样。**
2026-08-25 一晚上差点栽两次。

### 怎么修的

新增 `check:gates-chain`（`scripts/check-gates-chain.mjs`）：
`package.json` 里定义的每个 `check:*`，都必须能从 `gates` **传递可达**。

**为什么必须传递解析、不能只做字面 substring 匹配**：

`check:site` 自己内部就跑了 `build-marketing-sitemap.mjs --check` 和 `pnpm run check:handbook`，
所以 `check:handbook` / `check:sitemap` 事实上**已被覆盖**，只是没有字面出现在 `gates` 那一行上。

一个朴素的字面检查会对着这两个**精确地误报**。而误报的下场是有人把门岗关掉——
那就正好重演了本门岗要防的那件事。所以宁可多写几十行解析，也不留假红。

解析分三层：

1. `pnpm run x` / `pnpm x` / `npm run x` / `yarn x` → 取出脚本名，做 BFS 传递闭包；
2. 「同实现」旁路：链里某条命令跑了目标脚本**同一个实现文件、且带同样的 flag**
   （`--check` 这种 flag 必须匹配：带不带 `--check` 是「生成」和「校验」两回事）；
3. 都不命中 → 报红。

不认得的命令写法宁可**漏认**（漏认 = 报红），也不瞎认：
本门岗的失败方向必须是「多报红」而不是「多报绿」—— **假红看得见，假绿看不见**。

### 豁免名单

只有一条，且带完整理由（`INTENTIONALLY_OUT_OF_CHAIN`）：

| check | 为什么不入链 |
|---|---|
| `check:audit` | **节奏提醒**不是正确性门岗：commit 攒够 25 个就提示该做周期审计（R14）。它按时间/计数报红，和这次改动对不对无关。入链会让「今天该审计了」变成「你不能 push」——**门岗一旦开始拦无辜的人，人就会开始绕过门岗。** |

名单同时带**过期检测**：如果某条已经在链里了却还挂在豁免名单上，一样报红——
否则留着会让下一个人以为「这条本来就不用跑」。

### R17 红/绿证明

新门岗必须先证它会红，否则不算装上。

```
$ node ./scripts/check-gates-chain.mjs        # 完整链
✅ 门岗链完整：23 个 check:* 全部可达（蓄意豁免 1 个：check:audit）
exit=0

# 从 gates 链里抽掉 check:i18n
$ node ./scripts/check-gates-chain.mjs
❌ 有 1 个 check 脚本**不在 gates 链里**，等于定义了但从来不跑：
   · check:i18n  →  node ./scripts/check-i18n-visible-text.mjs

  一个门岗从 gates 链里消失是**没有任何报错**的：它不会失败，它只是不再执行，
  CI 照样一片绿。最常见的来路是解 package.json 冲突时「取了一边」，静默吞掉一节。

  → 把它接回 package.json 的 "gates" 链；
  → 如果确实**蓄意**不入链，去 scripts/check-gates-chain.mjs 的
     INTENTIONALLY_OUT_OF_CHAIN 里登记，并写清楚为什么。
exit=1

# 接回去
exit=0
```

另外反证了传递解析确有必要：
`gates` 链**字面不包含** `check:handbook`，也**字面不包含** `check:sitemap`——
朴素字面检查会对这两个误报。

---

## 验证

- **21 个使用 `expectAbsent` 的走查全部真跑，exit=0。**
  （`check:walkthroughs` 是**静态**检查，从不执行走查——过 gates 证明不了走查跑得通。）
- **6 个仍红的走查已回基线 `6c88035f` 逐个复跑，同样红** → 既存问题，非本次引入：
  `asset-surface-convergence`、`browser-overlay-interaction`、`canvas-batch-production`、
  `canvas-control-clarity`、`canvas-drag-pan-gestures`、`clip-node-editing`。
  另有 `project-location-settings` / `toolbar-order` / `scene3d-camera-follow` 同样基线复现，
  以及 `decompose-ui` / `asset-audio-upload` / `audio-timeline` 缺 `.tmp/` fixture、
  `provider-adapter-doctor` 缺 `NOMI_ADAPTER_UI_USERDATA` —— 都与本次改动无关。
- `tests/ux/_assert.test.mjs` 新增 3 条契约测试钉死保持窗口的行为（含「只在最后一刻闪现也要抓到」）。
- `pnpm run gates` exit=0。

## 留给后面的人

- **别把 `ABSENCE_HOLD_MS` 调小来让红灯变绿。** 报红说明被测物晚到了，那是产品的时序，不是尺子的问题。
- **别把 `QUIESCENCE_TIMEOUT_MS` 调大了事。** 超时信息会告诉你**是谁还在动**；
  无限循环的转圈已经排除了，所以不会是它——多半是有浮层没关干净。
- **失败路径的截图不要迁到 `screenshotSettled`。** 理由见上。
