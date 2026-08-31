# KIE / APIMart Model Generation Audit, 2026-08-30

## Scope And Rules

This audit compares the models currently seeded by Nomi with the official KIE and APIMart documentation indexes observed on 2026-08-30. It is a curation decision, not a request to expose every documented endpoint.

The four catalog decisions are:

- `flagship`: current general-purpose or category-leading model that should be recommended.
- `value`: current lower-cost or faster tier with a distinct reason to remain visible.
- `legacy`: retained for old projects, price, or compatibility; never the default recommendation.
- `companion`: an operation that depends on another model or task and should not be presented as a peer flagship.

An official documentation page proves that an API contract exists. It does not prove independent quality leadership. Cross-provider quality claims require Nomi blind evaluation.

## Executive Result

- Nomi currently seeds 15 KIE models and 31 APIMart models.
- Seedream is not missing its new generation. Both suppliers already expose Seedream 5.0 Pro; KIE also exposes 5.0 Lite. Seedream 4.5 is the compatibility generation and must no longer look equally recommended.
- The same generation problem exists for Nano Banana 1/2, Seedance 2.0/2.5, Qwen Image 2/3, and Wan 2.7/3.0.
- The highest-value KIE gap is Gemini Omni 1.1, plus music/SFX. The highest-value APIMart gaps are Suno V5.5, Lyria 3.5, FLUX 3 Video, and Kling 3 Omni.
- KIE/APIMart should remain curated channels. Broader fal/Replicate coverage is follow-up platform work, not a reason to copy every marketplace page into Nomi now.

## KIE: Current 15

| Kind | Current Nomi model | Decision | Successor / action | Reason |
|---|---|---|---|---|
| video | `bytedance/seedance-2` | legacy | Prefer `bytedance/seedance-2-5` | 2.5 is already seeded and is the current generation. Keep 2.0 for old projects and lower-cost fallback. |
| video | `happyhorse` | legacy | Prefer current general video models; APIMart already has HappyHorse 1.1 | KIE row is HappyHorse 1.0. Do not remove old project support. |
| image | `gpt-image-2-text-to-image` | flagship | Keep | Current GPT Image generation; KIE splits text/edit transport IDs. |
| image | `gpt-image-2-image-to-image` | flagship | Keep and dedupe with the text row in selection | Same model generation, separate KIE execution identity. |
| image | `seedream` | legacy | Prefer `seedream/5-pro-text-to-image` | This is Seedream 4.5. It is not the newest seeded generation. |
| image | `nano-banana` | legacy | Prefer `nano-banana-2` | Original Nano Banana remains a compatibility/value route. |
| video | `kling-3.0` | flagship | Keep; add Turbo/Omni only as distinct capability tiers | Current base Kling generation. Turbo and Omni are not replacements for every workflow. |
| video | `minimax-h3` | flagship | Keep | Current native audio-video model. |
| video | `bytedance/seedance-2-5` | flagship | Keep | Current Seedance generation already exists in Nomi. |
| video | `wan/3-0-video` | flagship | Keep | Current Wan generation already exists in Nomi. |
| image | `nano-banana-2` | flagship | Keep | Current full tier. |
| image | `nano-banana-2-lite` | value | Keep | Distinct faster/lower-cost tier with smaller input surface. |
| image | `seedream/5-pro-text-to-image` | flagship | Keep | Current Seedream quality tier. This disproves the "only 4.5 is connected" concern. |
| image | `seedream/5-lite-text-to-image` | value | Keep | Current lower-cost Seedream tier. |
| image | `flux-2/pro-text-to-image` | flagship | Keep until a verified KIE FLUX 3 image contract exists | Current KIE FLUX quality route; FLUX 3 coverage will come through fal/Replicate first. |

### KIE Additions

| Priority | Model / capability | Decision |
|---|---|---|
| P0 | `google/gemini-omni-flash-1-1` | Add as a distinct flagship profile. It is not APIMart's Preview contract. |
| P0 | Suno `V5_5` music | Add through KIE's asynchronous Suno lifecycle. |
| P0 | Suno sounds | Add as SFX, not as a fake TTS variant. |
| P1 | Kling 3 Turbo | Add as a value/speed tier after exact text/image request fields are certified. |
| P1 | Kling 3 Omni | Add only modes whose official reference/transformation contracts map honestly to Nomi slots. |
| P1 | Imagen 4 Ultra / Fast | Keep in certification backlog. Prior APIMart Imagen 4 was retired after deterministic 404s, so documentation presence alone is insufficient. |
| P1 | Gemini 3.1 Flash TTS / ElevenLabs dialogue v3 | Prefer direct ElevenLabs for first-party coverage; KIE routes remain optional redundancy. |
| Exclude | KIE 1.x/2.1/2.5/2.6 long tail | Do not seed. They are older generations or narrow utilities, not flagship gaps. |

## APIMart: Current 31

| Kind | Current Nomi model | Decision | Successor / action | Reason |
|---|---|---|---|---|
| text | `deepseek-v4-pro` | flagship | Keep | Current quality tier. |
| text | `deepseek-v4-flash` | value | Keep | Current latency/value tier. |
| text | `deepseek-v3.2` | legacy | Prefer V4 | Compatibility route. |
| text | `deepseek-v3.2-think` | legacy | Prefer V4 Pro | Compatibility/reasoning route. |
| text | `deepseek-v3.1-terminus` | legacy | Prefer V4 | Old generation; keep for compatibility. |
| text | `gemini-3.5-flash` | flagship | Keep | Current multimodal text route. |
| text | `MiniMax-H3-Context-IR` | companion | Keep out of ordinary assistant defaulting | Prompt enhancement for H3, not a peer chat model. |
| image | `doubao-seedream-5-0-pro` | flagship | Keep | Current Seedream quality tier is already connected. |
| image | `doubao-seedream-4.5` | legacy | Prefer 5.0 Pro | Compatibility generation. |
| image | `gemini-2.5-flash-image-preview` | legacy | Prefer `gemini-3.1-flash-image-preview` | Original Nano Banana generation. |
| image | `gemini-3.1-flash-image-preview` | flagship | Keep | Current Nano Banana 2 route. |
| image | `gpt-image-2` | flagship | Keep | Current GPT Image generation. |
| image | `qwen-image-2.0` | legacy | Prefer `qwen-image-3.0` | 3.0 is already seeded. |
| image | `qwen-image-3.0` | flagship | Keep | Current Qwen Image generation. |
| image | `z-image-turbo` | value | Keep | Fast/value tier; not presented as quality flagship. |
| video | `viduq3` | value | Certify current Q3 Pro/Turbo contract | Existing route remains useful, but official index now has a distinct Q3 Pro/Turbo page. |
| video | `kling-3.0-turbo` | value | Keep | Current speed tier. |
| video | `happyhorse-1.1` | value | Keep | Current HappyHorse generation on APIMart. |
| video | `grok-imagine-1.5-video-apimart` | value | Keep until a verified video successor exists | APIMart's 2.0 documentation currently concerns image generation, not a proven video replacement. |
| video | `sora-2` | flagship | Keep | Current Sora route. |
| video | `veo3.1-fast` | flagship | Keep | Current Veo generation with variants in one model family. |
| video | `kling-v3` | flagship | Keep; add Omni separately | Current base Kling quality route. |
| video | `doubao-seedance-2.0` | legacy | Prefer `doubao-seedance-2.5` | Compatibility/value generation. |
| video | `doubao-seedance-2.5` | flagship | Keep | Current Seedance generation already exists. |
| video | `MiniMax-H3` | flagship | Keep | Current native audio-video model. |
| video | `wan2.7` | legacy | Prefer `wan3.0-video` | Compatibility and video-edit route; not default. |
| video | `wan3.0-video` | flagship | Keep | Current Wan generation already exists. |
| video | `MiniMax-Hailuo-2.3` | value | Keep | Distinct lower-cost MiniMax video family. |
| video | `Omni-Flash-Ext` | legacy | Do not relabel as Gemini Omni 1.1 | Old/relay-specific identity. APIMart Preview has a different 720p contract. |
| video | `MiniMax-H3-Regeneration` | companion | Keep attached to H3 workflow | Upscale/regeneration depends on a prior H3 task. |
| audio | `nomi-audio` | legacy umbrella | Split recommended creation choices into explicit current music/SFX/TTS models | Current row hides `gpt-4o-mini-tts` and Whisper behind modes and does not cover music/SFX. |

### APIMart Additions

| Priority | Model / capability | Decision |
|---|---|---|
| P0 | Suno `v5.5` music | Add explicit music model with async task query. |
| P0 | Suno sounds | Add explicit SFX model with async task query. |
| P0 | Flow Music `lyria-3.5` | Add current music alternative on the shared APIMart music lifecycle. |
| P0 | `flux-3-video` | Add after its exact input and result schema passes fixtures. |
| P0 | `kling-v3-omni` | Add reference-capable modes that map to existing Nomi media slots. |
| P1 | `skyreels-v4` | Certify as a differentiated video alternative; do not block P0 breadth work. |
| P1 | `vidu-q3-pro` | Replace the recommendation for the older generic Q3 route after contract certification. |
| Exclude | `gemini-omni-flash-preview` as a stand-in for 1.1 | Different model identity, limits, and response contract. Keep it separate or omit it. |
| Exclude | Midjourney operation pages and Suno editing utilities | They are multi-step tools, not one model per page. Add later as workflows, not picker spam. |
| Exclude | Old Seedance/Wan/Kling pages | Already superseded by seeded current generations. |

## Catalog Metadata Contract

Curated models should carry code-owned metadata without changing the provider-first interaction:

```ts
meta.catalogLifecycle = {
  tier: "flagship" | "value" | "legacy" | "companion",
  asOf: "2026-08-30",
  successorModelKey?: string,
}
```

Rules:

- Existing projects keep their exact `(vendorKey, modelKey)` identity.
- `legacy` is selectable but sorted after `flagship` and `value`; it is never auto-selected when a current successor is usable.
- `companion` remains addressable by workflows but does not masquerade as a normal flagship model.
- A model can move between tiers by updating one code-owned metadata object. No label parsing is allowed.
- User-created models without lifecycle metadata remain normal selectable entries. Nomi must not guess their generation from names.

## Official Sources

Accessed 2026-08-30:

- KIE market index: <https://docs.kie.ai/llms.txt>
- KIE Gemini Omni 1.1: <https://docs.kie.ai/market/google/gemini-omni-flash-1-1.md>
- KIE Suno music: <https://docs.kie.ai/suno-api/generate-music.md>
- KIE Suno sounds: <https://docs.kie.ai/suno-api/generate-sounds.md>
- APIMart API index: <https://docs.apimart.ai/llms.txt>
- APIMart Suno music: <https://docs.apimart.ai/en/api-reference/audios/suno/generation.md>
- APIMart Suno sounds: <https://docs.apimart.ai/en/api-reference/audios/suno/sounds.md>
- APIMart Lyria 3.5: <https://docs.apimart.ai/en/api-reference/audios/flow-music/music-lyria-3-5.md>
- APIMart FLUX 3 Video: <https://docs.apimart.ai/en/api-reference/videos/flux-3-video/generation.md>
- APIMart Kling 3 Omni: <https://docs.apimart.ai/en/api-reference/videos/kling-v3-omni/generation.md>
- APIMart Gemini Omni Flash Preview: <https://docs.apimart.ai/en/api-reference/videos/gemini-omni-flash-preview/generation.md>
