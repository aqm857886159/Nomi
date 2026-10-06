---
name: effect-camera-07
description: 用具体的机位与运动描述控制镜头节奏。 用户要求摇镜扫景时使用。
license: MIT
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 摇镜扫景
    selectable-in-workbench: false
    tools: []
    required-providers:
    - video
    library:
      kind: effect
      title:
        zh-CN: 摇镜扫景
        en: Pan-scan vista
      summary:
        zh-CN: 用具体的机位与运动描述控制镜头节奏。
        en: 'Pan-scan vista: Add a precise camera or composition instruction to the scene.'
      appliesTo:
      - video
      group:
        zh-CN: 运镜
        en: Camera
      slots:
      - token: '{场景}'
        reference: scene
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

Slow horizontal pan across a wide {场景}, revealing its full scale

Keep the scene identity, spatial layout, lighting, color, and continuity unchanged. Change only the horizontal pan and the portion of the scene revealed described here.
