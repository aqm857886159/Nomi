# C0 视频等待测试装配

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实现并通过本地验证，待 PR 评审。

范围：仅 tests/ux/g1 与测试装配；不改生产。按任务书第四轮总账簇 B 执行。
证据：~/Desktop/Nomi-switch-gate/artifacts/sweep/gate4b-20260909/nano/deviations.json。
症状：180 秒只齐 6/8，继续读取缺失 result.url 异常，05/06 级联不可达。
根因（recurring）：装配以固定完成数等待，collect 软断言失败后消费方仍假设所有产物存在。
同类入口：04 的 ready 计数与结果读取；05 的八镜入轴消费；02 修补跨真实/loopback 模型的档案。
共享边界：测试侧视频终态等待与结果筛选；记录缺失/失败而不把它当成功，保留完整八镜断言。
依赖：not-applicable，不升级库或新增框架。现有 Playwright poll 与生产节点/任务持久化状态为事实源。
红证：loopback 第 7/8 镜响应延迟 190 秒，原等待和消费代码不动。绿证：相同延迟重跑，必须导出三帧，再全量 sweep。
验收：类级回归、全量 sweep 零功能偏差、完整 gates exit 0、hooks 正常 commit/push、PR。
回滚：撤回本任务测试装配提交。

补充事实：直接把 HTTP 响应挂起会先撞到生产 120s transport timeout，因此红绿夹具使用已有 APIMart create→query 形状（electron/catalog/apimartVendor.ts:45–80），并同时设置 provider_meta_mapping（electron/runtime.ts:302–310/414）。前两次夹具装配失败保留在 artifacts/sweep，不能当目标红证。
原结果表达式的崩溃以真实 pending-result-snapshot.json 重放证明；纯 loopback 调度器还会等待审片，可能在读 URL 前等到视频，所以与真实供应商即时账本快照的后置行为必须区分。

重跑绿证（同一工作目录）：
`NOMI_WALK_MODE=collect NOMI_SWEEP_CASE_DIR=$PWD/artifacts/sweep/c0-video-wait-green-recheck NOMI_C0_VIDEO_DELAYS='{"7":190000,"8":190000}' node tests/ux/g1/c0-short-film.walk.mjs --dry-run`
红证原版源码固定为 `e1f7e7329f14ceded007082dd348449da4d08aaf:tests/ux/g1/c0-short-film.walk.mjs`，复制到同目录临时 `.walk.mjs` 后以相同参数运行。临时文件在验证后删除，不留旧实现。
绿证必须读 deviations.json 的功能断言，不能把 collect 进程 exit 0 当验收通过；feel:* 原样保留，不归本测试装配修改。
