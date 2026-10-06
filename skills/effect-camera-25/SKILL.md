---
name: effect-camera-25
description: 用具体的机位与运动描述控制镜头节奏。 用户要求黑场转场时使用。
license: MIT
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 黑场转场
    selectable-in-workbench: false
    tools: []
    required-providers:
    - video
    library:
      kind: effect
      title:
        zh-CN: 黑场转场
        en: Cut-to-black
      summary:
        zh-CN: 用具体的机位与运动描述控制镜头节奏。
        en: 'Cut-to-black: Add a precise camera or composition instruction to the scene.'
      appliesTo:
      - video
      group:
        zh-CN: 运镜
        en: Camera
      slots: []
      source:
        url: https://github.com/jnMetaCode/ai-shortfilm-prompts/blob/f21500e5946973949c6bbf02e67e0c21b2e63a35/templates/camera-move-library.md
        revision: f21500e5946973949c6bbf02e67e0c21b2e63a35
        author: jnMetaCode
        changes: Nomi adds Chinese task labels, reference slots and review criteria; fixed subjects are parameterized where
          noted.
        evidence:
        - https://github.com/jnMetaCode/ai-shortfilm-prompts/blob/f21500e5946973949c6bbf02e67e0c21b2e63a35/templates/camera-move-library.md
      preview:
        path: assets/cover.png
        type: image
        provenance: illustration
---

Hard cut to black, hold one beat, resolve on the next scene

Keep any recurring subject’s identity, appearance, and clothing consistent across the transition. Allow the setting, time, and lighting to change in the next scene as described; change only the cut-to-black transition.
