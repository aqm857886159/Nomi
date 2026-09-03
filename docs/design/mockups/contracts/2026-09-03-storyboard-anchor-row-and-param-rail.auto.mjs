// 分镜表锚行/镜头行 · 自动层契约（2026-09-03，由样张实际渲染导出）。
// 禁止手改；布局改动后重新运行 scripts/extract-storyboard-anchor-mode-spec.mjs。

export default {
  "mockup": "docs/design/mockups/2026-09-03-storyboard-anchor-row-and-param-rail.html",
  "surface": "分镜表 · 锚行/镜头行自动层规格",
  "layer": "auto",
  "geometry": [
    {
      "name": "行内画面格",
      "selector": "[data-storyboard-frame]",
      "dimension": "width",
      "expected": 76
    },
    {
      "name": "行内画面格",
      "selector": "[data-storyboard-frame]",
      "dimension": "height",
      "expected": 132
    },
    {
      "name": "锚行画面格",
      "selector": "[data-anchor-frame]",
      "dimension": "width",
      "expected": 108
    },
    {
      "name": "锚行画面格",
      "selector": "[data-anchor-frame]",
      "dimension": "height",
      "expected": 144
    },
    {
      "name": "锚行引用缩略",
      "selector": "[data-anchor-ref-thumb]",
      "dimension": "width",
      "expected": 20
    },
    {
      "name": "参考 tile 识别尺寸",
      "selector": "[data-storyboard-ref-tile]",
      "dimension": "width",
      "expected": 56
    },
    {
      "name": "摘要 pill 高度",
      "selector": "[data-parameter-summary]",
      "dimension": "height",
      "expected": 28
    }
  ]
}
