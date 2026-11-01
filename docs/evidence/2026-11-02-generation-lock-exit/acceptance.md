# 验收逐项结果

“过（类测）”只表示对应自动行为检查通过，不顶替缺失真窗或真实付费。全部原始数字见 [verification](verification.json)。

| 条目 | 结果 | 证据与限制 |
| --- | --- | --- |
| A1 | 过 | 八张真 HTTP：首次 8 POST，4 拒绝、4 在途；单卡重试后共 9 POST/5 转发，批次结束。中英 httpEight 收据。 |
| A2 | 过 | generationLockExit 类测：连续三次 server 保留刹车。 |
| A3 | 过 | generationLockExit 类测：本机拒绝不计刹车/模型失败；健康 Node 测试。 |
| A4 | 过 | a4-fresh 中英真挂载编辑器：一张确认卡，2 资产→3 镜头，5 HTTP，镜头 @imageN 与引用图齐全。 |
| A5 | 过 | last-agent 中英×编辑器挂载/未挂四份收据，各5 HTTP，引用已补；现有 Agent 分阶段确认政策保留。 |
| A6 | 过 | confirmedProjectContinuation 29项保护含自身输入与上游封印；generationLockExit 作者行保护。 |
| A7 | 过（类测） | 方案/画布自动引用均读真实队列，排队目标不改；postmerge-related 的对应 autoReference 测试。 |
| A8 | 过（类测） | batchPlanPreview 重试使用当前动作基线、进入原确认；整合主线相关目录通过。 |
| A9 | 过 | last-edited-queue 中英分镜与画布：仅改稿镜3不发，4 POST；共享作者边界反例03红。 |
| A10 | 过（类测） | generationLockExit A9/A10＋confirmedProjectContinuation：别的镜变化允许，自身变化拒绝，再次新动作可发。 |
| B1 | 过 | httpEight：其余4张在跑时失败行双击重试，单张无普通弹卡，POST恰+1。 |
| B2 | 过（类测） | generationLockExit：暂停时单卡重试，恢复批次不再提交该节点。 |
| B3 | 未验证（真窗） | 共享 runner 对暂停/未暂停队列均有行为测试；三次 single-actions 准备失败停点，分镜/画布排队单发真窗未走到。 |
| B4 | 过 | httpEight 真窗双击只+1 POST；真实浏览器 ShotRetry 测拒绝后复位。 |
| B5 | 过 | httpEight 真窗批量/放置互斥；表与行 pending 类测。 |
| C1 | 过 | threePage：503无拒单证据为未知，↑被拒不增POST；既有判定规则未改。 |
| C2 | 过 | threePage 原Run出口＋共享类测两条路径；再次↑被拒历史保留，主进程选原占用Run，继续仅+1 POST。 |
| C3 | 过 | threePage 资产确认取消，POST/占用不变，再次入口可用；NodeErrorReport确认测试。 |
| C4 | 过 | threePage 任务中心自己的确认后选中节点并+1 POST；origin节点映射反例06红。 |
| C5 | 过（回归） | production/release 与 appIntegration 制作Run既有回归测试通过；未改制作状态机。 |
| C6 | 过 | threePage 中英真实文件关窗重开后，列表继续放行、出图。 |
| C7 | 过 | v0.24.0真实源码生成的Run夹具，由当前主进程回放占用、拒绝、人工放行再提交；included postmerge-related。 |
| D1 | 过 | 分类全部本机拒绝码为local-refusal、遥测一致；35错误类别×5失败面表驱动矩阵。 |
| D2 | 过 | postmerge-matrix 中英，分镜行/资产、画布、列表：在途只有查看任务，不给重试。 |
| D3 | 过 | 健康19项Node测试：local-refusal排除，unknown按原规则计；代理7项通过。 |
| E1 | 未验证（部分） | 分镜整批、画布分组、列表分区均有中英确认/逐节点HTTP；框选的完整连续真窗停在四段演练第一段，不能拿分组替代框选收据。 |
| E2 | 过 | 中英threePage＋listEntry：五失败面同类人话/无IPC原文，其余继续；新matrix补拍分镜实际镜头行。 |
| E3 | 未验证（部分） | 分镜真窗重试及拒绝复位浏览器测试通过；画布/列表错误卡重试真窗在single-actions三次准备失败后停止。 |
| E4 | 未验证（部分） | 三页排队显示/列表小卡窄列/排队报价排除均过；排队单发恰1 POST只有共享类测，缺真窗。 |
| E5 | 过 | postmerge-matrix 中英真在途拒绝，五面有查看任务、无重试。 |
| E6 | 过 | threePage 中英分镜资产、画布、列表出口+1 POST，无额外单张卡；确认取消保留原状态。 |
| E7 | 过 | postmerge-matrix 中英三页各点免费取回，3个节点成功，POST保持5。 |
| E8 | 未验证（部分） | 分镜/画布排队改稿均中英通过且三页展示同一拒绝；列表编辑三次卡canvas/inline定位，未验证该真窗。 |
| E9 | 过 | single-actions-3 的部分checks为true：分镜完成后画布、列表同节点同状态；该脚本整体仍失败。threePage另有跨页恢复。 |
| E10 | 过 | threePage 中英以真实Run文件重启，三页同状态、出口有效；C7另验旧数据。 |

16条反例均断言红、退出1、SHA按字节还原。前两条为中英真挂载编辑器；后14条为实际代码行为测试。详见 verification 的 mutations。

[150张截图逐张审阅与限制](visual-review.json)。真实付费、Windows、独立验收和完整连续免费四段均未完成。
