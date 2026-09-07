# Catalog 收录策略 v1：市场认可度门槛 + 全量吸纳（2026-09-07 用户拍板）

> 用户原话转译：做大规模调研与吸纳，但要筛选——**以市场认可度为筛选维度**（别人认为它好、且好到一定程度 → 收录），达标前提下**尽可能全量收录**。
> 配套：prototype 打分脚本逻辑见本目录 `prototype/README.md` 与 `prototype/score-demo` 思路；门槛公式可复算。

## 0. 一句话

**自动门槛先砍「没人认」的，人工只做策展不做法官。** 每个候选资产先算一个透明的"市场认可分"，过了门槛才进 catalog；没过门槛的进"待观察池"不进目录。通过门槛的尽量全收，宁可目录大、不可漏好货。

## 1. 市场认可分（MarketScore）—— 透明可辩护的公式

```
MarketScore = 0.6·log1p(下载量/安装量) + 0.4·log1p(点赞数/likes)
```

- 下载量权重 60%（"真有人用"是最硬的认可）、点赞 40%（"有人愿意表态"）。
- `log1p` 压长尾：10 万下载与 100 万下载的差距远小于 0 与 100 的差距——避免头部通吃、给中腰部公平机会。
- 按资产来源选信号：GitHub 技能 → stars 作下载量代理 + repo 级信号；HF LoRA → downloads + likes 直接可用；官网聚合站 → 安装量（telemetry）。

## 2. 分档与门槛（三级，不是一刀切）

| 档 | 规则 | 收录动作 |
|---|---|---|
| **S 档 · 头部** | 分数 ≥ P85 分位（示例 6.19） | 全量收录 + `curation: curated`，进首页精选候选 |
| **A 档 · 达标** | P15 ≤ 分数 < P85（示例 2.36–6.19） | **全量收录** + `candidate`（默认展示于目录，无样张不上首屏） |
| **待观察池** | 分数 < P15 或 0 下载 | **不进 catalog**；单独存 `watchlist`，月更一次看是否升温 |

- 分位门槛随池子大小动态计算（对 111 条是 P85=6.19；池子大了门槛自动抬）。
- **门槛是下限不是上限**：达标就全收（用户明确"尽可能全部收录"），不再人工挑肥拣瘦。
- 门槛之上仍有红线过滤（**与分数无关，一票否决**）：无 license 且不可补证 / gated / 已知恶意 → 直接拒绝或 open-directory 分级（见 §4）。

## 3. 合规与内容过滤（在分数之后跑，一票否决）

| 信号 | 处理 |
|---|---|
| license = none / other | 降级 `open-directory`（收录但分区），官方源白名单除外 |
| 真人 likeness（fal Realism-People 类）| 只进 open-directory + 明示，绝不上官方精选（红线不动） |
| gated / adult / NSFW | open-directory + 分级声明；NSFW 需额外内容分级字段 |
| repo 已删 / 404 | 采集时剔除 |

## 4. 收录范围与流程（"大规模 + 全量"怎么落地）

```
源A：GitHub 技能池（awesome-lists、聚合仓库如 samuraigpt 60 技能、anthropics 官方…）
源B：HF 模型/LoRA（minimax-h3、wan、hunyuan…按底座逐个关键词扫全）
源C：官方/自营效果（Nomi 内建 skill/effect-pack 直接进，无需打分）
   ↓ collect.mjs 采集（拉 frontmatter/元数据 → 归一 → MarketScore）
   ↓ 门槛 + 红线 → catalog.json + watchlist.json
   ↓ 人工只做：title 拟人化补全 + domain/craft 归类 + preview 样张挂载（策展，不是法官）
```

**批量执行计划（下一步，需你点头后开跑）**
1. **HF 全量**：对 minimax-h3 / wan / hunyuan / cosmos 等每个视频底座关键词全扫 → 打分 → 预计收录数十至百余条（已验证 111 条 minimax 可跑通）。
2. **GitHub 全量**：从已核验聚合池 + awesome 索引逐仓采集 → stars 打分 → 收录达标技能。
3. **watchlist 机制**：0 下载/低分的不丢，进池月更——保证"好到一定程度"随市场动态上浮。

## 5. 记录与可辩护性

- 每一条 catalog 条目带 `validation.checkedBy` + `stats`（分数可复算：下载/点赞是原始数据）。
- 门槛公式、分位、当日池子大小记录在 catalog 元数据（`scoring: {formula, p85, p15, poolSize}`），任何时间可复算与审计——收录决策不黑箱。

## 5.1 原型已跑通（2026-09-07，prototype/collect.mjs）

- **市场信号按 source 取**：GitHub skill → stars 作下载代理（0.6·log1p(stars)）；HF → installs+likes 双信号。同一公式跨源可复算。
- 打分自动分档：`tier: S(≥P85)/A(≥P15)/watch(<P15)`；S 档 candidate 自动升 `curated`；红线（license none/other、真人 likeness）仍优先压到 `open-directory`。
- 真实样例验证：anthropics/skills 17.5 万 stars→7.24 分 A 档；HF `larryvrh` 50 万下载+933 likes→10.61 分 S 档自动 curated；fal Realism-People（真人 likeness, license other）8.95 分但被红线压进 open-directory。**分数与红线独立工作、互不覆盖**。
- GitHub stars 走磁盘缓存（`gh-stars-cache.json`），匿名 API 限流 60/h 时降级 0 不阻塞（真实批量需 GH token 或分批）。

## 6. 待你拍板的两个参数

1. **P85/P15 分位**作为 S/A 门槛是否合适？（也可换绝对阈值，如分数 ≥ 5 直接收）
2. **GitHub 侧** stars 打分与"repo 内多个技能共享 repo stars"怎么处理（同 repo 技能用同一 stars 但各自按 SKILL.md 质量微调？）——倾向同 repo 同 stars、预览/description 质量做二次信号。

## 7. 全量执行计划（大规模调研+吸纳）

| 步 | 内容 | 规模预判 |
|---|---|---|
| B1 | HF 视频底座全扫（minimax-h3/wan/hunyuan/cosmos…）打分 | 数百条 → 收达标 |
| B2 | GitHub 聚合池全采（samuraigpt 60/digitalsamba 11/awesome 索引/已核验 43 仓） | 数百条 → 收达标 |
| B3 | watchlist 月更机制（低分不丢，随市场升温上浮） | 持续 |
| B4 | Nomi 自营效果直接进（官方源免打分） | 20+ 内建 |
