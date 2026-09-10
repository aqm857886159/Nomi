# director/panels/fields/
> L2 | 父级: ../CLAUDE.md
> 检查器字段原语：所有属性面板只用这些拼装，保证密度、重置、单位、滚轮微调表现一致。
> 成员清单
> useNumberDraft.ts: 数字框共享草稿；Escape/空白/非有限数不提交，有效 Enter/blur 只交一次实际变化，外部值（含滚轮修改）同步清旧草稿
> SliderNumberField.tsx: 标签 + 原生 range + 数字输入；拖动与键盘连续调节在首次变化前调 onChangeStart 记历史，滚轮按 step 微调，数字提交共用 useNumberDraft
> FieldPrimitives.tsx: InspectorCard、SectionHeader、Vec3Fields（共享数字草稿/滚轮微调）、TextField、ToggleField、ColorField；颜色预设/自定义/清除通过 onChangeStart 交由调用者记历史
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
