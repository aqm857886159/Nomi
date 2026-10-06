---
name: effect-storyboard-panels
description: 宽屏分镜：使用连接的参考，保留主体一致性。 用户要求宽屏分镜时使用。
license: Apache-2.0
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 宽屏分镜
    selectable-in-workbench: false
    tools: []
    required-providers:
    - image
    library:
      kind: effect
      title:
        zh-CN: 宽屏分镜
        en: Widescreen storyboard
      summary:
        zh-CN: 宽屏分镜：使用连接的参考，保留主体一致性。
        en: 'Widescreen storyboard: Apply the effect to connected references while preserving the subject.'
      appliesTo:
      - image
      group:
        zh-CN: 分镜
        en: Storyboard
      slots:
      - token: '{剧本文字}'
        reference: text
      source:
        url: https://github.com/PicoTrex/Awesome-Nano-Banana-images/blob/2558bf0bb825be150c5d1aeab918cd90004882d3/README.md
        revision: 2558bf0bb825be150c5d1aeab918cd90004882d3
        author: https://x.com/jamesyeung18/status/1992597408128045462?s=20
        changes: Nomi-authored adaptation of the cited reference-editing pattern, with subject, composition and continuity
          constraints; the exact adapted formula has not been tested in Nomi. Upstream media demonstrates the original case
          only.
        evidence:
        - https://x.com/jamesyeung18/status/1992597408128045462?s=20
        - https://x.com/jamesyeung18
      preview:
        path: assets/cover.png
        type: image
        provenance: illustration
---

这是一张 16:9 横向四格宽屏分镜联系表：根据{剧本文字}绘制连续镜头，保持角色身份、服装、场景空间关系、光线和画风一致。按左到右、上到下固定为 1 建立场景，2 动作开始，3 动作推进，4 结果收束；每格只表现一个明确机位和动作，四格等大。不要把对白、镜头编号、箭头或说明文字画进图里。
