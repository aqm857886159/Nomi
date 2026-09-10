# director/bridge/
> L2 | 父级: ../CLAUDE.md
> 导演台与桌面运行时的接缝：只经 src/desktop/bridge 的 getDesktopBridge 调 preload（资产落盘 / ffmpeg 帧转视频），无桥时诚实降级为 localOnly，不在这里碰 store。
> 成员清单
> canvasImages.ts: 按结果类型收集画布当前图片与历史图片，按节点 URL 去重并保留历史标识；不按节点外壳种类筛图
> persistOutputs.ts: 截图 dataURL 经资产桥落项目 PNG，桌面空白/data/blob句柄视为失败；帧经 director.framesToVideo 落 mp4；无桌面/无激活项目返回 localOnly，不将临时数据冒充持久成功
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
