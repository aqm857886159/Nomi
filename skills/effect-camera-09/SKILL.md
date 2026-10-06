---
name: effect-camera-09
description: 用具体的机位与运动描述控制镜头节奏。 用户要求逆光剪影时使用。
license: MIT
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 逆光剪影
    selectable-in-workbench: false
    tools: []
    required-providers:
    - video
    library:
      kind: effect
      title:
        zh-CN: 逆光剪影
        en: Backlit silhouette
      summary:
        zh-CN: 用具体的机位与运动描述控制镜头节奏。
        en: 'Backlit silhouette: Add a precise camera or composition instruction to the scene.'
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

Hard backlight, {主体} rendered as a near-black silhouette, bright rim only

Keep the subject’s identity, clothing, pose, setting, composition, and color palette unchanged. Deliberately change the lighting into the hard backlight and near-black silhouette described here.
