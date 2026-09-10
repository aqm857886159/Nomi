export const zhShotTable = {
  openScript: '打开原稿', factsEmpty: '点击重新拆解，读取这段参考片',
  sourceVideoMissing: '来源视频已删除，无法重新拆解',
  addColumn: '添加列', editCell: '编辑单元格', renameColumn: '重命名列', removeColumn: '删除列', generate: '生成 {{count}} 镜', running: '正在读取镜头', retry: '重新拆解', facts: { shotSize: '景别', motion: '运镜', visual: '画面', dialogue: '对白', onScreenText: '字幕', mood: '情绪' },
  title: '分镜表', count: '{{count}} 镜', duration: '{{duration}}s', timeRange: '{{start}}–{{end}}s', open: '打开分镜表',
  sourceMissing: '来源方案已删除', empty: '还没有镜头，打开原稿继续拆解',
  select: '选择第 {{index}} 镜', selected: '已选 {{count}} 镜',
  openSelected: '编辑选中镜头', viewOnly: '删除此节点仅移除视图，原稿分镜仍保留',
  columns: { index: '镜', thumbnail: '关键帧', duration: '时长', visual: '画面', references: '参考槽', status: '状态' },
  unknownReferences: '未选模型', noReferences: '无需参考', unread: '没读出',
  status: { ready: '未生成', 'anchor-ignored': '参考未使用', 'waiting-refs': '等参考图', 'missing-required': '缺必填参考', generating: '生成中', failed: '生成失败', recoverable: '可找回', done: '已生成', locked: '已锁定' },
}
export const enShotTable = {
  openScript: 'Open script', factsEmpty: 'Deconstruct again to read this reference video',
  sourceVideoMissing: 'Source video was deleted; cannot deconstruct again',
  addColumn: 'Add column', editCell: 'Edit cell', renameColumn: 'Rename column', removeColumn: 'Delete column', generate: 'Generate {{count}} Shots', running: 'Reading shots', retry: 'Deconstruct again', facts: { shotSize: 'Shot size', motion: 'Motion', visual: 'Visual', dialogue: 'Dialogue', onScreenText: 'On-screen text', mood: 'Mood' },
  title: 'Shot table', count: '{{count}} shots', duration: '{{duration}}s', timeRange: '{{start}}–{{end}}s', open: 'Open storyboard',
  sourceMissing: 'Source storyboard was deleted', empty: 'No shots yet. Open the script to continue',
  select: 'Select shot {{index}}', selected: '{{count}} selected',
  openSelected: 'Edit selected shot', viewOnly: 'Deleting this node removes the view; the storyboard remains',
  columns: { index: 'Shot', thumbnail: 'Keyframe', duration: 'Duration', visual: 'Visual', references: 'References', status: 'Status' },
  unknownReferences: 'No model selected', noReferences: 'No references needed', unread: 'Not read',
  status: { ready: 'Not generated', 'anchor-ignored': 'Reference unused', 'waiting-refs': 'Waiting for references', 'missing-required': 'Required reference missing', generating: 'Generating', failed: 'Generation failed', recoverable: 'Recoverable', done: 'Generated', locked: 'Locked' },
}
