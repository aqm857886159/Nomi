# 封面 v1 试产报告

状态：**历史 v1 试产报告，已被后续收据部分替代**。下文记录 v1 当时的结果，不代表现在的缺口。

2026-09-09 skill-ui-b 开工实核：后续已授权 GPT Image 2 补完37张，见 `generation-receipt.json` 的 `round3`（37/37 passed）；当前40张效果插画与15项原媒体均已在库内。本任务再补齐33个老技能，首轮33张+返工3张，采用33张。最新 [88条状态接触表](contact-sheet-skill-ui-b.png) 为15项原媒体+73张插画、0待生成；本次费用$0.306（保守折算¥2.448），同已批准gpt-image-2模型与锚图参考槽。见 skill-ui-b-visual-review.md 和追加收据。

## 结果与裁决

用户已批准锚图 3，以及「强调色只用一种（蓝），块数随隐喻 1–2 块」。完整 40 条隐喻位于 [规则文档](../2026-09-08-cover-illustration-rules.md)。第一次 dry-run 为 40 条，估价 $0.50 / 保守 ¥4.00；第二轮也完整 dry-run，均未请求密钥。完整日志在本机 `/tmp/nomi-covers-dry-run-v1.json` 与 `/tmp/nomi-covers-dry-run-v2.json`；实际生成提示词全保存在收据。

第一轮：纸底、墨线和色相基本一致；01/04/05 多于两块蓝色，04/05 隐喻没有表达。第二轮：蓝色块数收敛，但 04 仍照搬锚图三组并排框，未逐渐缩小；05 仍是矩形套框，没有上宽下窄梯形。02/03 的第一轮留白与隐喻更好，回选第一轮；01 选第二轮。最终可用 **3 张**，剩余 **37 张未生成**。失败原因是模型把参考图主体带入新图，不能用「同一配色」代替隐喻验收。

两轮均通过真实 `image_urls` 参考槽调用同一模型，没有第三轮试产或全量调用。返工 **1 轮**（共 **2 轮试产、10 次付费生成**）。达到上限后，收据写入失败状态；脚本在再次调用供应商前拒绝继续付费。

## 媒体与费用证据

- 总览：[55 条状态接触表](contact-sheet-v2.png)，含 **15 原始真实媒体 + 3 可用插画 + 37 明示未生成格**。灰格只是状态，不是插画成品。
- 两轮原始目检：[第一轮](rejected-trial-1/contact-sheet.png)、[第二轮](rejected-trial-2/contact-sheet.png)。未选用的 7 张保留在对应目录。
- [生成收据](generation-receipt.json)逐张记录提示词、模型、输出、实际扣费、task ID、锚图 SHA-256、选用状态与目检原因。
- 本次实付 **$0.1250**，按 8 CNY/USD 预算系数保守折算 **¥1.00**。包括旧锚图后累计 **$0.1625 / ¥1.30**，低于 ¥25 上限。这是供应商 USD 余额扣减及预算折算，不是人民币银行卡结算单。
- 锚图 SHA-256：`df56802b97e403f957c29b9a7cfb532fd55b7578b72faa734f573eea0f550928`。

## 验证

实际 10 张付费图均为可解码 PNG；收据模型与锚图 hash 一致、每次扣费 $0.0125；3 个 preview 指向存在的图片，37 个无伪造 preview；15 条原始技能文本与原媒体逐字节和开工 HEAD 对比一致；40 条 dry-run 唯一性、提示词长度与预算检查通过；0/41/NaN/未知参数拒绝。停止付费守卫已做真实 Electron 入口验证，未调用供应商。

本轮不改 src、不实现 UI、不装包。按指定分支整合 origin/main 的 3 个新提交，只涉及既有测试和文档。

Contracts 全量 75 项已执行：初次 71 通过、1 项 prior-art 阻断、3 项 advisory；补齐已有来源的条目结构后 prior-art 复验通过，全部阻断项已通过。3 项 advisory 为 docs-index、doc-status、research-sources，按现有规则保留提示。同步 main 的预算/dispatch 测试 6/6 通过。Ponytail 提出的恒真旧条件已删除。

## 40 条目标路径（状态明确区分）

| 效果 | 目标路径 | 状态 |
|---|---|---|
| 空镜转场 | `skills/effect-camera-01/assets/cover.png` | 可用 |
| 过肩对话 | `skills/effect-camera-02/assets/cover.png` | 可用 |
| 特写情绪 | `skills/effect-camera-03/assets/cover.png` | 可用 |
| 推轨跟拍 | `skills/effect-camera-04/assets/cover.png` | 未生成 |
| 仰拍起势 | `skills/effect-camera-05/assets/cover.png` | 未生成 |
| 俯拍众生 | `skills/effect-camera-06/assets/cover.png` | 未生成 |
| 摇镜扫景 | `skills/effect-camera-07/assets/cover.png` | 未生成 |
| 移轴虚化 | `skills/effect-camera-08/assets/cover.png` | 未生成 |
| 逆光剪影 | `skills/effect-camera-09/assets/cover.png` | 未生成 |
| 手持跟拍 | `skills/effect-camera-10/assets/cover.png` | 未生成 |
| 慢动作升格 | `skills/effect-camera-11/assets/cover.png` | 未生成 |
| 快动作降格 | `skills/effect-camera-12/assets/cover.png` | 未生成 |
| 焦点转换 | `skills/effect-camera-13/assets/cover.png` | 未生成 |
| 画框构图 | `skills/effect-camera-14/assets/cover.png` | 未生成 |
| 对角线构图 | `skills/effect-camera-15/assets/cover.png` | 未生成 |
| 绝对对称 | `skills/effect-camera-16/assets/cover.png` | 未生成 |
| 三分法构图 | `skills/effect-camera-17/assets/cover.png` | 未生成 |
| 前景遮挡 | `skills/effect-camera-18/assets/cover.png` | 未生成 |
| 后景虚化 | `skills/effect-camera-19/assets/cover.png` | 未生成 |
| 前景虚化 | `skills/effect-camera-20/assets/cover.png` | 未生成 |
| 长镜头一镜到底 | `skills/effect-camera-21/assets/cover.png` | 未生成 |
| 蒙太奇剪辑 | `skills/effect-camera-22/assets/cover.png` | 未生成 |
| 叠化转场 | `skills/effect-camera-23/assets/cover.png` | 未生成 |
| 闪白转场 | `skills/effect-camera-24/assets/cover.png` | 未生成 |
| 黑场转场 | `skills/effect-camera-25/assets/cover.png` | 未生成 |
| 匹配转场 | `skills/effect-camera-26/assets/cover.png` | 未生成 |
| 声音转场 | `skills/effect-camera-27/assets/cover.png` | 未生成 |
| 主观视角 | `skills/effect-camera-28/assets/cover.png` | 未生成 |
| 客观视角 | `skills/effect-camera-29/assets/cover.png` | 未生成 |
| 上帝视角 | `skills/effect-camera-30/assets/cover.png` | 未生成 |
| 人物三视图 | `skills/effect-character-three-view/assets/cover.png` | 未生成 |
| 表情九宫格 | `skills/effect-expression-grid/assets/cover.png` | 未生成 |
| 自然扩图 | `skills/effect-fill-outpaint/assets/cover.png` | 未生成 |
| 去 AI 感 | `skills/effect-natural-texture/assets/cover.png` | 未生成 |
| 物件六视图 | `skills/effect-object-six-view/assets/cover.png` | 未生成 |
| 俯视构图 | `skills/effect-overhead-view/assets/cover.png` | 未生成 |
| 旧图重绘 | `skills/effect-restore-drawing/assets/cover.png` | 未生成 |
| 场景三视图 | `skills/effect-scene-three-view/assets/cover.png` | 未生成 |
| 宽屏分镜 | `skills/effect-storyboard-panels/assets/cover.png` | 未生成 |
| 参考表情 | `skills/effect-transfer-expression/assets/cover.png` | 未生成 |
