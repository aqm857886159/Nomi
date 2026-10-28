# 方向检查：浏览器「提取提示词」接上付费令牌，付费卡改按 intent 分流（2026-10-27）

**代批与拍板的分界：**

- **协调代批（10-27）：只因目录口径命中、改法是换。** 代批只覆盖本单里除 `src/workbench/capability/capabilityApplyHandler.ts` 以外的命中。
- **结论：用户 10-27 放行（「五件都按推荐办」，记在 approvals.jsonl）**——热点文件只放行付费卡分流那一处，换成按 intent 查表（决定二推荐项）；入口走 B（决定一推荐项）。实现线 I-browser-extract-grant-r2 照设计卡「第 2 轮定稿」实现，实现提交带本文件的 `Direction-Check:` trailer。
- **`capabilityApplyHandler.ts` 交用户拍板。** 它本身是**文件级**命中，不在代批范围内。
  - 近 14 天它已有 2 个 fix：`121745347`（确认卡措辞）、`2efa07919`（推送前钩子，拆文件体积）。本单会是第 3 个。
  - 协调推荐放行，理由见 §6、§7。
- **另有一个触发：P1「第三个特例分支」。** 通用卡、凭据验证卡之后，提取卡是第三种专用卡。两种做法放在 §6 一起比。
- 设计卡：[`docs/plan/2026-10-27-browser-extract-grant.md`](../../plan/2026-10-27-browser-extract-grant.md)。

## 触发

用 `node scripts/fix-churn.mjs` 对实现要碰的文件逐个跑，基线 `6c05eebae`，2026-10-27。

| 口径 | 命中 | 计数 |
|---|---|---|
| 文件级 | `src/workbench/capability/capabilityApplyHandler.ts` | 已有 2 个 fix，本单第 3 个 |
| 目录级 | `src/workbench/capability/`：handler，加上新文件 `spendCardByIntent.ts`、`promptExtractionSpendCard.ts` | 已有 10 个 fix（4 个文件），本单第 11 个 |
| 目录级 | `src/desktop/`：`bridgeBrowserTypes.ts` 加一个桥方法的类型 | 已有 10 个 fix（3 个文件），本单第 11 个 |
| 目录级 | `electron/shared/contracts/`：新文件 `browserPromptExtraction.ts` | 已有 3 个 fix，本单第 4 个 |

- 有一个怪现象：单独跑这一个文件会报 `electron/shared/contracts/` 命中，和其它文件放在一起跑却不报。实现线要对**实际暂存的文件**重跑一次，以那次的输出为准。
- 下面这些文件没命中：
  - runner；
  - `electron/preload/mediaBridge.ts`；
  - `electron/main.ts`；
  - `electron/browser/core/browserViews.ts`；
  - 新的主进程模块；
  - 登记 JSON；
  - 文本矩阵；
  - 普查测试（`electron/` 根）。

**自写登记**：本方案不碰 `gate-family`，即 `scripts/check-*.mjs` 那一族，状态 under-review，近 30 天 91 个 fix。

- 普查做成 vitest 测试，只 import `scripts/door-map.mjs`，不改它。
- 如果实现线改成扩写 `scripts/check-run-task-grant.mjs`，就会命中 `gate-family`。那时要先回到 §5，补写「为什么现在换不了现成方案」。

**改法是换**，同一提交删旧，不留开关，不留回退：

- 「渲染层直接发任务、不带令牌」换成「主进程唯一链问人、铸令牌、再发」；
- 卡的分流从 `if` 换成查表。

## 0. 一句话根因

1. **令牌路上的付费口只在文字里登记**：概念 notes、文本矩阵的 gap 字符串都是文字。没有一份结构把「谁在令牌路上花钱」和「它的令牌从哪来」配成对，所以一个口能接在闸上、却没人为它铸令牌，一直坏到用户撞上为止（这一例从 09-09 坏到现在）。
2. **付费确认卡的措辞按调用方分支，全写在同一个渲染层 handler 里**：每多一个附属付费口，就多一个分支，多改一次热点文件。

## 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 09-11 拆解每一镜都被闸抛回（`2d907292a` 之后；见 `scripts/check-run-task-grant.mjs` 文件头） | 主进程三处 `runTask` 没带 grantId | 令牌路付费口少接令牌 |
| 本单：浏览器提取每次被拒（09-09 起） | 渲染层 `runWorkbenchTaskByVendor` 走 `nomi:tasks:run` 缺省的 `TOKEN_ADMISSION`，没人为它铸令牌。门岗只认主进程调用里自己写的 `request:`，看不见渲染层这扇门 | 同上 |
| 本单发现：页内「提取」可以被网页伪造 | 触发点长在远端网页的主世界里，console 转发不校验来源 | 把不可信内容当成用户确认（新的一类，0.25 根治） |
| `121745347`（10-18） | 确认卡未知价的措辞不对；英文正文里混了中文 | 卡的措辞分支堆在 handler 里 |
| `2efa07919`（10-18） | 推送前钩子：文件体积超线，做了机械拆分 | 同上（分支越积越多，文件变大） |
| 本单：提取要第三种专用卡 | 再加一个 intent 分支 | 同上 |

## 2. 为什么这一类会一直出现

**令牌这条线：**

- 令牌路本身是一个登记例外：概念 `spend.pending-identity`，到期日以它的 `exception_deadlines` 为准。
- 现有两道检查各管一半，没有一道管配对：
  - 登记管的是**谁能铸**：`mintSpendGrant` 等符号上的 `allowed_consumers`；
  - `check-run-task-grant` 管的是**主进程自己拼的请求有没有写 grantId**；
  - 没有任何东西把「谁在花」和「谁给它铸」配成对。
- 渲染层的一次性门 `nomi:tasks:run` 缺省走 `TOKEN_ADMISSION`。所以渲染层任何一个付费调用方，只要不是 ComfyUI、也不是新手例外，从结构上就是坏的。
- 唯一的信号是文本矩阵里的一句 gap 文字。它只是记录，不会变红。
- 连登记 notes 都把调用方文件写错了：文字漂离了代码，也没有任何东西去比对。

**卡这条线：**

- `confirmSpendFromMainProcess` 按 `intent` 就地决定措辞。
- 凭据验证虽然有了自己的模块，handler 里还是一个 `if`；拆解则是三处内嵌三元。
- 所以每来一个附属口，就要再改一次同一个文件。

**信任这条线：**

- 页内触发点在远端网页里，转发分不清真点击和脚本。
- 整条链上没有任何地方标记「触发来自哪里」。

体验铁律：

| 铁律 | 结论 | 最小证据 |
|---|---|---|
| ⑩ 说的=摆的 | 适用：卡上说读的那张图（来源页 + 图片），必须就是发出去的那张 | 设计卡 ★9 第 1、5 格：卡上的 subject 与请求里参考图的来源一致；来源页取主进程拿到的真实地址 |
| ⑪ 能选到 | 不适用：不增加模型参数，也不增加入口 | — |
| ⑫ 点了=以为的 | 适用：点「提取」只能有两种结果——弹一张写明读哪张图的卡、确认后进库，或者什么都不发。不许静默花钱（伪造的情形），也不许永远失败（现状） | 设计卡 ★9 第 1、3、4 格 |

若协调把这一单记进逃逸账本，结账挂两份测试：普查测试 `electron/spendTokenDoors.census.test.ts`，和真入口集成测试 `electron/browser/prompt/browserPromptExtraction.ipc.integration.test.ts`。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 不加普查：下一个附属付费口（比如 0.25 把提取挪到原生右键菜单，或者再出一个新的「读图」入口）照样能接在令牌路上却不带令牌，测试全绿，直到用户撞上 | 在本单基线上，除了本单的特征测试，`pnpm test` 里没有任何一格因为提取被拒而红——这就是现状的证据。有了普查以后：删掉任一 `mints` 行的铸令牌调用 → 红（设计卡 ★9 第 12 格） |
| 不改分流：下一张专用卡会成为 handler 里第四个 intent 分支，也就是这个文件的第 4 个 fix | `node scripts/fix-churn.mjs src/workbench/capability/capabilityApplyHandler.ts` 看计数；`grep -c "intent ===" src/workbench/capability/capabilityApplyHandler.ts` 看分支数 |
| 照原第 2 条不弹卡：任何网页发一条 console.info，就能花掉用户一次读图调用 | 设计卡 ★9 第 4 格的反例（`askWhenCallsAbove: 1`）→ 上游 1 次，0 张卡 |

## 4. 靶子独立性检查

- **判官独立**：
  - 「令牌到没到」由真闸来判（`electron/spendGrant.ts` 的 `assertAndConsumeQuotedSpend`），不用测试替身。
  - 供应商是本机假上游，只数请求次数，和被测代码无关。
- **人独立**：
  - 普查和集成测试由实现线写；
  - 另一条验收线按设计卡 ★9 逐格核，红灯命令一字不改；
  - 真付费由协调跑。
- **掉分先例**：没有「修对了反而掉分」的先例，这一单不是评测类改动。
- **靶子本身的错**：概念登记 notes ③ 点错了调用方文件，这是靶子本身错了。本单先改正登记。

## 5. P0：这些是我们独有的吗？现成方案有哪些

- **领域部分**：花钱确认是 Nomi 的领域（按调用问人、铸令牌、逐次核销，属于按镜头的花钱语义），自写有据。本单不新写这一层，只调用已有的唯一链 `confirmSpendAndMintGrant`。
- **通用部分全部接现成的**：
  - IPC 发送方校验：用仓库已有的 `assertTrustedSender`，对应 Electron 安全清单第 17 条（https://www.electronjs.org/docs/latest/tutorial/security ）；
  - 数门：用已有的 `scripts/door-map.mjs`（基于 TypeScript 编译器 API）；
  - 对话框：用已有的 `SpendConfirmDialog`。
- **「付费口 ↔ 令牌来源」配对**：没有现成工具做这件事，它是领域专属的。所以做成普查测试里的一张登记表，复用 door-map 数门。
- **`gate-family`**：不碰。若实现线改走扩门岗脚本，就要在这里补写：为什么现在换不了现成方案，哪天换。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

**决定一：入口怎么修**（协调已定 B）

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 走主进程唯一链 `confirmSpendAndMintGrant`（拆解先例 `electron/video/deconstructSpend.ts`），配 `assertTrustedSender`，每次都弹卡 | 新增 1 个 IPC、1 个主进程模块、1 个卡模块；热点文件分流改 1 行 | 低；卡可能被刷屏，但花不了钱 | **是（B）** |
| 补 | 照原第 2 条，用 `askWhenCallsAbove: 1`，不弹卡 | 最小 | 高：网页可以静默花钱 | 否 |
| 重写（限一个模块） | 把提取挪到文本流式门，不进令牌闸 | 小 | 高：流式门不过钱闸，再加上可伪造，就是静默花钱 | 否 |
| 删（备选 D） | 0.24 删掉页内图片「提取」（按钮、转发、监听三样一起删）；工具栏截图提取二选一：照拆解先例一键（手势可信、不弹卡），或一并藏起；0.25 在 Nomi 自己的面上放回 | 小；热点文件不动 | 0.24 少了「悬停图片 → 提取」，只能用截图框选代替 | 热点文件不放行时用 |

**决定二：卡怎么分流**（P1 第三个特例分支）

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 没有现成方案：卡的措辞是领域文案 | — | — | — |
| 补 | handler 里再加一个 `if` | 加 1 行 | 第四个分支，第 4 个 fix | 否 |
| 重写（限一个模块） | 按 intent 查表（新文件 `spendCardByIntent.ts`），handler 里只剩一次查表；凭据验证那一支同一提交搬进表 | handler 换 1 行，加一个表文件 | 低；拆解的三处内嵌三元暂时留在原处 | **是** |
| 删（方案 C） | 套用通用卡 | 0 | 卡上写「AI 助手想生成一个素材」「新节点」，句句不对（`src/workbench/capability/spendCardRouting.test.ts` 第二格钉住了这个现状） | 否 |

## 7. 用户要权衡的核心

0.24 要不要留下「悬停图片 → 提取」这条路：

- **放行 B**：留下这条路。代价是每次提取多点一下确认，热点文件改一行（换成查表）。
- **不放行**：0.24 删掉这条路，只留截图提取。0.25 把「提取」挪到 Nomi 自己的面上，恢复一键提取。

## 特征测试清单（动结构前先锁住）

| 测试 | 钉住的现状 |
|---|---|
| `electron/browser/prompt/browserPromptExtraction.ipc.integration.test.ts` | 修前的提取在主进程付费闸被拒（`spendGrant.ts` ← `taskSpend.ts` ← `runtime.ts`）：供应商 0 次、不进库、不弹卡。期望行为在修前跑出的红灯输出：`docs/evidence/2026-10-27-browser-extract-grant/extract-ipc-before.txt` |
| `src/workbench/capability/spendCardRouting.test.ts` | 两格。第一格：凭据验证走自己的卡（改成查表后不许变）。第二格：不认识的 intent 落进通用卡，「AI 助手想生成一个素材」挂在「新节点」上（提取专用卡落地时翻过来） |
| `src/workbench/capability/deconstructSpendCard.test.ts`（已有） | 拆解卡与通用卡的模型行；搬表时不动，照常绿 |

还没钉住的：

- 页内按钮 → console → 转发这条路：今天没有测试。实现线在设计卡 ★9 第 4、5 格里补，因为要先把转发抽成一个可测的纯函数，或者在假浏览视图上挂监听。
