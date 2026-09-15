# 22 句用户真会说的话 —— 技能面真实模型腿的题库

> 证据目录 `docs/evidence/2026-09-15-skill-real-run/` · 2026-09-15 · 模型 deepseek-chat（官方端点，temperature 0）

## 为什么是「先写句子」而不是「按界面排 case」

用户在 2026-09-09 三次追问过同一件事：为什么不拿各种 prompt 去打它。教训已经收在
[`docs/lessons/agent-tests-must-be-prompt-driven-and-human-path.md`](../../lessons/agent-tests-must-be-prompt-driven-and-human-path.md)：
按扫描出来的界面 surfaces 排 case，量到的是我们自己的清单；按「用户会打什么字」排，量到的才是他明天会遇到的事。

所以这份表**先写完再跑**，写的时候还不知道任何一个数字。

## 三组，各自在回答一个不同的问题

| 组 | 句数 | 它在问什么 |
|---|---|---|
| 选了技能 | 12（跨 6 条技能） | 用户在 composer 里点了一条技能，回复里看得出它被用了吗？它规定的参数落进工具入参了吗？ |
| 对照（同句不挂技能） | 4 | 上面那些「证据标记」到底discriminate 不 discriminate。**同一句话**不挂技能也命中 = 标记不合格。这一组是仪器的校准器，不是陪衬。 |
| 直接出片 | 6 | 用户只说「给我做一条 30 秒的片」时，Agent 自己有没有做事原则（先立视觉锚 / 用参考图模式 / 去查技能 / 定画幅）。 |

**夹具世界**：`default` = 项目里已经有一部别人的片子（海边小镇 6 镜 + 林夏角色卡）；
`empty` = 刚建好的空项目。「直接出片」那组跑 `empty`——在 `default` 里模型会**正确地**先问
「旧的替换还是并存」，整轮停在提问上，一个镜头都没建，那时候去判「它有没有先立人物资产」，
量到的是「它问了一句」而不是「它缺原则」（[`assert-you-are-in-the-situation-you-claim`](../../lessons/assert-you-are-in-the-situation-you-claim.md)）。
D02 说的是「用这张图」，它需要画布上真有一张图，所以留在 `default`。

## 句子表

| id | 组 | 挂的技能 | 用户说 | 夹具世界 | 正文证据标记（≥1 命中） | 入参证据标记 |
|---|---|---|---|---|---|---|
| S01 | 选了技能 | curated-film-storyboard | 这段剧本帮我做成分镜：林夏在码头等人，渔船进港，她看见父亲下船。 | default | 宽屏、16:9、每格、一个镜头、panel | 16:9 |
| S02 | 选了技能 | curated-film-storyboard | 把文稿里雨夜那段做成电影分镜 | default | 宽屏、16:9、每格、一个镜头 | 16:9 |
| S03 | 选了技能 | drama-short | 这个故事做成短剧：便利店店员每晚都遇到同一个客人，第七晚客人没来。 | default | 圣经、定妆、一致性、禁改、图生视频 | — |
| S04 | 选了技能 | drama-short | 帮我把这条短剧的角色先立起来，别每镜长得都不一样 | default | 圣经、静态特征、动态特征、禁改、定妆 | — |
| S05 | 选了技能 | brand-promo | 这是我的保温杯文案：48 小时保温、一只手能开、军规抗摔。做条宣传片。 | default | 画幅、9:16、竖屏、横屏、受众、调性 | — |
| S06 | 选了技能 | brand-promo | 宣传片先给我脚本，画布别动 | default | 阶段、剧本审阅、不碰画布、行动号召、前 3 秒 | — |
| S07 | 选了技能 | director-cinematography | 第 3 镜是两个人在车里对话，镜头该怎么给？ | default | 中景、景别、心理距离、视线空间、三分法、不动也是选择 | — |
| S08 | 选了技能 | director-cinematography | 帮我把这 6 个镜头的景别排一下，现在看着都一个样 | default | 跳一级、景别、收紧、远景、特写、中景 | — |
| S09 | 选了技能 | curated-product-turntable | 用我上传的那双鞋做个转台展示 | default | 转台、环绕、180、鞋型、cyclorama、turntable | turntable、180、环绕、转台 |
| S10 | 选了技能 | writer-screenwriter | 帮我写一场戏：女儿回家发现父亲在收拾行李 | default | 人物关系、揭示、不可逆、进入越晚、对白、信息不对称 | — |
| S11 | 选了技能 | curated-multi-view | 把这个角色做成多视图设定图 | default | 视图、视角、同一、一致、参考 | — |
| S12 | 选了技能 | curated-film-storyboard | Turn the script in the document into a film storyboard. | default | widescreen、宽屏、16:9、panel、每格 | 16:9 |
| N01 | 对照（同句不挂技能） | — | 这段剧本帮我做成分镜：林夏在码头等人，渔船进港，她看见父亲下船。 | default | 宽屏、16:9、每格、一个镜头、panel | 16:9 |
| N02 | 对照（同句不挂技能） | — | 这个故事做成短剧：便利店店员每晚都遇到同一个客人，第七晚客人没来。 | default | 圣经、定妆、一致性、禁改、图生视频 | — |
| N03 | 对照（同句不挂技能） | — | 这是我的保温杯文案：48 小时保温、一只手能开、军规抗摔。做条宣传片。 | default | 画幅、9:16、竖屏、横屏、受众、调性 | — |
| N04 | 对照（同句不挂技能） | — | 第 3 镜是两个人在车里对话，镜头该怎么给？ | default | 中景、景别、心理距离、视线空间、三分法、不动也是选择 | — |
| D01 | 直接出片 | — | 给我做一条 30 秒的雨夜便利店短片 | empty | — | — |
| D02 | 直接出片 | — | 用这张图做个人物出场镜头 | default | — | — |
| D03 | 直接出片 | — | 帮我做一条一分钟的产品短片，从头到尾都你来 | empty | — | — |
| D04 | 直接出片 | — | 做一条 30 秒的短剧，主角是个外卖员，最后有反转 | empty | — | — |
| D05 | 直接出片 | — | 我要一条横屏 20 秒的城市夜景片，直接开始别问我 | empty | — | — |
| D06 | 直接出片 | — | Make me a 30-second short film about a rainy night convenience store. | empty | — | — |
证据标记怎么选：**取自该技能正文里的专有说法**，不是句子本身能推出来的词。例如
`curated-film-storyboard` 正文只有一句「使用宽屏面板……每格只表现一个镜头」，
所以标记是「宽屏 / 16:9 / 每格」；`drama-short` 写的是「先立角色圣经、冻结定妆卡」，
所以标记是「圣经 / 静态特征 / 动态特征 / 禁改 / 定妆」。

## 这份题库的已知局限（写在前面，别当结论用）

1. **标记会漏报**。S07 那一轮回答里写满了「过肩 / 正反打 / 180° 轴线 / 中近景 / 平视 / 固定机位」——
   技能用得非常明显，但标记里写的是「中景」，而「中近景」不含「中景」这个子串，于是判成没命中。
   所以 `skillVisible` 是一个**下界**。
2. **对照组会自己去读技能**。N01/N02/N03 三句都自主 `read_skill` 读到了**正好对的**那条技能
   （`curated-film-storyboard` / `drama-short` / `brand-promo`）——`<available_skills>` 索引 + `read_skill`
   这条发现路径是通的。所以对照组不是「没有技能知识」的对照，它是「模型自己找 vs 用户亲手点」的对照。
   这恰好是本次最关键的那个发现（见 [`principles-hypothesis.md`](principles-hypothesis.md)）。
3. **n=4 的对照组读不出差别**。三轮 owner 臂里它在 2/4、3/4、3/4 之间跳；别拿它算效应。
4. **`回合成功率` 在这份题库里被「先读哪个」主导**。S07/S10 的两次回落都是
   「read_script 和 look_at_canvas 谁先」这种顺序抖动，不是质量变化。技能维度要看 `skillVisible`。
5. **入参证据只在真的调了 draft/arrange 的那一轮才有机会**。11 句里 2 句（S02/S09）整轮只做了读，
   那两格是「没发生」不是「没做到」。

## 怎么复跑

```bash
set -a && . ~/.nomi-secrets.env && set +a
# 现在这条线（单一 owner + pi 信封 + 出片原则）
NOMI_R30_BANK=docs/evidence/2026-09-15-skill-real-run/skill-bank.json \
  npx tsx tests/system/agent-tool-face-real-model.mjs
# 2026-09-14 的基线（逐字复现改动前那一行，只为让前后数字落在同一份判据上）
NOMI_R30_SKILL_ARM=raw NOMI_R30_BANK=docs/evidence/2026-09-15-skill-real-run/skill-bank.json \
  npx tsx tests/system/agent-tool-face-real-model.mjs
```

一套 harness 两个题库（动词面 42 句在 `docs/plan/agent-tool-face-v2-evidence/r30-bank.json`）。
不另开第二个脚本：判据一分叉，「修好了」在哪一份里成立就说不清了。
题库登在 `tests/system/agent-tool-face-usecases.json` 的 `banks` 里，
`check:agent-tool-face-usecases` 会核每一条 `skillKey` 真的装着、真的能在 composer 里选中。
