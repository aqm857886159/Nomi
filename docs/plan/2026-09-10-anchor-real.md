# C72 真实角色锚的分镜消费

状态：✅ 已实现并通过完整 gates，待 PR 评审（2026-09-10）。
起始基线：5c507a5cc3ee74f5fa25706165cb94cd3d2e8165；验证前已快进整合 origin/main 807c475d6（#689）；分支 fix/storyboard-anchor-consumption-20260910。
范围：Agent 分镜草稿共享写入边界、锚绑定解析、既有行内提示、专项验证。

## 先查别人
- ComfyUI 官方 First-Last-Frame blueprint：https://github.com/Comfy-Org/ComfyUI/blob/master/blueprints/First-Last-Frame%20to%20Video.json；已存研究 docs/research/2026-08-24-video-capability-shared-layer.md:43。首尾帧是独立输入，切模式和真实绑定必须同时验证。
- Runway 官方 I2V：https://help.runwayml.com/hc/en-us/articles/48324313115155-Image-to-Video-Prompting-Guide；同研究 :24、:34。首帧决定起始构图，角色图优先进参考槽，不能无差别塞首帧。
- Google Veo 参考图：https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/use-reference-images-to-guide-video-generation；同研究 :23、:33。参考能力按具体模型版本声明，不硬编码模式名。
- 内部 owner：src/config/modelArchetypes/anchorPolicy.ts:7 的 SLOT_ACCEPTS；shotReferenceSlots.ts:85 的 appendBinding、:157 的节点投影。复用容量/去重与投影，不新造供应商字段矩阵。以上外部依据复核的是仓库已存研究，非本轮重新联网抓取。

## 现场复盘（原生记录，不把预设当事实）
来源：用户指定 gate-r2/attempt-1UrYyt/review/native-session.jsonl。
- 第 3 行 nomi.input 明确要求「MiniMax-H3 的 768P 文生视频档」「本剧本不使用外部参考素材」。
- 第 9554 行 nomi_storyboard_write：7 个 anchors 全 carrier=text、无 referenceUrl；8/8 shots modeId=t2v，referenceBindings 全缺省。这里不是已传入 visual 图被丢弃，而是规划输入和写入都走文字一致性。
- skills/workbench-storyboard-planner/SKILL.md 已要求视觉锚选参考档；electron/shared/agentCapabilities/availableModels.ts:48 暴露所有模式/槽。MiniMax-H3 的 t2v/first/firstlast/ref 在 electron/shared/videoCapabilities/minimaxH3Apimart.ts:16。
- applyCanvasToolCall.ts:290 parse → :303 原样保存 → :319 才 validateAnchorModelFit；storyboardAnchorPolicy.ts:25 明确 advisory only。
- availableModels.ts:158 全局视频默认已优先参考；但 storyboardPlan.ts:514 对指定模型不套默认模式，执行边界 storyboardRowActions.ts:131 对无参考模式省略锚边。
类根因 recurring：AI 草稿的模式与真实角色参考绑定缺少联合约束，建议文字不能保证消费。

## 实施与边界
对包含真实图片 referenceUrl 的已引用视觉角色锚，在 propose_storyboard_plan 的解析后、保存前按目录归一化模型模式与 referenceBindings。优先 image_ref，次选 first_frame，保留能消费的已选模式；不得静默丢锚或覆盖已有绑定。支持的模式装不下时明确拒绝该草稿，交模型纠正；完全不支持图片则保留模式并使用 #681 行内提示。
无真实图、文本锚、不相关锚不触发；不修改用户资料、全局模型默认、存量方案 hydrate 或 GUI 手动选择。图片+视频的既有关键帧链不从角色定妆图抢视频首帧。
既有 binding.anchorId 类型补入解析 schema，避免 Agent 再写剥掉来源。无新外部协议、无依赖升级。

## 六角色核对
CTO：最早共享草稿写入收口；后端：不越过目录供应商身份；前端：复用槽投影；设计：复用原行内角标，不加控件；PM：真实参考在规划保存即绑定；真实用户：看到模式和参考缩略图即能核对。反方独立调研已确认边界与容量/幂等风险。

## 验收与回滚
先红后绿：真实目录+1角色图+8镜的 applyCanvasToolCall loopback；另测无参考能力、供应商隔离、已有槽容量、幂等与解析回写。官方 DeepSeek 规划仅1次、≤¥1、零媒体；原始模型与保存后的8/8分别计数，不混报。
已看 #681 真机全壳截图 docs/plan/storyboard-anchor-policy-evidence/screenshots/00-anchor-warning.png；本期前后截图用独立测试项目，不碰用户库。
必须完整取得 with-gates-lock gates、正常 hooks 提交推送并开PR，PR引用本方案和截图。回滚 revert 本任务提交，无数据迁移；新草稿使用既有字段，旧方案不静默迁移。

## 真机发现的同链阻塞
修复后首次截图见参考缩略图已绑定，但所有行仍“等小禾参考图”，批量0镜。deriveShotRowExec 的等待判据只认生成锚节点；storyboardPlan.ts:578 对外部 referenceUrl 明确不连/不生成该节点。新增 red-ready.log 先证失败，再使当前有效图片槽中 anchorId+URL 都吻合的真实输入满足等待条件；未绑定仍等待。属于真实锚消费链本身，不扩大到其他生成流程。

## 独立复核收敛
- 既有槽值不能只留在 JSON 却被新模式忽略：候选模式必须仍声明每个非空已填槽，否则拒绝草稿。red-authored-slot.log 已先红。
- 未写模型时复用 pickStoryboardDefaultModel，作为已有 resolveStoryboardImageDefault / resolveStoryboardVideoDefault 的同一身份 owner；红灯 red-default-identity.log，原默认快照仍一致。
- 直接 URL 就绪特判仅适用于无 referenceSourceNodeId 的外部图片，和物化不建锚边的条件一致；来源节点仍保留依赖/冻结判据。

## 生产规划 IR 同类入口
实扫 runStoryboardPlanner.ts 发现 production.plan-storyboard 的单次 JSON 草稿在返回 IR 前同样只 parse。它与直接 Agent 写入共同调用 normalizeStoryboardAnchorDefaults；原始模型 text 保留不改。red-production-ir.log 先证该入口失败，避免只修一个调用者。官方≤¥1仅跑此现有生产规划入口，不运行媒体，不声称完成常驻 Agent 多工具回合。

## 唯一官方样本与槽纠错
DeepSeek-v4-pro 官方单次 HTTP 200，模型原文 `official-raw-plan.json`：8/8 mode=ref，但8镜把角色槽写成未声明的 character_ref（实际image_ref），所以原始合法槽绑定0/8。第一次宿主拒绝，费用按peak tariff上界¥0.272682256。用原始样本先红再修：只有“未在模型任何模式声明的槽”且每条binding的anchorId和URL均匹配当前真实角色锚，才重新归入真实槽；已声明首帧槽、无证明的未知输入仍拒绝。后续零网络重放唯一官方样本，不追加模型抽样，不将宿主纠正冒称原始模型写对。
