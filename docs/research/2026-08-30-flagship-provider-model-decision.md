# Flagship Provider And Model Decision, 2026-08-30

## Decision

Nomi should add three official suppliers now: MiniMax, ElevenLabs, and Meshy. Existing KIE and APIMart should gain current flagship gaps in video, music, and sound effects. Replicate remains the existing element-decomposition route in this round; fal and broader Replicate media catalogs remain researched follow-up work. Volcengine already exists and must not be duplicated.

Meshy is deliberately narrow: only the current official `meshy-7` single-image route is included. It produces a GLB through one create/poll contract and avoids RunningHub's Enterprise-Shared credential requirement. Meshy is not a required default and does not replace Hunyuan3D/RunningHub; the two-stage text-to-3D workflow remains excluded.

"Strongest" here means a provider's current flagship with a callable production contract and direct value to Nomi. Vendor claims are not treated as an independent cross-provider quality ranking; final quality still requires Nomi blind tests.

## Inventory

The baseline `applyBuiltinSeeds` produced 12 suppliers, 92 models, and 136 mappings: 38 image, 34 video, 15 text, 2 audio, and 3 model3d. This implementation produces 15 suppliers, 106 models, and 151 mappings: 38 image, 36 video, 16 text, 12 audio, and 4 model3d. The expansion is concentrated on audio, current video contracts, one text flagship, and one usable 3D route rather than another image/video long tail.

## Selection

| Priority | Selection | Evidence-backed reason | Confidence |
|---|---|---|---|
| P0 | ElevenLabs `eleven_v3`, `music_v2`, `scribe_v2`, `eleven_text_to_sound_v2` | Current official flagship family; one supplier adds production TTS, music, STT, and SFX | High for contract/currentness; medium for cross-provider quality |
| P0 | MiniMax `MiniMax-M3` | Current text flagship, not obsolete M1; 1M context and multimodal input are useful to Nomi's Agent/provider surface | High |
| P0 | MiniMax `MiniMax-H3` | Current official multimodal video model; exercises first/last/reference media and honest cancel semantics | High |
| P0 | KIE `google/gemini-omni-flash-1-1` | Current explicitly versioned Gemini Omni contract with multimodal image/video/character/audio references and up to 4K | High for the KIE contract |
| P0 | KIE Suno `V5_5` music and sounds | KIE documents both current music and sound generation with asynchronous task retrieval | High for the contract |
| P0 | APIMart Suno `v5.5` music and sounds | APIMart documents current V5.5 generation and sound effects with one shared async task API | High for the contract |
| P1 | MiniMax Speech 2.8 HD/Turbo | Current official speech family; HD for final output, Turbo for preview | High |
| P1 | APIMart `flowmusic`, `version=lyria-3.5` | Current documented music route on an existing Nomi supplier | High for APIMart contract; no claim about Google-direct availability |
| P1 | Hugging Face Inference Providers | Hundreds of models and many provider partners, but non-chat tasks use task-specific clients/contracts and current first-party coverage excludes music and 3D | High |
| P0 | Meshy 7 official direct | Current one-stage image-to-3D contract returns `model_urls.glb` and avoids the aggregate route's enterprise-only credential requirement | High for contract; no cross-provider quality claim |

## Foreign Platform Decision

Popularity is treated as an adoption signal, not as a quality ranking. Public monthly-active-user counts are not consistently disclosed, so the decision uses first-party endpoint counts, request/run counts, catalog breadth, and production lifecycle support.

| Platform | First-party adoption / breadth signal | Fit for this round | Decision |
|---|---|---|---|
| fal | 1,000+ endpoints, billions+ requests/day; image, video, audio, music, speech, 3D, real-time | Strong breadth and a uniform queue, but each endpoint still has a distinct input/output contract | P1 follow-up after curated endpoint certification |
| Replicate | Individual public models show tens to hundreds of millions of runs; current collections include video, music, and 3D entries | Supplier already exists and Predictions lifecycle is mature, but current Nomi route is purpose-built for element decomposition | Keep existing route; expand in a separate PR |
| Hugging Face Inference Providers | Hundreds of models routed across fal, Replicate, Together, and other partners | Broad ecosystem, but non-chat HTTP contracts are task-specific and music/3D are not first-class in the current matrix | P1 connector research |
| OpenRouter | Current catalog is broad and Nomi already exposes it as an OpenAI-compatible text preset | Strong text/model routing, but does not close Nomi's media lifecycle gaps as cleanly as fal/Replicate | Keep existing preset; no duplicate media route in this round |
| Together / Fireworks | Large developer ecosystems with strong text and some image/video coverage | Overlaps existing text routes and adds less music/3D value | Revisit after P0 certification |

## Protocol Matrix

| Executor | Submit | Observe / result | Cancel | Nomi decision |
|---|---|---|---|---|
| fal queue | `POST https://queue.fal.run/{endpoint}` -> `request_id`, `status_url`, `response_url`, `cancel_url` | `IN_QUEUE`, `IN_PROGRESS`, `COMPLETED`; result schema is endpoint-specific | `202 CANCELLATION_REQUESTED`, `400 ALREADY_COMPLETED`, `404 NOT_FOUND` | Follow-up only; never infer one endpoint's request or output schema from another model |
| Replicate Predictions | `POST /v1/models/{owner}/{model}/predictions`; response includes stable prediction id and lifecycle URLs | `starting`, `processing`, `succeeded`, `failed`, `canceled`; output schema is model-specific | Standard prediction cancel endpoint; terminal responses remain inspectable | Preserve the existing supplier; broader curated mappings require their own PR and certification |
| MiniMax H3 | `POST /v2/video_generation`; `content[]`; duration integer 4-15; 768P/2K; ratios include 21:9 | `GET /v2/query/video_generation/{task_id}`; terminal URL at `task.content.url` | DELETE only confirms queued cancellation; running is too late; terminal deletion is not cancellation | Normalize status and cancel disposition before provider integration |
| Eleven v3 | `POST /v1/text-to-speech/{voice_id}?output_format=wav_44100` | Synchronous WAV body | No remote task cancel | Existing sync binary path after exact mapping |
| Eleven Music v2 | `POST /v1/music`; strict first release limit 3-300 seconds due official-page conflict | Synchronous audio body | No remote task cancel | Add declared binary codec/MIME; do not invent a task id |
| Eleven SFX v2 | `POST /v1/sound-generation` | Synchronous MP3 body | No remote task cancel | Add SFX archetype and declared MP3 output |
| Eleven Scribe v2 | `POST /v1/speech-to-text` multipart | Synchronous JSON text/word timestamps | No remote task cancel | Make multipart/response extraction declaration-driven |
| Meshy 7 image-to-3D | `POST /openapi/v1/image-to-3d`, `ai_model=meshy-7` -> `{result:id}` | `GET /openapi/v1/image-to-3d/{id}`; `model_urls.glb` | DELETE exists; disposition must be derived from actual state/result | Materialize one validated GLB; do not add two-stage text-to-3D |
| KIE Gemini Omni 1.1 | `POST /api/v1/jobs/createTask`; model `google/gemini-omni-flash-1-1` | Unified KIE task detail; terminal `resultJson.resultUrls[]` | No model-specific cancel contract found | Add as a distinct 1.1 profile; never share APIMart Preview limits |
| KIE Suno V5.5 | `POST /api/v1/generate` or `/api/v1/generate/sounds` | `GET /api/v1/generate/record-info?taskId=...`; terminal `response.sunoData[].audioUrl` | No documented cancel | Add music and SFX as asynchronous audio mappings |
| APIMart Suno v5.5 | `POST /v1/music/generations` or `/v1/music/generations/sounds` | `GET /v1/music/tasks/{task_id}`; terminal `result.music[].audio_url` | No documented cancel | Add music and SFX as asynchronous audio mappings |
| APIMart Lyria 3.5 | `POST /v1/music/generations` -> `data[0].task_id` | `GET /v1/music/tasks/{task_id}`; `result.music[].audio_url/wav_url` | No documented cancel | Enter shared async audio path; cancel is unsupported/detached, not confirmed |
| LocalAI external | `/.well-known/localai.json`, `/readyz`, `/v1/models/capabilities`, `/v1/models` fallback; optional legacy `/version` | Advertised capabilities only; `/readyz` distinguishes ready from startup preload | Version/backend dependent | Discovery descriptor and probe only; `/system` is not a normal-user success criterion; no media certification claim |
| ComfyUI | Existing `/prompt`, `/history`, `/view`, `/ws` | Existing direct adapter | Existing interrupt/queue semantics cannot always prove final remote state | Preserve direct adapter; translate evidence into shared cancel result later |

## Explicit Exclusions

- MiniMax Music 3.0: official notice says paid Lyrics/Music API stopped accepting new users and free API closed on 2026-08-20.
- Meshy text-to-3D: preview then refine is a two-stage workflow and does not fit one create/query pair without orchestration.
- fal and broader Replicate media catalogs: valuable platform follow-ups, but not part of this implementation because every selected endpoint still needs an exact request/result and paid certification contract.
- Hi3D 3.0: current public API model key was not verified; no guessing.
- APIMart `gemini-omni-flash-preview`: this is not KIE's `google/gemini-omni-flash-1-1`. APIMart currently documents a Preview model limited to 720p and a different input/result contract, so it is not included under the flagship-only rule.
- All APIMart/KIE uncovered radar entries: many are endpoint/manual pages rather than models.

## Architecture Findings Against Current Main

- Unknown provider strings currently fall through as success and can enter materialization.
- Reconcile is declared but not called by ProductionGenerationSubmission.
- Cancel is declared but the runtime adapter does not expose it.
- `model3d` exists in catalog and assets but not in shared GenerationProviderOutput or ProductionArtifact.
- Audio billing kind currently bypasses generic create/poll for every mapping.
- Materialization checks MIME but does not yet prove GLB structure or media decodability.

These are shared-contract failures. Provider additions must follow the fixes, not precede them.

## Sources

Accessed 2026-08-30:

- MiniMax text OpenAI API: <https://platform.minimaxi.com/docs/api-reference/text-openai-api.md>
- fal platform overview: <https://fal.ai/docs/documentation>
- fal asynchronous inference: <https://fal.ai/docs/documentation/model-apis/inference/queue>
- fal model catalog: <https://fal.ai/explore>
- Replicate model catalog: <https://replicate.com/explore>
- Replicate predictions: <https://replicate.com/docs/topics/predictions>
- Hugging Face Inference Providers: <https://huggingface.co/docs/inference-providers/index>
- OpenRouter models: <https://openrouter.ai/models>
- MiniMax H3 create: <https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create>
- MiniMax API model list: <https://platform.minimax.io/docs/api-reference/api-overview>
- MiniMax Speech 2.8: <https://platform.minimax.io/docs/api-reference/speech-t2a-http>
- MiniMax Music availability notice: <https://platform.minimax.io/docs/api-reference/music-generation>
- ElevenLabs models: <https://elevenlabs.io/docs/overview/models>
- ElevenLabs TTS: <https://elevenlabs.io/docs/api-reference/text-to-speech/convert>
- ElevenLabs Music: <https://elevenlabs.io/docs/api-reference/music/compose>
- ElevenLabs SFX: <https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert>
- ElevenLabs STT: <https://elevenlabs.io/docs/api-reference/speech-to-text/convert>
- Meshy text-to-3D: <https://docs.meshy.ai/en/api/text-to-3d>
- Meshy image-to-3D: <https://docs.meshy.ai/en/api/image-to-3d>
- APIMart Lyria 3.5: <https://docs.apimart.ai/en/api-reference/audios/flow-music/music-lyria-3-5>
- KIE Gemini Omni 1.1 Flash: <https://docs.kie.ai/market/google/gemini-omni-flash-1-1.md>
- APIMart Gemini Omni Flash Preview: <https://docs.apimart.ai/en/api-reference/videos/gemini-omni-flash-preview/generation.md>
- KIE Suno music: <https://docs.kie.ai/suno-api/generate-music.md>
- KIE Suno sounds: <https://docs.kie.ai/suno-api/generate-sounds.md>
- KIE Suno task query: <https://docs.kie.ai/suno-api/get-music-details.md>
- APIMart Suno music: <https://docs.apimart.ai/en/api-reference/audios/suno/generation.md>
- APIMart Suno sounds: <https://docs.apimart.ai/en/api-reference/audios/suno/sounds.md>
- APIMart Suno task lifecycle: <https://docs.apimart.ai/en/api-reference/audios/suno/overview.md>
- LocalAI source: <https://github.com/mudler/LocalAI>
- LocalAI 4.9.0: <https://github.com/mudler/LocalAI/releases/tag/v4.9.0>
- ComfyUI fixed source snapshot: <https://github.com/Comfy-Org/ComfyUI/tree/e7051b03758a1247e3adb84a5b784ffacb9a23bd>

## Verification Still Required

No credential-backed calls were made during research. Each new provider remains "configured, awaiting certification" until a real paid request, bounded download/decode, journal commit, and fresh-process readback succeed.
