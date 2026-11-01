# 反馈通道收尾验证

五条已实现，第 4 条按同一轮协调裁决完成。本页是实现自验，不是独立验收报告。

## 清单

| 项 | 结果 | 证据 |
|---|---|---|
| Q1 | 过 | 整包测试注入 EACCES、EBUSY、EPERM、EIO；发送返回现有失败结果，盘上两份旧件按字节不变；恢复后两份能发送 |
| Q2 | 过 | 发送已成功，出账读取 EBUSY；两份旧件保留；后台补发不抛异常 |
| Q3/Q4 | 过 | 坏 JSON 原文留在唯一 `.corrupt` 文件；新反馈入队；文件缺失正常从空开始 |
| H1 | 过 | 真实宿主 + fake timers：按时关闭、重开不被旧任务关闭、卸载清除定时器与监听 |
| S1/S2 | 过 | 默认不勾内容时整包摘要的未知 host、文件路径、假密钥零命中；内置 host 保留；用户留言原有 host 保留 |
| O1 | 过 | 五份真实旧目录由 v0.24.0 原 builder 组出报告，补发只剥目录；清单、字节数与 legacy-catalog-dropped 一致，其余内容保留 |
| O2 | 过 | 同批目录新组包补发按字节不变；立即发送与数字 0 计数也保留；413 与其他货物不受影响 |
| M1 | 过 | 两种连接形状：地址、连接名、假密钥零命中，模型名在；包内清单与中英翻译符合合同 |

所有自动测试均设置 `NOMI_TEST_NETWORK_GUARD=1`，假数据、注入发送函数，不访问真实资料或外部接收端。

## 先红与反证

实现前：3 个测试文件，11 failed / 44 passed（55）；错误对应 Q1、Q2、Q3、S1、摘要单测、M1、宿主卸载。

| 反例 | 退出码 | 原始末行 |
|---|---|---|
| readQueueStore 改回所有读错误当空 | 1 | Tests 4 failed / 16 skipped (20) |
| 摘要不走 host 判定 | 1 | Tests 1 failed / 19 skipped (20) |
| 宿主重开不 clearTimeout | 1 | Tests 1 failed / 2 skipped (3) |
| 宿主卸载不 clearTimeout | 1 | Tests 1 failed / 2 skipped (3) |
| O1 绕过发送前处理 | 1 | Tests 5 failed / 36 skipped (41) |
| O2 不分新旧剥目录 | 1 | Tests 6 failed / 35 skipped (41) |

每轮 finally 按原字节写回，并核对 SHA-256。第 4 条实现前定向切片为 12 failed / 9 passed / 20 skipped（41），其中 20 个未选中的是先前四条。第 4 条反例还原后重跑受影响目录及旧目录回归：31 files / 406 tests passed，退出码 0。

## 命令与边界

- `pnpm exec vitest run electron/feedback electron/telemetry electron/shared/contracts src/ui/community src/i18n tests/old-user-data/feedback-catalog.test.mjs`：31 files / 406 tests passed；目录测试排门岗锁，退出码 0。
- `pnpm run build`：已排门岗锁，退出码 0；前端有 chunk size 提示。
- 结构守卫扫描：新调用的 `maskForeignUrls`、`renameSyncWithRetry`、`zhFeedbackReport`、`FeedbackShareHost` 没有命中额外的 `.structure.test.ts` / `.guard.test.ts`。
- 根因合同为新增 schema v3，不改历史合同。门表由 door-map 生成：扩展统计提交、准备器与排除原因消费者后，基线 15 扇、当前 18 扇；新增入口仍收敛在原发送口。

Windows 真占用、真实外部投递与独立验收均未验证。自动测试证明主进程结果与现有失败分支的连接，不替代桌面真实任务收据。

## 旧包夹具与判错方向

`tests/fixtures/old-user-data/feedback/v0.24.0/provenance.json` 记录 v0.24.0 提交、10 个内部源码文件、五份真实目录输入与报告产物的哈希。生成时每个内部源码都通过 `git show v0.24.0:<path>` 读取，执行原 builder，未手写或修改产物字段。CI 读取五份固化包，并核对输入与产物哈希，不依赖浅克隆是否带 tag。CatalogState 的类型断言及五份目录/产物行为断言共同守住真实数据前提。

`modelsOmitted` 与 `mappingsOmitted` 都是数字才保留目录，否则只剥目录。手改旧目录加上这两格时会保留目录，和此前一样，不更差；新投影必写两格，不会误剥新包。新发、启动/定时补发共用 sendItem；仅反馈 IPC 注册准备器，通用队列不含反馈字段。

与同一轮前次交回版本对比：readQueueStore、text、buildFeedbackReport、shrinkFeedbackReport、宿主文件及双语模型清单句子原样保持，只增补旧包准备器、注册与排除原因。

## 协调复核：真窗口走查查出两件

实现线没有跑真窗口。协调在交回的代码上跑了中英走查（`tests/ux/feedback-delivery.walk.mjs`），查出两件，都修了：

1. **英文最小窗口下「Send」点不到。** 第 5 条把英文清单句子从 3 行写成 5 行。这张卡在 App 最小窗口（1100×720）下本来就贴着上限，多两行就把按钮挤出窗口，单测看不出来。句子不动：清单最高到放得下卡上其余部分为止，多的在清单里滚（`src/ui/community/FeedbackReportCard.tsx`）。以后清单再变长也挤不掉按钮，走查查留言框和「发送」点得到、没被切掉。
2. **概念门岗红。** 合同声明的共享边界没有登记进概念，推送前快检不跑这道门，所以没人看见。现在登记进 `feedback.report-delivery` 和 `feedback.outbound-log-tail`。队列的读取函数和三个无关模块同名，门岗按名字认人，所以改名 `readQueueStore`，只改名，不改行为。

修后走查通过（中英各一遍，退出码 1 只来自「走查抢了前台」这一项，按约定算通过）。截图协调亲眼看过：

- 最小窗口，清单在里面滚，「发送」在：[英文](2026-11-02-feedback-followups/en-06-manifest-min-window.png) · [中文](2026-11-02-feedback-followups/zh-CN-06-manifest-min-window.png)
- 走查窗口，勾了内容，清单整段放得下：[英文](2026-11-02-feedback-followups/en-05-manifest-content-ticked.png) · [中文](2026-11-02-feedback-followups/zh-CN-05-manifest-content-ticked.png)
