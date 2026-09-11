# director/panels/dialogs/
> L2 | 父级: ../CLAUDE.md
> 导演台的模态对话框：走设计系统 DesignModal，内容只组合 token 类与原语；每个对话框一个文件。
> 成员清单
> ActionSelectModal.tsx: 动作库弹窗：左 搜索 + 列表（图标 / 名字 / 连续动作 (循环) 或 单帧姿态 / 勾选，双击直接添加）；右 「动作实时预览」+ 动画 / 静态 徽标 + 重置视角 + 3D 预览 + 当前动作；底部提示 + 「添加「X」片段」；初选 walking 别名
> ActionPreview.tsx: 弹窗右侧的实时 3D 预览小场景（自己的 Canvas：X Bot + 网格 + 三灯 + OrbitControls，按秒表用 poseClipLibrary / poseSnapshot 采样套骨，resetSignal 归位视角）
> SettingsDialog.tsx: 偏好设置（清单 §8 H1）：漫游速度 / 方向键转速（内部 rad/s、显示 °/s）/ 左键旋转 / 右键平移灵敏度 / 惯性阻尼各带恢复默认 + 分区整体重置；视口主题两档即时生效；「操作说明与快捷键」入口；范围来自 scene/viewSettings.VIEW_SETTING_RANGES
> HelpDialog.tsx: 帮助（清单 §8 H2）：四栏键位表（视口工具 / 视口操作 / 时间轴与轨道 / 视口漫游），键位从 model/hotkeys 实时 formatHotkey，鼠标手势与 WASD 用固定 kbd 文本
> MobileConnectDialog.tsx: 手机虚拟相机对话框（二维码来自主进程 SVG / 复制链接 / 设备与延迟 / 三步证书指南 / 平移·升降速度 / 断开服务 ⇄ 重新开启）；打开即起桥，关掉对话框不停服务；服务关闭态只留一句状态 + 重开按钮；开发页无桌面桥时明说
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
