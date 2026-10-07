# 类根因复盘：测试 / 走查出网隔离

## 0. 一句话根因

测试夹具只替换了供应商服务，却没有把“请求目的地必须是夹具”放在共享 HTTP 出口；提示词库还把远端刷新当成普通缓存未命中处理，所以启动路径仍会摸公网。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| L-walkoffline / 卡 25 | 提示词库惰性刷新直接调用 `hardenedFetchText`；内置 APIMart 目录保留真实 origin | 测试环境没有统一的夹具目的地不变量 |

## 2. 为什么这一类会一直出现

主进程的供应商请求、提示词刷新和 Chromium 请求各有入口；夹具只改了 catalog 内容，没有在入口层声明“测试只准 loopback / 登记 origin”。因此换供应商、换启动场景或新增一个远端只读目录都能复现。

三条体验铁律与本问题不适用：这是测试基础设施的出站边界，不改变用户可见镜头或模型参数。

## 3. 不改结构的可验证预测

| 预测 | 怎么验证 |
|---|---|
| 新增任意远端只读目录仍会在走查日志出现公网 host | `NOMI_TEST_NETWORK_GUARD=1` 起该走查并读 `egress.jsonl` |
| 内置供应商模型列表仍会命中真实 origin | 用带内置 APIMart slice 的 `paidGenerationRoute` 夹具检查请求 host |

## 4. 靶子独立性检查

卡 25 的原始网络记录由独立预加载仪表写出；本修复的单测只断言真实 fetch 入口未被调用，走查仍由网络闸与夹具请求记录分别取证。

## 5. P0：这些是我们独有的吗？现成方案有哪些

网络传输、Electron `webRequest` 和 Undici fetch 都是通用能力；本仓已有 `appFetch`、`hardenedFetch` 与 `walkthrough-network-guard`。本次只把测试目的地判据接到现有 `appFetch`，没有再写供应商专用 HTTP 客户端。`network-stack` 自写登记仍保留，因为生产出站账本、SSRF 判定和测试夹具白名单是 Nomi 的组合约束，现成库不能同时理解这些语义。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 继续使用 Undici / Electron `webRequest`，把测试白名单接入既有 `appFetch` 与走查闸 | 只增加一个测试配置解析器 | 需要保证主进程与 Chromium 配置同步 | **推荐** |
| 补 | 每个模型列表 / 提示词调用点各自判断环境 | 调用点重复 | 新入口会漏 | |
| 重写 | 新建第二套测试 HTTP 客户端 | 迁移成本高 | 与生产出口漂移 | |
| 删 | 删除提示词远端刷新 | 丢失正常用户的在线更新 | 改变产品行为 | |

## 7. 用户要权衡的核心

测试要的是确定、零公网；正常用户仍保留在线模型列表和提示词刷新。

## 特征测试清单（动结构前先锁住现状）

- `electron/appFetch.test.ts`：外网 host 在真实传输前被拒绝；登记 origin 改投 loopback。
- `electron/promptLibrary/promptLibraryStore.test.ts`：测试开关下只读 bundled fixture，不启动远端 refresh。
- `scripts/walkthrough-network-guard.test.mjs`：fetch / http / socket 公网请求失败并带 host，loopback 放行。

## 放行

- 2026-10-08 协调会话放行：测试 / 走查模式的出站闸并进现有共享出口（`electron/hardenedFetch.ts` 与 `appFetch`），只在 `NOMI_TEST_NETWORK_GUARD=1` 时生效，正常使用联网行为不变；提示词库测试模式只用内置。卡 25 前后出网统计仍是 unverified，以 CI 上 Linux 走查（带闸跑）是否绿作为第一道实证。
