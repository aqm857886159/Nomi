# 方向检查：拆解的「取消」只活在渲染层（RW）· 2026-10-27

> 触发：`node scripts/fix-churn.mjs` 命中，而且**要改的文件本身就是热点**——`electron/video/deconstructVideo.ts` 14 天第 4 个 fix、`electron/video/extractVideoFrame.ts` 第 5 个、`electron/runtime.ts` 第 18 个、`electron/audioTaskRunner.ts` 第 3 个、`electron/catalog/customCallDispatch.ts` 第 4 个；目录 `electron/video/` 第 8 个、`src/desktop/` 第 11 个（`bridgeMedia.ts` 只加一个类型）；概念「参考素材在任务的哪一步交给供应商」第 18 个、「转写结果的带时间戳句段形状」第 3 个。
> 来源：0.24 发版前的花钱审计（拆解点了取消，主进程照样调供应商）。设计卡：`docs/plan/2026-10-27-deconstruct-cancel.md`。按派工书停点：设计卡提交后停下，结构性结论交用户拍板。

## 0. 一句话根因

「取消」只是渲染层的一个标记：主进程那次 `nomi:video:deconstruct` 没有能按请求找到的停止边界，编排（`deconstructVideo`）、付费出口（`runTask`）和三处 ffmpeg 子进程都拿不到 signal，所以点了取消之后，抽帧、取音轨、转写、逐镜读图照样跑完、照样花钱。

## 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| c2c170fbb 点名的转写模型不可用时整次拒绝 | 转写腿点名解不出时静默丢腿 | 付费腿的身份与解析 |
| 71e463037 转写腿按模式解析 | 按 kind 找模型，挑到配音 / 音乐行 | 同上 |
| b733d254a 拆出来的文字字段用界面语言写 | 提示词没说输出语言 | 生成内容的语言 |
| 42736b307 / 24db444b3 / 040aff21b（extractVideoFrame.ts 所在提交） | 生成产物落盘的校验与原子写 | 资产写入边界 |
| runtime.ts 近 14 天 17 个 fix | 参考素材只在提交步交、结果读法、线上模型名…… | runtime.ts 是引擎 A 的巨壳，多个概念住一个文件 |
| audioTaskRunner.ts / customCallDispatch.ts 近期 fix | 转写句段形状、线上模型名 | 各自的概念 |
| **本次：点了取消，主进程照样发满** | 取消只做渲染层标记；IPC 没有取消口；编排与 `runTask` 不收 signal | **执行的「停止」在主进程没有 owner** |

本次和前面那些不是同一类：`git log -S AbortSignal -- electron/video/deconstructVideo.ts electron/video/videoIpc.ts` 为空——拆解这条链从来没有接过 signal。热度来自拆解在 10-18 换成节点后的密集迭代，以及 runtime.ts 的「住得挤」，不是同一个 bug 反复冒。

## 2. 为什么这一类会一直出现

- **表示层**：`ipcRenderer.invoke(channel, ...args)` 只有通道和结构化克隆的参数，没有任何取消机制（Electron 官方文档），AbortSignal 也过不了结构化克隆——取消必须是第二条按请求寻址的通道。拆解又不是任务表里的一行（没有 taskId），任务中心那套停止够不着它。
- **所有权层**：「这次拆解还在不在跑」只由渲染层 `deconstructionLifecycle.ts` 拥有。09-22 的卡（`docs/plan/2026-09-22-deconstruction-node-terminal-state.md` §4）写明「IPC 的 invoke 没有取消口，所以取消 = 把这次调用的结果作废」；10-11 的中途表（`docs/plan/2026-10-11-canvas-ux-8-issues.md`）写「关窗 / 切项目：已发出的请求照常结算（用户已确认），结果作废不写表」。当时把「确认覆盖整批」当成可接受的花费；0.24 审计把它判成花钱错——用户点取消的意思就是「后面的别花了」。
- **方向层**：`runTask` 的 19 扇门里没有一扇带 signal（只有文本流式 IPC 绕开 `runTask` 自己接了）；主进程里「长任务 + 付费」的入口默认「发出去就等到底」。下一个照拆解形状写的入口，会冒同一类。
- **铁律**：⑫「点了 = 以为的」——用户点「取消」以为不再花钱，实际照样发满报价的行数（特征测试实测）。`tests/ux/full-walk/catalog.mjs` 里没有这颗按钮的 `userExpectation` / `actualObservation`，已按模板登记逃逸账本 candidate：`tests/ux/full-walk/escapeLedger/AUD-20261027-deconstruct-cancel.json`。⑩ ⑪ 不适用（不涉及意图参数和可选项）。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 任何时机点取消，主进程都把报价的行数发满（含没起跑的镜和转写），整次还以「成功」收尾 | `electron/video/deconstructCancellation.test.ts`（现状特征：四个取消时机都是 7/7） |
| 只在渲染层补（禁新起、丢结果）止不了血：没起跑的镜由主进程起跑，渲染层管不到 | 同上：取消信号进不了编排，`runTask` 只收到 1 个参数 |
| 单镜重试切项目 / 关窗后照样把那 1 次读图发出去；它连 requestId 都不带，主进程即使有取消口也认不出它 | `src/workbench/generationCanvas/nodes/shotTable/deconstructionTerminalState.test.ts`「单镜重试不带 requestId」 |
| 以后谁复用 `video.deconstruct`（比如 Agent 发起拆解）同样停不下来 | `node scripts/door-map.mjs deconstructVideo`：只有 videoIpc 一扇门，编排的 options 里没有必填的 signal 拦新调用方 |

## 4. 靶子独立性检查

- 尺子：本线的特征测试 + 另一条线的调研（结论一致：取消只在渲染层，主进程照跑）。修复后由另一条验收线对着设计卡 ★9 核。
- 没有「修对了反而掉分」的先例；这一刀不碰任何评测。
- 特征测试的在途清单由确定性挂起点拍出，不靠墙钟；连跑 5 次结果一致。

## 5. P0：这些是我们独有的吗？现成方案有哪些

取消是通用能力，全用现成的：平台标准 `AbortController` / `AbortSignal`；ffmpeg 子进程用 Node `child_process.spawn` 自带的 `signal` 选项（官方文档：abort 等同 kill，`error` 事件收到 `AbortError`，默认 `SIGTERM`）；`runTask` 下游的取消口早就都在（文本 `executeTextTask.abortSignal`、映射 `executeProfileOperation.signal`、自定义脚本 `runCustomCallScript.signal`、转写 `requestMultipart` 第 7 参 / 本机 `runLocalSpeechTranscription.signal`、探测 `probeMediaMetadata.signal`、下载 `hardenedFetch.signal`），只是没人接上。我们独有的只有「拆解这一批付费调用在哪几处要停」——那是领域编排（按镜头的花钱语义）。不新增依赖，不自写取消框架，不涉及自写登记。

仓库里同形状的先例（不是三方库，是同一个模式的又一个实例）：`electron/assets/previewRequests.ts` 的请求登记、`electron/video/trimVideo.ts` 的 ffmpeg 取消、`electron/ai/antigravityIpc.ts` 的取消归属校验、`electron/video/depthVideoIpc.ts` 的取消口 + 退出收摊。拆解直接复用 `previewRequests.ts` 那一份登记，不写第二份（待拍板第 5 题）；trimVideo、antigravity、depthVideo 各自的取消口要不要也收进来，是另一刀，本刀不做。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案（= 派工书方案） | 一条边界：videoIpc 按 requestId 登记 AbortController + 同源取消 IPC（校验发送方、项目、请求）；窗口销毁、项目上下文中止走同一个口；`deconstructVideo` 的 signal 必填，传给探测 / 切点 / 取音轨 / 抽帧 / 两处 `runTask`；signal 随 `runTask` 本来就有的第二个参数 admission 走（可选），付费闸外层先判 signal，再接到下游已有的取消口，其余门不传、行为不变；取消有专用错误 | M 偏大：约 15 个生产文件（含复用请求登记要挪的 2 个，另加 `runtime.ts` 迁出抵扣的落点）、4–5 个测试文件；5 个热点文件各接几行，不新增分支；`runtime.ts` 已在冻结上限（格式化后 665 行），必须净零 | 中：`runtime.ts` 与目录线合并（只在 `runCustomCallTask` 那一行行尾加参，避开 311–324 行）；在途 HTTP 只能断开、撤不回，日志记「已发 / 未知」 | ✅ |
| 接入，分两刀 | 第一刀同上，但 `runtime.ts` 一行不动：付费闸外层判 signal（admission 本来就是 `runTask` 的第二个参数）+ 编排里判 + ffmpeg 收信号；在途请求不断开，留到 `runtime.ts` 拆分那一刀 | M−：约 12 个生产文件，`runtime.ts` 零改动 | 取消后在途那几次照常跑完（钱上与断开几乎一样，已到达供应商的撤不回）；本机转写还会再跑几分钟 | 备选（第 6 题 (b)） |
| 补（只在渲染层） | 取消时禁新起，主进程跑完再丢 | 小 | 止不了血：没起跑的镜由主进程起，渲染层管不到 | ❌ |
| 补（只撤令牌） | 取消时在主进程作废这一批的令牌，后面的 `runTask` 被付费闸拒 | 小 | 本地重活（ffmpeg、本机转写）照跑；在途请求不断开；被拒后编排当成「授权失效」报一条假失败；等于第二套取消 | ❌（不替代 signal） |
| 重写（限一个模块） | 把拆解迁进制作 Run（停止原因、收据、可续都有） | L：Run 收据形状、画布投影都要动 | 0.24 来不及；令牌路例外本就 11-15 到期要迁 | 以后另立项 |
| 删 | 删掉「取消拆解」 | — | 用户失去控制 | ❌ |

**推荐**：接入现成方案。理由：取消能力全是现成的，缺的只是接线；热点文件里只加「把同一个 signal 往下传」这一种改动，不新增特例分支。

### 待拍板（每题带默认答案）

1. 在 5 个热点文件里接 signal，还是先把拆解迁进 Run？——默认：接 signal（迁 Run 另立项，赶在令牌路例外到期前）。
2. 取消那一刻在途的那几次（并发 4，最多 4 次读图 + 1 次转写）：立即断开、日志记「已发 / 未知」，还是等它们回来再丢？——默认：立即断开（等回来只多花时间，钱不会因此退）。
3. 单镜重试没有取消按钮：只在关窗 / 切项目时停（不改界面），还是给重试加取消按钮（改界面、走设计流程）？——默认：不加按钮。
4. 令牌撤销要不要作纵深？——默认不做：signal 在付费闸前后都拦；令牌 30 分钟自然失效，令牌号不出编排闭包。
5. 请求登记：复用补预览那一份（`electron/assets/previewRequests.ts`：按「发送方:requestId」登记、窗口销毁即撤、finally 清理），挪成中立模块两处共用；还是拆解在 videoIpc 里自己写一份同形状的（第二份定义）？——默认：复用、挪成中立模块（P1 不留第二份）。代价：多碰 `previewRequests.ts` 和 `assetsIpc.ts` 的一个 import（后者也是热点，14 天第 3 个 fix）。
6. `runtime.ts` 正好在冻结上限（格式化后 665 行，门岗只许变短）。把 signal 交给 4 种 runner，最省的写法 +3 行、逐个显式加参 +14 行（内存里模拟过格式化）。(a) 同提交从 `runtime.ts` 真迁出等量代码，迁哪段实现时挑，迁出本身会再碰它所属的概念；(b) 先只做「付费闸外层判 signal + 编排里判 + ffmpeg 收信号」，`runTask` 一行不动（它的第二个参数 admission 本来就在），在途请求不断开，断开留到 `runtime.ts` 拆分那一刀。——默认：(a)。理由：协调已定「在途的 runTask 收到同一个 signal」；选 (b) 的话本机转写在取消后还会再跑几分钟。钱上两者几乎一样：已到达供应商的请求哪种都撤不回，真正省钱的是「没发出去的不再发」，这一半 (b) 也做得到。
7. 缺 requestId 的拆解请求，主进程直接拒？——默认：拒。渲染层和主进程同一个包发版，不存在旧渲染层；不拒，就留着一条停不下来的路。

## 7. 用户要权衡的核心

点「取消」要不要真的停止花钱。要，就得在 5 个反复被修的文件里各接几行同一个 signal（不新增分支、不改界面），其中 `runtime.ts` 已顶到冻结上限，同一刀里还得迁出几行；不接，0.24 里点了取消，这一批付费调用照样发完。要拿主意的是第 6 题：在途那几次要不要一起断开。断开得动 `runtime.ts`，换来本机转写立刻停；钱上差别很小，因为已经到达供应商的请求撤不回。

## 特征测试清单（动结构前先锁住）

已钉住（本线 2026-10-27 提交，全绿 = 现状；修复时整段翻转）：

- `electron/video/deconstructCancellation.test.ts`：四个取消时机的在途清单与「取消后照样发满 7/7」；一开始就 abort 的 signal 也被无视（所有子步骤收到的参数里都没有 AbortSignal，`runTask` 只收 1 个参数）。
- `electron/video/videoIpcSession.test.ts`：主进程只有开始口、没有取消口；handler 交给编排的 options 只有 `authorizeSpend` / `onPhase`。
- `src/workbench/generationCanvas/nodes/shotTable/deconstructionTerminalState.test.ts`：点取消、项目被换走都不碰主进程桥；单镜重试不带 requestId。

## 8. 拍板结果（2026-10-27，用户「五件都按推荐办」）

- **分两刀**（第 2、6 题合起来定）。第一刀（0.24）：点取消之后不再发任何新的付费调用——付费闸外层判 signal（已取消不进闸、不扣钱）、编排里每一步发之前判 signal、ffmpeg 收到信号就停；`electron/runtime.ts` 一行不动。**取消时已经发出去的那一次请求照常结算**，PR 正文和根因合同的残余风险都写明。第二刀（0.25）：在途那一次立即断开，连同 `runtime.ts` 的迁出抵扣。
- 第 1 题：接 signal，不迁 Run（迁 Run 另立项）。
- 第 3 题：单镜重试不加取消按钮。
- 第 4 题：不撤令牌。
- 第 5 题：请求登记复用补预览那一份——挪成中立模块 `electron/ipcRequestRegistry.ts`，旧文件 `electron/assets/previewRequests.ts` 同提交删，所有调用方改过去。
- 第 7 题：主进程直接拒缺 requestId 的拆解请求。
- 协调补充：吞掉取消的三处（`LocalSpeechError` 归类、读图那段的 `catch`、`transcribeShots` 的 `.catch`）一起修，取消照原样传出去、不记成失败；主进程按项目绑定，`projectBinding` 失效（切项目、关窗）等同取消；导入转码那份请求登记（`electron/assets/importRequests.ts`）还没进 origin/main，本刀只收补预览与拆解两家，协调另派收口。
- 热点放行：实现提交带 `Direction-Check: docs/engineering/direction-checks/2026-10-27-deconstruct-cancel.md`。设计卡按第一刀改写：`docs/plan/2026-10-27-deconstruct-cancel.md`（第二刀写在「不做」）。
