---
name: effect-camera-21
description: 用具体的机位与运动描述控制镜头节奏。 用户要求长镜头一镜到底时使用。
license: MIT
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 长镜头一镜到底
    selectable-in-workbench: false
    tools: []
    required-providers:
    - video
    library:
      kind: effect
      title:
        zh-CN: 长镜头一镜到底
        en: Oner / long take
      summary:
        zh-CN: 用具体的机位与运动描述控制镜头节奏。
        en: 'Oner / long take: Add a precise camera or composition instruction to the scene.'
      appliesTo:
      - video
      group:
        zh-CN: 运镜
        en: Camera
      slots:
      - token: '{主体}'
        reference: subject
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

One continuous take, no cut, camera follows {主体} through the space

Keep every subject’s identity, appearance, clothing, setting, lighting, color, and continuity unchanged. Change only the continuous camera path; do not add a cut.
