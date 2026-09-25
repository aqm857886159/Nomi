# pi lane 每回合可用模型清单恢复

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实现并通过完整 gates；#646 当前任务分支，等待主会话 packaged C0 晋级。

C0 八镜 modelKey 全空且无 resolution：旧客户端删除时，用户消息里的动态模型清单未迁入 lane。归类 recurring；所有面板宿主、供应商与后续接入均受影响。

## 先查别人与层级选择

- 依赖已有：`node_modules/@earendil-works/pi-agent-core/README.md:57` 的 Message Flow 明确区分 context transform 与 provider message conversion；沿用现有转换，不重造 runner。
- 仓库已有：`electron/agentLane/laneHost.mts:201` 已把 nomi.input 交给 providerContent；`src/workbench/generationCanvas/agent/availableModels.ts:91` 已 join archetype，已有参数与参考槽。
- 官方 SDK：https://pi.dev/docs/latest/sdk （2026-09-09 实查）：session.prompt 每次提交用户输入，系统资料由 resource loader 管理；复用现有用户消息转换，无需新增 SDK 层。

| 方案 | 单一真相源 | 每回合动态 | 与老路径等价性 |
|---|---|---|---|
| A：composer 带结构化模型条目，共享 formatter | 现有 catalog → archetype 投影，formatter 两端同源 | 每次 send 重取，接入事件清缓存 | 等价：清单贴在用户请求旁；选用 |
| B：主进程读 models 再 join 档案 | 需再连接现有渲染层投影 | 可以 | 没必要增加读取/拼接路径，A 已有参数和参考槽 |
| system/resource loader 注入 | 会改变现有上下文归属 | 需额外刷新机制 | 不等价于技能要求的用户消息清单，不选 |

选 A：每回合携带当前目录；空清单省略，按 kind/modelKey/vendor 排序，只把标题旧工具名改为分镜/节点通用说法。

## 范围与验收

共享层持有模型条目类型和唯一 formatter；面板 send 采集，主进程 parser 校验与 providerContent 注入；拆解表单改 import。真实目录投影→真实桌面输入→native lane→HTTP 用户消息先红后绿，另测空清单、后续回合更新和无效输入。loopback 夹具复用目录投影，不再手写清单。真实小样 nano×2/deepseek-v4-pro×1 只到阶段02，合计不超过 ¥2；记录首调与 8/8 档位数字。最后完整 gates、正常 hook 提交和推送既有分支。

不动：工具 schema 形状/描述、SKILL.md、审批、pi 内核接线、完整 C0 断言/预算、真实资料库、打包和 PR 状态。回滚：revert 本任务提交；历史 context 缺字段仍可读，新回合采集当前目录，不迁写历史。

## 开工证据

§0 思考层叠修复独立提交 7f2c85daf；Vitest 11587 passed / 2 skipped，agent-runtime 371 passed，janitor 13、stats 8 passed；Ponytail PASS，对应 stash 已删除。
preflight 刷新到 origin/main d566c99c3；仅因任务要求保留的两个未跟踪 SWITCH 文件报 dirty_worktree。merge-base b8162783c，HEAD/main 分叉 65/41；已正常 merge 最新 main，无冲突。任务目录和分支均未切换。

## 验收进行中

- 真实调用点红：原输入边界只发送用户原话，无“可用模型”；parser 拒绝 availableModels。`agent-lane-models-block-evidence/red.log`。同一测试加载生产源码的 CJS 编译产物（测试时生成，不依赖旧 dist），恢复实现后 2/2 绿：`green.log`。
- loopback 阶段02 3/3：`tests/ux/shots/g1-models-loopback/attempt-{3cBxHp,oEEcSc,ljzfGu}`。请求 matcher 要求真实投影的全部 modelKey 在用户上下文，零付费。
- 小样启动修正：真实设置未列 nano，只在隔离副本加入用户点名且官方价目已确认的 nano；不修改用户设置。第一次启动检查失败，0 调用。首次付费尝试被原 UI 探针 15 秒截停；截图仍在思考。只对 plan-only 实验按真实终态的 180 秒等待审批。
- 第二次实验的 8192 输出上限过低：原生 assistant content=[]，usage.reasoning=8192，rawStopReason=length；运行时自动重试三次。模型没有可引用的推理正文，不能编造，也不把它记成选档错误。已恢复 nano 官方 16000 输出限额；所有失败费用和 reservation 仍计入同一个 ¥2 实验账本，不清零重试。

## deepseek-v4-pro 未完成样本：原生推理原文

来源：`tests/ux/shots/g1-models-real/attempt-78jTcp/profile/projects/*/.nomi/agent-sessions/--nomi-lane-main--/*.jsonl`。首轮已读取清单并明确 MiniMax-H3/t2v/768P；随后先调用 read_full_text 与 nomi_canvas_read，未进入分镜写入。后续 native assistant 记录 Connection error；不得把正确推理当作工具写入成功。

```text
用户想要我把剧本《日落前的一分钟》拆成分镜方案。让我仔细分析这个剧本和约束条件。

**剧本分析：**
- 主角：小禾，背相机的年轻创作者
- 地点：河边旧街修鞋摊和相邻长椅
- 时间：傍晚自然光
- 故事：小禾想拍短片 → 发现街景无故事 → 看到修鞋摊 → 拍摄师傅修鞋和孩子 → 编辑导出 → 夕阳下合上电脑

**约束条件：**
1. 横屏 16:9
2. 总时长 64 秒，八镜各 8 秒
3. 主角小禾，背相机的年轻创作者
4. 地点：河边旧街修鞋摊和相邻长椅
5. 结局固定：成功导出并播放，合上电脑看夕阳

**模型选择：**
- 视频：MiniMax-H3，768P，t2v 模式，16:9，8秒
- 图片：gpt-image-2，1K

但用户说"分镜方案"，我需要确认这是什么模式。用户没有明确说是图片分镜还是视频分镜。但是看约束条件，说"八镜各8秒"，"总时长64秒"，这明显是视频分镜。而且用户指定了 MiniMax-H3 的 768P 文生视频档。

所以这是**视频分镜**模式，shotKind 应该是 "video"。

**角色锚：**
- 小禾：背相机的年轻创作者，同一服装和身份（贯穿全片）
- 师傅：修鞋摊师傅，磨旧的手掌
- 孩子：站在旁边踮脚望

**场景锚：**
- 河边旧街修鞋摊
- 河边长椅

**风格锚：**
- 傍晚自然光、横屏16:9

让我拆成8个镜头：

1. 小禾背着相机走到河边旧街，举起相机发现街景无故事
2. 风吹动修鞋摊前的蓝布，小禾蹲下
3. 师傅用磨旧的手掌抚平一只小鞋，孩子踮脚望
4. 小禾拍针线穿过皮面的细节（特写）
5. 退到门口，记录孩子接过鞋子时的笑容
6. 太阳渐低，小禾坐到河边长椅上编辑
7. 屏幕里孩子穿好鞋跑向家人，小禾按下导出
8. 最后一束夕阳落在她脸上，她合上电脑，抬头看蓝布在风里摆动

现在来算每个镜头的时长。用户说八镜各8秒，那每个就是8秒，总共64秒。不需要用演时换算法，因为用户已经明确指定了。

现在来建 anchors：

**anchors:**
1. anchor-1: 小禾 - character - visual - 年轻女性创作者，20多岁，短发扎成低马尾，穿白色棉麻衬衫和卡其色长裤，背着棕色皮质相机包，气质安静专注。全身中性站姿，柔和傍晚自然光。
2. anchor-2: 修鞋摊师傅 - character - visual - 50多岁男性，皮肤黝黑，手掌粗糙有老茧，戴老花镜，穿深蓝色工作围裙，灰色短袖。坐在修鞋摊前，中性姿势，傍晚自然光。
3. anchor-3: 孩子 - character - visual - 5-6岁男孩，短发，穿橙色T恤和深蓝色短裤，脚穿一只旧鞋一只新鞋。中性站姿，傍晚自然光。但孩子只出现在几个镜头里...让我再看看。

孩子出现在镜头3、4、5、8？不，镜头8里没有孩子，镜头8是小禾。孩子出现在镜头3、4、5。而且孩子只有2-3个镜头出现。根据规则，≥2个镜头就建锚。但孩子出现在3个镜头（镜3、镜4、镜5），所以应该建锚。

实际上，让我重新数：
- 镜3：师傅抚平小鞋，孩子踮脚望
- 镜4：针线穿过皮面细节——这个可能没有孩子，只是手的特写
- 镜5：孩子接过鞋子时的笑容

孩子出现在镜3和镜5，2个镜头，应该建锚。

4. anchor-4: 修鞋摊 - scene - visual - 河边旧街上的修鞋摊，蓝色布帘在风中轻摆，木质工作台上有鞋楦、针线、皮料和散落的鞋钉。傍晚暖金色自然光从西边斜照，背景可见河面和旧街建筑。空场景全景。
5. anchor-5: 河边长椅 - scene - visual - 河边的木质长椅，面向河面，椅背有斑驳的旧漆。傍晚暖金色阳光从西边斜照，河面有粼粼波光。空场景全景。
6. anchor-6: 全片风格 - style - text - 暖金色傍晚自然光，柔和温暖色调，16mm胶片质感，浅景深，画面安静克制，无旁白，保留环境声。scope: all。

现在来写8个镜头。

**镜头1（8秒）：** 小禾背着相机走到河边旧街，举起相机。场景：修鞋摊。
- anchorIds: [anchor-1, anchor-4, anchor-6]
- prompt: 镜头缓慢向前推近，小禾从旧街转角走入画面，背着相机，举起相机对准宽阔街景。她微微皱眉，放下相机，环顾四周，表情略带失落。傍晚暖光勾勒她的轮廓。

**镜头2（8秒）：** 风吹动蓝布，小禾蹲下。
- anchorIds: [anchor-1, anchor-4, anchor-6]
- prompt: 镜头固定，一阵风吹来，修鞋摊前的蓝色布帘轻轻摆动。小禾从画面右侧走入，被蓝布的摆动吸引，缓缓蹲下身，视线落在摊位前。她的表情从茫然转为专注。

**镜头3（8秒）：** 师傅抚平小鞋，孩子踮脚望。
- anchorIds: [anchor-1, anchor-2, anchor-3, anchor-4, anchor-6]
- prompt: 镜头缓慢横摇，从师傅磨旧的双手开始——他正用粗糙的手掌轻轻抚平一只小鞋的鞋面，动作缓慢而温柔。镜头向右摇，一个孩子踮着脚尖，双手扒在桌沿，认真望着桌面。小禾在画面边缘，举起相机。

**镜头4（8秒）：** 针线穿过皮面细节。
- anchorIds: [anchor-2, anchor-4, anchor-6]
- prompt: 镜头固定特写，师傅的手指捏着针，针尖穿过棕色皮面，线被拉紧，皮面上留下细密的针脚。阳光从侧面斜照，照亮皮面的纹理和师傅手指上的老茧。浅景深，只有针线和手指清晰。

**镜头5（8秒）：** 孩子接过鞋子。
- anchorIds: [anchor-1, anchor-2, anchor-3, anchor-4, anchor-6]
- prompt: 镜头从门口向内拍摄，孩子从师傅手中接过刚修好的鞋子，低头看了看，然后抬起头，脸上绽开灿烂的笑容。小禾站在门口，相机贴在眼前，轻轻按下快门。她没有说话，只轻轻点头致谢。

**镜头6（8秒）：** 小禾坐在长椅上编辑。
- anchorIds: [anchor-1, anchor-5, anchor-6]
- prompt: 镜头缓慢拉远，小禾坐在河边长椅上，笔记本电脑放在膝上。她的手指在触摸板上滑动，专注地剪辑。太阳逐渐西沉，河面泛着金色光斑。她偶尔停下，歪头思考，然后继续操作。

**镜头7（8秒）：** 屏幕里孩子跑向家人，导出。
- anchorIds: [anchor-1, anchor-5, anchor-6]
- prompt: 镜头从侧面近景拍摄小禾的侧脸和电脑屏幕。屏幕里播放着孩子穿好鞋跑向等候家人的画面。小禾按下导出键，进度条开始走动。她双手交叉放在膝上，等待。进度条走完。

**镜头8（8秒）：** 夕阳落在脸上，合上电脑。
- anchorIds: [anchor-1, anchor-5, anchor-6]
- prompt: 镜头固定，最后一束暖金色夕阳落在小禾脸上，她合上笔记本电脑，抬起头，望向修鞋摊的方向。蓝色布帘仍在风里轻轻摆动。她微微笑了笑，眼神平静。画面缓缓淡出。

现在，用户要求模型：MiniMax-H3，t2v 模式，768P，16:9，每镜8秒。

MiniMax-H3 的 t2v 模式是纯文生，不接参考边。所以 anchorIds 里引用的 visual anchors 实际不会连参考边（因为 t2v 没有参考槽），但 text anchors 的描述会拼进 prompt 里。

等等，让我重新读一下规则。用户说"仅使用 APIMart。视频用 MiniMax-H3 的 768P 文生视频档"。t2v 是文生视频，纯文生，不接参考边。这意味着 visual anchors 的参考图实际上不会被用来做参考——但这是系统的限制，我仍然应该按规则建锚。

但是，MiniMax-H3 也有 first 模式（首帧），firstlast（首尾帧），ref（多模态参考）。用户说"文生视频档"，所以应该是 t2v 模式。

不过用户也说"图片如需生成只用 gpt-image-2 的 1K 档"。但这只是说如果需要图片的话。对于视频分镜，我们用的是 MiniMax-H3。

好的，让我确认：用户说"视频用 MiniMax-H3 的 768P 文生视频档"，这明确是 t2v 模式。t2v 是纯文生，没有参考槽。所以我不应该连任何参考边。

但根据 skill 规则，visual anchors 默认会生成参考图。在纯文生模式下，这些参考图不会被连到视频节点，但可以作为视觉参考存在。

对于本方案，由于使用的是 t2v 纯文生模式，所有视觉锚的描述需要被整合进 prompt 中。不过 skill 里说 text anchors 的描述会自动拼进引用它的镜头 prompt，而 visual anchors 的描述不会自动拼进——它们依赖参考图。但在纯文生模式下，参考图无法被使用。

所以实际上，对于 t2v 模式，我需要确保所有必要的视觉描述都在 prompt 里。但这又和 skill 说的"prompt 里不重描外貌（交参考图锚）"矛盾。

让我重新考虑。在 t2v 纯文生模式下，visual anchors 的描述可能仍然会以某种方式被系统处理——也许系统会把它作为文本拼进 prompt？我不确定。让我还是按照标准流程来，建 visual anchors，然后在 prompt 里不重复外貌描述。如果系统在纯文生模式下无法使用参考图，用户可以在确认时看到并调整。

实际上，用户明确说了"仅使用 APIMart"，并且"视频用 MiniMax-H3 的 768P 文生视频档"。t2v 是纯文生模式。但 MiniMax-H3 的 first 模式也支持首帧参考。如果用户想要更好的效果，可能需要用 first 模式。但用户明确说了"文生视频档"，所以应该用 t2v。

好的，让我按照这个来写方案。不过我需要考虑：在 t2v 纯文生模式下，prompt 需要包含所有视觉描述，因为没有参考图可用。我应该在 prompt 里包含足够的视觉描述。

但 skill 规则说"prompt 里不重描外貌（交参考图锚）"——这是针对有参考图的情况。在纯文生模式下，这个规则可能需要调整。但 skill 没有明确说明纯文生模式下的特殊情况。

我还是按照标准流程来做，建 visual anchors，prompt 里不重复外貌。如果用户确认后发现问题，可以调整。

现在让我整理方案：

**title:** 日落前的一分钟

**anchors:**
- anchor-1: 小禾 (character, visual)
- anchor-2: 修鞋摊师傅 (character, visual)
- anchor-3: 孩子 (character, visual)
- anchor-4: 修鞋摊 (scene, visual)
- anchor-5: 河边长椅 (scene, visual)
- anchor-6: 全片风格 (style, text, scope: all)

**shots:** 8个视频镜头，各8秒，MiniMax-H3 t2v 768P 16:9

现在我需要确认每个镜头的 modelKey 和 modeId 和 params。

modelKey: MiniMax-H3
modeId: t2v
params: resolution=768P, aspect_ratio=16:9, duration=8

等等，duration 参数是 MiniMax-H3 支持的参数吗？让我再看一下。

MiniMax-H3 参数: resolution[2K,768P] aspect_ratio[21:9,16:9,4:3,1:1,3:4,9:16] duration watermark webhook

所以 duration 是支持的参数。那我应该填 duration=8。

现在让我也考虑：用户说预算上限 ¥8。文本、图片、视频和审片都要在这个预算内。但我不知道具体定价，所以只能按用户要求来规划，让用户在确认时看到报价。

好，现在让我调用 nomi_storyboard_write。

但是等等，我需要先读全文吗？剧本已经在用户消息里了，而且用户说"先读全文"。让我读一下。

实际上用户已经把剧本发在消息里了，而且还有选择区域。让我读一下选择区域和全文。

看用户消息，有个 selection 是文档引用。让我读一下。

其实用户已经把完整剧本贴在消息里了，包括约束条件。我应该可以直接开始规划。但为了确认，让我读一下文档。

好的，让我先读文档，然后再规划。但考虑到剧本已经在消息里完整给出，读文档可能只是确认一下。让我还是读一下，确保没有遗漏。

同时，让我也读一下 canvas，看看有没有现有的锚可以用。

好，让我并行调用这两个。
```

## 三条指定模型小样汇总

| 小样 | 首调分镜写对 | 回合成功 | modelKey / 768P 档位 | 单次费用 |
|---|---|---|---|---|
| nano 1（3WOrbI） | 1/1 | 1/1 | 8/8 / 8/8 | ¥0.033922 |
| nano 2（D7JQM1） | 1/1 | 1/1 | 8/8 / 8/8 | ¥0.031906 |
| deepseek-v4-pro（78jTcp） | 0/1，未调用写工具 | 0/1 | 0/8，未写入 | ¥0.093114 |

验收为 2/3；不宣称真实模型全绿。nano 1 的原始走查因旧事件终态探针报失败，另以原生 toolResult + 最终 stop 文本 + 落盘八镜逐项复核，保留原报告而不改写；nano 2 已完整通过阶段02并人眼查看分镜表，768P/8秒可见、收据完成、文字不重叠。deepseek 的参数推理正确不等于写入成功，失败原文见上节。

全部尝试（含启动与输出限额实验失败）共 9 次文本付费请求，累计账单差额 ¥0.204694，最大未释放预留 ¥1.203798，均未达 ¥2。金额来自 APIMart balance 差额，可能包含同 token 并发消费。零图片/视频调用。三条脱敏数字收据在 `agent-lane-models-block-evidence/{nano-1,nano-2,deepseek-1}.json`，完整原生转录保存在各隔离 profile，凭据副本已清理。

验证：真实调用点 2/2、定向 33 条、预算/排序追加 14 条、native R30 2 条、typecheck、root-cause-contracts、boundaries、vocabularies 均通过。完整 gates 已通过（`/tmp/nomi-models-gates4.log`）：75 项阻断门岗、Vitest 1,259 文件/11,663 测试通过（2 跳过）、agent-runtime、janitor、stats、Vite 与 Electron 构建均绿。排队期间 main 推进至 #665，已无冲突整合 `4886cdde3` 后重跑；验证树基线 `fa0cbe472`。原有 context 256 KiB 上限保持不变；本轮没有改 SKILL/schema 描述或工具形状，也没有生产 SDK 接线改动。

### deepseek 后续请求为何未发出

已补只读定量核验 `deepseek-budget-proof.json`：首请求 61,746 UTF-8 bytes；两个工具结果正文增加 2,131 bytes、两条调用名称再增加 30 bytes。即使完全不计调用 ID、JSON 包装和可能回传的推理，下一次请求至少 63,907 bytes。按官方原价和 8,192 输出上限，其最大预留至少 ¥0.796347，加前面保留的 ¥1.203798，合计至少 ¥2.000145，必然被小样闸在发送前拒绝。native SDK 把此拒绝表现为 Connection error。实际账单虽仅 ¥0.204694，本任务不提高 ¥2 限额、不清除失败预留或重跑凑绿，按允许的 2/3 验收诚实交付。

真实设置目录结构复核：12 个可能可用供应商、92 个已发布模型投影为 90 条，138,103 bytes；90 条均通过 composer parser，低于原 262,144-byte 总限额。该只读上界测量未解密凭据，未打印或投影 key。

## 第四轮复盘（2026-09-09，证据先行）

### 包身份与三种假设

未改生产代码，先核对 gate4b nano/default `report.json` 的 `packagedAsarSha256`，均为 `d8f84ef10063e7fd1179b5569c88ca1e89c0399621907ab160149f107bb1f657`。实读该包（`/Users/aoqimin/Desktop/Nomi-switch-gate/release/mac-arm64/Nomi.app`）哈希一致，但包内 `dist-electron/agentLane/laneDesktopInput.js` **没有 availableModels schema 或 formatter 调用**，全部 renderer bundle **没有 availableModels 字段**。源码 HEAD 标签不能证明被启动包内的代码身份。

复现：复用 `_launchApp.mjs` + `prepareIsolation` 拷真实设置，仅在隔离目录追加现有 loopback 文本供应商；点击真实编辑器「拆成镜头」，走 `ProjectAgentResidentShell` 注册的 launch，不直接调用 send/providerContent。临时只读探针在主进程记录收到的 renderer command context，并包装实际 providerContent 记录拼接结果，均只打印字段是否存在、条数与 skillKey，不打印 key 或用户正文。模型响应来自 localhost，费用 ¥0；结束删除隔离凭据目录。

| 假设 | 第四轮实证 |
|---|---|
| 常驻启动器没有经过采集 | **被测旧包根本不含采集代码**。真实 `skillKey=workbench.storyboard.planner` prompt command 的 `availableModels` 不存在；主进程也不存在；请求 0 行。当前本地构建同一点击路径发送 87 条，并成功拼入 prompt。不能称当前源码绕过 send。 |
| listAvailableModelsForAgent 抛错被吞 | 当前实现本身无 catch；send 外层 catch 会显示 error 并停止发送。当前构建实跑成功返回 87 条，旧包不含该采集调用，不能将旧包的缺失归因此异常。 |
| skillKey 跳过清单 | 当前构建带同一 skillKey 的回合已实证 renderer 87 → main 87 → HTTP 有 modelKey=。排除。 |

诊断日志：`agent-lane-models-block-evidence/round4-{package,current}-diagnostic.log`。打包版红属于陈旧产物，不是三种源码假设中的任何一种。`dist:mac:dir` 当前只检查 Electron 安装后直接 electron-builder，没有先执行 build；打包流程可吞入旧 dist/dist-electron。归类 recurring，尚待据此修复与新包验收，不借当前源码的绿替代新包结果。

### 完整目录的独立发现

真实设置 `deriveModelListing` 得到 35 个 keyStatus=ok 视频模型，当前请求只有 33 个：缺 `dreamina-multiframe` 与 APIMart `viduq3`。只读目录核对：两项均 enabled、有 archetype，但仅有 image_to_video mapping；`listAvailableModelsForAgent` 调 `preloadModelOptions('video')`，后者默认只收 text_to_video。这与注入整体消失是两个机制。尚未改动，不把 33/35 报作全部模型通过。

### 本轮范围与验收约束

用户指定保留目录/分支、两个未跟踪 SWITCH 文件；preflight 已刷新 origin/main（ca9a6fad7），仅因这两文件报 dirty_worktree。任务起点 HEAD 4e50e47c8；merge-base 4886cdde3，HEAD/main 两侧 71/38。禁止改 SKILL/schema 描述/审批/C0 断言或预算；付费仅 nano×2 到阶段02，≤¥0.3。最后须本轮完整 gates exit 0、正常 hooks commit/push 原分支，SWITCH-LAST 顶部≤12行；不新 PR、不合并。

### 已证实的目录完整性修复方案

在唯一的 `listAvailableModelsForAgent` 采集函数中汇总现有 image/imageEdit/video text_to_video/image_to_video 发布投影，继续由既有 `(vendor, modelKey)` 去重。调用方不增加任何采集路径，不复制目录过滤规则，picker 的默认模式约束不改。真实启动器端到端红：4 个可用视频模型仅注入2个，缺 reference-only 与内置 dreamina-multiframe。独立 class 单测使用真实 DTO→publication→archetype 链，证明 image_edit 同类也漏，失败已留存。回滚为 revert 本轮改动，不迁写历史。打包根因修复范围正在等主会话答复；其间不改打包边界。

main 整合预演发现上游同时修改了 C0 全程预算与观察器；已 `git merge --abort` 回到任务树，保留本轮未提交证据/测试，未把上游预算变更带入本任务，也未提交任何合并。

### 本轮已取得的绿灯（仍未交付）

- 唯一采集函数已汇总文生与参考图输入发布模式；35 条定向测试通过。
- 真实常驻 launch：修前 2/4 → 修后 4/4 视频模型 key；请求来自真实 IPC/native lane，夹具不提供 composer context。`round4-red.log` / `round4-green.log`。
- 先执行带锁 `pnpm run build`，再执行原 `pnpm run dist:mac:dir`，命令 exit 0，packaged MCP 25 tools / 89 resources 冒烟通过。新包 asar SHA256 `8209b44bcb841bdb816f072327bb8dcd589f1cc78fa31de356c552ee93d816f6`。打包版同一真实 launch 4/4：`round4-packaged-green.log`。此包生成于整合 main 之前，不能冒充最终 HEAD 的整包身份。
- 第一个 nano 样本停在新签名包的 macOS 钥匙串授权：`sample` 主线程持续在 `SecItemCopyMatching → SecKeychainItemCopyContent → SecurityServer::ClientSession::decrypt`；没有文本出站账本。已请求本机用户处理系统授权，不向聊天索取密码/key。原 C0 预算/断言文件未改；外置 test-only facade 在已有预算器的入参再施加 ¥0.3 总额上限，保存出站 JSON body（不含请求头）。
- main 整合已完成为 `69d505570`（Ponytail 正常 PASS）。保留任务分支原 `c0-script.md` / `c0-real-budget.mjs` / 对应测试原样（¥8），冲突保留原 plan-only 与原 native storyboard 断言，同时接受上游 collect 观察器和通用 native 首工具统计。合并核对 13 条 node tests + 2 条预算 Vitest 通过；无 force 或 hook 绕过。
- 模型雷达：APIMart 新增 gemini-omni-1.1-flash；LLM 车道受 safeStorage 凭据限制未查成。未更新雷达基线、未接模型；输出仅保存在本轮 .tmp。

真实设置全目录补验（零额度、相同常驻启动器）：修后 renderer 91 → main 91 → HTTP 视频 modelKey **35/35**，missing=[]，同时覆盖仅图生视频的两项。日志 `round4-real-catalog-green.log`。这一轮仍为本地构建，不替代被钥匙串阻塞的新包真实付费模型数字。

系统授权阻塞的进一步证据：只读 IORegistry 返回 `CGSSessionScreenIsLocked=true` / `kCGSSessionOnConsoleKey=true`；SecurityAgent 没有可见窗口。因此不能断言用户此时已经看得到钥匙串弹窗，须先解锁 Mac。完整 gates 已取得共享锁进入执行；本轮未因排队先推。

### 完整 gates 首轮与合并修正

首轮已跑完76门岗（205.6秒）：71通过、2阻断、3 advisory，exit1；未进入后续完整单测/构建，不称全绿。阻断证据在 `.tmp/round4-gates.log`。

1. 词表合并时取“main所有登记并集”错误地复活了本分支已删的 context store 登记。改为真正三方比较：保留任务分支登记，只加入 main 相对 merge-base 新增的 owner；不改门岗/断言，不保留不存在的路径。已有回归先红，修后63条 node tests、205 owner登记核验通过。
2. main 新增走查夹具使用旧应用内工具名。按真实生产 `laneCanvasTools`/`documentModelTools` 对账，把 sweep 的 `nomi_canvas_plan` 改为 `nomi_storyboard_write`（原 propose_storyboard_plan 参数保持）；体验走查改为 `append_to_end`，其真实 schema 仅接 content，去掉旧统一 MCP 的 operation 入参。未改C0断言或任何生产工具 schema。MCP引用门岗117调用点通过。

两项均是本次main整合暴露的测试/登记差异，原门岗完整保留；收敛后重新排完整 gates，不复用首轮失败收据。

第二轮完整 gates **exit 0**：`.tmp/round4-gates2.log`；76 contracts（73通过、0阻断、3 advisory）；Vitest 1264文件通过/1文件跳过，11689测试通过/2跳过；Agent runtime373、janitor13、stats8通过；renderer与Electron构建通过，五门戳 HEAD `69d505570821`。修复仍暂存未提交，未push。

Mac持续锁屏导致首个付费尝试约28分钟仍未离开凭据读取，现已终止本任务该实例（TERM无效后对已核实的PID 25224 KILL），保留blocked收据 `round4-paid-blocked.json`。未完成nano样本，不以零额度数替代。接下来用本次gates构建重新打包最终整合树，不保留后台挂起的付费尝试。

最终整合树打包 `dist:mac:dir` **exit0**（`.tmp/round4-package-final.log`），asar SHA256 `5214e066ac68f42f2537097ad6f3917a7634bbad727cc18a734a9e68f84afc97`；packaged MCP25 tools/89 resources通过，最终包常驻启动器视频清单4/4通过，`round4-final-packaged-green.log`。本轮未取得nano×2付费数字；原尝试按真实C0输出 paid calls=0，隔离凭据已清理，没有挂起的付费实例。修复与证据已暂存，未commit、未push；只有main整合提交69d505570已在本地。仍需用户解锁Mac，以及答复此前提出的打包边界修复范围问题，才能完成剩余交付；不宣称本任务完成。

## 已批打包边界收尾（2026-09-09）

第四轮（b）「清单没到模型」来自过期包，该结论作废；视频站、时间轴、导出和体感发现仍有效。用户确认此次约 ¥26 的浪费源于 dist:mac:dir 复用现成产物。

根因类别 recurring：package.json 的 dist 与 dist:mac:dir 都直接执行 electron-builder，缺少构建身份不变量。范围仅 scripts/ 与 package.json 脚本，另附合同、证据与教训；不改生产 UI、技能、schema、审批、C0 或预算。现有 build:renderer、build:electron 也须在执行前作废旧戳，防止部分构建后混用。

实现：完整构建前取 HEAD 与真实工作树 Git tree（临时 index，不改变暂存区，含非忽略的未跟踪文件），删除两份旧戳；构建成功且前后身份一致才在 dist/、dist-electron/ 写相同戳。两个打包入口共用校验，缺戳、坏戳、任一身份漂移均退出并提示先 pnpm build。戳记录 dirty，不以单一布尔值代替内容身份。构建过程失败不发戳。

验收：Node 临时 Git 仓测试过期戳、HEAD 变化、staged/unstaged/untracked 变化、缺戳/坏戳、部分/失败构建；正确戳通过。红绿日志 package-stamp-{red,green}.log。完整 gates 必须 exit 0 后原分支正常 push。回滚 revert 打包修复提交；已有无戳产物必须重建，不迁写假戳。Mac 锁屏，nano×2 待钥匙串授权后补。

收尾首次 contracts 全部 76 项汇总，仅 electron-install 的脚本开头正则阻断：检查未识别 build 包装器和打包前只读戳校验。保持 Electron 身份检查必须先于编译/打包的要求，将结构测试对齐真实入口；13/13 通过（.tmp/round4-close-electron-identity-green.log）。首次 gates exit 1 留档 .tmp/round4-close-gates-attempt1.log；之后必须重新完整 gates，不能引用先前收据推送。
