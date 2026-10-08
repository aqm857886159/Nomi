# 类根因复盘：测试临时目录门岗

## 0. 一句话根因

临时目录创建分散在走查脚本和测试辅助脚本中，门岗只扫描 node:test 文件，导致同一类系统临时目录漏检并反复修补。

## 1. 归类

| 提交 / 问题 | 直接原因 | 类根因 |
|---|---|---|
| 走查脚本直接调用 `mkdtempSync(os.tmpdir())` | 创建入口绕过共享助手 | 扫描边界只覆盖少数文件后缀 |
| 本轮迁移 | 共享助手已存在但调用者未统一接入 | 通用临时目录能力缺少单一静态 enforcement boundary |

## 2. 结构性结论

共享助手继续作为唯一系统临时目录分配边界；静态门岗扫描 `scripts/**/*.mjs` 与 `scripts/**/*.ts`，并保留调用方 scratch root、Vitest 全局工作区和共享助手本身的白名单理由。新增反例测试固定绝对 `/tmp` 调用，防止扫描回退。

## 3. 预测

| 预测 | 验证 |
|---|---|
| 新增走查脚本的系统 `mkdtemp*` 会被门岗点名 | `pnpm run check:test-temp-static` |
| helper 限定调用或漏 import 会被点名 | 同一门岗的 helper import 测试 |

## 4. P0 / 现成方案

这是测试基础设施边界，不是产品领域能力。Node `fs.mkdtemp` 是底层标准，但没有项目级登记与失败清理语义；现成库无法替代本仓库的注册、进程退出清理和跨测试生命周期约束。因此保留薄共享助手，接入标准 API，拒绝继续复制实现。

自写登记 `gate-family` 仍处 `under-review`：它绑定本仓库门岗族谱、冻结基线与提交判据，现成 CI/Policy 库无法表达这组关系；目标日期为 2026-11-01，届时复评并在能保留棘轮语义时迁移。

## 5. 用户权衡

维护者多写一次 helper import，换取走查和 node:test 的临时目录在失败、超时、进程退出时有一致回收与门岗覆盖。

## 特征测试清单

- `scripts/check-test-temp-static.node-test.mjs`
- `scripts/_test-temp.node-test.mjs`
