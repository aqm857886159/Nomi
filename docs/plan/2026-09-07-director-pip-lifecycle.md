# 画中画测量生命周期修复

状态：✅ 本地实现与验收完成，未提交。18:08冻结后新构建的完整Electron、窗口栏和手机旅程全部exit0，PiP新建/冷重开同像素指标均通过，最终冷重开截图已交叉亲眼核验；类测试5/5、独立工程门禁9/9全绿。

修复前的冷启动截图中主视口人物已加载但 PiP 为空。`PipViewport` 子组件的 layout effect 先于外层宿主 DOM ref 挂载执行，缺少 host 时直接退出，之后没有订阅尺寸；新建机位改变依赖才偶然恢复。隐藏开关也没有进入测量生命周期。

范围只含 `PipViewport.tsx` 的共享测量 effect、相邻类测试、v3 合同及模块地图。改用提交后的 effect，明确随显示/折叠/机位状态测量和清理，不改 Renderer 算法、不加轮询或依赖。原文件备份在 `.tmp/director-full-audit-20260907/resume-PipViewport.before.tsx`，回滚只恢复本次文件块。

验收先保留冷挂载、初始隐藏后显示、隐藏清理的红例，再验尺寸变化、无机位转有机位、折叠/卸载。主代理真实 Electron 旅程在新建和冷启动时用同一 PiP 内部画面截图的角色像素指标，旧构建先红、新构建同条件再绿并亲眼看图；骨骼就绪不代替 PiP 像素就绪。

## 先查别人

- 依赖里已有？three 的 scissor / viewport 支持同一画布多视口（https://threejs.org/docs/#api/en/renderers/WebGLRenderer.setScissor）；drei 的 View（https://github.com/pmndrs/drei#view）是另一条路，但它另起 portal 树、与本壳的 DOM 测量不同源。
- 仓库里已有？画中画渲染与外壳已存在：`src/workbench/generationCanvas/nodes/director/scene/PipRenderer.tsx:66`、`src/workbench/generationCanvas/nodes/director/panels/viewport/PipViewport.tsx:1`。
- 生态里已有？R3F 官方关于同一上下文内嵌渲染代价的说明（https://docs.pmnd.rs/react-three-fiber/advanced/scaling-performance）。
- 结论：沿用同画布 scissor 内嵌渲染，只收口显示 / 折叠 / 机位生命周期里矩形与观察器的清理。
