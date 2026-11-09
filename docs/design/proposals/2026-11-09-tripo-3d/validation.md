# 本轮验证记录

日期：2026-11-09。范围：调研文档、流程探索与离线假设计算，**不是供应商接入验收**。

## 已执行

- 刷新 `origin/main`，从 `707ed7a001bd1d0c18eac0af5f3a7853f634f672` 创建独立任务分支；`pnpm install --frozen-lockfile`、`pnpm run delivery:preflight` 通过。
- 阅读官方现行API/模型文档与代码owner，明确本地私有token和正式Run的HTTP引用边界；`door-map` 对 `generate3D` 找到1个调用文件，对 `validateGlbStructure` 找到4个调用文件（5处调用）。这是只读范围确认，不是已修复合同。
- 先渲染并亲眼检查现役供应商连接组件的 Design Lab 截图，再制作流程 exploration；见 [现有组件截图](preview/baseline-catalog.png)。该截图是现役组件+实验室夹具，不是实际用户账户或真实供应商验证。
- 用已有 Playwright/Three 依赖加载仓库 Kenney GLB；本页不新增依赖、远端请求或项目写入。
- `check.mjs`：5步骤×4状态×2语言×2主题＝80个组合；390/800/1360宽度无页面横向溢出；验证真实WebGL旋转会改变像素；停止/继续查询按钮切换正确；无页面异常；网络仅本机GET；12个评测行均保持未运行。
- 独立线复跑同一检查及私有离线演算。审阅指出的公开信息边界已收口，评测采集按case/provider/attempt分别留行，避免覆盖失败样本。

复跑（仓库根目录）：

```sh
node scripts/build-tailwind.mjs
pnpm exec vite --host 127.0.0.1 --port 5189
# 另一个终端
node docs/design/proposals/2026-11-09-tripo-3d/check.mjs
```

`check.mjs` 会重新生成同名探索截图；不要在同时修改探索页时运行，避免 Vite 热重载影响截图。屏幕尺寸是浏览器视口，不是 Nomi 的发布窗口基线。

## 截图入口

| 内容 | 截图 |
|---|---|
| 中文光/暗 | [光](preview/exploration-zh-light.png)、[暗](preview/exploration-zh-dark.png) |
| 英文光/暗 | [光](preview/exploration-en-light.png)、[暗](preview/exploration-en-dark.png) |
| 中文窄屏光/暗 | [光](preview/narrow-zh-light.png)、[暗](preview/narrow-zh-dark.png) |
| 英文窄屏光/暗 | [光](preview/narrow-en-light.png)、[暗](preview/narrow-en-dark.png) |
| 主流程五步 | [输入](preview/flow-prepare.png)、[连接](preview/flow-connect.png)、[任务](preview/flow-run.png)、[检查](preview/flow-inspect.png)、[场景](preview/flow-scene.png) |

截图均是人工选择的情景与仓库示意资产，不是供应商实际任务，不用于证明可用率、耗时、质量或收入。

## 未执行与限制

生产代码、供应商API上传/生成、真实产物、费用、私有合同、正式推广链接、申请/发送消息和实际收入均未验证。没有安装包、Windows、真实账户地区、真人可用性或运行时性能成绩。没有宣称总体最优。

没有 Claude Design 的 Design 类型画布入口：HTML 标 `exploration`，没有创建批准board；下一轮实施仍需完整设计流程和真实任务证据。未跑整套应用测试与打包，因为本轮不改变生产代码；推送门岗与PR检查另由PR记录。
