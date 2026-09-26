# Phase 0 契约卫生账本

> 状态：✅ 盘点收据完成；Phase 1 迁移放行仍 BLOCKED
> 基线：`origin/main@1f39ea3cf` · 盘点日期：2026-09-26
> 范围：只读盘点 `docs/fixes/*.root-cause.json` 与现有审计资料，不修改历史生产契约。

## 结论

Phase 0 先把“契约数量”与“结构问题数量”分开。606 份根因合同不等于 606 个独立架构问题；后续施工单位是去重后的 `class_root` 和共享边界簇。历史合同保持原样，卫生债通过外部例外账本追踪，避免为了让旧 JSON 看起来完整而改写当时的事实。

## 机器盘点

| 项目 | 数量 | 解释 |
|---|---:|---|
| 根因合同总数 | 606 | `docs/fixes/*.root-cause.json` 全量 |
| schema v3 | 585 | 当前完整合同形状 |
| schema v2 | 9 | 历史版本，冻结 |
| schema v1 | 12 | 历史版本，冻结 |
| 非空唯一 `class_root` | 590 | 606 份中 593 份有非空值；两个重复组分别为 3 条和 2 条 |
| `UNCLASSIFIED` macro bucket | 1 | 3 份已有 `class_root` 暂不能按确定性规则归入七簇；13 份缺 `class_root` 是独立 hygiene exception，可暂按 scope 分簇但必须人工复核 |
| 缺 `class_root` | 13 | 进入例外账本，不能进入新的 recurring lane |
| `recurring` | 551 | 字段位于 `recurrence.classification`；必须能生成门表并绑定共享边界 |
| `one_off` | 30 | 仍需保留证据，不自动升级为结构簇 |
| 缺 recurrence | 25 | 先补分类，不改变历史根因结论 |
| 有 `invariant_owner_layer` | 374 | 其余 232 份是 owner 证据债 |
| 有 `doors` | 181 | 其余 425 份是历史门表债；不等于有 425 个新 owner |
| 有 `entry_points` | 593 | 13 份缺入口字段 |
| 有 `invariants` | 593 | 13 份缺不变量字段 |
| 有 `residual_risks` | 598 | 8 份缺残余风险字段 |
| 有 `migration` | 598 | 8 份缺迁移字段 |

字段缺口还包括：`shared_boundaries` 56、`same_class_entry_points` 56、`prevention` 55、`legacy_paths` 48、`dependency_lifecycle` 48、`class_regression_tests` 57。按当前 JSON 原文扫描，5 份合同含 `not verified`，192 份含 `pending/blocked/deferred`；这些是证据状态，不能被改写为完成。

逐合同映射见 [`contract-cluster-map.json`](2026-09-26-phase-zero-contract-cluster-map.json)，逐条例外见 [`contract-exceptions.json`](2026-09-26-phase-zero-contract-exceptions.json)。映射统计为 606 份、590 个非空唯一 `class_root`、13 份缺 `class_root`，另有 3 份无法按确定性规则归入七簇，保留在 `UNCLASSIFIED` bucket，Phase 1 前必须人工确认。

## 例外处理政策

| 例外 | 处理 | owner | 进入条件 |
|---|---|---|---|
| v1/v2 历史合同 | 原文冻结；在本账本登记 `contract_version_exception`、责任人、到期日 | 根因合同维护人 | 只有对应问题再次复发时才升级为 v3 |
| 缺 `class_root` 的 13 份 | 先人工归类或标为 `unclassified`，禁止新 lane 直接复用 | 架构协调 lane | 归类依据必须有代码锚点 |
| recurring 无 `doors` 的 425 份 | 不把读入口冒充决策 owner；补门表按风险分批，优先当前活跃/高风险合同 | 对应 owner | 写入 `node scripts/door-map.mjs` 收据后才可迁移 |
| 缺 invariant owner 的 232 份 | 进入 owner 补齐队列；没有 owner 的概念不能新增生产写口 | 架构协调 lane | 先绑定 bounded context，再写代码 |
| `not verified`/`pending`/`blocked` | 保留原状态，绑定证据类型、责任人和截止日期 | 对应交付 lane | 真实运行证据替换后才可关闭 |

“历史合同不改”不代表债务被忽略：例外账本必须有 `contract_id`、`exception_kind`、`owner`、`due`、`status`、`evidence` 六列。状态只允许 `open / scheduled / verified / waived`，`waived` 必须附理由和替代防线。

## 结构聚类规则

1. 先按规范化 `class_root` 去重。
2. 再按 `shared_boundaries`、`same_class_entry_points`、`doors` 的交集连边。
3. 目录、日期、PR 或文件名只能作为证据，不作为簇的主键。
4. 同一 `class_root` 多份合同合并成一张施工卡，但保留所有合同 ID 和各自的回归测试。
5. “同层顺带改动”与真实类根因分开；误报进入 `false_positive` 清单，不从证据中删除。
6. `doors` 是事实入口清单；决策门、写 owner、read projection 单独计数。

Phase 0 的账本因此不追求把 606 份 JSON 变成一份大 JSON，而是建立从合同到结构簇、从结构簇到唯一施工 owner 的可追溯关系。
