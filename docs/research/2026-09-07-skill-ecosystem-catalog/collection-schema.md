# 收录格式（Catalog Entry Schema）与展示格式 设计 v0 → v0.1（效果橱窗）

> 状态：草案 v0.1，2026-09-07 经顶尖市场设计调研升级（`research-showcase-design.md`）。配套样例数据：`catalog.sample.json`；展示 mockup：`showcase.html`。
> v0 → v0.1 变更：① 加 `kind` 分型 ② 展示层加 `preview` 结构字段 + "无样张不上架"规则 ③ 展示改为三层渐进（卡片/详情/接入后）。

## 0. 设计原则

1. **对外以 SKILL.md 为唯一事实源**：catalog 条目存 `name/description` 直取 frontmatter，Nomi 的 `skill.json` 扩展字段一律不收入 catalog 本体（保持生态互通），只作为桌面端"适配层"可选字段（`adapterForNomi`）。
2. **收录 ≠ 可用 ≠ 推荐**：三类状态分开记，都展示。
3. **机器可读 + 人类可读同源**：一个 JSON 条目同时驱动网页列表/详情与桌面端安装；任何展示字段都能溯源到来源字段。
4. **校验门槛前置**：投稿/收录时即跑 agentskills.io 规则，失败拒收或标记 `invalid`。
5. **效果优先（2026-09-07 用户拍板）**：展示是"效果橱窗"不是文字货架——卡片第一眼是演示小样/封面；演示可见、参数/文件接入后才给（PromptBase 分层披露原理）。

## 1. 收录格式 —— catalog entry（JSON）

```jsonc
{
  "$schema": "https://nomi.app/catalog/entry.v0.schema.json",

  // —— 身份（唯一键 = owner/repo + name）——
  "id": "samuraigpt/generative-media-skills::muapi-ugc-video-factory",
  "kind": "skill",                          // skill | effect-pack | lora（三类统一外层）
  "owner": "samuraigpt",
  "repo": "generative-media-skills",
  "name": "muapi-ugc-video-factory",        // 取自 SKILL.md frontmatter，须与目录同名
  "version": "1.0.0",                       // 取自 metadata.version 或默认 1.0.0
  "skillPath": "skills/muapi-ugc-video-factory/SKILL.md",  // 仓内相对路径（lora 为权重路径）

  // —— 事实源（直取 frontmatter，展示用原文，不做摘要改写）——
  "description": "原文 description…（≤1024 的原样拷贝）",
  "license": "Apache-2.0",
  "compatibility": "",
  "tags": [],                               // 由描述/正文抽取的领域标签

  // —— 分类（双轨）——
  "domain": "ugc-advertising",              // 领域轨道：受控词表
  "craft": "director",                      // 内容工种轨道：受控词表（对齐 Nomi 现有 director-/writer- 前缀体系）
  "modality": "style",                      // 形象/声音/风格/动作…（lora/effect-pack 常用，skill 可省）

  // —— 效果预览（效果橱窗核心字段，见 §3）——
  "preview": {
    "kind": "demo-video",                   // demo-video | author-gallery | local-probe | none
    "url": "https://…/demo.mp4",            // 托管小样（skill/effect-pack 可托管跑）
    "gallery": ["https://…/1.png"],         // 作者样张（lora：HF model card 图）
    "caption": "输入：一段夜景色… 输出：VHS 质感",  // 输入→输出对照说明
    "requiredForFeatured": true             // 无样张不上首屏（规则 12）
  },

  // —— 来源与可溯性 ——
  "source": {
    "type": "github",                       // github | huggingface | local | site
    "url": "https://github.com/samuraigpt/generative-media-skills",
    "repoId": "",                           // huggingface 专用（如 larryvrh/MiniMax-H3-Turbo-Lora）
    "ref": "main",
    "publishedVia": "claude-plugin",        // 可选：agent-skills-plugin 形态
    "collectedAt": "2026-09-07"
  },

  // —— 校验与安全（收录门槛，P0 必须有）——
  "validation": {
    "status": "pass",                       // pass | invalid | unknown（failed 细则）
    "checkedBy": "skills-ref-validate@x.y.z",
    "nameLenOk": true, "descLenOk": true, "reservedWordOk": true, "dirNameMatches": true
  },
  "security": {
    "auditStatus": "unscanned",             // scanned-pass | scanned-fail | unscanned
    "auditReportUrl": "",
    "verified": false                       // 作者身份/官方认证：官方 | partner | 社区
  },

  // —— 展示用聚合字段（可空；网页定期刷新，非收录必填）——
  "stats": { "installs": 0, "stars": 0, "updatedAt": "" },

  // —— 适配层（Nomi 专用，可空；只存在桌面端消费时使用）——
  "adapterForNomi": {
    "needs": "tools-mapping",               // direct | tools-mapping | rewrite | reference-only
    "mappedTools": ["create_canvas_nodes"], // 映射到 Nomi 工具白名单后的结果
    "requiredProviders": ["video"],
    "notes": "绑定 muapi API，需替换为 Nomi 媒体后端"
  },

  // —— 收录治理 ——
  "curation": {
    "status": "candidate",                  // official | curated | candidate | rejected
    "rejectedReason": ""
  }
}
```

### 字段删减规则（P1 前可砍的）
- `compatibility`、`adapterForNomi.mappedTools`、`stats.stars` 首版可为空——**收录格式先要稳，展示字段可渐进补**。

## 2. 展示格式（v0.1 · 三层渐进效果橱窗，依据 research-showcase-design.md 12 条）

### 2.0 三层渐进（PromptBase 分层披露原理）

| 层 | 用户看到 | 看不到 |
|---|---|---|
| 卡片 | 演示封面/静音小样 + 名字 + 一句"装了能做什么" + 类型章 | 元数据/参数/文件 |
| 详情 | 自动播演示 + 一句话效果 + CTA + 规格/使用提示 + 作者 + License | SKILL.md 全文/权重文件 |
| 接入后 | 才给 SKILL.md 全文/文件树/参数（skill=装法 / effect-pack=铺画布 / lora=底座+strength） | — |

### 2.1 列表卡片（效果优先：演示 > 名字 > 人话 > 元数据）

```
┌─────────────────────────────┐
│   [演示封面 / 静音循环小样]     │  ← 最大面积（video thumb）
│        ▷ 0:28                 │
│  [技能章][官方精选]            │  ← 类型章 + 策展徽标
├─────────────────────────────┤
│  复古录像带质感                │  ← 拟人化名字（非 kebab key）
│  给画面加上 80 年代 VHS 质感…  │  ← 一句"装了能做什么"（人话）
│  ⬇ 34k · 作者                │  ← 仅用量/作者（信任信号，元数据不进卡）
└─────────────────────────────┘
```

- **卡片字段最小集**：演示封面 + 名字 + 一句人话 + 类型章 + 官方/开放区徽标 + 用量/作者。license/统计/标签一律不上卡面（v0.1 改：信息密度让位给效果）。
- **同一 repo 折叠**「+N more from repo」防霸榜（抄 skills.sh/SkillsMP）。
- **无 preview 的条目不上首屏**、降级进"纯方法论文档"栏（规则 12 工程化）。
- **名字用展示名 title**：catalog 存 `name`（kebab 唯一键）+ `title`（拟人化展示名），两字段分离（v0.1 新增）。

### 2.2 详情页（自上而下，抄 Civitai 详情序 + CapCut 用量信任）

1. **演示区（最大）**：自动播放 demo-video / 样张画廊，附 `preview.caption`（输入→输出对照，抄 HF）。
2. **标题 + 一句效果**：`title` + 一句话人话版 description 展示态。
3. **主 CTA**（演示正下方，抄 Civitai 双钮）：`接入 Nomi`（动词人话，不叫"安装"）+ `先看来源`（次要）。
4. **规格/使用提示**（kind 分型）：skill=装法+工具白名单；effect-pack=铺到画布；lora=底座模型+建议 strength/触发词（抄 Civitai 规格表）。
5. **分类双轨**：domain 标签 + craft 标签 + modality。
6. **作者卡**：可点、显示来源 repo/作者（抄 Civitai 作者卡 + Figma @作者）。
7. **安全审计区**：scanned-pass 绿 / unscanned 黄「未经第三方审计，装前自查」/ fail 红不进目录（抄 skills.sh）。
8. **License + 免责**沉底（抄 Civitai）：商用许可允许/署名 + "合成数据，不复制艺术家"式免责 + 「收录 ≠ 官方推荐」。
9. （可选，P1+）详情挂"被谁用过 / Remix 墙"提升可信（抄 HF Spaces using N）。

### 2.3 首页（效果瀑布流，不做文字货架）

- 全屏效果流：一格 = 一段静音循环成片/样张，文字压底（抄 SeaArt/CapCut）。
- 分类 = 顶部主导航（精选/技能/风格包/LoRA）+ 二级 chips（domain）；不抄 HF 左侧长表单。
- hover 主动作 = 播放/一键试（Try it out，抄 Figma）；点击进详情；两层渐进。
- 冷启动官方精选垫底避免空墙（抄 Notion Featured）。

### 2.4 榜单与口径（开发者视图，次要）

- All Time / Trending / Hot 三榜 + telemetry 口径（抄 skills.sh）——但**这是开发者模式**，不是主橱窗；首版可后置。
- 投稿 = GitHub PR / CLI 发布（发布即收录），人工策展负责 title/domain/preview 补全与 curation 提升。

## 3. 收录 → 展示 → 安装 的数据流

```
第三方技能/资产(owner/repo@skillPath · huggingface repoId)
   │  (投稿/爬取 + 校验 + preview 采集 + 安全审计)
   ▼
catalog.json  ←── 单一真相源（Git 仓库，PR 合入制）
   │  网页端：CI 渲染静态站（效果瀑布流/详情/榜单）
   │  桌面端：拉 manifest → 比对 skills-lock.json 哈希 → 下载/安装/更新
   ▼
Nomi（分型接入：skill 拷目录 · effect-pack 铺画布 · lora 本地 ComfyUI 落位）
```

## 4. P0 落地物清单（建议范围）

1. `packages/schemas/` 下：`catalog-entry.v0.schema.json`（Zod 或 JSON Schema）+ 示例（含 kind/preview/title）
2. `nomi skill validate <dir>` → 对齐 agentskills.io 规则的校验器（可先包 `skills-ref validate`）
3. 采集管线脚本：给定 `owner/repo` | `hf repoId` → 拉取 → 解析 → 产出 catalog 条目（含 preview 采集）
4. 首版静态站（效果瀑布流 + 详情 + 按 kind 分型接入），CI 重建
5. 桌面端：catalog manifest 拉取 + 与 `skills-lock.json` 合并的更新检测（P2）
