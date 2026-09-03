# 3D 导演台开源研究证据账本

研究日期：2026-09-03

## Evidence

- `observed` — `package.json:176-185,206,220`：Nomi 已有 Leafer、React Three Fiber、Drei 和 Three.js。
- `observed` — `src/workbench/generationCanvas/nodes/Scene3DEditor.tsx:126-180`：3D 状态归一化、比较和写回已有明确边界。
- `observed` — `src/workbench/generationCanvas/nodes/Scene3DEditor.tsx:202-318`：take 和截图会进入现有参考节点/参考槽链。
- `observed` — `src/workbench/generationCanvas/nodes/scene3d/scene3dSceneView.tsx:127-180`：场景对象已有选择、聚焦和变换交互。
- `observed` — `src/workbench/generationCanvas/nodes/NodeImageEditToolbar.tsx:78-153`：图片已有 AI 编辑、裁剪、抠图、切图、变换和白板入口。
- `observed` — `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardLeaferCanvas.tsx:1-170`：白板已经以 Leafer 为渲染和交互基础。
- `documented` — [Theatre.js 官方仓库](https://github.com/theatre-js/theatre)：3D 对象编辑、属性和动画编辑器；core 与 Studio 使用不同许可证。
- `documented` — [Theatre.js R3F 官方文档源码](https://github.com/theatre-js/website/blob/main/content/docs/0.5/500-api/300-r3f.mdx)：`@theatre/r3f` 将 R3F 对象暴露到 Studio。
- `documented` — [PlayCanvas 官方开源说明](https://developer.playcanvas.com/user-manual/getting-started/open-source/)：engine、editor、react 和其他仓库的开源/许可证边界。
- `documented` — [MMPose 官方仓库](https://github.com/open-mmlab/mmpose)：2D、多人体、手、脸、全身和 3D mesh recovery，Apache-2.0。
- `documented` — [GVHMR 官方仓库](https://github.com/zju3dv/GVHMR)：世界坐标人体动作恢复项目；[现代化实现](https://github.com/ryanrudes/gvhmr)说明 SMPL/SMPL-X 需要单独注册且不能随项目再分发。
- `documented` — [WHAM 官方项目页](https://wham.is.tue.mpg.de/index.html)：从视频恢复世界坐标 3D 人体动作的研究方向。
- `documented` — [Microsoft TRELLIS](https://github.com/microsoft/TRELLIS)：文字/图片到多种 3D 表示，仓库声明主体代码和模型为 MIT，但依赖有独立许可。
- `documented` — [Microsoft TRELLIS.2](https://github.com/microsoft/TRELLIS.2)：PBR 3D 资产生成、Linux/NVIDIA 前提和 MIT 声明。
- `documented` — [Tencent Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1)：图片到高保真 3D 资产；版本许可证需按仓库核验。
- `documented` — [VAST TripoSR](https://github.com/VAST-AI-Research/TripoSR)：单图到 3D 的快速 pipeline；权重和依赖仍需单独核验。
- `documented` — [LeaferJS 官方仓库](https://github.com/leaferjs/leafer)：编辑器、手势、布局、SVG 导出，MIT。
- `documented` — [Fabric.js 官方项目页](https://fabricjs.com/)：对象模型、文本、变换、序列化和 SVG I/O。
- `documented` — [Penpot 官方仓库](https://github.com/penpot/penpot)：图层、组件、协作、自托管和 MPL-2.0。
- `documented` — [SVG-Edit 官方仓库](https://github.com/SVG-Edit/svgedit)：开源 SVG 编辑器近邻。
- `documented` — [tldraw 官方仓库](https://github.com/tldraw/tldraw)：SDK 生产使用需要 license key。
- `blocked` — TikHub 官方账号层面的 LibTV/TapNow 帖子检索：当前执行环境没有可用运行时密钥，未把官网浏览当成已完成账号研究。

## Walkthrough

Walkthrough: not applicable — source-only study

## Inference chain

1. Nomi 已有 renderer、场景状态、动作/机位捕获和图片白板，因此更换 renderer 不能直接解决用户摩擦。
2. Theatre.js、PlayCanvas 的价值主要是编辑器信息架构和时间序列交互；动作恢复和资产生成属于不同的后端能力层。
3. 因此最小可行方向是：保留现有内核，建立 Shot Compiler 和动作/资产 adapter，再用 Leafer 扩展窄版 Reference Design Board。

