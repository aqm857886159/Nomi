---
name: effect-expression-grid
description: 表情九宫格：使用连接的参考，保留主体一致性。 用户要求表情九宫格时使用。
license: Apache-2.0
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 表情九宫格
    selectable-in-workbench: false
    tools: []
    required-providers:
    - image
    library:
      kind: effect
      title:
        zh-CN: 表情九宫格
        en: Expression grid
      summary:
        zh-CN: 表情九宫格：使用连接的参考，保留主体一致性。
        en: 'Expression grid: Apply the effect to connected references while preserving the subject.'
      appliesTo:
      - image
      group:
        zh-CN: 角色设定
        en: Character
      slots:
      - token: '{角色名}'
        reference: character
      source:
        url: https://github.com/PicoTrex/Awesome-Nano-Banana-images/blob/2558bf0bb825be150c5d1aeab918cd90004882d3/README.md
        revision: 2558bf0bb825be150c5d1aeab918cd90004882d3
        author: https://x.com/vista8/status/1966164427243458977
        changes: Nomi-authored adaptation of the cited reference-editing pattern, with subject, composition and continuity
          constraints; the exact adapted formula has not been tested in Nomi. Upstream media demonstrates the original case
          only.
        evidence:
        - https://x.com/vista8/status/1966164427243458977
        - https://x.com/vista8
      preview:
        path: assets/cover.png
        type: image
        provenance: illustration
---

这是一张 3×3 表情联系表：以{角色名}为同一角色，参照姿势图生成九格，画幅为 1:1。保持发型、面部比例、服装、肤色、光线和纯色背景一致，只改变表情；按左到右、上到下依次为：1 中性，2 开心，3 悲伤，4 愤怒，5 惊讶，6 恐惧，7 厌恶，8 困惑，9 疲惫。九格等大、顺序固定，不要把文字、编号、箭头或说明画进图里。
