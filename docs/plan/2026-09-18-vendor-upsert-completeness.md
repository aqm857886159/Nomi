# 供应商记录的完整性：写路径编译期闭合 + 存量一次性修复

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已实施（PR #816）
> 根因合同：[docs/fixes/2026-09-18-vendor-upsert-drops-fields.root-cause.json](../fixes/2026-09-18-vendor-upsert-drops-fields.root-cause.json)
> 调研：[docs/research/2026-09-18-record-rebuild-completeness/prior-art.md](../research/2026-09-18-record-rebuild-completeness/prior-art.md)

## 要解决的真实摩擦

用户接好一家供应商，Nomi 记住了两件只有它自己知道的事：这家的参考图怎么传（`assetIngestion`）、
`Authorization` 前面写哪个词（`authScheme`）。过几天他回设置页**只改了个名字**按保存——
这两项被静默抹掉，界面零提示。之后 Higgsfield 每次出站 401、参考图不再走这家自己的通道
（图出来了但参考图没被用上）。因果隔着几天 + 一次看似无关的操作，用户永远连不起来。

类根因不在这几个字段上：`apply*Upsert` 重建记录时按名字逐个搬字段（白名单式**保留**），
没被列举的字段保存后消失，而类型/门岗/测试三边都不会红。

## 范围

- 改：`electron/catalog/` 的三个 `apply*Upsert` 记录组装；新增 `upsertDraft.ts`（编译期穷尽）与
  `vendorFieldLossRepair.ts`（v12→v13 一次性修复）；`electron/shared/vendorFieldLossNotice.ts`（提示的共享契约）。
- 改：`src/ui/onboarding/` 连接卡上一条可关掉的提示（补不了的那部分明着告诉用户）。
- **不动**：`meta` 的内部结构、凭据加密边界、`seedBuiltins` 的常驻对账逻辑、`Mapping` 的传输契约语义。
- 回滚：两个新模块可整体删除，`apply*Upsert` 回到手抄清单；v13 只加字段不删字段，降级读得回去
  （但 `writeCatalog` 的高版本只读保护会拒绝旧应用写回，这是既有设计）。

## 验收门

1. 阳性对照在 `origin/main` 上必须红：改名保存后 `assetIngestion` / `authScheme` 丢失、`Mapping.delivery` 丢失。
2. 变异必须红：把任一字段从清单摘掉、或给 `Vendor` 加一个新字段而不改写路径 ⇒ `tsc` 报 missing property。
3. 修复的阳性对照：造一条 `authScheme` 被抹掉的内置家，走生产那支请求装配看真实出站头，
   修前 `Bearer`、修后 `Key`。
4. `pnpm run gates` 全量档绿。
5. **CI 独有的那道**：`check:prior-art` 的 PR 侧只在 `pull_request` 事件里跑（正文由工作流注入
   `PRIOR_ART_PR_BODY`），本地 `gates` 恒跳过——所以「本地全绿」证不了它。
   另一条坑：正文是**推送那一刻**的快照，事后 `gh pr edit` 改了正文不会让已跑的那次重新读到，
   必须再推一次（`synchronize` 事件才带新正文）。本地要提前验就跑
   `node scripts/check-prior-art.mjs --pr`。

## 先查别人

（完整报告见上方 `prior-art.md`；以下为结论与出处）

- **部分更新的三态语义是既成标准，不许自造** —— RFC 7396 JSON Merge Patch <https://www.rfc-editor.org/rfc/rfc7396.txt>：缺席=保留、`null`=「remove the Name/Value pair from Target」、有值=替换。
  本仓 `Model.customCall` 的注释「undefined=保留，null=显式删除」（`electron/catalog/types.ts:300`）已经是同一套，`Vendor.assetIngestion` 对齐它即可。
- **`-?` 会连 `undefined` 一起剥掉，这是第一版编译不过的根因** —— TS 2.8 发布说明 <https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-8.html>：`strictNullChecks` 下 homomorphic 映射类型移除 `?` 时**同时移除该属性类型里的 `undefined`**。解法是先取键 union 再用非同态映射补 `undefined`。
- **手册的 `Required<T>` 页会把人带偏** —— <https://www.typescriptlang.org/docs/handbook/utility-types.html> 只讲「去掉可选」、不提上面那条，只看它会得到相反结论。以发布说明为准，并已用编译器实测复核（两次变异都拿到真实报错）。
- **同一手法本仓已有先例，不是新发明** —— `electron/catalog/credentialConfigFields.ts:32` 的 `Record<keyof Vendor, VendorConfigFieldClass>`（「加字段不分级就编译不过」），运行期对偶是 `electron/catalog/credentialConfigFields.test.ts:18` 的 `satisfies Required<Vendor>` 全量样本。本刀是同一类型上的另一根轴（那根问「是不是凭据」，这根问「保存时怎么裁决」）。
- **存量修复的默认形状是带版本号的一次性迁移** —— `electron-store` 的 `migrations` <https://github.com/sindresorhus/electron-store>（`'version': handler`，存量版本落后才跑）；本仓自己的 `migrateCatalogForward` v1→v12 阶梯（`electron/catalog/catalogStore.ts:125`）同形状，其中 v6→v7 还记了「迁移幂等，靠 bump 强制重跑」——要重跑就显式加一级，而不是让它常驻。
- **常驻补齐的反例与它的前提** —— `seedBuiltins.seedVendor`（`electron/catalog/seedBuiltins.ts:416`）是常驻对账，但它只迁移「仍指向我们旧默认值」的记录、用户改过就绝不覆盖。即常驻补齐必须带一条「什么时候不许碰用户的值」的判据；本刀的判据是 `!(field in vendor)`（键不存在才补）。而由于写路径已被类型闭合，这类丢失不可能再发生，常驻守卫守的是一件不会再来的事 —— 故选一次性迁移。

## #816 合并列车：迁移块拆分（2026-09-19 裁决）

main 的 catalogStore.ts 已到 800 行，合并本 PR 的 v12→v13 迁移后达到 801 行。按主会话裁决把 migrateCatalogForward 整块 move 到 electron/catalog/catalogMigrations.ts；原函数体、迁移顺序、版本号与逐步写盘保持不变。defaultCatalog 与 writeCatalog 通过参数传入；onDiskCatalogVersion 服务所有写盘路径，留在 store。既有 relay 再导出保持原路径。同步机器生成门表与合同路径，不增加运行时行为。

先查别人：复用本仓已拆出的 relayLegacyMigrations.ts、catalogMediaContractMigration.ts 等迁移模块；这是既有内部函数搬移，无新依赖或外部协议。回滚可整体 revert 本条拆分提交。验收：两个文件均 ≤800 行、check:filesize、原有 15 条测试（含真实请求装配的 Bearer→Key 阳性对照）、typecheck、review:branch 与全量 gates；随后普通 push 和原 PR 合并验证。
