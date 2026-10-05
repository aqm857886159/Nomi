---
name: effect-multi-angle-grid
description: 多机位九宫格：使用连接的参考，保留主体一致性。 用户要求多机位九宫格时使用。
license: Apache-2.0
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 多机位九宫格
    selectable-in-workbench: false
    tools: []
    required-providers:
    - image
    library:
      kind: effect
      title:
        zh-CN: 多机位九宫格
        en: Multi-angle grid
      summary:
        zh-CN: 多机位九宫格：使用连接的参考，保留主体一致性。
        en: 'Multi-angle 3x3 sheet: same moment, nine camera positions, everything else held.'
      appliesTo:
      - image
      group:
        zh-CN: 分镜
        en: Storyboard
      slots: []
      source:
        url: https://github.com/aqm857886159/Nomi/blob/a9ab76648cb634f9e29a38728a8d4f53256beef8/skills/effect-multi-angle-grid/SKILL.md
        revision: a9ab76648cb634f9e29a38728a8d4f53256beef8
        author: Nomi contributors
        changes: Original Nomi text, written to a task-framing / keep-and-change / fixed-output-spec structure; no upstream wording is reused. Not yet tested against a live model in Nomi.
        evidence:
        - https://github.com/aqm857886159/Nomi/blob/a9ab76648cb634f9e29a38728a8d4f53256beef8/skills/effect-multi-angle-grid/SKILL.md
      preview:
        path: assets/cover.png
        type: image
        provenance: illustration
---

这是一张 3×3 机位联系表：同一时刻、同一场景、同一批人物，只换九个机位。只改机位和取景；人物身份、服装、发型、动作、人数与左右站位、背景、光线和色调一律严格保持不变。按阅读顺序（左到右、上到下）九格依次为：1 正面平视，2 左前 3/4，3 右前 3/4，4 左侧，5 右侧，6 背面，7 俯拍，8 仰拍，9 荷兰角（地平线倾斜）。九格等大，格与格之间只用细的中性分隔线，不要文字、编号、字幕或界面元素。上面写的是观看位置，不是要加进画面的物体：不要画出相机、三脚架或取景框，不添加人物，不复制主体。如果提供了空白网格参考图，只按它的格线排版，不要把它的线条或空白当作画面内容。
