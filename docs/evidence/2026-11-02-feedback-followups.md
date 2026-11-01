# 反馈通道收尾验证

第 1、2、3、5 条已实现；第 4 条触发设计卡停点，旧包目录剥离未实现，历史清单说明已改正。本页是实现自验，不是独立验收报告。

## 清单

| 项 | 结果 | 证据 |
|---|---|---|
| Q1 | 过 | 整包测试注入 EACCES、EBUSY、EPERM、EIO；发送返回现有失败结果，盘上两份旧件按字节不变；恢复后两份能发送 |
| Q2 | 过 | 发送已成功，出账读取 EBUSY；两份旧件保留；后台补发不抛异常 |
| Q3/Q4 | 过 | 坏 JSON 原文留在唯一 `.corrupt` 文件；新反馈入队；文件缺失正常从空开始 |
| H1 | 过 | 真实宿主 + fake timers：按时关闭、重开不被旧任务关闭、卸载清除定时器与监听 |
| S1/S2 | 过 | 默认不勾内容时整包摘要的未知 host、文件路径、假密钥零命中；内置 host 保留；用户留言原有 host 保留 |
| O1/O2 | 未验证 | 新旧 schemaVersion 与 context 字段一致，无可靠投影版本标识；按设计停点未改补发 |
| M1 | 过 | 两种连接形状：地址、连接名、假密钥零命中，模型名在；包内清单与中英翻译符合合同 |

所有自动测试均设置 `NOMI_TEST_NETWORK_GUARD=1`，假数据、注入发送函数，不访问真实资料或外部接收端。

## 先红与反证

实现前：3 个测试文件，11 failed / 44 passed（55）；错误对应 Q1、Q2、Q3、S1、摘要单测、M1、宿主卸载。

| 反例 | 退出码 | 原始末行 |
|---|---|---|
| readStore 改回所有读错误当空 | 1 | Tests 4 failed / 16 skipped (20) |
| 摘要不走 host 判定 | 1 | Tests 1 failed / 19 skipped (20) |
| 宿主重开不 clearTimeout | 1 | Tests 1 failed / 2 skipped (3) |
| 宿主卸载不 clearTimeout | 1 | Tests 1 failed / 2 skipped (3) |
| O1/O2 剥附件反例 | 未验证 | 第 4 条停点，无剥离实现可变异 |

每轮 finally 按原字节写回，并核对 SHA-256。还原后重跑受影响目录：17 files / 296 tests passed，退出码 0。

## 命令与边界

- `pnpm exec vitest run electron/feedback electron/telemetry src/ui/community`：17 files / 296 tests passed；目录测试排门岗锁，退出码 0。
- `pnpm run build`：已排门岗锁，退出码 0；前端有 chunk size 提示。
- 结构守卫扫描：新调用的 `maskForeignUrls`、`renameSyncWithRetry`、`zhFeedbackReport`、`FeedbackShareHost` 没有命中额外的 `.structure.test.ts` / `.guard.test.ts`。
- 根因合同为新增 schema v3，不改历史合同。门表由 door-map 生成：基线 11 扇、当前 12 扇，新增的一扇是摘要复用地址判据。

Windows 真占用、真实外部投递、中英真窗口截图与独立验收均未验证。自动测试证明主进程结果与现有失败分支的连接，不替代桌面真实任务收据。
