# Catalog Registry Prototype（P0 可运行原型）

> 对应立项 `docs/plan/2026-09-07-skill-catalog-registry.md` P0。真实数据跑通，未接产品代码（生产化 = PR-a/b 落地时把这些逻辑迁进 `packages/schemas/catalog-registry/` + scripts + 主进程）。

## 文件

| 文件 | 作用 | 状态 |
|---|---|---|
| `catalog-entry.v0.schema.json` | catalog 条目 JSON Schema（v0.1：kind/preview/title/两区治理） | ✅ 定稿 |
| `validate-skill.mjs` | `nomi skill validate` 原型：目录级（SKILL.md frontmatter 规则，对齐 agentskills.io）+ catalog 级（结构不变量） | ✅ 跑通 |
| `collect.mjs` | 采集管线原型：GitHub raw + HF API → 解析 → 条目 → 校验/分区 → out.json | ✅ 跑通 |
| `seeds.json` | 测试种子（3 GitHub skill + 2 HF LoRA） | ✅ |
| `out.json` | 5 条真实采集产物（运行管线生成） | ✅ |

## 运行方式

```bash
# 校验一个技能目录（外部标准 kebab-case）
node validate-skill.mjs <dir>
# 校验内建技能（internal 模式：允许 Nomi 点号分段命名）
node validate-skill.mjs <dir> --internal
# 校验整个 catalog 结构
node validate-skill.mjs --catalog catalog.json
# 采集管线：seeds → out
node collect.mjs seeds.json out.json
```

## 跑通记录（2026-09-07）

- 内建 `skills/` 全量 33 个扫 internal 模式：**31 合规、2 暴露真实命名不一致**——`skill-author`（name `workbench.creation.skill-author`，目录取末段）与 `workbench-generation`（name `workbench.generation.canvas-planner`，目录取首段）。Nomi 内部点号分段 ↔ 目录连字符的映射规则不统一，已记待项目走查（本原型不改产品代码）。
- 采集 5 条全成功，关键分区正确：
  - `hf::larryvrh/MiniMax-H3-Turbo-Lora` → license apache-2.0 / candidate / comfyui-install / 底座 Comfy-Org/MiniMax-H3 / 50.2 万下载
  - `hf::fal/MiniMax-H3-Realism-People-LoRA` → license other → **open-directory**（真人 likeness 正确落开放区）
  - anthropics canvas-design license "Complete terms in LICENSE.txt" → 归一化 other → open-directory
- 大样例 `catalog.sample.json` 57 条已迁移 v0 → v0.1（补 kind/preview/title + license 分区），过 catalog 校验 ✓。

## 已知缺口（诚实记录）

- license=无 的条目当前落 candidate——严格说应进 open-directory 或需人工策展确认，规则待拍板（schema 里 candidate→official 需 security.verified=official 已拦一道）。
- GitHub 采集只探 2 个候选路径（`<dir>/SKILL.md`、根 `SKILL.md`）；Vercel CLI 的 3 层深度探测待生产化补齐。
- preview（演示/样张）字段已入 schema，采集尚未自动抓样张 URL（skill 需托管小样、lora 需抓 HF model card 图），留 P1 网页站阶段。
- 无自动化测试文件；生产化时按立项 PR-a 补 vitest 夹具（合规/违规/分区三组）。
