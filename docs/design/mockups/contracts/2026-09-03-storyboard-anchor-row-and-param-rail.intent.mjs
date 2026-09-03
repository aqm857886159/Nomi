// 分镜表锚行/镜头行 · 意图层契约（2026-09-03）。
//
// 这里写的是拍板者必须守住的关系，不是“某个 div 现在叫什么”。
// 自动层负责尺寸与挂点；本层负责模型模式改变时，用户看到的参考入口仍然诚实。

export default {
  mockup: 'docs/design/mockups/2026-09-03-storyboard-anchor-row-and-param-rail.html',
  surface: '分镜表 · 锚行/镜头行真实模型模式参考区',
  layer: 'intent',

  structure: [
    {
      name: '模型模式选择器必须暴露真实身份',
      ancestor: '[data-model-switcher]',
      descendant: '#modelSelect',
      // 选择器不是抽象“模式 A/B”：用户必须能看到真实 archetype/mode 身份；动态 derive 关系由 modeProof 走查证明。
    },
    {
      name: '一镜的阅读顺序是画面格→参考区→提示词',
      before: '[data-storyboard-frame]',
      after: '[data-storyboard-refzone] [data-reference-zone-view]',
      // 这承载“要生成的→拿来参考的→怎么描述”的认知顺序，不是实现层的 DOM 偏好。
    },
    {
      name: '参考区必须留在镜头行内',
      ancestor: '[data-storyboard-row]',
      descendant: '[data-storyboard-refzone]',
      // 锚行与镜头行同构时，共用这一格的语义；把参考区搬到另一条常驻栏会让作用域漂移。
    },
    {
      name: '锚行与镜头行共用同一套栅格类，不是两套布局',
      sameClass: ['[data-storyboard-row]', '[data-storyboard-anchor-row]'],
      // 这是结构意图：锚行必须进入 shot-row 的四栏扫描骨架，不能以旧卡片布局另起炉灶；计算样式的细节由走查实测。
    },
    {
      name: '参数下沿复用统一参数条',
      ancestor: '[data-parameter-rail]',
      descendant: '[data-parameter-summary]',
      // InlineParameterBar 的拍板形态是模型身份+摘要 pill+统一面板；这里不能再造一套“露几个参数”。
    },
    {
      name: '独立锚卡先于镜头行出现',
      before: '[data-storyboard-anchors]',
      after: '[data-storyboard-rows]',
      // 锚是跨镜头一致性的源头；版面位置把“先定锚、再拍镜”教给用户。
    },
  ],

  geometry: [
    {
      name: '行内画面格保持扫描尺寸',
      selector: '[data-storyboard-frame]',
      dimension: 'width',
      expected: 76,
    },
    {
      name: '行内画面格保持竖屏高度',
      selector: '[data-storyboard-frame]',
      dimension: 'height',
      expected: 132,
    },
  ],

  // 走查脚本消费这组关系。它们不能由 assertMockupContract 的静态顺序/几何断言替代：
  // 只有实际切换 mode 并观察输出，才能证明没有回到“并列四态 fixture”。
  modeProof: [
    { key: 'seedance-2:t2v', zone: 'none-accepted', tiles: 0, array: false },
    { key: 'seedance-2:first', zone: 'slots', tiles: 1, array: false },
    { key: 'seedance-2:firstlast', zone: 'slots', tiles: 2, array: false },
    { key: 'seedance-2:omni', zone: 'slots', tiles: 1, array: true, contains: ['image_ref', 'video_ref', 'audio_ref'] },
    { key: 'happyhorse:i2v', zone: 'slots', tiles: 1, array: false, contains: ['asArray'] },
    { key: 'happyhorse:edit', zone: 'slots', tiles: 2, array: true, contains: ['source_video', 'image_ref'] },
    { key: 'agnes-video:keyframes', zone: 'slots', tiles: 1, array: true, contains: ['上限未公布'] },
    { key: 'unknown:default', zone: 'slots', tiles: 1, array: true, contains: ['契约未知'] },
  ],
}
