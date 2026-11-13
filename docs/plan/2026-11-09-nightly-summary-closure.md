# 夜跑汇总完整性与逐条状态

## 历史与选择

沿用 2026-10-23 汇总分栏方向（`docs/engineering/direction-checks/2026-10-23-nightly-summary-columns.md`），保留同一 issue 和整体红阈值。旧方向把无日志默认归产品，已被真实缺批次证据推翻。用户批准删除这条默认和通过数减法。三路比较：沿用共享汇总边界并删除误判最小；换新服务增加维护；删汇总丢失协调观察入口。因此只换现有边界的数据合同。

## 短版设计卡

- ★1 保住什么：协调能确认本夜完整性、新红、首次观测红 SHA/run 与上次绿 SHA；量具为 11-04 / 11-08 真实 TSV、run jobs 和同 SHA selected 清单重放。
- ★2 做法：现有 workflow 在安装前写 manifest/哨兵，report 接 needs；同一汇总脚本验证证据并合并 issue 受管状态块；不新增依赖。
- ★3 不做：不改走查/选择规则/超时/隔离，不通知账号，不在本轮写 issue、触发 workflow、推送或开 PR。
- ★4 老数据：首轮无账时红项为存量，首红 unknown；坏账显示 unknown。缺失/跳过保留已知红；真实绿再红开新段，前段留存。firstObservedRed 是观测点，不声称致因提交。
- ★9 验收：下列八项每项执行改坏红、还原绿；生产协议还核对 provenance/重复/畸形行与工作流静态合同。

## 验收清单与反例

1. 11-04 四批安装失败仅 1 条 exit0：显示批次失败，不能恢复；反例删完整性判断。
2. 11-08 应跑 380、收到 190：明确缺 190，不比较原始红数宣布改善；反例把缺失算绿。
3. exit125 单列，不计通过；反例并入通过。
4. 跨夜缺失保留红；绿转红列新红并记录首红 SHA/run、上次绿 SHA；反例缺失覆盖绿。
5. 受管块坏 JSON 或坏结构：unknown，不恢复；反例坏块当空基线。
6. 多条新红仅一条评论，各有失败行、日志链接、首红/上次绿；连续红不重发且无 at 符号；反例去掉差分。
7. 无环境特征的失败、超时、无日志均未定；反例恢复默认产品。
8. `--read-state <正文文件>` 输出合法 JSON；反例 CLI 忽略该入口。

## 系统改进

先在共享报告边界证实完整性，才允许恢复；状态只由有效观测推进。待发评论先写入同一状态账；发送失败保留首次红证据，下一次读取评论标记核对收据，已接收的不重发。每个 expected 独立算绿/跳过/缺失/红，批次与 needs 独立展示。旧红的缺失不等于恢复；状态块坏了不制造空账来掩盖未知。报告和 issue 共享完整性结果。

## 官方语义核实（2026-11-09）

- [needs context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#needs-context)：job result 为 success/failure/cancelled/skipped，matrix 汇总不能代替每批哨兵。
- [job dependencies](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs)：report 的 always 在依赖失败后仍执行，不保证任何结果齐全。
- [toJSON](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#tojson)：经 env 传 JSON，不在 shell 源码里展开。

## 证据边界

历史 run 没有新 manifest/哨兵；夹具的 selected 与 job conclusions 来自只读分诊下载的数据，用作同 SHA 重放输入，不伪称旧 workflow 产过新协议。未验证：真实 GitHub issue 更新与评论、Actions 执行（本轮禁止外部写入）。
