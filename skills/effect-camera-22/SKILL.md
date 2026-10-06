---
name: effect-camera-22
description: 用具体的机位与运动描述控制镜头节奏。 用户要求蒙太奇剪辑时使用。
license: MIT
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 蒙太奇剪辑
    selectable-in-workbench: false
    tools: []
    required-providers:
    - video
    library:
      kind: effect
      title:
        zh-CN: 蒙太奇剪辑
        en: Montage intercut
      summary:
        zh-CN: 用具体的机位与运动描述控制镜头节奏。
        en: 'Montage intercut: Add a precise camera or composition instruction to the scene.'
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

Rapid 0.5s intercut of charged details — sparks, eyes, blade, a held breath

Keep the identities, props, setting, lighting, color, and continuity consistent across the details. Change only the 0.5s intercut rhythm and the charged detail order described here.
