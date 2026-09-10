# Nomi 库封面插画规则

状态：2026-09-09 第三轮已授权；GPT Image 2，原隐喻表，风格硬门，累计预算 ¥60。

## 目的与媒体顺序
卡片先让用户看懂会做什么。真实产物 > 统一规则插画；插画只解释用途，绝不当作模型生成效果样例。标题由 UI 叠字，图内不写字。和 v4 技能 chip hover 视频共用同一媒体。

## 从 token 派生
`src/design/tokens.ts:1` → `src/theme/nomiTheme.ts`；颜色真值在 `src/theme/nomi-tokens.css:3`：

| 色彩角色 | token | 锚图取值 |
|---|---|---|
| 纸 | --nomi-paper | oklch(1 0 0) |
| 墨 | --nomi-ink | oklch(0.22 0.01 80) |
| 唯一强调色 | --nomi-accent | oklch(0.55 0.13 250) |

脚本每次读取 token，色值不在脚本复制。每张 2–3 色，强调色只用一种（蓝），块数随隐喻 1–2 块。深色 UI 翻转界面 token，媒体不套滤镜改色。

## 构图、隐喻与禁项
横向 16:9，中心概念占约一半画面；最多五个主要几何形，留纸色空间。只用平面几何、与锚图一致的墨线和 1–2 块同色蓝形，避免复杂纹理。

| 用户任务 | 一个概念、一个隐喻 |
|---|---|
| 三视图/一致性 | 同一个矩形展开为三张卡 |
| 分镜 | 连续的三格画框 |
| 运镜 | 围绕一个物体的弧线 |
| 修图/扩图 | 一块画面自然接上缺口 |
| 去 AI 感 | 规则形边缘的一处细小自然变化 |
| 剧本 | 两个几何物体间的一条动作线 |

禁：人脸、文字、数字、水印、模型绘制标题、多隐喻拼贴、3D 渲染、渐变光效、装饰性闪光。不要借用品牌标志或照搬 Anthropic 某张具体插画。

## 三张候选与人工判读
[接触表](covers/contact-sheet.png)。原图：

1. [anchor-1.png](covers/anchors/anchor-1.png)：扇形纸卡，最接近“一体多视”；细节略多。
2. [anchor-2.png](covers/anchors/anchor-2.png)：物体绕中心排列；出现星形装饰，偏离禁项，不推荐作为量产锚图。
3. [anchor-3.png](covers/anchors/anchor-3.png)：矩形穿过三格画框，结构最克制，推荐；底色有轻微暖纸纹理，量产保留此纸底与墨线粗细。

三张都亲眼检查；模型未精确满足全部规则，以上偏差明确保留供选择。2026-09-09 用户已选锚图 3。15 个收录技能保留原仓真实配图；仅 40 个效果生成插画。

## 第三轮脚本、契约与验收

`node scripts/covers/generate-covers.mjs --dry-run` 检查缺图提示词；`pnpm exec electron scripts/covers/generate-covers.mjs` 生成候选。完成下载后仍须逐张目检通过才能登记 preview。已有三张保持。

官方规范：https://docs.apimart.ai/en/api-reference/images/gpt-image-2/generation.md ；模型 `gpt-image-2`，POST `/v1/images/generations`，`size:16:9`、`resolution:1k`、`n:1`，锚图 3 通过 `image_urls` 的 base64 data URI 发送，触发图生图。仓库档案 `input_urls` → APIMart `image_urls` 的映射见 `electron/catalog/apimartImages.ts:132`，不是直接把档案键当报文字段。

官方市场价格：https://apimart.ai/api/marketplace/models?keyword=gpt-image-2&page_size=10 ，本次查询起价 $0.0085/次，按分辨率计费。逐张收据记报价、provider cost、余额差、时间与任务 ID；实付以账户扣减证据为准，共享账户活动可能污染差值。预算换算按保守 8 CNY/USD，不声称银行卡结算汇率。

用户 09-09 02:15 最新裁决优先：原表保留，不先简化；每条最多两次，均不达标才简化该条再一次。风格硬门是浅暖纸底、墨线、仅蓝色强调 1–2 块、无字无人脸；隐喻只需读得出与取景/镜头/画面相关，不逐字对答案。未通过保持灰格。累计上限 ¥60，未决请求阻断后续提交；每次至少预留 $0.15，保留全部返工支出。

应用密钥只在 Electron 进程内通过现有 readCatalog/decryptApiKeyRecord 读取，不落收据或输出；沿用依赖、不装包。

## 锚图 3 定稿 + 每条效果的隐喻词

2026-09-09 用户选定 `covers/anchors/anchor-3.png`。参考图固定走 image_urls；只替换下表几何隐喻，标题仍由 UI 叠字。主会话 09-09 01:05 裁决：强调色只用一种（蓝），块数随隐喻 1–2 块；以锚图纸底、墨线和蓝色为准，无需再次确认。

| 条目 | 效果 | 几何隐喻 |
|---|---|---|
| effect-camera-01 | 空镜转场 | 两个空取景框之间，一块窄矩形搭桥 |
| effect-camera-02 | 过肩对话 | 一个近处大圆弧挡住画框一角，框内一个小矩形 |
| effect-camera-03 | 特写情绪 | 一个小取景框裁切一个放大的圆形 |
| effect-camera-04 | 推轨跟拍 | 三个逐渐变小的取景框沿一条直线排列 |
| effect-camera-05 | 仰拍起势 | 一个下窄上宽的梯形框包围竖直长矩形 |
| effect-camera-06 | 俯拍众生 | 一个倾斜平面框俯罩三个小圆片 |
| effect-camera-07 | 摇镜扫景 | 一个横向长框配一条扫过半圆的弧线 |
| effect-camera-08 | 移轴虚化 | 一个宽框被两条平行线夹出窄带，带内一小方块 |
| effect-camera-09 | 逆光剪影 | 一个纸色大圆背后托出一块实心矩形 |
| effect-camera-10 | 手持跟拍 | 两个略微倾斜的框沿轻微折线追随一个小方块 |
| effect-camera-11 | 慢动作升格 | 三个紧挨的轮廓圆逐步铺开，末端一个实心圆 |
| effect-camera-12 | 快动作降格 | 三个间隔很远的窄矩形沿一条横线跳跃 |
| effect-camera-13 | 焦点转换 | 两个远近不同的框之间，一条连线将注意力交给小圆 |
| effect-camera-14 | 画框构图 | 三层嵌套矩形框，最内层一个小色块 |
| effect-camera-15 | 对角线构图 | 一个矩形框内，一条斜线连接对角与一块三角形 |
| effect-camera-16 | 绝对对称 | 一条中轴两侧各一个相同空框，中轴一个圆片 |
| effect-camera-17 | 三分法构图 | 一个空框以两横两竖分割，一个交点落一小圆片 |
| effect-camera-18 | 前景遮挡 | 一个大纸色矩形遮住后面小方块的一半 |
| effect-camera-19 | 后景虚化 | 前面一块实心方形，后面两个稀疏断线空圆 |
| effect-camera-20 | 前景虚化 | 前面一个大断线空圆，后面小框内一块清晰方形 |
| effect-camera-21 | 长镜头一镜到底 | 一条连续不间断的曲线穿过三个空框 |
| effect-camera-22 | 蒙太奇剪辑 | 三个错位短画框，接缝处一块斜切矩形 |
| effect-camera-23 | 叠化转场 | 两个部分重叠的空框，交叠处仅一块实心区域 |
| effect-camera-24 | 闪白转场 | 两个小画框之间留一个宽纸白空框，一角有小色块 |
| effect-camera-25 | 黑场转场 | 两个细线空框之间一个墨色实心框，边上小色条 |
| effect-camera-26 | 匹配转场 | 两个相邻画框内相同位置的圆，一空心一实心 |
| effect-camera-27 | 声音转场 | 一条连续波形线跨过两个画框，连接一个小色块 |
| effect-camera-28 | 主观视角 | 两条从画面近端汇聚的斜线指向远端小方块 |
| effect-camera-29 | 客观视角 | 一个独立小框从侧面完整容纳圆和方块 |
| effect-camera-30 | 上帝视角 | 同心圆环俯罩十字平面中心的一块小方形 |
| effect-character-three-view | 人物三视图 | 三个并排的空圆头长方身几何框，下方一条短色带 |
| effect-expression-grid | 表情九宫格 | 一个九格空方框，只有中央格填色 |
| effect-fill-outpaint | 自然扩图 | 一个空画框的缺角被一块严丝合缝的矩形接上 |
| effect-natural-texture | 去 AI 感 | 一张平滑几何纸片卷起一角，露出细墨线纹理与小色片 |
| effect-object-six-view | 物件六视图 | 一个展开成六面的空心立方体纸网，只有一个面填色 |
| effect-overhead-view | 俯视构图 | 一个平面矩形内俯看圆盘与方块，四周留白 |
| effect-restore-drawing | 旧图重绘 | 一个断线矩形逐步接为完整墨线框，缺口用小色块连接 |
| effect-scene-three-view | 场景三视图 | 三个相邻空框内，同一折角以三个方向展开 |
| effect-storyboard-panels | 宽屏分镜 | 三个横向宽画框顺序排列，中间框有一小矩形 |
| effect-transfer-expression | 参考表情 | 两张几何纸卡之间，一条弧线把弯曲线形传递到小色片 |

## 试产迭代

第一轮 5 张实付 $0.0625，保守折算 ¥0.50。纸底、线条与蓝色色相接近锚图，但 01/04/05 出现 3 块以上蓝形，04/05 带入锚图主体，隐喻不符。第一轮接触表保留到 `covers/rejected-trial-1/`；最终回选其中合格的 02/03，其他图标记不选用。第二轮模板只借用纸底、线条与色彩，明确禁止复制锚图构图；每条几何隐喻作为唯一主体，优先一块蓝形、最多两块。前轮曾采用最多两轮试产，第二轮不合格停止全量；第三轮由用户新裁决明确取代。

第二轮结论：配色线宽一致，04/05 隐喻仍未表达，按最多两轮停止全量。最终回选 3 张（第二轮 01，第一轮 02/03），37 张待生成；实付本次 $0.125 / 保守 ¥1.00。详细逐图路径、收据和未完成边界见 [试产报告](covers/covers-v1-report.md)。

## skill-ui-b：33 个老技能的封面隐喻

本任务单独预算 ≤¥12、最多90张；一轮生成后仅返工目检未过项一次，不沿用历史第三轮权限。既有55条真实媒体不重复付费。以下是一句话隐喻及蓝色块数，沿用锚图3纸底/墨线/唯一蓝色；不改技能正文。生成模型沿用最新已批准的 GPT Image 2，与既有37张补图同模型、同 image_urls 锚图槽。

| 条目 | 几何隐喻 | 蓝块数 |
|---|---|---|
| brand-promo | 一枚蓝色圆片置于空白矩形展台中央，两条墨线向外展开 | 1 |
| creation-edit | 一张纸色矩形中间缺一条横带，蓝色短条恰好补齐缺口 | 1 |
| director-action | 一个蓝色圆片沿拱形轨迹越过两块纸色障碍 | 1 |
| director-art-design | 一个纸色舞台框内，蓝色三角片与蓝色圆片分立两侧 | 2 |
| director-cinematography | 一个空取景框内的蓝色方片，被框外一条弧线环绕 | 1 |
| director-consistency | 三个相邻纸色画框被一条连续蓝色带贯穿 | 1 |
| director-guzhuang | 两层纸色梯形屋檐叠在一个蓝色长方形基座上 | 1 |
| director-keyframe-review | 一个纸色画框的一角压着一枚蓝色圆形印记 | 1 |
| director-performance | 一条墨线弧由平缓逐渐抬高，末端托起一枚蓝色圆片 | 1 |
| director-shot-translation | 一条墨线曲线穿过空框后变成蓝色直条 | 1 |
| director-sound | 一个蓝色圆片向右发出两道墨线半圆弧 | 1 |
| director-staging | 三个纸色圆片围绕一个蓝色方片形成三角站位 | 1 |
| director-style-otomo-wright | 三条斜向纸色速度片间插入一条蓝色短片，形成切分节奏 | 1 |
| director-transitions | 两个空画框在中间重叠，交界由蓝色窄片衔接 | 1 |
| drama-short | 两个纸色场景框之间一条折线突然转向蓝色终点方块 | 1 |
| model-integration | 两个相对的纸色接口由一块蓝色榫形几何块连接 | 1 |
| release-media-pack | 一个纸色开口盒里露出一张蓝色卡片和两张纸色卡片 | 1 |
| skill-author | 三条纸色横带汇入一张蓝色卡片 | 1 |
| workbench-creation | 一枚蓝色小圆片在纸色长方形页面上拉出一条墨线 | 1 |
| workbench-fixation-planner | 两个并排空框各钉住一枚同色蓝片，一个圆形一个方形 | 2 |
| workbench-generation | 一条墨线分叉连接两个蓝色方块 | 2 |
| workbench-storyboard-planner | 三个空画框沿一条折线依次排列，终点落一枚蓝色方片 | 1 |
| writer-adaptation | 一个纸色竖框展开成横框，蓝色小圆片贯穿两种轮廓 | 1 |
| writer-behavior-psychology | 一个纸色圆片背后藏着半枚蓝色圆片，二者以短线相连 | 1 |
| writer-dialogue | 两个纸色轮廓圆相向，一条蓝色短线横跨其间 | 1 |
| writer-improv | 两条自由墨线交会，交点向上跳出一枚蓝色方片 | 1 |
| writer-incubation | 一枚蓝色种子形几何片上生出两条墨线分枝 | 1 |
| writer-novel-digester | 三张叠放纸页的墨线汇入一枚蓝色小方片 | 1 |
| writer-review | 一张纸色页面上的墨线被一个蓝色空心圆圈住 | 1 |
| writer-screenwriter | 两个纸色几何角色沿一条动作线走向蓝色场景框 | 1 |
| writer-songfangjin | 两个纸色圆片之间牵着一条墨线，中央系一枚蓝色小方片 | 1 |
| writer-structure | 三个相接纸色拱形由中央一枚蓝色楔形块支撑 | 1 |
| writer-style-schrader | 一个高大的空矩形里，一枚很小的蓝色方片独处在底边 | 1 |
