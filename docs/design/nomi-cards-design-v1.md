# Nomi 分类卡片设计 v1

日期：2026-05-25
覆盖代码版本：v0.6.1
依赖文档：
- `docs/design/nomi-design-system.md`（设计系统 v1）
- v0.5.1 audit / v0.6.0 release notes 里关于"5 个分类共用 BaseGenerationNode"的遗留差距

> 本文档目的：把"角色 / 场景 / 道具 / 声音"这 4 类节点从"跟分镜长一样的图像方块"升级成**符合各自使用情境**的卡片视觉。
>
> 流程严格按"先研究、再设计、最后实施"的顺序，避免视觉先行 / 闭门造车。

---

## §1 用户研究：4 个真实创作场景

我们做 5 分类卡片，本质是回答"用户在哪种情境下用它"。先列 4 个具象场景。

### §1.1 场景 A：15 分钟短片（个人创作）

**用户画像：** 独立创作者，单兵作战，一周内做完。

**资产规模：**
- 主角 1 + 配角 2–3
- 场景 4–5
- 道具 5–8
- 配乐 / 音效 5–10

**典型工作流：**

1. 创作区写 1500 字剧本梗概
2. 切到生成区"角色"分类，建小苏 + 妈妈 + 老师 3 个角色卡，各生成 1–2 张定型图
3. 切到"场景"分类，建 4–5 个场景卡，每个生成一张氛围图
4. 道具略，先做"小苏的旧背包"
5. 进分镜区，开始铺 20–30 个分镜，每个分镜 prompt 里 `@小苏 @教室` 引用角色和场景
6. 中途反复切回"角色"分类对比"小苏第 17 个分镜的发型是不是和第 3 个分镜统一"
7. 时间轴拖 BGM + 雨声

**痛点：**
- 反复切分类做"视觉一致性核对"。每次切过去要 1 秒识别"哦这是小苏的卡片"
- 道具的"归属角色"在脑子里记着，没地方写
- 想知道"小苏出现在哪些分镜"，目前没法看，要靠手数

### §1.2 场景 B：1 小时长片（团队 2–5 人）

**用户画像：** 小团队，导演 + 美术 + 配乐分工。

**资产规模：**
- 主角 1 + 配角 10+
- 场景 20+
- 道具 30+
- 声音素材 30+

**典型工作流：**

1. 导演先在创作区分章节铺剧本
2. 美术批量在"角色"和"场景"分类建卡，每个角色多个表情/服装变体
3. 切回剧本检查"这个分镜该用小苏的哪个服装版本"
4. 导演反查"这个场景在第几集出现过 → 风格要一致"
5. 配乐工程师在"声音"分类管理 30+ 音乐 / 音效

**痛点（更严重）：**
- 角色多了之后**视觉相似的角色容易混**（两个少年角色卡片靠 prompt 才能分得清）
- 场景太多分不清"教室 day"和"教室 night"，要靠时间标签
- 道具找不到"这个道具是谁的"
- 声音 30+ 个，没试听等于没分类

### §1.3 场景 C：短视频系列（10 集，每集 2 分钟）

**用户画像：** 内容创作者，每周 1–2 集。

**资产规模：** 共享角色和世界设定，剧情每集不同。

**典型工作流：**
- 角色 / 场景 / 道具是跨集复用的"资产库"
- 每集只新建分镜

**痛点：**
- 跨"项目"复用资产（v0.8+ Phase H 范围，v0.6 不解决）
- 一个角色用了 10 集后，需要看"这角色出现在哪些集" → 跨项目反查（也是 Phase H）

**v0.6 能做的：** 同项目内的"使用次数"。给后续 Phase H 留接口。

### §1.4 场景 D：动画 / PV（强视觉一致性）

**用户画像：** 动画师 / 音乐 PV 制作者。

**资产规模：**
- 主角 1–2，但每个角色有 5+ 服装变体、表情变体
- 场景 3–5，每个场景有"白天/黑夜/雨/雪"4 个时段版本

**痛点（最严重）：**
- **变体管理**：小苏校服 vs 小苏便服 vs 小苏雨衣，都属于"小苏"但视觉不同
- 用户进角色卡，需要看到"这个角色当前有几个变体"
- 选哪个变体作为"主形象"
- 同场景的不同时段哪个最常用

**v0.6 能做的：** 派生链 (`regeneratedFrom`) 数据已存在，可以显示"X 个变体"计数。完整变体管理 UI（带切换 / 标记主形象）是 Phase G。

---

## §2 每个分类的真实需求

按 [MoSCoW](https://en.wikipedia.org/wiki/MoSCoW_method) 排：Must / Should / Could / Won't。

### §2.1 角色卡 (Cast)

**核心使用情境：** 视觉一致性核对（"小苏发型对不对？"）+ 关联反查（"小苏出现在哪些分镜？"）

**MoSCoW 需求：**

| 优先级 | 需求 | 当前数据可达性 |
|---|---|---|
| **Must** | 主形象（头像或立绘） | ✅ 已有 `node.result.url` |
| **Must** | 名字 | ✅ 已有 `node.title` |
| **Must** | 一句话设定（"反派少年，14 岁，有伤疤"） | ⚠️ 没专门字段，可暂用 `node.prompt` 的第一行 |
| **Should** | 使用次数（"在 23 个分镜里"） | ✅ 可 live 计算（数 prompt 引用 / 反向 edges）|
| **Should** | 变体数量（"3 个版本"） | ✅ 可数 `regeneratedFrom = this.id` 的节点 |
| **Could** | 关联场景 chip | ❌ 需要 Phase G 关系图谱 |
| **Could** | 标签（"反派 / 主角 / 少年"） | ❌ 需要新字段 `meta.tags` |
| **Won't** | 详细 prompt 全文 | ⚠️ 进入编辑态才看 |
| **Won't** | 模型 / 参数 chip | ⚠️ 进入编辑态才看 |

**关键观察：**
- 角色卡是**纵向矩形**（人物视觉天然纵向）
- 主形象 70% 空间 + 信息 30%
- "使用次数 + 变体数"是长片场景的关键 metadata，必须显示

### §2.2 场景卡 (Scene)

**核心使用情境：** 氛围一致性核对（"雨夜街头色调统一吗？"）+ 反查（"教室出现过哪些角色？"）

**MoSCoW 需求：**

| 优先级 | 需求 | 当前可达性 |
|---|---|---|
| **Must** | 场景图（大幅缩略） | ✅ `node.result.url` |
| **Must** | 名字 | ✅ `node.title` |
| **Must** | 时间/氛围 tag（"夜 · 雨 · 冷色"） | ❌ 需要 `meta.mood` 或解析 prompt |
| **Should** | 使用次数 | ✅ 可 live 计算 |
| **Should** | 出现的角色 chip（小头像列表） | ❌ Phase G |
| **Could** | 变体（"夜间版 / 白天版"） | ✅ 同上派生计数 |
| **Won't** | prompt 详情 / 模型 | ⚠️ 编辑态 |

**关键观察：**
- 场景卡是**横向矩形 / 接近正方形**（场景天然 landscape）
- 主图 80% 空间 + 信息条浮在底部（沉浸式）
- "时间/氛围 tag" 是和角色卡最大的不同——场景是有"时段感"的

### §2.3 道具卡 (Prop)

**核心使用情境：** 视觉一致性（"小苏的小刀长什么样？"）+ 归属（"这道具是谁的？"）

**MoSCoW 需求：**

| 优先级 | 需求 | 当前可达性 |
|---|---|---|
| **Must** | 道具图 | ✅ `node.result.url` |
| **Must** | 名字 | ✅ `node.title` |
| **Must** | **归属**（"小苏的"）— 道具特有 | ❌ 需要 `meta.ownedBy` 字段 |
| **Should** | 出现场景 | ❌ Phase G |
| **Should** | 关键属性（"旧 / 黑色 / 帆布"） | ❌ 需要 `meta.attributes` 或解析 prompt |
| **Should** | 使用次数 | ✅ 可计算 |
| **Won't** | 模型 / prompt | ⚠️ 编辑态 |

**关键观察：**
- 道具卡是**正方形**（物品中心，无明显方向）
- "归属"是道具特有信号，没它就没意义
- 视觉上跟角色 / 场景区分应该有"物品感"（边框、阴影、底纹）

### §2.4 声音卡 (Audio)

**完全不同的范式。** 声音是**时间维度**的，视觉不是主体。

**核心使用情境：** 选 BGM / 音效 + 试听 + 用到时间轴

**MoSCoW 需求：**

| 优先级 | 需求 | 当前可达性 |
|---|---|---|
| **Must** | 类型徽标（BGM / 音效 / 旁白） | ❌ 需要 `meta.audioKind` |
| **Must** | 名字 | ✅ `node.title` |
| **Must** | 时长 mm:ss | ⚠️ 需要从音频文件解析 |
| **Must** | 播放控制（▶ / ⏸） | ❌ 需要 audio kind 支持 |
| **Should** | 波形预览 | ❌ 需要预生成波形或 web audio API 实时绘 |
| **Could** | 音量峰值 | ⚠️ 派生于波形 |
| **Could** | BPM（音乐用） | ❌ 元数据 |
| **Won't** | 静态图像缩略 | ⚠️ 不存在 |

**关键观察：**
- 声音卡是**横向 strip**（时间天然横向）
- 视觉主体是波形 + 播放按钮，不是图
- 当前 v0.6 数据层**没有 audio kind 支持**，声音分类节点其实是 image 占位

**v0.6 范围的现实：**
- 实现 AudioStripNode 视觉骨架（波形 placeholder + 时长 placeholder + 播放按钮 disabled）
- 真实音频处理推到 audio kind 落地的独立 phase

---

## §3 信息架构差异

### §3.1 4 张卡片的核心差异表

| 维度 | 角色 | 场景 | 道具 | 声音 |
|---|---|---|---|---|
| **形状** | 纵向矩形 | 横向矩形 | 正方形 | 横向 strip |
| **默认尺寸** | 200 × 280 | 320 × 200 | 200 × 200 | 420 × 80 |
| **主视觉占比** | 70% | 80% | 65% | 60% (波形) |
| **主信息** | 名字 + 设定 | 名字 + 氛围 | 名字 + 归属 | 名字 + 时长 |
| **关联线索** | 使用次数 / 变体数 | 使用次数 / 角色 chip | 使用次数 / 归属 | 关联场景（未做）|
| **时间维度** | ❌ | 隐含（时段）| ❌ | ✅ 核心 |
| **跟分镜的最大区别** | 没 composer | 没 composer | 没 composer | 有播放控制 |

### §3.2 关联反查的核心性

**长片场景下**，"X 出现在哪些 Y"的反向查找是**最高价值**的功能：

- 小苏角色卡 → "23 个分镜引用"
- 教室场景卡 → "7 个角色出现过"
- 旧背包道具 → "15 个分镜出现"

**v0.6.x 卡片至少要显示这些计数**，哪怕 click 暂时不能跳转（跳转 = Phase G 关系图谱）。

**计数的 MVP 算法**（不依赖 Phase G）：

```typescript
// 角色 X 出现次数 = 全部分镜节点中 prompt 包含 X.title 的数量
// 场景 / 道具同理
function getUsageCount(node, allNodes) {
  if (!node.title || !node.categoryId || node.categoryId === 'shots') return 0
  return allNodes.filter(n =>
    n.categoryId === 'shots' && n.prompt?.includes(node.title)
  ).length
}

// 变体数 = derivedFrom = this.id OR regeneratedFrom = this.id 的节点数
function getVariantCount(node, allNodes) {
  return allNodes.filter(n => n.derivedFrom === node.id || n.regeneratedFrom === node.id).length
}
```

简单文本匹配，足够 MVP。后续 Phase G 会有真正的关系字段。

### §3.3 数据模型现状 vs 期望

| 字段 | 现状 | 期望（最终） | v0.7 实现策略 |
|---|---|---|---|
| `title` | ✅ 已有 | 沿用 | 沿用，作为名字 |
| `prompt` | ✅ 已有 | 沿用（仅生图用，**不**作为 tagline 源）| 沿用 |
| `result.url` | ✅ 已有 | 沿用 | 主视觉 |
| `meta.tagline` | ❌ | 一句话设定 | **AI 从剧本提取** |
| `meta.tags` | ❌ | 标签数组 | **AI 从剧本提取** |
| `meta.ownedBy` | ❌ | 道具归属 | **AI 从剧本提取** |
| `meta.mood` | ❌ | 场景氛围 tag | **AI 从剧本提取** |
| `meta.audioKind` | ❌ | BGM / SFX / VO | **AI 从剧本提取** |
| `meta.durationSec` | ⚠️ 已有 `durationSeconds` 在 result | 沿用 | 沿用 |

**关键决定：**
- 新字段都存 `node.meta`，不动顶层 schema
- **不**走 prompt 派生 / 用户手填的 placeholder 引导
- AI 不知道的字段就空着，**卡片不显示对应行**（不显示 "+ 添加" 提示）

### §3.4 信息来源分层（Sources）

每个字段的填充来源严格分 3 层，优先级从高到低：

**Level 1：节点自带（白吃）**
- `title` / `result.url`：节点创建时就有
- 使用次数 / 变体数：基于现有数据 live 计算
- 这层 100% 可靠

**Level 2：AI 从剧本一次性提取**
- 创作区 (Creation workspace) 的剧本是**唯一 source of truth**
- 通过 AI 一次 call 把整个剧本喂给 vision/text 模型，返回 JSON：所有 entity（人物 / 场景 / 道具 / 声音）+ 其属性（tagline / mood / ownedBy / audioKind）
- 把 AI 返回的字段写入对应卡片节点的 `node.meta`
- AI 不确定 / 没找到的字段就**不写**

**Level 3：用户手动覆盖**
- 卡片上的字段可点击 inline 编辑
- 用户编辑 = 覆盖 Level 2 的 AI 提取值
- 用户清空 = 下次 AI 同步会重新尝试填

**Level 0：什么都没有 → 卡片不显示该行**
- 不强迫用户看到 "+ 添加 tagline" placeholder
- 用户从生成区**手动**新建的"无名"角色卡（剧本里不存在）只显示图 + 编号

视觉规则：

```
有数据：
┌──────────────┐
│ [小苏头像]    │
│ 小苏      ●12 │
│ 反派少年14岁  │  ← Level 2 提取的
└──────────────┘

仅 Level 1（剧本里没提到 / 用户随手建的）：
┌──────────────┐
│ [头像]        │
│ 角色 03    ●0 │
└──────────────┘  ← 干净，不显示 tagline 行
```

---

## §4 视觉设计：4 个卡片

每个卡片严格遵循 `docs/design/nomi-design-system.md` 的 token / 组件 / patterns。

### §4.0 尺寸通则（重要）

**用户约束：必须完整显示图，不能裁切。** 所以所有图像类卡片采用：

```
卡片宽度 = 固定（按分类）
图像区高度 = 卡片宽度 / 图像 aspect ratio   （完整显示图，不裁切）
信息区高度 = 固定（按分类）
卡片总高度 = 图像区高度 + 信息区高度
```

**Masonry 错落：** 同分类卡片宽度统一，但高度不一定齐（取决于各自图的比例）。在自由画布场景下天然支持，无需对齐。

**极端比例兜底（aspect > 3:1 或 < 1:3）：** 仅这些罕见 case 强制裁到 3:1 / 1:3 边界 + tooltip 标记"已限制比例"。95% 常规比例（1:1、4:3、3:4、16:9、9:16）走完整显示。

### §4.1 `CharacterCardNode`

**视觉结构**（width=200，height 动态）：

```
1:1 图（200×200）：              9:16 图（200×356）：
┌──────────────┐               ┌──────────────┐
│ ╭───╮  ╭──╮  │               │ ╭───╮  ╭──╮  │
│ │角色│  │📋│  │               │ │角色│  │📋│  │
│ ╰───╯  ╰──╯  │               │ ╰───╯  ╰──╯  │
│              │               │              │
│ [完整 1:1 图] │               │              │
│              │               │ [完整 9:16   │
│              │               │   立绘]      │
├──────────────┤               │              │
│ 小苏     ●12 │               │              │
│ 反派少年14岁  │               │              │
│         ⊕3变 │               ├──────────────┤
└──────────────┘               │ 小苏     ●12 │
                               │ 反派少年14岁  │
                               │         ⊕3变 │
                               └──────────────┘
```

**规格表：**

| 属性 | 值 / token |
|---|---|
| **宽度** | 200 px 固定 |
| **图像区高度** | `200 / aspectRatio`（image natural aspect）；占位态用 1:1 → 200 |
| **信息区高度** | 80 px 固定 |
| **外框** | `border border-nomi-line rounded-nomi shadow-nomi-sm`（选中 `shadow-nomi-md` + 2px outline `nomi-accent`）|
| **背景** | `bg-nomi-paper` |
| **图像区** | `w-full rounded-nomi-sm overflow-hidden`，图用 `object-contain object-center`（不裁），无图时斜条纹占位 |
| **TitlePill** | 左上 absolute，同设计系统 §5.1 |
| **副本角标** | 右上 absolute，仅当 `derivedFrom` 存在时显示 |
| **名字字号** | `text-body` (14px) `font-medium` `text-nomi-ink` |
| **设定字号** | `text-caption` (12px) `text-nomi-ink-60`，单行 truncate + 全文 tooltip |
| **使用次数 dot** | 8px 圆点 `bg-nomi-accent`，旁数字 `text-micro text-nomi-ink-60`；为 0 时不显示 |
| **变体 chip** | `rounded-full bg-nomi-ink-05 px-2 py-[2px] text-micro text-nomi-ink-60`；变体 ≥1 才显示 |
| **行为** | 点击 = 选中；双击 = 进入编辑态 |

**空状态规则：**
- 没头像 → 图像区 1:1 占位斜条纹 + 中央 "角色 NN / 等待生成"（同 §5.1 设计系统占位态）
- 没 tagline → **隐藏第二行**（不显示 "+ 添加" placeholder）
- 使用 / 变体 = 0 → 隐藏对应 dot / chip

### §4.2 `SceneCardNode`

**视觉结构**（width=320，height 动态）：

```
16:9 图（320×180）：               1:1 图（320×320）：
┌──────────────────────────────┐  ┌──────────────────────────────┐
│ ╭───╮              ╭──╮      │  │ ╭───╮              ╭──╮      │
│ │场景│              │📋│      │  │ │场景│              │📋│      │
│ ╰───╯              ╰──╯      │  │ ╰───╯              ╰──╯      │
│                              │  │                              │
│   [完整 16:9 场景图]            │  │       [完整 1:1 场景图]       │
│                              │  │                              │
│ ┌──────────────────────────┐ │  │                              │
│ │ 教室                ●12  │ │  │                              │
│ │ 夜·雨·冷色          ⊕2   │ │  │                              │
│ └──────────────────────────┘ │  │                              │
└──────────────────────────────┘  │                              │
                                  │ ┌──────────────────────────┐ │
                                  │ │ 教室                ●12  │ │
                                  │ │ 夜·雨·冷色          ⊕2   │ │
                                  │ └──────────────────────────┘ │
                                  └──────────────────────────────┘
```

**特别设计：** 信息条**浮在主图底部偏离卡片底 8px**（半透明深底 + 白字 + backdrop-blur），不是底部独立区。这样场景图始终全幅展示，氛围感不被切割。**注意：** 信息条 absolute 定位，不占用卡片高度，所以信息区高度 = 0（仅图像区决定卡片高度）。

**规格表：**

| 属性 | 值 / token |
|---|---|
| **宽度** | 320 px 固定 |
| **图像区高度** | `320 / aspectRatio`；占位态默认 16:9 → 180 |
| **信息区高度** | 0（信息条 absolute 浮动）|
| **主图** | `w-full rounded-nomi overflow-hidden`，`object-contain object-center` |
| **信息条** | `absolute bottom-2 left-2 right-2 px-3 py-2 rounded-nomi-sm`，背景 `bg-nomi-ink/[0.78]` + `backdrop-blur-md`，字色 `text-nomi-paper` |
| **名字** | `text-body` (14px) `font-medium` |
| **氛围 tag** | `text-micro` `text-nomi-paper/80`，多个 tag 用 `·` 分隔，缺失时隐藏整个 tag 行 |
| **使用次数** | 浮在右上信息条内 |
| **变体** | 浮在右下 |
| **占位态** | 没场景图 → 斜条纹 16:9 占位 + 中央 "场景 NN / 等待生成"，信息条降级到普通灰底（`bg-nomi-ink-10`）|

### §4.3 `PropCardNode`

**视觉结构**（width=200，height 动态，多数为 1:1）：

```
1:1 图（200×200，最常见）：
┌──────────────┐
│ ╭───╮  ╭──╮  │
│ │道具│  │📋│  │
│ ╰───╯  ╰──╯  │
│              │
│ [完整道具图]  │
│              │
│              │
├──────────────┤
│ 旧背包    ●8 │
│ 🔗 小苏的    │
└──────────────┘
```

**特别设计：** "归属"用 🔗 + 文字明确标识，**字色用 `nomi-accent`** 让它跳出来——这是道具卡的核心差异化。

**规格表：**

| 属性 | 值 / token |
|---|---|
| **宽度** | 200 px 固定 |
| **图像区高度** | `200 / aspectRatio`；占位 1:1 → 200 |
| **信息区高度** | 60 px 固定 |
| **主图** | `w-full rounded-nomi-sm overflow-hidden`，`object-contain object-center` |
| **名字** | `text-body` (14px) `font-medium` `text-nomi-ink` |
| **归属** | `text-caption` (12px) `text-nomi-accent` `font-medium`，前置 `IconLink` 12px |
| **使用次数** | dot + 数字 `text-micro` |
| **空状态** | 没归属 → **隐藏归属行**（不显示 "+ 添加归属" placeholder）|

### §4.4 `AudioStripNode`

**视觉结构**（420 × 80 固定，**没有图像**）：

```
┌───────────────────────────────────────────────┐
│ [▶]  [BGM] 雨夜BGM     ⌒⌒⌒⌒⌒  03:42  ●5    │
└───────────────────────────────────────────────┘
```

布局水平：左 [播放按钮] | 中左 [类型徽标 + 名字] | 中右 [波形] | 右 [时长 + 使用次数]

**规格表：**

| 属性 | 值 / token |
|---|---|
| **尺寸** | 420 × 80 px 固定（无图，不参与 masonry）|
| **外框** | `border border-nomi-line rounded-nomi-lg shadow-nomi-sm` |
| **播放按钮** | 32×32 圆形 `bg-nomi-ink text-nomi-paper`，IconPlay / IconPause |
| **类型徽标** | `rounded-full bg-nomi-accent-soft text-nomi-accent text-micro px-2 py-[1px]`，文案 "BGM" / "音效" / "旁白"；audioKind 缺失时隐藏 |
| **名字** | `text-body` (14px) `text-nomi-ink` |
| **波形** | 32px 高 SVG。`audioKind` 没数据时显示灰条纹占位 |
| **时长** | `text-caption text-nomi-ink-60 tabular-nums font-mono`；durationSec 缺失时显示 `--:--` |
| **使用次数** | 同其它卡片，0 时隐藏 |
| **状态** | 播放中：按钮 IconPause；波形 highlight 当前位置 |

**v0.7 不做：**
- 真实音频播放（需要 audio kind 落地）
- 真实波形分析
- BPM / 音量峰值

---

## §5 实施计划

### §5.1 任务清单

| Task ID | 主题 | Wave |
|---|---|---|
| **[DESIGN-CARDS-01]** | meta 字段类型 + provenance helpers | 1 |
| **[DESIGN-CARDS-02]** | `useNodeUsageCount` / `useNodeVariantCount` hooks | 1 |
| **[DESIGN-CARDS-03]** | `CharacterCardNode` 实现（width-fixed + 完整图）| 2 |
| **[DESIGN-CARDS-04]** | `SceneCardNode` 实现（含浮动信息条）| 2 |
| **[DESIGN-CARDS-05]** | `PropCardNode` 实现 | 2 |
| **[DESIGN-CARDS-06]** | `AudioStripNode` 实现（骨架）| 2 |
| **[DESIGN-CARDS-07]** | BaseGenerationNode 改 renderKind 分发器 | 3 |
| **[DESIGN-CARDS-08]** | 默认 size 按 renderKind + 图 aspect 决定 | 3 |
| **[DESIGN-CARDS-09]** | `NewCardInlineForm` 组件（必填 name + 鼓励填字段）| 3 |
| **[DESIGN-CARDS-10]** | 更新空状态 CTA 接入 inline form | 3 |
| **[DESIGN-CARDS-11]** | AI extraction service（一次性剧本提取）| 4 |
| **[DESIGN-CARDS-12]** | "从剧本同步" 按钮 + 结果预览 modal | 4 |
| **[DESIGN-CARDS-13]** | 首次隐私确认 + 失败兜底 + 状态 toast | 4 |
| **[DESIGN-CARDS-14]** | 版本 bump 0.6.1 → 0.7.0 + release notes | 5 |
| **[DESIGN-CARDS-15]** | Final audit + spec compliance | 5 |

总计约 7–9 天。

### §5.2 BaseGenerationNode dispatcher

```typescript
function BaseGenerationNode({ node, ...rest }) {
  const renderKind = node.renderKind ?? inferFromCategoryId(node.categoryId)
  switch (renderKind) {
    case 'shot-frame':     return <ShotFrameNode node={node} {...rest} />
    case 'character-card': return <CharacterCardNode node={node} {...rest} />
    case 'scene-card':     return <SceneCardNode node={node} {...rest} />
    case 'prop-card':      return <PropCardNode node={node} {...rest} />
    case 'audio-strip':    return <AudioStripNode node={node} {...rest} />
    default:               return <ShotFrameNode node={node} {...rest} />
  }
}
```

`ShotFrameNode` = 现有 BaseGenerationNode 内容整体移过去（保留 composer 内嵌、status badge、derived badge、resize、timeline drag 等 1100+ 行功能）。其它 4 个新组件从零写简化版（仅图 + 信息区 + 计数）。

### §5.3 共享 hooks

```typescript
// src/workbench/generationCanvas/hooks/useNodeRelationships.ts

export function useNodeUsageCount(nodeId: string, nodeTitle: string | undefined): number {
  return useGenerationCanvasStore((state) => {
    if (!nodeTitle) return 0
    return state.nodes.filter(n =>
      n.categoryId === 'shots' && n.id !== nodeId && n.prompt?.includes(nodeTitle)
    ).length
  })
}

export function useNodeVariantCount(nodeId: string): number {
  return useGenerationCanvasStore((state) =>
    state.nodes.filter(n => n.derivedFrom === nodeId || n.regeneratedFrom === nodeId).length
  )
}
```

### §5.4 meta 字段类型与 provenance

每个字段都附带 source 标记，便于 AI 重提时知道哪些是用户手填（不覆盖）。

```typescript
// src/workbench/generationCanvas/model/nodeMetaFields.ts

export type FieldProvenance = 'user' | { ai: number /* timestamp */ }

export type CharacterMeta = {
  tagline?: string
  taglineSource?: FieldProvenance
  tags?: string[]
  tagsSource?: FieldProvenance
}

export type SceneMeta = {
  mood?: string[]
  moodSource?: FieldProvenance
  tags?: string[]
  tagsSource?: FieldProvenance
}

export type PropMeta = {
  ownedBy?: string
  ownedBySource?: FieldProvenance
  attributes?: string[]
  attributesSource?: FieldProvenance
}

export type AudioMeta = {
  audioKind?: 'bgm' | 'sfx' | 'vo'
  audioKindSource?: FieldProvenance
  durationSec?: number
  bpm?: number
}

// helpers
export function readCharacterMeta(node: GenerationCanvasNode): CharacterMeta {
  return (node.meta || {}) as CharacterMeta
}
// 同理 readSceneMeta / readPropMeta / readAudioMeta

export function isUserEdited<T>(source: FieldProvenance | undefined): boolean {
  return source === 'user'
}
```

### §5.5 AI 提取服务

**单次 call 模型，结构化输出。**

```typescript
// src/workbench/cardsAi/extractCardsFromScript.ts

import { generateObject } from 'ai'
import { z } from 'zod'

const ExtractionResultSchema = z.object({
  characters: z.array(z.object({
    name: z.string(),
    tagline: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })),
  scenes: z.array(z.object({
    name: z.string(),
    mood: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  })),
  props: z.array(z.object({
    name: z.string(),
    ownedBy: z.string().optional(),
    attributes: z.array(z.string()).optional(),
  })),
  audio: z.array(z.object({
    name: z.string(),
    audioKind: z.enum(['bgm', 'sfx', 'vo']).optional(),
  })),
})

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>

const SYSTEM_PROMPT = `你是一个影片创作助手。从用户给的剧本里提取所有实体并归类：

- characters: 角色（人 / 拟人化形象）
- scenes: 场景（地点 / 环境）
- props: 重要道具（物品）
- audio: 配乐 / 音效 / 旁白（"BGM"="bgm", "音效/SFX"="sfx", "旁白"="vo"）

对每个实体提取：
- name: 准确的实体名（中文优先，跟剧本里出现的一致）
- tagline (角色): 一句话设定，<20 字
- tags (角色/场景): 1-3 个关键词
- mood (场景): 时段/氛围词，如 "夜"/"雨"/"冷色"
- ownedBy (道具): 归属（角色名 / 场景名），剧本明示"X 的 Y"才填
- attributes (道具): 视觉关键属性 1-3 个
- audioKind (音频): 仅 bgm/sfx/vo

只输出 JSON，不输出解释。不确定的字段不填。`

export async function extractCardsFromScript(
  script: string,
  aiModel: LanguageModel,
): Promise<ExtractionResult> {
  const result = await generateObject({
    model: aiModel,
    schema: ExtractionResultSchema,
    system: SYSTEM_PROMPT,
    prompt: `剧本：\n\n${script}`,
  })
  return result.object
}
```

**提取结果应用规则：**

```typescript
function applyExtractionToCard(
  existingNode: GenerationCanvasNode,
  extracted: { tagline?: string, tags?: string[] /* ... */ },
  extractTimestamp: number,
): Partial<GenerationCanvasNode> {
  const meta = (existingNode.meta || {}) as CharacterMeta
  const updates: Partial<CharacterMeta> = {}
  
  // tagline: 只在 source 不是 'user' 时覆盖
  if (extracted.tagline && meta.taglineSource !== 'user') {
    updates.tagline = extracted.tagline
    updates.taglineSource = { ai: extractTimestamp }
  }
  // 同理 tags / mood / ownedBy / 等等
  
  return { meta: { ...meta, ...updates } }
}
```

### §5.6 创建流程（3 种）

**路径 1 — 从剧本同步（推荐主流程）**

```
触发：生成区 toolbar "从剧本同步" 按钮
      （创作区无内容时按钮 disabled + tooltip "先在创作区写剧本"）
      （AI provider 未配置时按钮 disabled + tooltip "先在设置接入 AI"）
流程：
  1. 首次触发 → 弹隐私确认（一次性，记住）
  2. Loading: 读创作区 plaintext + call extractCardsFromScript
  3. AI 返回后弹 ExtractionPreviewModal：
     [✓] 创建 3 个角色: 小苏, 妈妈, 老师
     [✓] 创建 2 个场景: 教室, 桥下
     [✓] 更新 5 个已有卡片（小苏 +tagline, 教室 +mood, ...）
     [取消]  [✓] 应用
  4. 用户应用 → 一次性写入 store
  5. Toast: "已同步 5 张新卡片 + 5 张更新"
失败：
  - AI 网络错 → toast 错误 + [重试] 按钮，不修改任何卡片
  - JSON 格式错 → toast "AI 返回格式异常"
```

**路径 2 — 手动 inline 表单**

```
触发：sidebar 右键"+ 新建{分类}" 或 空状态 CTA
组件：NewCardInlineForm（不弹 modal，画布上展开为待填卡片）
字段：
  - 名字 *（必填）
  - 一句话设定（角色）/ 氛围（场景）/ 归属（道具）/ 类型（声音）—— 鼓励填
  - 标签 —— 可选
行为：
  - Enter / 创建按钮 → 写入 store，source 标 'user'
  - Esc / 取消按钮 → 见路径 3
```

**路径 3 — 取消表单 = 空白卡片（fallback）**

```
路径 2 表单按"取消"或留空 Enter：
  - 仍创建一张卡片，仅有默认 title = "角色 N"
  - 无 tagline / tags / 等其它元数据
  - 用途：用户想立刻看到生成的效果，不在意元信息
  - 卡片视觉：标题 pill + 图 + 使用次数（数据缺失行全部隐藏）
后续可补：
  - 用户点击卡片 → 进入编辑态修改 metadata（同路径 2 表单）
  - 或写完剧本后用路径 1 批量提取，按名字匹配补字段
```

### §5.7 同步与冲突处理

**首次同步：** AI 提取，全字段都 source='ai'

**用户编辑某字段：** source='user'

**第二次同步：**

| 字段当前 source | AI 提取有值 | 行为 |
|---|---|---|
| 'user' | yes | **不覆盖**，保留用户值 |
| 'user' | no | 保留用户值 |
| { ai: ts } | yes | 覆盖（latest AI wins）|
| { ai: ts } | no | 保留旧 AI 值（不清空，避免误删） |
| undefined（空）| yes | 写入 |
| undefined | no | 不动 |

**重命名孤儿：** AI 提取的 entity 名匹配不到现有卡片 → 建新卡片。原同名旧卡片不删（可能仍有图）。

**显式重提某字段：** UI 上字段右侧加 "↻" 按钮，点 = 把该字段 source 清空，下次同步 AI 写入。MVP 不做。

### §5.8 隐私边界

**首次同步前必弹一次性确认：**

```
┌─────────────────────────────────────────┐
│ 从剧本同步                                │
│                                         │
│ 接下来会把创作区的剧本内容发送到 AI Provider │
│ ({providerName})，用于自动提取角色/场景/   │
│ 道具/声音信息填充卡片。                    │
│                                         │
│ 剧本会包含你的创作内容，请确认你接受这个    │
│ 数据流动。                                 │
│                                         │
│ □ 不再提示                                 │
│                                         │
│           [取消]  [理解，继续]              │
└─────────────────────────────────────────┘
```

用户勾"不再提示" + 确认 → 写入 `localStorage / settings.cardsAi.privacyAck = true`，后续不再弹。

### §5.9 兜底逻辑（v0.6.1 → v0.7 升级）

- 旧节点 meta 都是空的（仅有 result/history/...）
- v0.7 打开后所有现存卡片只显示 image + title + 0 计数（其它行隐藏）
- 用户可任选路径 1（一键同步）或路径 2（逐个填）补全
- **关键：v0.7 升级**不会让旧节点"看起来坏掉"** —— 优雅降级

### §5.10 失败兜底全表

| 场景 | 行为 |
|---|---|
| AI provider 未配置 | "从剧本同步"按钮 disabled + tooltip |
| 创作区为空 | 按钮 disabled + tooltip |
| 网络失败 | toast "AI 调用失败 [重试]"，不修改 |
| AI 返回非 JSON | toast "AI 响应格式异常"，不修改 |
| AI 返回 JSON 但 schema 不符 | toast "AI 输出无法识别"，不修改 |
| AI 提取 0 个 entity | toast "未找到可识别的角色/场景/道具" |
| 用户取消预览 | 不修改 |
| 剧本超长（>50k chars）| 弹提示 "剧本较长，可能需要 30s+"；超 200k 强制截断前 200k + 告知 |

---

## §6 验收

### §6.1 功能验收

- [ ] 角色分类节点用 CharacterCardNode 渲染
- [ ] 场景分类节点用 SceneCardNode 渲染
- [ ] 道具分类节点用 PropCardNode 渲染
- [ ] 声音分类节点用 AudioStripNode 渲染（视觉骨架）
- [ ] 分镜分类节点继续用 ShotFrameNode（即原 BaseGenerationNode 内容）
- [ ] 4 张卡片在 meta 字段缺失时优雅降级
- [ ] 使用次数 / 变体数 live 计算正确

### §6.2 视觉验收（必须截图）

每个分类截图一张并对比设计稿：
- [ ] CharacterCardNode 占位态 + 有图态
- [ ] SceneCardNode 有图态（含浮动信息条）
- [ ] PropCardNode 有归属 + 无归属
- [ ] AudioStripNode 占位（无音频数据）+ 假数据态

### §6.3 设计系统合规

- [ ] 所有颜色用 token，无 hex
- [ ] 所有字号用 token
- [ ] 所有图标走 `@tabler/icons-react`
- [ ] 新组件都在 `docs/design/nomi-design-system.md` §4 登记规格
- [ ] 选中态 / hover 态 / 占位态视觉一致

---

## §7 长期视角

完成本设计后，Nomi 卡片体系将支撑：

1. **v0.7 起**：用户做"快速识别 + 一致性检查"的工作流，4 分类卡片各司其职
2. **Phase F**：Nomi Script 创作时 `@小苏` 引用直接显示角色卡片（hover 弹出预览）
3. **Phase G**：关系图谱可视化，4 类卡片是节点单元
4. **Phase H**：跨项目资产库（角色卡 / 场景卡 / 道具卡 / 声音卡都是跨项目可复用单元）

**所以 v0.7 这 5 天投资是 Phase F/G/H 的视觉基座。**

---

## §8 启动前确认清单

我等你确认：
- ⬜ 4 个场景假设是否符合你的产品意图（特别是场景 D 动画/PV 的变体管理）
- ⬜ 使用次数 / 变体数计数显示在卡片上是否必要
- ⬜ 道具的"归属"用 `🔗 小苏的` 高亮显示，是否过强
- ⬜ 场景卡的浮动信息条（半透明黑底白字）是否符合你想象
- ⬜ AudioStripNode 在没真实音频数据时显示骨架占位，可接受
- ⬜ meta 字段不改 schema 只在 node.meta 里加，可接受
- ⬜ 5 天工期 + 版本 bump 到 0.7.0，可接受

任意 ⬜ 想调整告诉我。全 ✓ 我立即派 executor 启动 Wave 1。
