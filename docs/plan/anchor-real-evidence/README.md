# C72 验收收据

- 现场复盘：`gate-r2-write.json` 摘录指定原生 JSONL 第3/9554行。该次输入明确禁外部参考，写入7个文字锚；不能把它称为丢失已传图片。
- Loopback：真实目录 + 一个角色图片锚 + 八镜，先红后绿；生产写入最终8/8模式吃参考、8/8合法槽绑定。相关5文件35测试通过；日志本地 `class-green.log`。
- 真机：`screenshots/red-*` 为改前，`green-*` 为改后；`unsupported-*` 展示「该模型不吃参考」。人工检查完整外壳与行截图，改后有真实缩略图、可批量生成8镜。
- 官方仅一次 HTTP200：`official/report.json` 保留首次宿主拒绝，不改成成功。原始文本见 `official-raw-plan.json`：模式8/8，但未知 character_ref 槽导致合法绑定0/8。输出令牌6362、输入10920；峰时费率上界¥0.272682256，非账单实扣值。预算预检另一次在发送前拒绝，0请求0费用。
- 修正后原样本零网络重放：`official-replay/report.json`、`persisted-plan.json` 证明模式8/8、绑定8/8，实际写入成功且幂等。`after.png` 与逐行截图经人工检查。未追加付费抽样，不能声称修改后的首次在线回合成功；本次在线宿主成功率0/1，修复后重放1/1。
- 原生完整SSE与请求保留在本地 `.tmp/anchor-real-official-02`；`official/raw-artifacts.json` 提供路径与哈希，未提交大体积原始流。所有项目/素材均为隔离夹具；没有媒体生成或访问用户资料库。
- 本次覆盖共享工具写入及生产单次规划IR；不代表常驻Agent多工具旅程或生成画面一致性验收。关键帧链沿用既有路径。

先红日志（本地）：red.log、red-ready.log、red-authored-slot.log、red-default-identity.log、red-production-ir.log；完整门岗日志：gates.log。

完整 gates 退出0：所有阻断契约通过，Vitest 1301文件/11897测试通过（1文件/2测试跳过），Agent运行时与构建通过。存在文档 advisory 与构建 chunk-size warning；无阻断失败。命令 `python3 scripts/with-gates-lock.py -- pnpm run gates`，验证基线807c475d68f0。
