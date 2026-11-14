# 设计卡：查任务不重传参考素材（F-poll-reupload）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：参考素材只在提交时交给供应商   线/负责人：F-poll-reupload   类别：[花钱][长跑]
```

方向检查（runtime.ts 热点，交用户拍板）：`docs/engineering/direction-checks/2026-10-22-poll-reupload.md`。

### 功能分类
- [ ] 新界面 / 改交互
- [x] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

| 格 | 结论 | 证据 |
|---|---|---|
| ★0 先查别人 | 纯 bug 修复，不要求。顺手确认：① APIMart 上传接口文档只说「上传后得到 URL 用于生成」，查任务接口只收 task_id（`electron/catalog/apimartVendor.ts` 的 `APIMART_VIDEO_QUERY_OP`）· **确认了**「查询步不需要参考」；② 引擎 B（制作 Run）早就是「封存前本地化一次」（`electron/capabilityCore/productionReferenceUrls.ts`）· **确认了**修法方向与另一台引擎一致；③ 自定义调用脚本也是「派发前本地化一次、脚本内自己轮询」（`electron/catalog/customCallDispatch.ts`）· **确认了**它不在本类里 | 文件行 |
| ★1 用户怎么用 | 当我用本地图做首尾帧 / 参考生成视频时，我想图只交一次、生成中途整理素材也不影响取回成片。步骤：放参考 → 生成 → 等（期间轮询几十次）→ 成片落画布。**不做**：不改提交时的上传（仍每任务上传一次）、不做跨任务上传缓存。**真实任务**：① #1279 场景 2（Seedance 2.0 fast 首尾帧 480p 4 秒）；② 同一条生成中途删掉参考节点；③ MCP / 外部 Agent 直接给 `data:` 参考的视频任务。**指标**：主指标「每任务每张本地参考的上传次数」目标 = 1（基线 26，量具：真付费账本 net-log 的 U 计数 + `electron/tasks/pollDoesNotReuploadReferences.test.ts`）；护栏「提交后删参考的任务取回成功率」目标 100%（量具：同测试第 3 例）；质量「创建请求里的参考地址 = 那次上传返回的地址」（同测试第 1 例） | 特征测试 / 协调真付费抽检 |
| ★1b 连带界面 | 无新文案。连带的是错误卡：修前查询阶段可能冒出 `asset-upload-failed`（「还没请求服务商 · 重试」），修后查询阶段不再产出该码；若用户自配映射把参考写进查询步，查询报一句不带 `asset-*` 码的说明，走「可找回」（重新取回，不重新提交） | `referenceFreeQueryOps.class.test.ts` |
| ★2 谁说了算 | 「参考什么时候交给供应商」唯一 owner = `referenceStage.stageSubmitsReferences`（提交步才交；概念 `asset.reference-submit-stage`）；执行边界 = `runtime.executeProfileOperation`（引擎 A 全部 HTTP 步唯一出口）。门表：`localizeAssetsForVendor` 3 扇（runtime / customCallDispatch / productionReferenceUrls），只有 runtime 那扇在轮询链上；`executeProfileOperation` 4 扇（runTask create、taskResultQuery query+result、catalogCommit 测试映射） | `node scripts/door-map.mjs localizeAssetsForVendor` / `executeProfileOperation` |
| ★3 一致与复用 | 复用现有 `collectLocalAssetUrls` 判本地素材值，不新造判据；与引擎 B、自定义调用「提交前本地化一次」同语义 | `git grep collectLocalAssetUrls` |
| ★4 全状态 | 排队 / 运行中：查询不读盘不上传；成功：成片照常落地；失败（上游说失败）：照旧；提交后参考丢失：不受影响；用户映射查询步引用参考：查询报错落「可找回」，说明改映射；能力不可用：不适用（不新增能力）。无新增文案（报错句在主进程，走既有错误卡） | 特征测试 |
| 5 中途表 | 排队 / 运行中 × 停止：与修前相同（停止不碰上传）；× 关窗 / 重启：无状态重建的查询本来就不带参考，不变；× 断网：查询失败照旧重试，不再因上传通道失败而失败；× 连点生成：每次生成各自上传一次（与修前相同，指纹缓存命中则不提交）；× 提交后删参考：修前查询失败、修后正常取回。花费：都不多扣（修前也不多扣生成费，只多耗上传流量） | 特征测试第 1、3 例；人工 |
| 6 外部数据与失败 | 供应商查询接口只收任务号（APIMart / new-api / 方舟原生 / KIE / fal / Runway 等内置映射全集由门岗测试遍历）；用户自配映射若把参考写进查询步 → fail-closed 报错，不发本机地址 | `referenceFreeQueryOps.class.test.ts` |
| ★7 性能 | 不适用：不新增用户操作；只少做事（每次查询少读盘、少上传） | — |
| 8 真实条件 | Windows 本机跑特征测试 + 门岗；本机假上游走查（免费）；真付费 `unverified`，待协调跑一条 #1279 场景 2 对账（期望序列 `B U U C P…P D`） | 协调 |
| 拍板图清单 | 不适用：internal-no-visible-change：只改主进程何时上传参考，界面无变化 | — |
| ★9 验收与回滚 | **验收清单（动手前写全）**：① 特征测试 3 条修前红、修后绿；② 变异：`stageSubmitsReferences` 恒 true → 特征测试红；③ 门岗测试遍历全部内置查询 / 取结果步全绿，且门岗自身有牙；④ 相关目录 vitest（`electron/tasks` `electron/catalog` `electron/runtime*`）全绿；⑤ 本机假上游走查：创建时照常上传、成片落地；⑥ 真付费一条（协调）：每张参考上传 1 次、查询期间 0 次。**反例（这一类会从哪回来）**：另一个查询调用方忘了说是哪一步（`stage` 必填，typecheck 拦）；新供应商的查询步模板引用参考（门岗遍历目录自动覆盖）；用户自配映射（运行时 fail-closed）；`data:` 内联参考（特征测试第 2 例）；引擎 B / 自定义调用（门表核过，各自只本地化一次）。**回滚**：revert 本 PR 的提交即恢复修前行为（无数据迁移）。独立验收：V-pollupload 待出 | 本卡 / PR 正文 |
