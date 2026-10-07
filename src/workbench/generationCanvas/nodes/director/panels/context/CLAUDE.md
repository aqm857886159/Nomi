# director/panels/context/
> L2 | 父级: ../CLAUDE.md
> 精修「选中才出」（2026-10-04 用户拍板方向 A，设计卡 docs/plan/2026-10-04-director-refine-select-to-show.md）：右边默认什么都没有，点谁谁的属性卡才出来。
> 卡里是 inspector/ContextInspector 原样，一个字段不改，只换宿主；卡开没开不另存，由 store.selection derive。
> 成员清单
> ContextCard.tsx: 右侧属性卡（宽 320、高随内容、浮层不占流、只有卡挡指针）：选中的物体 / 机位 / 灯找得到才出现，× = clearSelection；无选中时由壳的瞬态打开「场景设置」态，选中实体即让位；选中角色或机位时卡头多「画线 / 逐点」（L2 就近，顶栏不随选中变宽）；出现时写 --nomi-director-side-width 让 toast 让开
> useDismissOnEscape.ts: 按需面板（场景设置卡、资产库抽屉）自己吃 Esc：壳的 Esc 链见到 data-nomi-escape-layer 就让路；浮层开着时先让浮层收，输入框里的 Esc 归输入框
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
