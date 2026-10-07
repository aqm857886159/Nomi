---
name: effect-overhead-view
description: 俯视构图：使用连接的参考，保留主体一致性。 用户要求俯视构图时使用。
license: Apache-2.0
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 俯视构图
    selectable-in-workbench: false
    tools: []
    required-providers:
    - image
    library:
      kind: effect
      title:
        zh-CN: 俯视构图
        en: Overhead composition
      summary:
        zh-CN: 俯视构图：使用连接的参考，保留主体一致性。
        en: 'Overhead composition: Apply the effect to connected references while preserving the subject.'
      appliesTo:
      - image
      group:
        zh-CN: 构图
        en: Composition
      slots:
      - token: '{场景}'
        reference: scene
      source:
        url: https://github.com/PicoTrex/Awesome-Nano-Banana-images/blob/2558bf0bb825be150c5d1aeab918cd90004882d3/README.md
        revision: 2558bf0bb825be150c5d1aeab918cd90004882d3
        author: https://x.com/op7418/status/1960896630586310656
        changes: Nomi-authored adaptation of the cited reference-editing pattern, with subject, composition and continuity
          constraints; the exact adapted formula has not been tested in Nomi. Upstream media demonstrates the original case
          only.
        evidence:
        - https://x.com/op7418/status/1960896630586310656
        - https://x.com/op7418
      preview:
        path: assets/cover.png
        type: image
        provenance: illustration
---

这是一张俯视构图任务：将参考中的{场景}改为从正上方观察的俯视角度。保持物体身份、数量、相对位置、材质、色彩和光线方向不变，只改变观察角度。不要把“俯视”、箭头、网格、说明文字或编号画进图里，也不要凭空加入人物或物体。
