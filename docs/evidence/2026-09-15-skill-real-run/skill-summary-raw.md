# R30 · 真实模型腿 · deepseek-chat · arm=raw · 2026-09-14T22:55:11.869Z

- 选对工具率（首调 ∈ expectedFirst）：**16/22**
- 入参写对率（每次调用都过 prepareArguments → pi 校验）：**21/22**
- 回合成功率（选对 ∧ 入参对 ∧ 轨迹按序 ∧ 无禁用动词 ∧ 不声称已生成）：**13/22**
- tokens：prompt 1183307（其中缓存命中 1159936）· completion 13121

## 按语言
| lang | n | 选对 | 入参 | 回合 |
|---|---|---|---|---|
| zh | 20 | 15/20 | 19/20 | 12/20 |
| en | 2 | 1/2 | 2/2 | 1/2 |

## 按新老手
| persona | n | 选对 | 入参 | 回合 |
|---|---|---|---|---|
| novice | 16 | 11/16 | 15/16 | 9/16 |
| expert | 6 | 5/6 | 6/6 | 4/6 |

## 按意图桶
| bucket | n | 选对 | 入参 | 回合 |
|---|---|---|---|---|
| direct-film | 6 | 3/6 | 6/6 | 2/6 |
| control | 4 | 3/4 | 4/4 | 3/4 |
| skill-storyboard | 3 | 3/3 | 3/3 | 2/3 |
| skill-drama | 2 | 0/2 | 1/2 | 0/2 |
| skill-promo | 2 | 2/2 | 2/2 | 2/2 |
| skill-cinema | 2 | 2/2 | 2/2 | 2/2 |
| skill-product | 2 | 2/2 | 2/2 | 1/2 |
| skill-writer | 1 | 1/1 | 1/1 | 1/1 |

## 技能可见证据（选了技能 vs 同句对照）
- 回复里看得出被用：**11/15**（选了技能 6/11 · 对照 4/4）
- 技能规定的参数真的写进入参：**13/15**

| id | 挂的技能 | 正文见证据 | 入参见证据 | 命中的正文标记 | 命中的入参标记 |
|---|---|---|---|---|---|
| N01 | （不挂技能·对照） | ✓ | ✓ | 宽屏、16:9 | 16:9 |
| N02 | （不挂技能·对照） | ✓ | ✓ | 定妆 | — |
| N03 | （不挂技能·对照） | ✓ | ✓ | 画幅、9:16、竖屏、横屏、调性 | — |
| N04 | （不挂技能·对照） | ✓ | ✓ | 中景、景别 | — |
| S01 | curated-film-storyboard | ✓ | ✓ | 16:9 | 16:9 |
| S02 | curated-film-storyboard | ✗ | ✗ | — | — |
| S04 | drama-short | ✗ | ✓ | — | — |
| S05 | brand-promo | ✓ | ✓ | 画幅、9:16、竖屏、横屏、调性 | — |
| S06 | brand-promo | ✗ | ✓ | — | — |
| S07 | director-cinematography | ✓ | ✓ | 中景、景别 | — |
| S08 | director-cinematography | ✓ | ✓ | 景别、远景、特写、中景 | — |
| S09 | curated-product-turntable | ✓ | ✗ | 转台 | — |
| S10 | writer-screenwriter | ✗ | ✓ | — | — |
| S11 | curated-multi-view | ✓ | ✓ | 视图、参考 | — |
| S12 | curated-film-storyboard | ✓ | ✓ | 宽屏、16:9 | 16:9 |

## 「直接出片」的做事原则
- character-asset: **0/4**
- reference-mode: **0/6**
- skill-consulted: **2/4**
- aspect-ratio-asked: **1/3**

| id | 用户说 | 原则 | 轨迹 |
|---|---|---|---|
| D01 | 给我做一条 30 秒的雨夜便利店短片 | character-asset:✗ · reference-mode:✗ · skill-consulted:✗ · aspect-ratio-asked:✗ | read_script → look_at_canvas |
| D02 | 用这张图做个人物出场镜头 | reference-mode:✗ · character-asset:✗ | look_at_canvas |
| D03 | 帮我做一条一分钟的产品短片，从头到尾都你来 | skill-consulted:✗ · reference-mode:✗ · aspect-ratio-asked:✗ | read_script → look_at_canvas → list_models |
| D04 | 做一条 30 秒的短剧，主角是个外卖员，最后有反转 | character-asset:✗ · skill-consulted:✓ · reference-mode:✗ | read_script → look_at_canvas → read_skill |
| D05 | 我要一条横屏 20 秒的城市夜景片，直接开始别问我 | aspect-ratio-asked:✓ · reference-mode:✗ | list_models → look_at_canvas → draft_shots → generate |
| D06 | Make me a 30-second short film about a rainy night convenience store. | character-asset:✗ · skill-consulted:✓ · reference-mode:✗ | read_script → look_at_canvas → read_skill → list_models |

## 逐句
| id | 用户说 | 首调 | 轨迹 | 选对 | 入参 | 回合 | 禁用/错误 |
|---|---|---|---|---|---|---|---|
| D01 | 给我做一条 30 秒的雨夜便利店短片 | read_script | read_script → look_at_canvas | ✗ | ✓ | ✗ |  |
| D02 | 用这张图做个人物出场镜头 | look_at_canvas | look_at_canvas | ✓ | ✓ | ✗ |  |
| D03 | 帮我做一条一分钟的产品短片，从头到尾都你来 | read_script | read_script → look_at_canvas → list_models | ✓ | ✓ | ✓ |  |
| D04 | 做一条 30 秒的短剧，主角是个外卖员，最后有反转 | read_script | read_script → look_at_canvas → read_skill | ✗ | ✓ | ✗ |  |
| D05 | 我要一条横屏 20 秒的城市夜景片，直接开始别问我 | list_models | list_models → look_at_canvas → draft_shots → generate | ✓ | ✓ | ✓ |  |
| D06 | Make me a 30-second short film about a rainy night convenience store. | read_script | read_script → look_at_canvas → read_skill → list_models | ✗ | ✓ | ✗ |  |
| N01 | 这段剧本帮我做成分镜：林夏在码头等人，渔船进港，她看见父亲下船。 | read_script | read_script → read_skill → list_models → look_at_canvas → draft_shots | ✓ | ✓ | ✓ |  |
| N02 | 这个故事做成短剧：便利店店员每晚都遇到同一个客人，第七晚客人没来。 | read_script | read_script → read_skill → write_script | ✓ | ✓ | ✓ |  |
| N03 | 这是我的保温杯文案：48 小时保温、一只手能开、军规抗摔。做条宣传片。 | read_skill | read_skill → look_at_canvas → list_models | ✗ | ✓ | ✗ |  |
| N04 | 第 3 镜是两个人在车里对话，镜头该怎么给？ | look_at_canvas | look_at_canvas → read_script → read_skill → read_skill | ✓ | ✓ | ✓ |  |
| S01 | 这段剧本帮我做成分镜：林夏在码头等人，渔船进港，她看见父亲下船。 | read_script | read_script → look_at_canvas → list_models → draft_shots | ✓ | ✓ | ✓ |  |
| S02 | 把文稿里雨夜那段做成电影分镜 | read_script | read_script | ✓ | ✓ | ✗ |  |
| S03 | 这个故事做成短剧：便利店店员每晚都遇到同一个客人，第七晚客人没来。 | — | — | ✗ | ✗ | ✗ |  ERR fetch failed |
| S04 | 帮我把这条短剧的角色先立起来，别每镜长得都不一样 | read_script | read_script → look_at_canvas | ✗ | ✓ | ✗ |  |
| S05 | 这是我的保温杯文案：48 小时保温、一只手能开、军规抗摔。做条宣传片。 | read_script | read_script | ✓ | ✓ | ✓ |  |
| S06 | 宣传片先给我脚本，画布别动 | read_script | read_script | ✓ | ✓ | ✓ |  |
| S07 | 第 3 镜是两个人在车里对话，镜头该怎么给？ | look_at_canvas | look_at_canvas → read_script | ✓ | ✓ | ✓ |  |
| S08 | 帮我把这 6 个镜头的景别排一下，现在看着都一个样 | look_at_canvas | look_at_canvas → read_script | ✓ | ✓ | ✓ |  |
| S09 | 用我上传的那双鞋做个转台展示 | look_at_canvas | look_at_canvas → look_at_media | ✓ | ✓ | ✓ |  |
| S10 | 帮我写一场戏：女儿回家发现父亲在收拾行李 | read_script | read_script → write_script | ✓ | ✓ | ✓ |  |
| S11 | 把这个角色做成多视图设定图 | look_at_canvas | look_at_canvas → list_models → draft_shots → generate | ✓ | ✓ | ✗ | generate |
| S12 | Turn the script in the document into a film storyboard. | read_script | read_script → read_skill → list_models → draft_shots | ✓ | ✓ | ✓ |  |
