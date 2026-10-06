---
name: effect-camera-24
description: 用具体的机位与运动描述控制镜头节奏。 用户要求闪白转场时使用。
license: MIT
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 闪白转场
    selectable-in-workbench: false
    tools: []
    required-providers:
    - video
    library:
      kind: effect
      title:
        zh-CN: 闪白转场
        en: Flash-white
      summary:
        zh-CN: 用具体的机位与运动描述控制镜头节奏。
        en: 'Flash-white: Add a precise camera or composition instruction to the scene.'
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

Hard flash to white, then resolve on a new time/place

Keep any recurring subject’s identity, appearance, and clothing consistent across the transition. Allow the setting, time, and lighting to change in the new shot as described; change only the flash-to-white transition.
