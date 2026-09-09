# 拆解表真实用户走查

> 状态：批修后复验及同 profile 后半段完成；完整单窗脚本保留缩放动作失败记录 · 2026-09-10
- 隔离 profile：`/var/folders/f4/vz86j5nd0_sf56qdhzrmbbvw0000gn/T/nomi-sidebar-ui-7P874S`；只复制加密 model-catalog，项目由 UI 新建。
- 一窗口，键入三镜纸船文稿，UI 选择 GPT-5.5，点「新建分镜方案」，真实模型返回三个图片镜头并审批保存。
- 首扫请求 1 次；保存审批 1 次；媒体生成提交 0；单镜 materialize 后在费用确认取消。
- **S1** 保存 owner 成功但表节点被事务补偿；Agent 随后重复请求确认。根因：两处分镜 owner 写未继承 proposal gesture。
- **S2** 全页改第一镜后表才出现；表行和原始镜头均显示「月光映照纸船，水面安静。」；证明既有同步桥有效。
- **S3** 双击第三行进入全页但目标在屏外（top=1107.5），未选中未聚焦。批修：事件止冒泡 + 仅可见工作区消费定位请求。
- **S4** fit-view 缩至约 36% 仍完整表，文字难读。批修：密度读 React Flow transform，不读陈旧 canvasZoom。
- 密度三数：原稿屏无行动价值行约 2；全页反复出现参考未使用 3 次；取消生成确认有「取消」可执行动作，但金额显示「目录未标价」。
- 首调模型工具参数可解析，保存回合成功 0/1（自提议取消）；批修后须复验才可交付。
- 转录：隔离项目 `.nomi/agent-sessions/--nomi-lane-main--/2026-09-09T19-06-05-203Z_01a08790-2213-7126-bbff-379159dced55.jsonl`。
- 首扫截图：`tests/ux/shots/shot-table-storyboard-projection/01-before-empty-library.png` 至 `09-third-row-navigation.png`。
- 前后证据：`02-before-document.png`、`04-after-canvas-missing-table.png`、`06-materialized-before-spend.png`、`07-after-edit-canvas.png`、`08-after-fit-table.png`。
- 自动脚本：`tests/ux/shot-table-storyboard-projection.walk.mjs`，无 store/桥写、无夹具、无刷新、无 mock 模型。
- 复验 profile：`/var/folders/f4/vz86j5nd0_sf56qdhzrmbbvw0000gn/T/nomi-shot-table-storyboard-B3VyJU`；真实拆镜 1 次、保存审批 1 次，媒体生成提交 0。
- 复验立即生成表节点成功；materialize 取消后第一镜修改同步到原始镜头；`replay-04-table-created.png` 与 `replay-05-before-spend.png`。
- 脚本在「滚轮 -600 必达 full」动作假设处红灯，实际缩放只达 compact；**未修改断言/超时**。finally 关窗后经主会话授权在同隔离 profile 继续，无第二次模型拆解；不能声称完整单窗脚本全绿。
- 改用现役「重置视图」明确 100%；后半段 full/compact、表与镜头提示词同步、第三行 selected/focus/inViewport、表内滚轮不改 viewport 全部通过。第三行 top=649。
- 清晰验收图：`resume-11-shot-prompt-editor.png`；定位图：`resume-07-third-row-focused.png`；滚轮图：`resume-08-inner-wheel-guard.png`。均复制在本报告同名目录。
- 卡片档发现框架默认minZoom=0.5覆盖既有0.2；按任务授权接通既有20–300%常量。补验Home20%后card通过：`final-12-density-card-real.png`。
- `resume-11-shot-prompt-editor.png` 打开唯一 image 节点 `gen-v2-image-mtuhvpif-rpq7` 的提示词编辑面；首句月光可见。双标题2/1为旧迁移给表错误领号造成，非重复materialize。
- 迁移已改用canonical编号predicate/backfill，table/text红回归均复现；UI复制方案新表`gen-v2-shot_table-mtuikf3i-kxo8`落盘无shotIndex，旧image2身份未重排。
- 冷启动后两表恢复；只读落盘确认新表仍无shotIndex，旧image2未改；截图`final-14-restart-two-tables.png`。
