# B1 契约证据

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实现与验证；未提交、未推送。完整 gates 的新鲜基线要求与任务书「不合 main」冲突。

## 红 → 绿

- `contracts-red.log`：接手前保存的八簇红测试（C27/C43 合并）；`contracts-revised-red.log`：新 C42 分派规则的红测试。
- `budget-red.log` 属于已废弃的“注入设置预算”方案，**不作为新 C45 证据**；新裁决用 `budget-revised-red.log` → `budget-composer-green.log`。
- `c43-isolated-red.log` 直接执行 Git HEAD 的原始 `canvasWriteReceiptText`（TypeScript 转译，不重写逻辑），证明旧收据正文泄漏 id；当前对应夹具验证正文无 id 且 details 保留。
- `approval-class-red.log` 补现役逐步只读审批/宿主强制确认的同类边界；当前描述和执行共用 `decisionOf`，再调用 canonical `capabilityApprovalPolicy`。
- `contracts-green.log`：B1 11 条 + C0 3 条 + L1 20 条（含控制）+ 审批/原生审批 11 条，共 45/45。
- `lane-suite.log`：第一次 lane 全套 348/353；5 个失败均是本批明确替换的旧正文/preview 预期。`laneL1Scenarios.mts` 保留跨运行时与冷重启对账强度，更新成匿名写收据、显式 full context、嵌套 patch；最终 `lane-suite-final.log`：**354/354，exit 0**。
- `budget-composer-green.log`：34/34；预算不注入、输入状态分派、客户端 admission、次级手势上下文传递。
- `composer-gesture.log/json`：真实 Chromium 中运行生产 composer + 共享意图函数，Enter=steer、Alt+Enter=follow-up、审批等待 Enter=steer，没有排队文字按钮。脚本 `composer-gesture.mjs --build` 生成隔离页面后用任意本地 HTTP server 18741 执行；这是组件交互证据，不冒充整应用截图。

## 真实模型

`deepseek-sample.json` 为最终独立项目的原生 lane 投影，`r30-summary.json` 为人工判读。
最终四次请求，切组 0，答复内部 id 0；“等等别动”用户 entry 在下一 assistant entry 前；无写入。
首调工具写对按要求分母是 **1/3**，按实际工具调用是 **1/1**（试拍/停止两句没有工具调用，不虚计写对）。用户任务完成 **2/3**：试拍没有生成，当前 lane 的生成/报价接入属 B4。
只读回答仍超过三行，不能声称 C47 模型服从已解决。收尾简短且没有复述清单。
所有尝试按公开未折扣单价估算累计 **¥0.360324**；最终请求预约上界加此前已结算费用 **¥0.726936 < ¥1**，供应商账单币种为 USD，预算换算取 7 CNY/USD。
`deepseek-fixture-incomplete.json` 首次缺时间轴工具，无出网、零费用；`deepseek-attempt-1.json` / `deepseek-attempt-2.json` 保留前期失败（越出只读目标、谎称生成、旧 session 影响）。前两次实际请求在同一原生 session，attempt-2 usage 是累计值，**不能再与 attempt-1 相加**。最终独立项目 usage 单独相加才得上述总数。
凭据仅由应用加密设置复制到 `.tmp/b1-real/settings` 后经 safeStorage 解密，未打印；媒体生成端口为隔离夹具，无真实媒体提交。未重打包。

## 交付限制

原命令 `python3 scripts/with-gates-lock.py -- pnpm run gates` 的 `gates.log` 为真实 exit 1：origin/main 不是 HEAD 祖先。未设置 CI=true、未修改门岗、未并 main、未绕 hook，未 push。
`contracts-gates.log` 已跑完全部 76 项：文档标题不符合 prior-art 扫描格式、浏览器证据脚本 Node/浏览器全局声明两项失败；均已修正并分别验证。最终完整 contracts 收据见 `contracts-gates-final.log`：全部阻断性门岗通过，进程 exit 0（session 93551 已收取）。这不等于完整 gates 通过。
