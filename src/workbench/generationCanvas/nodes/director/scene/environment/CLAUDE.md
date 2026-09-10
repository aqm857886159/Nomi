# director/scene/environment/
> L2 | 父级: ../CLAUDE.md
> 空场景的底：天空色、网格、地面、基础环境光 + 720 全景球 + Spark 泼溅宿主与显现着色器；泼溅对象本身在 entities/SplatEntity。
> 成员清单
> SkyGround.tsx: 主题（深邃黑 / Blender 灰）× 图层配置（天空色 / 网格显示与高度 / 地面透明度）→ 背景色 + drei Grid + 地面平面 + 半球光/环境光；网格与地面 editor-only；store 黑幕计数 >0 时天空盖黑（显现中）
> PanoramaSphere.tsx: 图层 panoramaConfig → 等距柱状贴图球（半径 / 旋转；x 负缩放镜像 + 双面材质 + 不剔除，FrontSide 会被三方翻面判定剔成黑），TextureLoader 加载，1.8s 三次缓出淡入，加载与淡入期间开黑幕；不打 editor-only（出片可见）
> SparkHost.tsx: 场景根挂唯一 SparkRenderer（@sparkjsdev/spark 2.1，three ≥0.180，WASM 内联无需 URL 解析），卸载交 retireSparkRenderer 排空后 dispose
> retireSparkRenderer.ts: 单一卸载边界：停调度/清 timer，等排序与 LoD worker 排空，一次释放 GPU 资源
> splatRevealDyno.ts: 5 段显现 GLSL（Magic / Spread / Unroll / Twister / Rain）装进 Spark dyno objectModifier 的控制器：按帧推 t（×2 倍速）、走完 + 尾停 1s 摘 modifier；参数纯数学在 model/splatReveal
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
