# 第三轮执行裁决（2026-09-09 02:15）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

用户授权 GPT Image 2 / APIMart，累计预算 ¥60；保留原隐喻，逐张风格验收。每条 GPT 最多两次，均失败才简化该条再试一次；最终不合格保持灰格。沿用现有脚本与依赖，不改 src/UI、不装包，单笔提交更新 #655。

官方规范：https://docs.apimart.ai/en/api-reference/images/gpt-image-2/generation.md （2026-09-09 实抓）。POST /v1/images/generations，model=gpt-image-2、size=16:9、resolution=1k、n=1、image_urls=[锚图 base64 URI]；有 image_urls 即图生图。档案 input_urls 在 electron/catalog/apimartImages.ts:132 映射到 image_urls；#650 修的是 fal 的同类 join。

价格：https://apimart.ai/api/marketplace/models?keyword=gpt-image-2&page_size=10 ，当前起价 $0.0085/次（1k 默认档）；逐任务保留 provider cost 和余额差，不把起价当实付。每次保守预留至少 $0.15，按 8 折算，含历史费用累计不超过 ¥60。未知请求阻断下一次提交。

验收：37 条 dry-run；锚图对照逐张检查纸底、墨线、蓝色 1–2 块、无字无人脸；只把通过图片登记 preview，保留逐张裁决；55 格 contact-sheet-v3；PNG 解码/metadata/15 原媒体不变验证；contracts 与提交推送钩子。回滚本次提交，已发生费用保留。

前轮失败是构图精确度要求与模型能力不匹配；此次按用户更新素材生产方案，不改生产应用。原始两轮证据与规则表保留，停止裁决由本轮明确授权取代。

---
以下为前轮历史：

# 技能库封面 v1

状态：📎 交接/日志；两轮试产未通过，已停止付费，未全量；用户已选择锚图 3，09-09 01:05 已明确允许 1–2 块同色蓝形，无需确认。

范围：40 条缺媒体效果的几何隐喻、参考图生成、预算收据、55 条媒体接触表、SL-LAST 与 PR #655。沿用当前任务分支；不改 src，不实现 UI，不装包。

## 先查别人

- 官方图生图契约：https://docs.apimart.ai/en/api-reference/images/gemini-2.5-flash/generation.md 。已复核 model、n=1、16:9 和 image_urls 字段；继续使用参考槽，不用文字伪称参考。
- 官方价格：https://apimart.ai/api/marketplace/models?keyword=nano%20banana&page_size=10 。2026-09-09 付费前再次请求并核实 $0.0125/张；每张预留双倍报价，预算使用 8 CNY/USD 保守系数。
- 仓内已验证路径：`scripts/covers/generate-covers.mjs:1`。沿用应用 readCatalog/decryptApiKeyRecord、余额差与 PNG 解码；本次只扩展已批准的批次规模、逐条隐喻和参考图收据，不引入依赖或新 API 格式。

执行：补全 40 条几何隐喻；dry-run 展示全部提示词与费用；先生成 5 张并亲眼对照锚图，最多两轮；通过后生成余量；总付费上限 ¥25，沿用 8 CNY/USD 保守换算、双倍报价预留与未决请求阻断。每张记录提示词、模型、费用、锚图 SHA-256，保留失败和返工费用。

验收：40 张真实 PNG 且 metadata 指向各自媒体；15 条原始媒体不变；锚图通过 image_urls 发送；55 条接触表检查纸底、墨线、1–2 块同色蓝形、无脸无字；contracts 及脚本针对性检查；提交钩子通过后单笔 commit 和普通 push，更新现有 PR，不合并。

回滚：本次提交整体 revert；已经发生的供应商扣费不可回滚，收据必须保留。

开工：指定分支 pull --ff-only 成功；preflight 已刷新 origin/main，但因上一轮留下的规则表与本计划未提交而报 dirty_worktree。按用户明确要求继续当前任务分支并保留该两份工作；最终整合远端基线。

结果：本次 10 次生成、3 张可用、37 条待生成；1 轮返工。实付 $0.125 / 保守 ¥1.00。详见 `docs/design/covers/covers-v1-report.md`。
