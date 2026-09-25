# 过程动效 GPU 能力探测生命周期

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

范围：只修 processMotionCapability 与 useReducedProcessMotion，以及其现有测试。等待视觉、动画数量、百分比、img-fx 引擎不变。

旧实现每个 hook 初始化和 mount effect 各创建一个临时 WebGL context，等待层与状态条都有消费者，且没有显式释放。根因是稳定 renderer 能力与动态系统偏好没有分开生命周期；是否长期泄漏须另测，重复创建已经可复现。

复用既有读取函数：保持 readProcessMotionCapability 自包含，供性能脚本 page.evaluate 序列化执行；用 finally 释放本函数创建的临时 context（浏览器支持 WEBGL_lose_context 时）。hook 按 Document 缓存 renderer 检测结果，多个消费者、重挂载不再各探测；系统 reduced-motion 仍由每个 hook 原有 matchMedia change 订阅更新并清理。不全局缓存 preference，不增加新动画引擎或第三方依赖。

先查别人：现有 useReducedProcessMotion 是两个生产消费者的共同入口；img-fx dist/index.es.js:1128 自有 renderer.dispose 生命周期，不能负责应用另建的探测 context。tests/ux/canvas-perf/waitingFxScenario.mjs:9 直接序列化独立读取函数，故缓存只放 hook 层、不引入读取函数闭包。门表由 door-map 生成，见合同。

回归先红：context 成功/读失败均释放；序列化执行无外部依赖；真实 React 多消费者/StrictMode/重挂载只探测一次、动态偏好仍切换、卸载解除监听。独立无 WebGL/软件渲染分类断言保留。

风险：缓存按 document 寿命，运行时更换 GPU 不主动重探测，页面重载重新检测；浏览器不提供 lose_context 时依赖浏览器回收。无持久化变更。回滚这两个生产文件与测试即可。

## 实测

- 旧代码新增5条红测：成功/异常释放、序列化释放、多消费者复用、真实React StrictMode生命周期。八consumer的真实浏览器挂载旧版32 probes / 0 releases，修后1 / 1。
- 最终18项纯逻辑/SSR单测与1项真实浏览器场景通过，含动态系统偏好、StrictMode、卸载订阅归零、重挂载、无WebGL缓存与新Document重探测。日志 /tmp/nomi-process-motion-probe-red.log 与 /tmp/nomi-process-motion-probe-green.log。
- 另用实际Chromium WebGL（未mock GPU）执行 page.evaluate(readProcessMotionCapability)：SwiftShader renderer正确返回，contexts=1 / releases=1。hook生命周期测试仅模拟硬件能力，React/媒体查询/事件与浏览器为真；不把该夹具当硬件性能证明。
- scoped eslint与App tsc通过。根因合同checker本合同无错误；父任务waiting-grid合同的生产/测试尚未落地时曾红，统一变更就绪后由父任务重验。

- 浏览器生命周期场景归入既有 `tests/ux/process-feedback-imgfx.e2e.mjs` 的 `PF_FX_ONLY=probe` 分支；普通Vitest不import/launch Playwright。该分支直接bundle真实hook，不依赖design-lab服务；整套默认运行也执行该场景。

## 先查别人

- 已有共享调用边界：`src/workbench/generationCanvas/nodes/useReducedProcessMotion.ts:1`，能力读取与系统偏好由该hook统一，不新建事件引擎。
- 已安装上游源码：`node_modules/img-fx/dist/index.es.js:1128` 自有renderer.dispose，无法释放应用另建的探测context；本轮只处理应用的临时context。
- 已有直接序列化消费者：`tests/ux/canvas-perf/waitingFxScenario.mjs:12` 调用page.evaluate(reader)，因此保留reader自包含，缓存置于现役hook。
- 本次为内部资源生命周期纠错；未把TikHub内容或未查过的外部资料当成依据。
