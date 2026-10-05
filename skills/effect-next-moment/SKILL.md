---
name: effect-next-moment
description: 下一刻：使用连接的参考，保留主体一致性。 用户要求下一刻时使用。
license: Apache-2.0
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 下一刻
    selectable-in-workbench: false
    tools: []
    required-providers:
    - image
    library:
      kind: effect
      title:
        zh-CN: 下一刻
        en: Next moment
      summary:
        zh-CN: 下一刻：使用连接的参考，保留主体一致性。
        en: 'Render the most plausible moment a few seconds after the reference.'
      appliesTo:
      - image
      group:
        zh-CN: 分镜
        en: Storyboard
      slots: []
      source:
        url: https://github.com/aqm857886159/Nomi/blob/a9ab76648cb634f9e29a38728a8d4f53256beef8/skills/effect-next-moment/SKILL.md
        revision: a9ab76648cb634f9e29a38728a8d4f53256beef8
        author: Nomi contributors
        changes: Original Nomi text, written to a task-framing / keep-and-change / fixed-output-spec structure; no upstream wording is reused. Not yet tested against a live model in Nomi.
        evidence:
        - https://github.com/aqm857886159/Nomi/blob/a9ab76648cb634f9e29a38728a8d4f53256beef8/skills/effect-next-moment/SKILL.md
      preview:
        path: assets/cover.png
        type: image
        provenance: illustration
---

这是一次推演任务：画出参考图之后几秒内最合理的下一个瞬间，把参考图当作导致这一刻的上一刻。只改动作的推进，机位可以随动作自然变化；参考中的人物身份、服装、发型、所处地点和光线逻辑严格保持，不添加新人物，不更换环境。动作要有看得见的进展（姿势、手势或视线已经变了），不要缩成一张面朝镜头的普通肖像，也不要原样复现参考图。输出单张图，不要文字、字幕或界面元素。
