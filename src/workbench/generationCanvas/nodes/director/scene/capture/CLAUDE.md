# director/scene/capture/
> L2 | 父级: ../CLAUDE.md
> 出片的 three 侧：截图与 MP4 帧共用一条离屏渲染管线——复用渲染目标 readPixels 到 2D 画布（隐藏集 = editor-only 旗标对象）、标签直接画上、toBlob 一次异步编码；流程 / 命名 / 落盘住 DOM 侧 useDirectorOutputs。
> 成员清单
> directorCapture.ts: 零 React 工具：机位位姿 → PerspectiveCamera（与视口 / 画中画同一套翻转）、collectCaptureHiddenObjects（按 sceneRefs 的 editor-only 旗标）、FrameRenderer（渲染目标 / 读回缓冲 / 画布按尺寸缓存，逐帧不再分配）、drawLabels、encodeCanvas（toBlob + FileReader → dataURL）
> CaptureBinder.tsx: R3F 接线：机位局部位姿先转世界，或取 free/black；隐藏辅助物期间按共享头顶锚点投影标签，再恢复场景与合成；登记供 captureFrame 转发
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
