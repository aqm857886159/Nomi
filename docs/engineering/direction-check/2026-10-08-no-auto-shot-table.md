# 方向检查：画布自动建分镜表（shot_table）

> 触发：`node scripts/fix-churn.mjs` 对 `exec/ensureStoryboardShotTable.ts`（目录 14 天第 9 个 fix）、`capability/multiShotCanvasLanding.ts`（文件第 10 个）、`nodes/shotTable/`（目录第 5 个）全部命中。
> 结构结论：用户 2026-10-08 已拍板（docs/design/2026-10-08-approved-designs.md ①；原话「我们以前提到我们经常莫名其妙生成分镜表，这个可以删掉吧」）——画布里自动建的分镜表删掉，不再补。

## 0. 一句话根因

派生视图（分镜表）被当成数据：写入口（写分镜方案、制作流程落地）每次都顺手造一个画布节点，于是要靠「已有就不建、重叠要再读、删了不许复活、标题用计划名」一串补丁维持它，每个补丁又催生下一个。

## 1. 归类表

| 提交 | 直接原因 | 类 |
|---|---|---|
| fb3ee6a35 同一 Run 重叠落地只建一张表 | 两次落地都在 await 前判成「没有表」各建一张 | 视图被当数据，要幂等造 |
| a67becd6e / 923d19b97 落地对账、切项目 | 落地对账与建节点时机错位，把「画布没有」当「用户删了」 | 同上（造节点的时机 owner 不清） |
| 896f236ff / b17df53c7 落地后画布移动、重开后空白节点 | 落地写节点同时带出视图与视口副作用 | 同上（落地副作用面过大） |
| 59dd536bd 分镜表自开各回到自己的主人 | 写方案触发建表与打开，owner 错层 | 同上 |
| 其余（spend、auto-reference、react19 等） | 与建表无关，碰同目录 | 不归本类 |

## 2. 为什么会一直出现

建表这件事没有唯一入口也没有唯一时机：方案写入口与制作流程落地各造一份，用户从未要求；表又可被用户删，于是系统要区分「没建过」和「建了被删」。体验铁律不适用（不是参数 / 选择 / 点击结果问题），属结构问题。

## 3. 不改结构会冒出什么

| 预测 | 验证 |
|---|---|
| 新的写入口（如新的 Agent 动词）再顺手造表，用户又看到莫名其妙的表 | `git grep "kind: 'shot_table'"` 在 src 中只应剩拆参考片一处 |
| 删表后重开项目 / 重放落地又复活 | `multiShotCanvasLanding.test.ts` 的 production landing 用例 |

## 4. 靶子独立性

测试原先把「表存在」当契约（`shotTableProjection.integration.test.ts` 等），所以每个补丁都在往一个用户从未要求的靶子上补。本次靶子改为用户原话：写方案 / 落地后画布上没有 shot_table。

## 5. P0

分镜表不是独有数据，只是镜头的表格视图；视图由分镜方案视图 + 生成列表承担（别的线做）。无自写登记命中。

## 6. 选项

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 不适用（领域视图） | | | |
| 补 | 再加一道幂等 / 不复活判断 | 第 10+ 个补丁 | 同类继续冒 | 否 |
| 重写 | 统一建表入口 | 保留一个用户没要的视图 | 仍是第三视图 | 否 |
| 删 | 删两个造表入口，旧表只读保留 | 旧项目表保留由用户自删 | 低 | 是 |

## 7. 用户要权衡的核心

画布只放用户确认过的节点，还是继续附带一个表格视图——用户 10-08 已选前者。

## 特征测试清单

- `src/workbench/creation/storyboard/exec/shotTableProjection.integration.test.ts`：写方案（含 Agent 路）画布无表；旧表载入、编辑、删除正常。
- `src/workbench/capability/multiShotCanvasLanding.test.ts`：落地有节点和分组、无表；旧 production 表重放不重复、可删。
- `src/workbench/generationCanvas/nodes/shotTable/factBridge.test.ts`：拆参考片仍建表。
