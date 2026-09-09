# B2b：过程与面板样张

状态：📋 方案待拍板。设计实验室待审，生产实施未授权。

范围：只增实验室 specimen、定向截图与设计文档。C34 活状态/完成摘要/失败；C30 宽窄与拖拽；C31 四面现状与统一外框；C32 品牌对账。
不动项：所有生产代码、冻结区、已有视觉基线。不会运行 design-lab:update。
回滚：撤销本任务新增的实验室文件、注册项与文档即可，无产品状态迁移。
验收：真实 React 组件截图；夹具注明宿主数据与真实调用点；过程展开/收起、原地推进、拖动边界与宽度恢复实测；四面截图逐张人眼复核；contracts 与相关测试通过；正常 hook 提交推送，PR 不合并。

## 先查别人

- Beautiful UI 的折叠推理链与加载反馈：https://www.beautifului.dev/#thinking-state 。只参照形态，不复制其样式系统。
- 现役生成面手柄：`src/workbench/generation/GenerationWorkspace.tsx:163`；真实 Pointer Capture 手势与共享宽度 store 可复用。
- 现役预览 Panel：`src/workbench/preview/PreviewWorkspace.tsx:270`；已有框架面板而非再造一套全局 resize 框架。
- 品牌共用几何与字标：`src/design/identity.tsx:95`；顶栏调用 `src/ui/app-shell/NomiAppBar.tsx:119`。直接复用，不设计新 logo。

Beautiful UI 官方首页 https://www.beautifului.dev/ 与 /license（2026-09-09 检查）：Loading State / Thinking State / Task Rows / Tool Chips。只参考交互形态，不安装或拆取代码；完整四列表放设计文档。保留 Nomi 现有 React 18 / Tailwind 3 组件。
现役近邻即仓库生成面拖手柄与预览面 react-resizable-panels：`src/workbench/generation/GenerationWorkspace.tsx:163`、`src/workbench/preview/PreviewWorkspace.tsx:270`。边界沿用 `src/workbench/assistantWidthBounds.ts`。不引入新框架或外部格式。

## 证据与根因分层

C34 recurring：现象是过程平铺；直接原因是 flow 逐项渲染和事后折叠；缺失不变量是一个回合只有一个默认可见过程入口。共享 owner 应在 v4 投影层；当前生产不改。
C30/C31 recurring：创作固定列宽且独立 padding，分镜/预览直角 aside，生成独立拖手柄。未来由宿主共同约束宽度与 frame，不能再每面补 CSS。本轮镜像四个真实入口，只提出统一样张。
C32 recurring：顶栏真 NomiBrand 与面板文字 N 分开核对。CDP 证实运行时字栈漏 Variable，字体落到 Songti SC；规范镜像与运行时 token 双真相漂移。品牌几何由 identity.tsx owner 负责，字栈由 token 层负责；本轮仅在实验室局部对照规范字栈。
生产修复合同与红绿类回归属于批准后的实施，本轮无生产修复，不伪造已完成合同。
