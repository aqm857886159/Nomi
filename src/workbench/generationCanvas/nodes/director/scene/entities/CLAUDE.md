# director/scene/entities/
> L2 | 父级: ../CLAUDE.md
> 把 store 里的实体数据物化为 three 对象；根节点打 id 标记并登记到 SceneRegistry，位姿由 useTimelinePlayback 每帧直写。
> 成员清单
> DirectorEntities.tsx: 装配：objects（parentId 树）/ lights / cameras 挂在图层整体变换组下；机位四态由选择/激活/预览态推导
> PrimitiveEntity.tsx: 八种基础几何体 + solid/translucent/clay 三种显示模式（clay 加边线）
> primitiveMaterial.ts: 三种显示模式下的材质参数求值（纯函数）
> CharacterEntity.tsx: 内置 X Bot 或用户上传的 Mixamo 角色（builtin:* → ../character/mannequinAssets，否则 modelPath；GLB/GLTF/FBX 各走各的 loader；按骨骼范围量身高缩放到 1.75m、首帧按蒙皮最低点贴地）+ 拾取图层上的不渲染胶囊代理（蒙皮网格射线不可靠）、颜色着色、白模模式换石膏材质（半透不影响角色）、每帧骨骼管线（../character/useCharacterRig）+ 骨骼编辑态 IK 把手、登记双脚吸附处理器、加载失败退化胶囊
> SplatEntity.tsx: 泼溅稳定句柄解析后创建 Spark SplatMesh；加载与显现共用一次黑幕生命周期，失败/卸载/换 URL 均清理并 dispose；重命名/换语言只更新错误文案，不重建请求或重播显现
> ModelEntity.tsx: type='model' 用户模型：GLB/GLTF 走 useGLTF、FBX 走 useFBX，Suspense/错误边界退化线框盒；加载后发现 mixamorig 骨骼即 updateObject 升格为 character
> LightEntity.tsx: 平行/点/聚光 + 可拾取灯具模型（editor-only）+ 照射方向指示
> CameraEntity.tsx: 机位可见实体：程序化机身（盒体 + 朝 +Z 镜筒 + 顶部取景器，共用一份金属材质 metalness 0.8 / roughness 0.2，emissive 选中 0x00FFCC×1 否则 0x00A2FF×0.25，缩放 选中 1.15 / 预览 1.1；不依赖任何模型文件）+ 固定 16:9 深 0.9 的视锥线（含顶上「朝上」三角）+ 5m 虚线射线；线色四态 选中青 / 激活橙 / 预览蓝 / 默认蓝，透明度 0.9 / 0.9 / 0.7 / 0.45；激活机位整组隐藏，showRayHelper 关线；editor-only
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
