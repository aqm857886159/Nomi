---
name: effect-camera-08
description: 用具体的机位与运动描述控制镜头节奏。 用户要求移轴虚化时使用。
license: MIT
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 移轴虚化
    selectable-in-workbench: false
    tools: []
    required-providers:
    - video
    library:
      kind: effect
      title:
        zh-CN: 移轴虚化
        en: Tilt-shift miniature
      summary:
        zh-CN: 用具体的机位与运动描述控制镜头节奏。
        en: 'Tilt-shift miniature: Add a precise camera or composition instruction to the scene.'
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

Tilt-shift, a shallow band of focus across a wide scene, top and bottom blurred

Keep every subject’s identity, appearance, clothing, setting, composition, lighting, color, and continuity unchanged. Change only the tilt-shift focus band and blur described here.
