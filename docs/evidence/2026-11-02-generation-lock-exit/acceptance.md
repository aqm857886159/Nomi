# 验收逐项结果

类测和假服务商真窗不替代真实付费或独立验收。第二轮B6/B7的修前红、修后绿与新收据见 [round2](round2.json)。

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
| A9 | 过 | continue-edit-2 中英×分镜/画布/列表六份passed，各4 POST：仅改稿镜3不发，其余继续；共享作者边界反例03红。 |
| A10 | 过（类测） | generationLockExit A9/A10＋confirmedProjectContinuation：别的镜变化允许，自身变化拒绝，再次新动作可发。 |
| A11 | 过 | 四类类测及最终重读竞态通过；中英 spendChange：资产运行时真下拉改镜2为2K，第二卡取消不增POST且资产保留，再批量确认后请求resolution=2k，每例5 POST；反例17去掉比较4断言红并按字节还原。 |
| B1 | 过 | httpEight：其余4张在跑时失败行双击重试，单张无普通弹卡，POST恰+1。 |
| B2 | 过（类测） | generationLockExit：暂停时单卡重试，恢复批次不再提交该节点。 |
| B3 | 过 | continue-queue-3 中英三页真实排队单发：原批次条目取消，每次单卡恰+1 POST且无普通确认卡；每份两轮合计10 POST/10转发，第二轮五种提示词各一次，所有批次Promise结束。全部排队时再点组头不弹卡、不增POST。 第2轮另补B6确认后未入队的资产窗口，中英三页目标仍只1 POST。 |
| B4 | 过 | httpEight 真窗双击只+1 POST；真实浏览器 ShotRetry 测拒绝后复位。 |
| B5 | 过 | httpEight 真窗批量/放置互斥；表与行 pending 类测。 |
| B6 | 过 | 第2轮：5入口×5结局，关键帧、旧结果重跑、无新run的忙/锁/可找回、用户与Agent的改价第二卡均有行为类测；中英三入口真窗各5 POST，目标1 POST，结果ID和1条run保留。 |
| B7 | 过 | 第2轮：undefined内存/读盘JSON往返不假冲突，真实编辑仍拒绝；原金路径修前0图片请求、修后1，关窗重开仍保留。 |
| C1 | 过 | threePage：503无拒单证据为未知，↑被拒不增POST；既有判定规则未改。 |
| C2 | 过 | threePage 原Run出口＋共享类测两条路径；再次↑被拒历史保留，主进程选原占用Run，继续仅+1 POST。 |
| C3 | 过 | threePage 资产确认取消，POST/占用不变，再次入口可用；NodeErrorReport确认测试。 |
| C4 | 过 | continue-three-1 中英passed：任务中心unknown普通重试及批量重试不再包含死按钮，专用确认后放行原Run恰+1 POST，被拒历史与出口保留。 |
| C5 | 过（回归） | production/release 与 appIntegration 制作Run既有回归测试通过；未改制作状态机。 |
| C6 | 过 | threePage 中英真实文件关窗重开后，列表继续放行、出图。 |
| C7 | 过 | v0.24.0真实源码生成的Run夹具，由当前主进程回放占用、拒绝、人工放行再提交；included postmerge-related。 |
| D1 | 过 | 分类全部本机拒绝码为local-refusal、遥测一致；35错误类别×5失败面表驱动矩阵。 |
| D2 | 过 | postmerge-matrix 中英，分镜行/资产、画布、列表：在途只有查看任务，不给重试。 |
| D3 | 过 | 健康19项Node测试：local-refusal排除，unknown按原规则计；代理7项通过。 |
| E1 | 未验证（部分，停点） | 分镜/分组/列表批量均有真窗收据；补测三次分别卡实际框选空白角、缩放定位、30%缩放未生效（实为42%）。该项停止，未以Meta+A分组替代框选。 |
| E2 | 过 | 中英threePage＋listEntry：五失败面同类人话/无IPC原文，其余继续；新matrix补拍分镜实际镜头行。 |
| E3 | 过（分项真窗） | continue-single-3 中英检查E3/storyboard、E3/canvas、E3/list均true：真实失败卡双击各只+1 POST、无普通确认卡、生成成功；整体脚本后来在E4准备失败，未改记全绿。 |
| E4 | 过 | continue-queue-3 中英三页真实排队单发：原批次条目取消，每次单卡恰+1 POST且无普通确认卡；每份两轮合计10 POST/10转发，第二轮五种提示词各一次，所有批次Promise结束。全部排队时再点组头不弹卡、不增POST。 第2轮另补B6确认后未入队的资产窗口，中英三页目标仍只1 POST。 |
| E5 | 过 | postmerge-matrix 中英真在途拒绝，五面有查看任务、无重试。 |
| E6 | 过 | threePage 中英分镜资产、画布、列表出口+1 POST，无额外单张卡；确认取消保留原状态。 |
| E7 | 过 | postmerge-matrix 中英三页各点免费取回，3个节点成功，POST保持5。 |
| E8 | 过 | continue-edit-2 中英×分镜/画布/列表六份全部passed；各4 POST，仅排队改过的镜不发，其余继续，三页同一拒绝。 |
| E9 | 过 | continue-single-3 中英部分checks E9=true，分镜完成后画布/列表同节点同状态；整体失败另列，未据此宣称全脚本通过。 |
| E10 | 过 | threePage 中英以真实Run文件重启，三页同状态、出口有效；C7另验旧数据。 |

前17条反例保留历史证据；本轮新增18–20三条分别32/2/2断言红并按字节还原。新免费四段passed且绑定源码提交，旧格式收据不能开跑。

E1实际拖框、真实付费、Windows和本轮独立复验仍未验证。
