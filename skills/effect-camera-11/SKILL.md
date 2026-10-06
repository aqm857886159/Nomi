---
name: effect-camera-11
description: 用具体的机位与运动描述控制镜头节奏。 用户要求慢动作升格时使用。
license: MIT
disable-model-invocation: true
metadata:
  nomi:
    version: 1.0.0
    label: 慢动作升格
    selectable-in-workbench: false
    tools: []
    required-providers:
    - video
    library:
      kind: effect
      title:
        zh-CN: 慢动作升格
        en: Slow-mo overcrank
      summary:
        zh-CN: 用具体的机位与运动描述控制镜头节奏。
        en: 'Slow-mo overcrank: Add a precise camera or composition instruction to the scene.'
      appliesTo:
      - video
      group:
        zh-CN: 运镜
        en: Camera
      slots:
      - token: '{impact/shatter}'
        reference: text
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

Extreme slow motion on the instant of {impact/shatter}, debris suspended mid-air

Keep the subjects, impact or shatter event, setting, lighting, color, and continuity unchanged. Change only the playback speed and suspended-debris timing described here.
