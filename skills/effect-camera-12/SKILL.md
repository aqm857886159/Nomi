---
name: effect-camera-12
description: 用具体的机位与运动描述控制镜头节奏。 用户要求快动作降格时使用。
license: MIT
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 快动作降格
    selectable-in-workbench: false
    tools: []
    required-providers:
    - video
    library:
      kind: effect
      title:
        zh-CN: 快动作降格
        en: Time-lapse undercrank
      summary:
        zh-CN: 用具体的机位与运动描述控制镜头节奏。
        en: 'Time-lapse undercrank: Add a precise camera or composition instruction to the scene.'
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

Fast time-lapse, clouds and shadows racing, light shifting over a near-static frame

Keep the scene identity, composition, subject placement, color palette, and continuity unchanged. Allow the clouds, shadows, and light to shift only as the time-lapse described here.
