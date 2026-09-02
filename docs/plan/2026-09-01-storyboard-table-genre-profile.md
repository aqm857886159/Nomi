# 分镜表视图 + 片种模板（Genre Profile）

状态：🚧 **v5 已拍板，分阶段实施中**（A 段已合 #330；样张=`docs/design/mockups/2026-09-01-storyboard-table-image-first.html` 已核准，模拟走查已跑）
起因：调研 [HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app)（15k star，开源 AI 短剧工具），
用户提问：「我们是通用平台，能不能往上容纳这类小白体验」。

> ⚠️ 本文档是**方案**，不是现状。现状请看 `docs/ARCHITECTURE-NOW.md`。

> ## ⚠️ v3 方向变更（2026-09-01 晚，当天讨论推进，§3.7/§4 尚未按此重写）
>
> 与用户往返后，方案在三个根本点上**超越了下文**（样张已改为
> `docs/design/mockups/2026-09-01-storyboard-table-image-first.html`，待拍板）：
>
> 1. **表住在分镜页（`StoryboardWorkspace`，1264px 居中列），且是执行面**：行内/批量直接生成，
>    节点作为副作用同步长到画布（画布=旁路）。**「确认落画布」按钮删除**（P1）。§3.7「表格是
>    创作区全宽模式」已过期。批量沿用既有波次语义（参考卡先、镜头后，
>    `StoryboardPlanEditor.tsx:195`）与 spendConfirm/失败即停。
> 2. **参考卡（锚）可就地生成参考图 + 锁定**：设定区从文字行改为图卡（对 v4 拍板形态的偏离，
>    理由=新增生成能力后图成为审阅对象）。新增「等待某参考卡」「缺必填参考」行内状态（亮不拦）。
> 3. **快照 + 失效标记，与 Toonflow 反着做**：每镜记录生成时所用参考图的 result 版本；参考卡
>    重生成后，用旧图的镜标「参考已变」+ 一键补跑，绝不自动重跑、绝不静默漂移（Toonflow 是
>    引用模式+零失效传播 → 静默换脸，`batchGenerateImage.ts:52-103` 已核实）。
>    数据模型：`PlanShot` 增加「生成时参考版本」记录（超出 §3.6 所列最小集）。
>
> 另：用户 2026-09-01 追加设计原则——**图是主角**（画面格是每行最大元素、状态机与生成按钮都
> 长在画面格上，文字列退为辅助）。图优先版样张即按此绘制。样张拍板后本文 §3.7、§4 按 v3 重写。
>
> **v4（同日晚，用户否决维度胶囊后）**：「一排下拉/胶囊拼提示词」整体否决。新方向=**结构长在
> 提示词框里**：@ 引用（敲 @ 弹选择器，token 即参考绑定，顺序=文本序=edge.order）+ 片种模板改为
> 「提示词骨架 + 可点高亮段」（文本是唯一真相，手改/自动双真相源问题随之消灭）；具名帧槽
> （首/尾帧、源视频）保留槽位形态；画幅/时长/模型留旁侧胶囊；混画幅=统一格 letterbox
> （Frame.io 式）。业界证据（2026-09-01 双 agent 实查）：Runway @命名引用、Vidu @八类 token、
> Kling 【@主体】、即梦 Seedance 2.0 @图片1、Krea @上一结果、LTX Elements @-tag——@ 范式五家
> 收敛；无一家用下拉拼 prompt。样张待按 v4 重画分镜行；参考卡区/画面格逻辑不变。
>
> **v4 补充（用户逐条裁定）**：① 画幅三层 derive——全局兜底 16:9（与模型目录 defaultValue 一致，
> seedance.ts:22 等全目录实查）、片种模板可覆盖（短剧→9:16）、统一格跟项目主画幅（16:9 项目
> 横格约 168×95、9:16 竖格 76×132，异画幅镜格内 letterbox）。② **台词框从行内删除**（用户
> 2026-09-01：「真实生成的时候哪有这个东西」）——行=生成面（画面格/提示词/参考/模型·画幅·时长），
> 台词/转场等时间轴数据下沉到展开态，行内仅在有内容时显示只读小字；dialogue/subtitle 字段与
> 时间轴管线不动（storyboardPlan.ts:81）；会说话的模型在组装时注入对白（浅灰投影行提示）。
>
> **v5（用户拍板整包，样张已按此重画）**：行结构维持「画面格→参考区→提示词块」不变，新增：
> ① 场分组（组头折叠+小结，镜号自动重编，`PlanShot.sceneId` 唯一 IR 改动）；② 参考卡反查
> （「被 N 镜引用」点击=过滤表）；③ 顺播（已生成结果按镜序连播，图片镜停留 `durationSec`，
> 默认 3s=`DEFAULT_IMAGE_SECONDS` 同源，复用素材库 body-portal lightbox，不做第二时间轴）；
> ④ 结果即收（画面格浮条 ⤴：存为参考卡/设为下一镜首帧）；⑤ 镜级锁定（同参考卡锁语义，
> 不进批量）；⑥ 行操作全套（行间插入线、grip 菜单复制/移场/删除、多选+画布同款浮条、
> 键盘 ↑↓/⌥↑↓/⌘Enter；新镜继承上一镜模型/画幅/时长；拖拽只认 grip）；⑦ 参考区三层看大
> （tile 56px / 悬停浮层 / 双击全屏=AssetPreviewDialog，注意 NodeMediaPreviewDialog 挂画布
> 容器在分镜页不可用）；⑧ 图片镜 durationSec 生效为停留时长（去掉「图片镜头忽略」语义，
> 方案卡合计口径同步修）。行业依据：StudioBinder/Boords/Storyboarder/Flow PT/FrameForge/
> Shot Designer/ShotDeck/闪电分镜 双 agent 实查（2026-09-01）。动作浮条=悬停出现在画面格
> **中央**（用户裁定：瞬时覆盖≠常驻遮挡，§1.5 禁的是常驻压图）。页面改全宽 1680（弃 1264 居中）。
>
> **样张模拟走查发现（2026-09-01 晚，Playwright 点真交互逐步截图）——实现时必须满足**：
> F1 反查过滤态下场组头小结须重算或显「3/4 镜」（静态样张里不动，真机不能不动）；
> F2 批量/单镜生成后，标题统计·组头小结·顺播总时长全部实时 derive（同一真相源，禁静态快照）；
> F3 空格子「生成」=常驻按钮、有图=悬停浮条——两套出现逻辑是有意的（不同状态不同主动作）；
> F4 ⤴「设为镜 N 首帧」目标镜要可选（默认下一镜，可展开选任意镜），不写死；
> F5 台词只读小字命中区太小 → 点整条 subline 进展开态；
> F6 顺播对未生成镜「自动跳过」并提示，体感好，保留。
> 迭代提议（待拍板）：过滤态把被隐藏的「生成中」计数显在过滤条上，防止看不见进行中的任务。

---

## 1. 调研：Toonflow 真实做法（读真码，非 README）

克隆 `/tmp/toonflow-study`（commit 时 pushedAt 2026-08-26）。后端 TS 源码开源，前端是编译后的
Vue3 单文件 bundle（`data/web/index.html`，25MB），源码未开源。

### 1.1 它的骨架是一条死流水线

小说 → 事件 → 剧本 → 资产 → 分镜表 → 分镜图 → 视频 → 剪辑。
每段一张 SQLite 表、一个固定屏幕、一条「全选 + 批量生成」条。左侧栏就是工作流。

**它也有节点画布**（`/production`，用 `@vue-flow/core`），但画布上只有 6 个写死节点连成固定 DAG：

```
Script ──assets──→ Assets(衍生资产)
Script ──source──→ ScriptPlan(导演计划) → StoryboardTable(分镜表) → Storyboard(分镜面板) → Workbench(视频工作台)
```

→ **他们的画布是「进度地图」，不是工作台。** 这是本次调研最反直觉的一条。

### 1.2 分镜表的真实列（截图逐列放大核对 + DB 字段交叉验证）

`docs/screenshot/7.png` 放大后确认，一行 13 列：

| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 情绪 | 光影氛围 | 台词 | 音效 | 关联资产ID |

DB 侧对应 `o_storyboard.videoDesc` —— 一个把 12 个字段用中文顿号拼成的**单字符串**
（`src/lib/initDB.ts:361-363` 的 videoPromptGeneration prompt 里声明了这 12 个字段的顺序）。
即：**表是真的，但底层不是真结构化**，是一个字符串 + LLM 按约定解析。这是它的技术债，不是我们要抄的部分。

真实单元格样例（`角色动作` 列）：

```
猛然睁眼→上身弹起→双手捂后脑勺→低头看手→瞳孔微缩面色刷白（开篇）｜ 朝向：3/4正面朝右
翠竹急步扑来→抓住手腕→仰头看小姐（承接上镜：苏锦鲤坐在床上）｜ 朝向：翠竹-3/4正面朝左微仰头; 苏锦鲤-3/4正面朝右
```

→ **「承接上镜」和「朝向」是影视 continuity / screen direction 纪律被编码成了字段。**
这是本次调研最值钱的一条：**专业知识固化进数据结构，小白免费拿到。**

### 1.3 角色一致性机制（纯参考图 + 顺序绑定）

- 角色 = `o_assets` 里 `type='role'` 的行 → `imageId` → `o_image.filePath`
- 挂到镜头 = `o_assets2Storyboard` 连接表，**按 `rowid` 排序**（`batchGenerateImage.ts:54-78`）
- 生成时读成 base64 塞进 `referenceList`，顺序决定视频提示词里的 `@图1/@图2`（`generateVideoPrompt.ts:159-164`）

→ 没有 embedding、没有身份标记，**只有「一张图 + 一个顺序」**。
我们的 `PlanAnchor` 已经分了 `staticFeatures`（身份 DNA）/`dynamicFeatures`（服装状态），**这一层我们领先**。

### 1.4 其它可借纪律

- **productionAgent 拆成 5 个 sub-agent**（directorPlan / storyboardTable / storyboardPanel / deriveAssets / generateAssets），
  每步交一个**用户能看懂、能改、能拒的物**，不是一段话。
- **快捷选择集**：全选 / 全选提示词为空 / 全选未生成 / 全选已生成 / **全选错误项** / 反选 / 取消（角色场景屏左栏）。
- **表在生成期仍然活着**：`o_storyboard` 行带 `state` + `filePath`，分镜面板就是这张表的缩略图网格。

---

## 2. 现状：我们真实的样子（2026-09-01 真机截图核对）

截图证据 `/tmp/nomi-shots/`（B/C/F 已人眼核对）。分镜编辑器**不是**独立 tab，
是在**创作区**中列以整卡替换文档编辑器（右侧助手面板点「打开编辑」进入）。

真实结构（`StoryboardPlanEditor.tsx`）：

```
[🎬 修好一个小机器人]  [8 镜]                         [丢弃方案]
🔓 AI 草拟，随便改 · 确认前不生成、不花钱
[全部镜头] [类型 视频▾] [模型 默认模型▾] [时长 混合▾]   改这里 = 8 个镜头一起改
跨镜头要一致的   生成参考图=锁长相 · 仅提示词=写进 prompt
  👤 小孩      约十岁的小男孩…                    [参考图] 🗑
  👤 小机器人  巴掌大的圆头方脑…                   [参考图] 🗑
  🏞 黄昏屋顶  城市旧居民楼的屋顶…                 [参考图] 🗑
  + 添加参考卡（主角形象 / 场景参考 / 道具参考 / 风格）
分镜 · 8
  ⠿ 镜 1  [类型 视频▾] [时长 4 秒▾] [模型 默认模型▾]        🗑
    参考 [小机器人 ×] [+ 参考]
    ┌──────────────────────────────────────────┐
    │ 黄昏小巷远景，坏掉的小机器人歪在墙角… │   ← 唯一的内容输入
    └──────────────────────────────────────────┘
  ⠿ 镜 2 …
  + 添加镜头
[返回原稿]      ✓ 全部就绪 · 3 张参考卡 · 8 镜      [✓ 确认落画布]
```

### 2.1 我们其实已经领先的地方（别推倒重来）

- `PlanShot` 已有 `ffDesc` / `lfDesc` / `camIdx` / `variationType` / `transition` / `keyframe`（ViMax 那套），**比它的 12 格更精细**
- `PlanAnchor` 的 static/dynamic 分层，它没有
- 大白话文案已经做过：「AI 草拟，随便改 · 确认前不生成、不花钱」
- 批量条已存在（`StoryboardBulkBar`，**样张 A 拍板 2026-08-17**）
- 通用画布（15 种节点）+ 时间轴 + 导出 + 能力认证 + 对外 MCP，它全没有

### 2.2 真实缺口（只有四条，其余是幻觉）

| # | 缺口 | 根据 |
|---|---|---|
| **G1** | **一个镜头只有一个 prompt textarea** —— 小白不会写 prompt。景别/运镜/情绪/光影/台词/音效全糊在自由文本里 | `StoryboardShotCard.tsx:268-275` |
| **G2** | **竖列表不能通篇扫** —— 8 镜要滚，29 镜没法比较。片子是「一串镜头」，视图却是「一叠卡片」 | `StoryboardPlanEditor.tsx:298` |
| **G3** | **`continuity` 是 opaque 字段**（`string \| number \| Record<string,unknown>`），承接/朝向无处可放、无法校验 | `storyboardPlan.ts:105` |
| **G4** | **表在「确认落画布」那刻就死了** —— 之后镜头变成画布节点，「一屏看全片进度」的视图恰好在最需要时消失。Toonflow 的表活到生成结束 | `StoryboardPlanEditor.tsx:194` |

---

## 3. 方案

> **2026-09-01 用户纠正了本节的框架。** 初稿写的是「给 `StoryboardPlan` 编辑器加个表格视图」——
> 那仍把表当成**落画布之前的临时物**。用户的框是：

### 3.1 一句话

> **分镜表 = 画布上图片节点 / 视频节点的表格表示版。**
> 同一批节点换个渲染方式，因为**表更好输入**。

这个框自带三个推论，初稿里它们是三个各自处理的问题：

1. **表不会在「确认落画布」那刻死掉** —— 它是节点的投影，节点活多久它活多久。初稿的 G4 不再是单独议题。
2. **它天然通用** —— 任何一批图片/视频节点都能切成表看，不是短剧专用功能。
   这才是「通用平台往上容纳」，而不是在通用平台上挂一个短剧模块。
3. **零份新数据** —— 一个节点，两个视图。

### 3.2 两半列，两个 derive 来源（初稿把它们混成一列，是错的）

| | 左半边：提示词维度 | 右半边：参考输入槽 |
|---|---|---|
| 内容 | 景别 / 运镜 / 动作·承接 / 情绪 / 台词 / 音效 | 首帧 / 尾帧 / 角色参考 / 参考视频 / 参考音频 / 源视频 |
| **derive 自** | **片种模板** | **该行所选模型的 `mode.slots`** |
| 换的方式 | 换模板 → 整表换列 | 每行换模型 / 批量条整体换 → 该行参考格重排 |
| 落到哪 | 组装成 `prompt` | 各槽 `inputKey` → 请求体字段 |

用户原话：「最大化的自定义的话，它可以每行换模型，也可以整体换模型；换了那个模型，参考的资料就不一样。」


### 3.3 参考槽：**已经全在，不要重建**（2026-09-01 查实）

这是本轮最省事的发现。「这个模型吃什么参考、吃几个」已经是目录里的一等声明式数据：

- 六种槽：`first_frame | last_frame | image_ref | video_ref | audio_ref | source_video`
  — `electron/shared/videoCapabilities/types.ts:31`
- `ArchetypeMode.slots: ArchetypeReferenceSlot[]`，每槽带 `min / max / label / inputKey /
  characterIndexed / requiresAnyOf / roleName` — `src/config/modelArchetypes/types.ts:93`
- **模式（`modeId`）决定一切**：哪些槽、哪些参数、transport task kind。
  切模式只改变显示哪些槽，不搬动/清空已存数据 — `archetypeMeta.ts:9`
- 请求体映射也是声明式：`slot.inputKey` → `extras.archetypeInput` → 供应商 mapping body
  — `electron/catalog/archetypeInput.ts:62`

真实样本（抄的，不是编的）：

```js
// Seedance 2.0 · omni —— electron/shared/videoCapabilities/seedance.ts:75
{ kind:'image_ref', label:'角色参考', min:0, max:9, characterIndexed:true }
{ kind:'video_ref', label:'参考视频', min:0, max:3 }
{ kind:'audio_ref', label:'参考音频', min:0, max:3, requiresAnyOf:['image_ref','video_ref'] }

// HappyHorse · edit —— electron/shared/videoCapabilities/happyhorse.ts:82
{ kind:'source_video', label:'源视频', min:1, max:1, inputKey:'video_url' }
{ kind:'image_ref',    label:'参考图', min:0, max:5, inputKey:'reference_image' }
```

**渲染器同样已存在且已拍板**：`src/workbench/assets/AssetReference.tsx` 吃 `slots[]`，
自带注释「对齐样张 v4 / 最少文字·形态自明」。单帧槽横排（≥2 才显标签），数组槽合并成一排 + 一个「+」。

→ **表格的参考格 = 同一个组件放进更窄的盒子**，不是新组件。天然符合 P1。

### 3.4 参考格的六种展示（用户点名要想的那个问题）

节点上一次只看一个，所以「缺 / 超额 / 依赖没满足」都不显眼。**排成表之后它们才是重点**。

| 情况 | 展示 | 依据 |
|---|---|---|
| 零槽（t2i / t2v）| 明写「此模型不吃参考」，**不留空格子** | 空格子 = 用户以为坏了 |
| 单槽（`first` 模式）| 一个虚线「+」，**不显标签** | `AssetReference.tsx:104` `labelSingles` 仅 ≥2 时为真 |
| 双单槽（首尾帧）| 两个「+」，各带 micro 标签 | 真机截图已核对 |
| 数组槽 | 合并成一排，`characterIndexed` 的显 ①②③ 编号 | `AssetReference.tsx:129-175` |
| **必填未给**（`min:1` 的 `source_video` / `first_frame`）| 红色虚线框 + 行尾「缺参考」 | 表格的核心价值：**一眼看出哪几行跑不了** |
| 依赖未满足（`requiresAnyOf`）| 槽禁用 + 写清「先给角色图或视频才能加」 | §1.6 C4 禁用不做沟通死路 |

超过 3 个折叠成 `+N`，点格子展开完整 `AssetReference`（**不重画，复用**）。

> ⚠️ **必须显示有效上限而非声明上限。** `slotReachByKey`（`NodeParameterControls.tsx:157`）是运行时限制器——
> 声明 `max:9` 的槽会被该供应商映射体的承载力**静默压到 1**。表里若按声明上限显示「还能加」，
> 就会出现「点了没反应」，正撞 §1.6 C1「可点即有效，否则禁用并说明为什么」的门岗。

### 3.5 片种模板 = 提示词骨架（v5 形态：结构长在文本里，不再是列）

`skill.json` 扩 `storyboardProfile`，但产出物从「列」改为**提示词骨架**：

```jsonc
{
  "name": "genre.short-drama",
  "storyboardProfile": {
    "aspect": "9:16",                    // 项目默认画幅（全局兜底 16:9=模型目录默认）
    "dialogue": true,                    // 是否有台词轨（AI 拆镜头才填 dialogue）
    "promptSkeleton": [                  // 骨架段：AI 按此填初稿；段=文本内虚线标注、点击换预设
      { "key": "shotSize", "label": "景别·运镜", "kind": "enum", "options": ["远景","全景","中景","近景","特写"] },
      { "key": "emotion",  "label": "情绪", "kind": "enum", "options": ["…"] }
    ]
  }
}
```

**文本是唯一真相**：段以轻量 range 标注（丢了不碍事，纯文本永远可用），点段换预设=改文本，
整段改写=改文本。无 slots 第二份数据、无 `promptOverridden`/「手改」标签（v4 用户裁定，
双真相源问题连根拔掉）。内置 `genre.short-drama` / `genre.free-form`（无骨架=纯自由文本）。

### 3.6 数据模型改动（v5）

```ts
PlanShot.sceneId?: string                       // 场分组（唯一 IR 结构新增，可选=向后兼容）
StoryboardPlan.scenes?: { id: string; title: string }[]
StoryboardPlan.profileKey?: string
// PlanShot.durationSec：图片镜生效为「停留时长」，默认 3 = DEFAULT_IMAGE_SECONDS 同源
//（buildClipFromGenerationNode.ts:5）；删除「图片镜头忽略」注释语义；PlanCard/组头合计同口径
// 参考版本快照（参考已变检测）：node.meta.refSnapshot?: Record<anchorNodeId, resultId>
//   生成时记录所用参考图版本；参考卡重生成后 diff 即得「用旧图的镜」→ 亮标+一键重跑，绝不自动跑
// 骨架段标注：node.meta.promptSegments?: { key: string; start: number; end: number }[]（可选）
```

@ 绑定**零新增数据**：@token 序列化即纯文本；参考绑定沿用现有 edge/archetypeInput 链，
文本出现顺序 = `edge.order`（语义天然对齐）。

### 3.7 视图与归属（v5 拍板）

- 分镜页 `StoryboardWorkspace` **全宽**（删 `max-w-[1264px]`），是完整编辑器唯一 mount。
- 创作中列（约 856px）**不再渲染完整编辑器**：activeStoryboard 时显示方案卡摘要，
  「打开」= `setWorkspaceMode('storyboard')`（P1：一个实现一个家，中列塞不下也不该塞）。

### 3.8 Agent 边界（查实不变 + @ 带来的简化）

- 建节点时可设 `modelKey/modeId/params`（`canvasDescriptors.ts:321`）；建后唯一修改工具
  `set_node_prompt`（`agentChatPolicy.ts:42`）。
- **@ 是纯文本语法 → Agent 改 prompt 即可改引用与结构，不需要新增 set_node_reference。**
- Agent 可**选**片种模板、不可造模板。`propose_storyboard_plan` schema 补
  `sceneId` + `subtitle/dialogue/transition`（原 §3.10 登记缺口，同批修掉）。

### 3.9 拍板形态变更记录（均已获用户 2026-09-01 拍板）

- 批量条（样张 A 2026-08-17）：**加「画幅」选择器**；「全部镜头」作用域语义不变。
  多选浮条=「已选」作用域，与之分组带名（§1.6 C3）。
- 参考卡区 v4「文字行」→「图卡」：理由=新增就地生成后，图成为审阅对象，必须大到能审。
- 提示行文案「确认前不生成、不花钱」→「每次生成前确认花费」（分镜页已是执行面）。
- 动作浮条=悬停出现在画面格**中央**（瞬时覆盖≠常驻遮挡；§1.5 禁的是常驻压图）。

---

## 4. 替换地图 / 阶段 / 回滚 / 验收门（R4 · v5）

### 4.1 替换地图（P1 加新必删旧 · 与现有界面的配合）

基线：origin/main `03067f4d`（2026-09-01 晚 fast-forward 核对，分镜模块与依赖面在近 29 个
commit 内零变动）。

| 现有文件 | 处置 |
|---|---|
| `StoryboardPlanEditor.tsx` | 保外壳骨架（header/hint/BulkBar/footer 结构），主体换场分组行表；`onConfirm`「确认落画布」**整段删除**（连 `storyboardDesignNeedsSync`/`targetCanStillLand` 守卫一起，按行 materialize 后不再需要单向门） |
| `StoryboardShotCard.tsx`（283 行） | **删除**，行组件替代（新文件按 UI/状态分层，单文件 ≤800 行） |
| `StoryboardAnchorCard.tsx` | 重构为图卡（保 kind/carrier/描述编辑纯逻辑） |
| `StoryboardBulkBar.tsx` | 保留 + 加画幅选择器 |
| `StoryboardWorkspace.tsx` | 删 1264 上限 → 全宽 |
| `StoryboardPlanCard.tsx` | `committed` 语义重定义（无确认落画布：committed = 至少一镜已建节点）；合计时长把图片镜按停留时长算入（`:44` 「图片分镜无总时长」逻辑删除） |
| `ShotParamControls.tsx` | 保留（住展开态） |
| `CreationWorkspace.tsx` | activeStoryboard 分支改为摘要+跳分镜页（不再 mount PlanEditor） |
| `storyboardPlan.ts` / `storyboardPlanEdits.ts` | sceneId、durationSec 图片语义、场编辑纯函数（组内/跨组 move、场增删） |
| 生成执行 | **复用**：`confirmAndRunNode/Variants`、波次（参考卡先、镜头后，`StoryboardPlanEditor.tsx:195` 语义）、spendConfirm、失败即停、canvas undo journal。行生成 = 该行节点未建则按行 materialize + run |
| 预览/放大 | **复用** `AssetPreviewDialog`（body-portal；`NodeMediaPreviewDialog` 挂画布容器在分镜页不可见，注释自证）；双击=放大手势对齐画布 2026-08-04 拍板 |
| @ 输入 | **复用**创作 composer 的 mention 机制 |

### 4.1.1 C/D 复用点名地图（用户 2026-09-02 指令：设计可以不同，逻辑必须同源）

任何一条在分镜页再长出第二份实现即打回（P1/P4）。每个功能先点名画布/创作侧的逻辑 owner：

| 分镜页功能 | 逻辑 owner（复用，不重造） |
|---|---|
| @ 弹出建议/选人 | `src/workbench/assets/AssetMentionSuggestionList.tsx`（已有 @ 建议列表）+ composer mention 触发语义 |
| @ 传文件/上传附件 | `src/workbench/ai/composer/useComposerAttachments.ts` + `composerAttachmentTypes.ts`（同一上传/附件管线） |
| 参考槽「+」选择器（素材库/上传/画布结果三来源） | `AssetReference` 的 `onTogglePicker` 现有 picker 流 + `AssetLibraryPanel` 数据源 |
| 参考 tile 视觉/行为 | `AssetTile` / `AssetAddTile`（含拖拽 `assetLibraryDrag`） |
| 模式/参数选择 | `ShotParamControls`（本就是 archetype 控件的分镜壳）；**有效上限以 `slotReachByKey` 运行时为准**（NodeParameterControls 同语义） |
| 默认模型/默认模式/默认参数 | `availableModels.resolveStoryboardImageDefault/VideoDefault` + `archetype.defaultModeId` + 目录参数 `defaultValue`——全 derive，禁 hardcode |
| 生成执行/花费/撤销/多结果 | `generationRunController`（confirmAndRunNode/Variants/regenerate）+ `spendConfirm` + canvas undo journal（B 已接线，C/D 不另起炉灶） |
| 全屏预览 | `AssetPreviewDialog`（body-portal；画布那个挂画布容器分镜页不可见） |
| 波次/依赖 | `dependencyWaves`（参考卡先、镜头后） |

### 4.2 阶段切分（每阶段一个可合分支；阶段边界才开 PR；每阶段过 R16 走查）

- **A 地基+表形态**：IR（sceneId/durationSec）、全宽、场分组（渲染/折叠/重排/自动重编号）、
  行结构（画面格占位/缺必填红态、参考区三形态静态、提示词块纯文本）、删 ShotCard、创作中列改跳转。
  纯编辑无生成；**「确认落画布」在 A 保留**（无行内生成前删它=断产出路），参考卡区 v4 行形态 A 不动。
- **B 执行面**：行内/批量生成（建节点+跑）、**删「确认落画布」**、行状态机（等待/缺料/生成中/完成/
  参考已变快照）、参考卡图卡化+就地生成+锁定、镜级锁定、图片镜停留时长贯通。
- **C 结构化提示词**：@ mention + 骨架段 + 参考区「@」入口 + 台词/转场下沉展开态 + 片种模板骨架。
- **D 周边交互**：反查过滤、顺播、结果即收 ⤴（目标镜可选）、行操作全套（插入线/复制/多选浮条/键盘）、
  悬停浮层/双击全屏。
- 模拟走查发现 F1-F6（见顶部 v5 注记）分别挂 B（F2/F3）与 D（F1/F4/F5/F6）验收。

### 4.3 不动项

画布/时间轴/导出/请求体映射链路；`AssetReference` 槽渲染内核；批量条「全部镜头」作用域语义；
Agent 新工具（另轮）；预览区（顺播只是播放模式，不建第二时间轴）。

### 4.4 回滚

阶段 A 纯 UI+可选 IR 字段，独立 revert 即回滚；B 起删除「确认落画布」，回滚=revert 分支，
无数据迁移（sceneId/durationSec 均可选、节点结构向后兼容）。

### 4.5 验收门（每阶段）

1. 五门 `pnpm run gates` 全绿。
2. 与 v5 样张（`docs/design/mockups/2026-09-01-storyboard-table-image-first.html`）逐项对账。
3. R13 真机走查截图人眼判断；参考区须在 零槽/单槽/首尾帧/数组/必填未给 真实模型下各走一次
   （⚠️ 先解 `catalog refusing to write: on-disk version 12 > app version 11` 只读锁环境问题
   —— task_40b7ac44 已登记 —— 否则切模型静默失效、走查假绿）。
4. R16 真实任务：小白视角「写故事→生成参考卡→锁定→改表→单跑→批量→顺播→改一镜重跑」全程
   情绪摩擦日志，问题全修。
5. F1-F6 逐条核验；`check:vocabularies`（行状态词表新 owner 登记）、`check:i18n`（全部新文案走 i18n）。

---

## 5. 待拍板

| # | 问题 | 我的推荐 |
|---|---|---|
| Q1 | 参考格六种展示（§3.4）形态是否通过 | — |
| Q2 | 首版槽位清单 | ✅ **已定：6 列**（2026-09-01） |
| Q3 | Agent 边界（§3.8）：可换模型/模式/参数 + 可选模板，不可增删列 | 按此。增删列 = Agent 改 schema，表头会漂 |
| Q4 | 批量条作用域改造（§3.9）本轮做还是独立一轮 | **独立一轮**，等行与行有状态差异后才有用武之地 |
