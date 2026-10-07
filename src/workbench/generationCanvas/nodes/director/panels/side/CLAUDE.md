# director/panels/side/
> L2 | 父级: ../CLAUDE.md
> 场景里有什么、能往里加什么：大纲（SceneObjectsTab，住顶栏「▤ 图层名 ▾」浮层，见 topbar/SceneMenu）与资产库（AssetsTab，住左侧抽屉 AssetsDrawer）。
> 2026-10-04 用户拍板精修走方向 A「选中才出」：右栏浮起双卡（SidePanels，键 director.side / nomi:director:sideWidth / sideCollapsed 随之退役，旧值留着无害）同 PR 删除；属性改住 context/ContextCard。
> 成员清单
> AssetsDrawer.tsx: 精修「选中才出」的资产库宿主：左侧抽屉（卡头「资产库」+ ×，内容 = AssetsTab 原样），从「＋ ▾」底部「资产库」打开，Esc / × 关；压在左下预览小窗上（z-40），不用 backdrop-blur（会让真实鼠标的双击送不到资产行，2026-09-09 实测）
> SceneObjectsTab.tsx: 大纲：图层（新建/复制/重命名/删除/显隐/激活）+ 实体树（显隐/锁定/删除/重命名/跨图层复制移动/Ctrl·Shift 多选）+ 多选浮条 + 搜索
> AssetsTab.tsx: 资产库：连线引用（LinkedAssetsContext）/ 用户上传（工程 assets：上传 GLB·GLTF·FBX·PLY·SPZ·SPLAT·KSPLAT·SOG·图片·场景 JSON，文件夹增删改、条目移动 / 重命名 / 删除）/ 泼溅场景（上传里的泼溅）/ 基础几何体（角色与三种灯只在「＋ 添加」里，2026-10-04 去重）；双击或「添加」入场景，全景设为天空，场景 JSON 导入为新图层；资产桥落盘，无桌面运行时退回 data / blob URL 并提示临时；目录菜单/拖放共用 assetFolders 防环，搜索展开命中祖先
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
