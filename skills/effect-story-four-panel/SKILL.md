---
name: effect-story-four-panel
description: 剧情四宫格：使用连接的参考，保留主体一致性。 用户要求剧情四宫格时使用。
license: Apache-2.0
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 剧情四宫格
    selectable-in-workbench: false
    tools: []
    required-providers:
    - image
    library:
      kind: effect
      title:
        zh-CN: 剧情四宫格
        en: Four-beat story
      summary:
        zh-CN: 剧情四宫格：使用连接的参考，保留主体一致性。
        en: 'Four-beat story sheet: setup, escalation, climax, aftermath on one 2x2 sheet.'
      appliesTo:
      - image
      group:
        zh-CN: 分镜
        en: Storyboard
      slots: []
      source:
        url: https://github.com/aqm857886159/Nomi/blob/a9ab76648cb634f9e29a38728a8d4f53256beef8/skills/effect-story-four-panel/SKILL.md
        revision: a9ab76648cb634f9e29a38728a8d4f53256beef8
        author: Nomi contributors
        changes: Original Nomi text, written to a task-framing / keep-and-change / fixed-output-spec structure; no upstream wording is reused. Not yet tested against a live model in Nomi.
        evidence:
        - https://github.com/aqm857886159/Nomi/blob/a9ab76648cb634f9e29a38728a8d4f53256beef8/skills/effect-story-four-panel/SKILL.md
      preview:
        path: assets/cover.png
        type: image
        provenance: illustration
---

这是一张从参考图推演出的四拍剧情 2×2 联系表。只改表情、机位、取景和动作的推进；参考中的角色、服装、地点、光线逻辑和世界观严格保持。按阅读顺序（左到右、上到下）四格依次为：1 铺垫（交代当下情境，最贴近参考图），2 升级（矛盾或动作推进），3 高潮（最强烈的一刻），4 后果（事件之后的余波）。四格等大，格与格之间只用细的中性分隔线，不要文字、对白气泡或编号；不添加新主角，不改变画风。如果提供了空白网格参考图，只按它的格线排版，不要把它的线条或空白当作画面内容。
