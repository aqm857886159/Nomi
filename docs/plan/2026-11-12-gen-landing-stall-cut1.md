# 生成结果落地时主进程停住：第一刀（三处删）

实现线写，2026-11-12。方向检查（类根因复盘公开版）：`docs/engineering/direction-checks/2026-11-12-gen-landing-main-stall.md`。用户原话：「在做图片生成的时候 软件特别卡 … 很多用户反馈过这个问题」（11-12）。

这一刀只删三种「每张图都做一遍、而且在主进程上同步做」的活，不碰数据格式、不碰界面和文字、不碰崩溃恢复和保存节奏：

- **A 找项目目录不再每次整读项目文件。** `resolveWorkspaceProjectDir`（按项目编号找目录）每问一次都整读、解析一遍 `.nomi/project.json` 来核对编号；落地一张图要问它十几次。
- **F 付费确认卡的「预计耗时」不再走同步 IPC。** 点生成时渲染层用 `sendSync` 问主进程要历史耗时，主进程正忙着落地时渲染层就跟着冻住。
- **E 落地回执不再整读产物文件重算哈希。** 落地门写盘时已经流式算过 sha256，回执又同步整读一遍 4K 大图再算一次。

## ★0 先查别人

1. Electron 官方性能指南（https://www.electronjs.org/docs/latest/tutorial/performance ）· 主进程无论如何都不要阻塞、不要用同步 IPC（`sendSync` 会把渲染层钉在主进程上），能异步就异步 · F 直接照做：换成 `invoke` / `handle`；A、E 是同一条原则的应用（主进程上不做可省的同步读）。重活挪出主进程（`utilityProcess`，https://www.electronjs.org/docs/latest/api/utility-process ）是第二刀的方向，这一刀不混进来。
2. write-file-atomic（https://github.com/npm/write-file-atomic ）· 写临时文件再改名，读的人要么看到旧文件、要么看到新文件；改名后文件的 inode 变了 · 定了 A 怎么判「记住的答案还算不算数」：比项目文件的 stat 指纹（设备、inode、大小、mtime、ctime，纳秒精度），任何一次原子换文件（包括别的进程、同步盘换进来另一个项目的清单）都会变指纹，变了就重新核对编号。
3. InvokeAI `image_files_disk.py`（https://github.com/invoke-ai/InvokeAI/blob/main/invokeai/app/services/image_files/image_files_disk.py ）· 落图在后端进程里做，不 fsync，存的时候顺手放进一个最近 N 张的内存缓存，之后读不再碰盘 · 定了 A 的写口：本进程 `saveWorkspaceProject` 写完项目文件后立刻把新指纹记上，下一次找目录不必为自己的保存重读；也印证 E：UI 那一侧不该为已经存好的图再算一遍哈希。
4. ComfyUI `server.py`（https://github.com/comfyanonymous/ComfyUI/blob/master/server.py ）· 出图预览走服务端流式返回；它的反例是 PIL 的阻塞活直接跑在事件循环上，图一大整个服务就卡 · 同一类问题的旁证：阻塞活放在事件循环上，并发张数一多就叠加——这一刀先删能删的，挪出去留给第二刀。
- 出口：不涉及：这一刀不新增、不扩大、不挪动任何挡人的保护（拒绝、加锁、等待都不碰）。

## ★1 用户怎么用

当我在画布上连点几张图生成、图陆续出来的时候，我想继续拖画布、点别的卡、打字都不卡，以便边等边干活。

1. 点「生成」：付费确认卡（或直接开跑）照旧出现，卡上的「预计耗时」和今天一样已经在卡上；点下去那一下渲染层不再等主进程。
2. 图落地：主进程上每张图少了「找目录时整读项目文件」（落地段每轮约 350 次 → 0）和「回执整读产物」（每张 1 次 → 0）。
3. 关掉重开、换项目、删项目、挪项目文件夹：找目录的结果和今天一样（见 ★9 第 2、3 条）。

**不做什么：** 不改运行记录记账和锁、不改整份项目保存、不改 fsync（报告里这三项合计占主进程落地窗口一半以上，第二刀）；不加遥测字段；不改界面和文字。

**真实任务与量具：**

| 目标 → 信号 → 指标 | 量具 |
|---|---|
| ① 落地段找目录读项目文件次数 → 0 | 新性能场景 `gen-landing-8-concurrent` 的 `landingDirManifestReads`（主进程仪表 `tests/perf/gen-landing/landingCounters.cjs` 按调用栈数） |
| ② 点生成到落地的同步 IPC 次数 → 0 | 同场景 `landingSyncIpcCalls`（`ipc-message-sync` 逐通道数）；结构门岗 `scripts/renderer-sync-ipc-baseline.json` 去掉这条通道（棘轮，加回同步就红） |
| ③ 回执整读产物次数 → 0 | 同场景 `landingReceiptRereads` |
| ④ 主进程落地段最长停顿中位降 ≥25%（参考，不作硬门） | 同场景 `landingMainStallMaxMs`；另用独立调查的探针（60 图 · 4K · 8 张同时，各 3 轮，记 load）对照 |
| ⑤ 付费确认卡的预计耗时修前修后一字不差 | 单测 `src/workbench/generationCanvas/runner/spendConfirmEtaAsync.test.ts`；真 Electron 用 10.7MB 事件日志对比修前修后通道回的统计（见 ★1c） |
| ⑥ 崩溃恢复、运行记录、项目库现有测试不改照绿 | 现有测试（★9 第 7 条） |

### ★1b 连带界面

付费确认卡（单张、批量）上的「预计耗时」一行：数值和出现时机都不变，不新增文字。其余界面不涉及。

### ★1c 老用户

没有迁移步骤，不改任何落盘格式。

- A 的「记住」只在内存里，重启就没了；第一次找目录照旧整读一次项目文件、照旧在这里做旧格式迁移（`readManifestOrMigrateLegacy`），迁移刚写出的新清单下一次再核对一遍才记住。
- F 是同一条通道换成异步，主进程那头算的东西（`deriveGenerationEtaStats(readEvents(…))`）一字不动。
- E 给内存里的产物对象多带一个可选的 `contentHash`（只在主进程里传给回执；运行记录里本来就记这份哈希，值不变）。没带哈希的产物照旧现读现算。
- 真实规模验证：用独立调查留下的 10.7MB 事件日志（17120 条）比修前修后通道回的统计；性能场景跑完后项目文件大小写在原始结果里（`projectFileBytes`），见 ★7。

## ★2 谁说了算

| 东西 | 正本 / 唯一写入口 | 谁读 |
|---|---|---|
| 「这个编号的项目在哪个目录」 | `electron/workspace/workspaceRepository.ts` 的 `resolveWorkspaceProjectDir`（登记表 + 项目文件里的编号；记住的答案也只在这个模块里，键 = 设置目录 + 项目编号，凭据 = 项目文件 stat 指纹；回的目录永远是登记里现在的那个） | 20 扇门，全是读（`node scripts/door-map.mjs resolveWorkspaceProjectDir`：运行记录仓库 / 运行时 / 服务、事件日志、项目记忆、经验库、资产目录、诊断、反馈、MCP / RPC 服务、项目会话等） |
| 项目文件内容 | 同模块 `saveWorkspaceProject`（暂存后原子换）和旧格式迁移；写完就地刷新记住的凭据 | — |
| 历史耗时统计 | 主进程 `electron/events/eventsIpc.ts` 的 `nomi:events:generation-eta-stats`（现为 `handle`） | 渲染层 `spendConfirm.ts` 的 `withGenerationEtaStats`，只有两个调用方：单张 `generationRunController.ts`、批量 `batchPlanPreview.ts`（git grep `describeGenerationCost(` 只有这两处生产调用；无界面路、Agent 路都走这两处） |
| 落地文件的 sha256 | 资产库写盘（暂存时流式算，`generatedAssetStaging.ts`）→ 落地门 `localizeTaskAsset` 回给调用方 | 回执 `canvasLocalArtifactReceipt`（`node scripts/door-map.mjs canvasLocalArtifactReceipt`：生产 1 扇 `canvasAwareOutputMaterializer`，测试装配 1 扇） |

**数门合计：** 找目录 20 扇读门（不改调用方，改主人自己）；预计耗时 1 扇（`spendConfirm.ts` 的取数）→ 换成 1 个异步取数函数、2 个调用方各包一层 `await`；回执 1 扇生产门。

**删掉的旧东西（同提交）：** 每次找目录必读项目文件的那段；`sendSync` 那条通道和主进程的 `ipcMain.on` + `returnValue`；回执里无条件整读重算。

## ★3 一致与复用

以前定过什么：编号核对（`manifest.id !== projectId` 就当找不到）是 2026-05-31「项目走工作区」初版就有的（`073099bc4`），当时没有具体事故；它防的是 2026-10-29 项目位置复盘（`docs/plan/2026-10-29-project-location-owner.direction-check.md`）里那一类：登记表指向的文件夹里其实是另一个项目（复制出来的文件夹、同步盘换进来的清单），不核对就会把东西写进别的项目。这条防线保留：凭据里有项目文件的 stat 指纹，文件被换（哪怕换成另一个项目的清单）指纹就变，变了照旧整读核对编号，对不上回 null。登记表每次都读（它小，且别的进程——MCP 服务、无界面宿主——会改它），所以「删了 / 挪了 / 重新登记到别处」都在下一次就看得见。

三条路见方向检查：沿原方向（读得更快）治标；换做法（挪出主进程 / 合批）第二刀；删掉——选这条。

## ★4 全状态

| 状态 | 用户看到 |
|---|---|
| 空 | 不变 |
| 加载（点生成到卡出现） | 卡出现时预计耗时已在卡上（不变）；取数期间渲染层不再冻住 |
| 成功 | 不变 |
| 取数失败（通道被拒 / 回 ok:false） | 冷启动估计（和修前同步版失败时逐项相同） |
| 项目被删 / 挪走 / 换了文件夹 | 和修前一样：找不到 → 走原来的「项目不在了」路径；换了文件夹 → 新文件夹 |
| 能力不可用 | 不变 |

## 5 中途表

不涉及：这一刀不改任何长跑、可打断的流程；落地、记账、保存的时序不变。

## 6 外部数据与失败

外部来源：无新增。项目文件可能被别的进程 / 同步盘改写——stat 指纹不同就重新核对；指纹相同而内容不同（同一纳秒、同大小、同 inode 的原地改写）理论上漏判，这只发生在绕过原子写的外部工具上，记进已知限制。

已知行为（只记，不改）：
1. 只换备份文件、主文件没动：修前每次报「身份不可用」，修后记住的答案照回原目录，直到重启或主文件变动。不会落错项目（主文件仍是本项目）。
2. exFAT 等时间戳粗（10ms 级）、没有稳定 inode 的盘上，「原地、同大小、10ms 内把项目文件改写成别的项目」认不出来（独立验收实测 49/50 漏判）。要同时满足：项目放在这类盘上 + 有绕过原子写的外部工具原地改写 + 同大小 + 改写发生在记住答案之后 10ms 内。后果：继续回原目录，落地的图和运行记录写进这个现在声称是另一个项目的文件夹，直到指纹变或重启。同盘原子替换 0/50、截断重写 0/50 漏判；APFS 上改不回 ctime，0 漏判。

## ★7 性能

新增操作：无（这一刀只删活）。最坏规模：60 张图的画布、8 张 4K（约 35MB PNG）同时落地，项目文件 185KB 起。登记新场景 `tests/perf/scenarios/gen-landing-8-concurrent.json`（量具 `tests/perf/gen-landing-bench.mjs`，真 Electron、回环假上游、零花费），主指标 `landingSyncWork` = 三个确定性计数之和，硬预算 0（文件里写 0.5，因为预算必须是正数）；毫秒 `landingMainStallMaxMs` 只作参考。

| | 修前 | 修后 |
|---|---|---|
| 三个计数之和（每轮，3 轮） | 365 / 367 / 362（读项目文件 356 / 358 / 353 + 同步 IPC 1 + 回执整读 8） | 0 / 0 / 0 |
| 主进程落地段最长停顿中位（量具 `gen-landing-bench`，3 轮） | 458ms（load 14.3 / 15.5 / 12.8） | 155ms（load 11.8 / 10.6 / 9.1） |
| 主进程落地段最长停顿中位（独立剖析探针，60 图 · 4K · 8 张同时，3 轮） | 374ms（load 12.3 / 11.2 / 10.1） | 149ms（load 11 / 9.5 / 11.1） |
| 渲染层取预计耗时被挡住（10.7MB 事件日志，5 次） | 125–159ms | 0–0.1ms，取到的数值逐字段相同 |

原始结果：`tests/perf/evidence/2026-11-12-gen-landing-before-fix.json`、`tests/perf/evidence/2026-11-12-gen-landing-after-fix.json`；场景 5 轮只量结果 `tests/perf/evidence/2026-11-12-gen-landing-8-concurrent.json`。毫秒受负载影响，修前修后负载相近（9–16），只作参考；判预算只看三个计数。

缺口：新场景不进 CI（性能场景现在都不进 CI）；遥测没有主进程卡顿字段（另一刀）。

## 8 真实条件

- 免费：单测（真仓库模块、真提交出口与运行记录账本）+ 真 Electron 性能场景（屏幕外窗口、隔离资料、回环假上游）。
- 真付费：不涉及（不改出站请求、不改花钱语义）。
- Windows：未验证（stat 指纹在 NTFS 上的 inode / ctime 语义不同，见 ★9 第 2 条的已知限制）。

## 拍板图

不适用：不新增、不改任何界面元素、布局、文案。

## ★9 验收与回滚

**验收清单（动手前写全，验收线只核这份；每条带反例：改坏 → 红，还原 → 绿）：**

1. 同一编号连续找 N 次目录，项目文件最多读 1 次；本进程保存之后再找，0 次。反例：去掉「凭据对得上直接回」→ 读次数测试红。（`electron/workspace/workspaceProjectDirResolution.test.ts`）
2. 四种失效各一条测试，都拿到新答案或 null、绝不回旧目录：从项目库移除（登记删了）→ null；原生项目删到废纸篓 → null；文件夹挪走（目录不在）→ null；重新登记到别处（本进程打开挪过的文件夹 / 别的进程改写登记表指向另一份拷贝）→ 新目录。反例：凭据不比 stat 指纹 → 「项目文件被换成别的项目」那条红（第 3 条同一个改坏法）。凭据里不再存登记的目录、也不再单独 `existsSync`：命中时回的是登记里现在的目录，改指别处就是回新目录；stat 指纹带设备号和 inode，换了目录 / 目录没了 stat 必变或失败，所以这两处判断多余，2026-11-13 验收两次证明删掉后 735 条测试全绿，已删。
3. 目录还在、项目文件被换成另一个项目的（编号不同）→ null，另一个项目照常找到自己。当初防什么、现在怎么防见 ★3。反例：凭据不比 stat 指纹 → 这条红。
4. 旧格式项目第一次找目录时照旧迁移一次（`.nomi/project.json` 生成），之后不再整读。反例：首次找目录不走迁移（直接读新格式清单）→ 「迁移」断言红。
5. 预计耗时走异步通道：`scripts/renderer-sync-ipc-baseline.json` 里不再有 `nomi:events:generation-eta-stats`（改回 `sendSync` → `check:renderer-sync-ipc` 红）；性能场景同步 IPC 计数 0；卡出现时数字已在卡上（回话没到之前不出卡；改成先出卡 → 断言红；批量卡同一条在 `src/workbench/generationCanvas/components/batchPlanPreview.eta.test.ts`，去掉 `await withGenerationEtaStats` → 红）；通道被拒 / 回 ok:false → 和修前同步版失败一样给冷启动估计。
6. 回执用落地时算好的哈希：一次出 4 张，回执不读产物文件，运行记录里每份的哈希等于那份文件真实的哈希；没带哈希的产物照旧现读现算。重算不是有意的「落地后复验」：回执 2026-10-05 引入（`e46569609`）时注释写的是「只把那份文件记进 Run，不再下载一次」，算哈希只是因为产物对象上只有地址。反例：链上传错哈希 → 哈希断言红；回执不用传来的哈希 → 读次数断言红。（`electron/capabilityCore/canvasLandingReceiptHash.test.ts` 守传递，`canvasLandingRealHash.test.ts` 用真的资产库写盘守「记下的哈希 = 盘上真实哈希」，资产库记录的哈希写错 → 红）
7. 现有崩溃恢复 / 运行记录 / 项目库测试不改照绿（`tests/run-retrieval-recovery/`、`electron/productionRun/`、`electron/workspace/`、`electron/projects/`）。

**回滚：** revert 本 PR 的实现提交；三处互不依赖，可分别 revert。

**独立验收：** 合并前另派验收线（不是本线），报告链接写进 PR `## 独立验收`。
