# 2026-10-08 paid-post fixture gate direction check

## 0. 一句话根因
生产夹具开关在五个入口各自解释，导致 `NOMI_E2E=0` 时仍可能把用户连接改到 loopback，属于重复判定造成的安全回归。

## 1. 归类

| 症状 | 直接原因 | 类根因 |
|---|---|---|
| `userVendorBaseUrl` 在关闭 E2E 时仍返回夹具地址 | 入口只读 production fixture flag | 夹具启用和 loopback 合法性没有唯一 owner |
| provider/bootstrap/app/MCP 各自复制 env 判断 | 逻辑散落在五处 | 新入口可以复制出不同的开关组合 |

## 2. 方向结论

这是 recurring/high-risk 的边界问题。结构性修复是把纯判定下沉到 `electron/shared/productionRunE2eFixtureGate.ts`，五个入口只调用它；renderer 不得导入含 Node 文件系统副作用的 fixture renderer。矩阵测试锁住 E2E、production flag、packaged flag 和 loopback 的全组合，静态守卫锁住生产代码不再直接读开关。

## 3. P0 与现成方案

通用能力只使用现有 TypeScript URL 解析和 Vitest；项目特有约束是 Electron packaged gate、loopback 私有 origin 和凭据不得跨 origin。没有可替代的库能表达这三项领域约束，因此不引入新依赖。

## 4. 可验证预测

- `NOMI_E2E=0 + PRODUCTION_FIXTURE=1 + loopback` 保持用户 base。
- 非 loopback 永远不生效。
- packaged 只有 `PACKAGED_FIXTURE=1` 才生效。
- 五个入口的源代码没有直接读取 `NOMI_E2E_PRODUCTION_FIXTURE`。

证据：`electron/productionRun/productionRunE2eFixture.matrix.test.ts`（32 组合 + 静态守卫），`electron/catalog/userVendorBase.test.ts` 最小复现；相关 vitest 139 tests 通过，build 通过。

## 5. 用户权衡

夹具在错误环境下不会再替换连接，测试必须显式打开完整开关；这牺牲了误配置时的便利，换取真实用户凭据不会被送到错误 origin。

## 6. 交付

本次提交只在本地提交，不推送。方向结论：保留单一 owner 与结构性守卫，后续入口不得复制开关判定。

## P0 ????

?????? `mcp-protocol`???????? MCP ???????????????? MCP ????????? Electron packaged gate?loopback ?? origin ??? origin ?????? MCP transport ???????? 2026-11-08??????
