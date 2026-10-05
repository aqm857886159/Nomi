---
name: effect-prev-moment
description: 前一刻：使用连接的参考，保留主体一致性。 用户要求前一刻时使用。
license: Apache-2.0
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 前一刻
    selectable-in-workbench: false
    tools: []
    required-providers:
    - image
    library:
      kind: effect
      title:
        zh-CN: 前一刻
        en: Previous moment
      summary:
        zh-CN: 前一刻：使用连接的参考，保留主体一致性。
        en: 'Render the most plausible moment a few seconds before the reference.'
      appliesTo:
      - image
      group:
        zh-CN: 分镜
        en: Storyboard
      slots: []
      source:
        url: https://github.com/aqm857886159/Nomi/blob/a9ab76648cb634f9e29a38728a8d4f53256beef8/skills/effect-prev-moment/SKILL.md
        revision: a9ab76648cb634f9e29a38728a8d4f53256beef8
        author: Nomi contributors
        changes: Original Nomi text, written to a task-framing / keep-and-change / fixed-output-spec structure; no upstream wording is reused. Not yet tested against a live model in Nomi.
        evidence:
        - https://github.com/aqm857886159/Nomi/blob/a9ab76648cb634f9e29a38728a8d4f53256beef8/skills/effect-prev-moment/SKILL.md
      preview:
        path: assets/cover.png
        type: image
        provenance: illustration
---

这是一次推演任务：画出参考图之前几秒内最合理的上一个瞬间，让参考图成为这一刻自然导致的结果。只改动作的回退，机位可以随动作自然变化；参考中的人物身份、服装、发型、所处地点和光线逻辑严格保持，不添加新人物，不更换环境。动作要和参考图有看得见的差别（姿势、手势或视线还没到参考图那一步），不要缩成一张面朝镜头的普通肖像，也不要原样复现参考图。输出单张图，不要文字、字幕或界面元素。
