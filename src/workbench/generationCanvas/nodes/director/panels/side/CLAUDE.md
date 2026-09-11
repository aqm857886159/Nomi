# director/panels/side/
> L2 | 父级: ../CLAUDE.md
> 右栏：视口右侧浮起的双卡（2026-09-09 第 2 期）——上卡是「场景里有什么」（大纲 / 资产库），下卡是属性检查器（inspector/）。
> 卡片有圆角 / 描边 / 阴影、卡间留空，与顶栏五簇同一套浮层语言，但**仍在布局流里**：视口按 flex 让出宽度。
> 试过绝对定位浮在视口上（样张的样子），3D 画布的可用几何随即和它错位——右侧一条内的物体点不到、画中画剪裁矩形画到镜像位置，真机 j1 当场红。判据见 SidePanels.tsx 的 POS。
> 成员清单
> SidePanels.tsx: 浮起双卡装配：场景对象 / 资产库 分段胶囊页签（语义仍是 tablist，不套 NomiSegmented 那个 radiogroup）+ 属性检查器，纵向可拖分栏（键 director.side 不变）；整列左缘可拖宽、宽度自持久 nomi:director:sideWidth，并写进 --nomi-director-side-width 让全局 toast 左移（顶栏「交付」簇同住右上角，不让开就盖住截图/产出/退出）；顶部让开悬浮顶栏取 topbar/topChrome 的 DIRECTOR_TOP_CHROME_PX。卡片刻意不用 backdrop-blur：它会让真实鼠标的 dblclick 送不到可拖拽行（资产双击入场当场失效，而合成事件照常，单测发现不了）
> SceneObjectsTab.tsx: 大纲：图层（新建/复制/重命名/删除/显隐/激活）+ 实体树（显隐/锁定/删除/重命名/跨图层复制移动/Ctrl·Shift 多选）+ 多选浮条 + 搜索
> AssetsTab.tsx: 资产库：连线引用（LinkedAssetsContext）/ 用户上传（工程 assets：上传 GLB·GLTF·FBX·PLY·SPZ·SPLAT·KSPLAT·SOG·图片·场景 JSON，文件夹增删改、条目移动 / 重命名 / 删除）/ 泼溅场景（上传里的泼溅）/ 预设模型 / 基础灯光 / 基础几何体；双击或「添加」入场景，全景设为天空，场景 JSON 导入为新图层；资产桥落盘，无桌面运行时退回 data / blob URL 并提示临时；目录菜单/拖放共用 assetFolders 防环，搜索展开命中祖先
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
