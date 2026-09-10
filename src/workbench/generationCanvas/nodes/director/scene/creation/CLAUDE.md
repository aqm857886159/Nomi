# director/scene/creation/
> L2 | 父级: ../CLAUDE.md
> 视口内创建模式：幽灵体 world TRS 放 ref，提交时完整转 scene/parent local；active/step 是 React 状态，首次进入即可显示HUD与取消。模式互斥与Orbit占用由DirectorViewport统一拥有。
> 成员清单
> useCharacterPlacement.ts: 放置角色：地面幽灵体跟随 → 点击落点 → 拖拽定朝向 → 松开经 store.addObject 创建；右键/Esc 取消
> useBoxDraw.ts: 创建方块：拖底面 → 松开拉高 → 左键确认；Shift 锁正方形/正方体；右键/Esc 取消
> usePathDraw.ts: 画路径（模式来自 store.drawMode，需先选角色/机位）：画笔 = 拖画 → 弧长重采样 → 按 1.4m/s 定时长 → 播放头下有空路径片段（加轨道自动带的）就填进它并改时长，否则新建 → 批量写路标；逐点 = 每点击落一个路标并推进播放头 1s
> CreationGhosts.tsx: PlacementGhost（双环 + 朝向箭头 + 半透明胶囊）、BoxDrawGhost（半透明方块），均 editor-only
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
