<p align="center">
  <a href="https://nomiaqm.com/en/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="marketing/assets/promo-0.22/cover-en-dark.jpg" />
      <img src="marketing/assets/promo-0.22/cover-en-light.jpg" alt="Nomi — 프로급 AI 비디오. 모델은 원가 그대로." width="100%" />
    </picture>
  </a>
</p>

<h1 align="center">Nomi — 오픈소스 로컬 우선 AI 비디오 스튜디오</h1>

<p align="center">
  만들고 싶은 영상을 에이전트에게 말하기만 하세요. 샷을 기획하고, 키프레임과 영상을 생성해 타임라인에 배치합니다 —<br />
  <em>내가</em> 연결한 모델로, <em>제공사가</em> 책정한 가격 그대로.
</p>

<p align="center">
  <a href="#다운로드"><b>다운로드</b></a> ·
  <a href="https://nomiaqm.com/en/">웹사이트</a> ·
  <a href="https://atomgit.com/aqm857886159/Nomi">AtomGit 미러</a> ·
  <a href="#소개-영상-보기">90초 소개 영상 보기</a> ·
  <a href="https://nomiaqm.com/en/quickstart">빠른 시작</a> ·
  <a href="docs/integrate-with-your-agent-en.md">AI로 바로 연결하기</a> ·
  <a href="#커뮤니티">커뮤니티</a>
  <br />
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.tr.md">Türkçe</a>
</p>

<p align="center">
  <a href="https://github.com/aqm857886159/Nomi/releases/latest"><img src="https://img.shields.io/github/v/release/aqm857886159/Nomi?label=release&color=1a1816" alt="최신 릴리스" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-1a1816" alt="플랫폼" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-1a1816" alt="라이선스" /></a>
</p>

## 한눈에 보기

- **소개:** 데스크톱용 AI 비디오 스튜디오입니다. 내장 에이전트가 스토리를 샷 단위로 나누고 키프레임과 영상을 생성한 뒤, 직접 편집하고 MP4로 내보낼 수 있는 실제 타임라인에 배치합니다.
- **지원 플랫폼:** macOS(Apple Silicon 및 Intel)와 Windows.
- **가격:** Nomi 자체는 무료입니다. 원하는 모델을 직접 연결하고 제공사에 원래 요금 그대로 결제하면 됩니다. Nomi 계정, 구독, 추가 수수료가 없습니다.
- **지원 모델:** Seedance, Kling, Wan, Hailuo, Nano Banana, GPT Image 등. APIMart, Kie.ai, Volcengine, ModelScope, Dreamina 멤버십, OpenAI 호환 엔드포인트 또는 로컬 ComfyUI를 통해 연결할 수 있습니다.
- **에이전트 연동:** 내장 MCP 서버를 통해 Claude Code, Codex 또는 Cursor에서 Nomi를 직접 제어할 수 있습니다.
- **로컬 우선:** 프로젝트, 프롬프트, API 키는 모두 내 컴퓨터에만 보관됩니다.
- **라이선스:** 2026-08-01부터 AGPL-3.0-only입니다. v0.18.1 이하 릴리스는 Apache-2.0으로 배포되었으며 해당 라이선스를 유지합니다.
- **최신 버전:** [Releases](https://github.com/aqm857886159/Nomi/releases/latest)에서 확인할 수 있습니다.
- **이름 안내:** 이 Nomi는 AI 비디오 제작 앱이며, nomi.ai의 AI 동반자 챗봇 Nomi와는 무관합니다.

## 스폰서

스폰서의 후원으로 Nomi는 무료 오픈소스로 유지됩니다. 스폰서가 기본값이나 내장 경로로 강제되는 일은 절대 없습니다. 사용자가 직접 고른 모델만 자신의 키로 연결하고 제공사에 원가 그대로 결제합니다. [여기에 소개되고 싶으신가요?](#커뮤니티)

<table>
<tr>
<td width="128" align="center"><a href="https://gway.dev/sign-up?aff=8j8f"><img src="docs/media/sponsors/gway-logo.png" alt="Gway" width="96" /></a></td>
<td><b><a href="https://gway.dev/sign-up?aff=8j8f">Gway</a></b> — AI 비디오 및 멀티 이미지 레퍼런스 생성에 특화된 API 플랫폼으로, Seedance 2.0 / 2.5, Wan 3, MiniMax 등 주요 모델을 OpenAI 호환 종량제 방식으로 제공합니다. Nomi에는 아직 기본 프리셋이 없지만, <b>Let AI connect it for me</b>를 클릭하면 Claude Code 또는 Codex가 내 키로 바로 연결해 줍니다. Nomi를 후원해 준 Gway에 감사드립니다! <i>(Gway 링크에는 추천 코드가 포함되어 있습니다.)</i></td>
</tr>
</table>

## 왜 Nomi인가

중계 서비스(릴레이), 공식 API, ComfyUI, 로컬 모델은 원래 저렴합니다. 하지만 상용 AI 비디오 서비스는 똑같은 모델을 돌리면서 몇 배의 요금을 청구하는 경우가 많습니다.

Nomi는 **내 모델** 위에서 프로급 제작 워크플로우를 제공합니다. 요금은 제공사에 원가 그대로 직접 결제합니다. 에이전트조차 내가 선택한 모델로 실행되므로 구독료도, 마진도 없습니다.

## 소개 영상 보기

[![90초 Nomi 0.22 소개 영상 보기](marketing/assets/promo-0.22/film-poster-en.jpg)](https://github.com/aqm857886159/Nomi/blob/main/marketing/assets/video/nomi-0.22-film.mp4)

영상에 등장하는 모든 화면은 Nomi의 실제 UI이며, 모든 이미지와 클립 역시 Nomi로 생성했습니다.

## 할 수 있는 일

### 말만 하세요 — 에이전트가 캔버스에서 직접 작업합니다

<img src="marketing/assets/promo-0.22/still-agent.jpg" alt="한 번의 요청을 캔버스 위 네 장의 키프레임으로 바꾸는 Nomi 에이전트" width="100%" />

만들고 싶은 영상을 설명하세요. 에이전트가 현재 캔버스를 읽고 스토리를 샷으로 분할한 뒤, 키프레임을 생성하고 영상으로 변환해 타임라인까지 정리합니다. 생성된 모든 결과물은 캔버스에 그대로 놓이므로 언제든 확인하고 수정할 수 있습니다.

개입 수준은 원하는 대로 고를 수 있습니다: **Ask each step**(단계마다 확인), **Auto-edit**(자동 편집 — 유료 생성은 계속 확인), **Full auto**(완전 자동).

### 모든 샷을 직접 연출하세요

<img src="marketing/assets/promo-0.22/still-storyboard.jpg" alt="네 개의 샷이 모두 생성되고 캐릭터 레퍼런스 카드가 고정된 스토리보드" width="100%" />

스토리보드에서는 각 샷이 한 줄로 정리됩니다 — 프롬프트, 첫 프레임, 모델, 길이. 캐릭터나 장소의 레퍼런스 카드를 고정해 두면 해당 카드를 쓰는 모든 샷에서 동일한 얼굴과 분위기를 유지할 수 있습니다.

### 손안의 3D 디렉터

<img src="marketing/assets/promo-0.22/still-director.jpg" alt="스마트폰 뷰파인더 화면과 함께 쓰는 3D 디렉터" width="100%" />

캐릭터 포즈를 잡고 카메라를 배치한 뒤, 스마트폰을 뷰파인더처럼 사용해 구도를 잡을 수 있습니다. 캡처한 프레임은 곧바로 캔버스로 돌아옵니다.

### 샷마다 원하는 모델로 자유롭게

<img src="marketing/assets/promo-0.22/still-model.jpg" alt="같은 비디오 카드를 다른 모델로 다시 생성한 화면" width="100%" />

Seedance, Kling, Wan, Hailuo, Nano Banana, GPT Image 등 다양한 모델을 APIMart, Kie.ai, Volcengine, ModelScope, Dreamina 멤버십, OpenAI 호환 릴레이 또는 로컬 ComfyUI로 연결해 쓸 수 있습니다. 특정 샷만 다른 모델로 바꿔 새로운 테이크를 바로 생성해 보세요.

### 오늘 나온 새 모델, 오늘 바로 Nomi에서

새 모델이 출시되면 **Let AI connect it for me**를 클릭해 Claude Code나 Codex에게 연결을 맡기세요. 엔드포인트, 파라미터, 모델 ID를 자동으로 찾고, Nomi 자체 화면에 API 키를 붙여 넣게 한 뒤(어시스턴트는 키를 볼 수 없습니다), 실제 테스트를 한 번 돌려 정상 동작하면 모델 목록에 추가합니다.

### 온전히 당신의 작업물

프로젝트는 디스크 위의 일반 폴더입니다. 캔버스, 스토리보드, 타임라인, 생성된 모든 파일과 내보낸 영상이 모두 그 안에 담깁니다. 계정은 필요 없으며, 기본적으로 어떤 데이터도 외부로 전송되지 않습니다. 익명 사용 통계는 선택 사항(Settings → Privacy & diagnostics)이며 언제든 끌 수 있습니다. 소스 코드는 AGPL-3.0으로 공개되어 있습니다.

**다음 목표: AI 편집.** Nomi는 AI로 만드는 모든 영상 작업을 한곳에서 끝내는 스튜디오를 향해 나아가고 있습니다 — 함께 만들어 가요.

## 다운로드

| 운영체제 | 빌드 | 다운로드 |
|---|---|---|
| macOS | Apple Silicon | [Nomi-mac-arm64.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-arm64.dmg) |
| macOS | Intel | [Nomi-mac-intel.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-intel.dmg) |
| Windows | Windows 10 / 11 x64 | [Nomi-windows-setup.exe](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-windows-setup.exe) |

현재 지원하는 공식 릴리스 대상은 macOS arm64/x64 및 Windows x64입니다. Linux, Windows arm64, macOS 유니버설 설치 파일은 현재 배포하지 않습니다.

<details>
<summary><b>macOS에서 처음 실행할 때</b></summary>

현재 macOS 빌드는 **Apple Developer ID 서명 및 공증(Notarization)이 되어 있지 않아** 처음 실행 시 macOS가 차단할 수 있습니다. 반드시 위 직접 다운로드 링크나 공식 Nomi 웹사이트 및 GitHub 저장소의 링크만 사용하세요.

1. 사용 중인 Mac에 맞는 DMG 파일을 내려받아 열고, 창 안의 **Nomi**를 **응용 프로그램(Applications)** 폴더로 드래그합니다.
2. 응용 프로그램 폴더에서 Nomi를 실행합니다. macOS가 **“Nomi”을(를) 열 수 없음(“Nomi” Not Opened)** 경고를 띄우면 **완료(Done)**를 누른 뒤, **시스템 설정 → 개인정보 보호 및 보안(System Settings → Privacy & Security)**을 열어 **보안(Security)** 항목까지 스크롤한 다음 Nomi 안내 옆의 **확인 없이 열기(Open Anyway)**를 클릭해 승인하세요. macOS 15부터는 앱을 오른쪽 클릭해 **열기**를 선택해도 이 차단을 통과할 수 없습니다(macOS 14 이하에서는 기존 방식이 계속 동작합니다).

macOS가 Nomi가 “손상되었기 때문에 열 수 없음”이라고 표시하는 경우에 한해, 설치 파일이 공식 Nomi 링크에서 받은 것인지 먼저 확인한 뒤 아래 명령어를 실행하세요.

```bash
xattr -dr com.apple.quarantine "/Applications/Nomi.app"
```

Gatekeeper를 전역으로 비활성화하지 마세요. 업데이트할 때는 맞는 DMG를 내려받고 Nomi를 종료한 뒤, 새 Nomi를 응용 프로그램 폴더로 드래그해 **대치(Replace)**를 선택하면 됩니다.
</details>

<details>
<summary><b>Windows에서 처음 실행할 때</b></summary>

설치 파일에는 Authenticode 서명이 포함되어 있지 않습니다. SmartScreen 경고 창에서 **추가 정보(More info)** → **실행(Run anyway)**을 선택하세요.
</details>

## 빠른 시작

1. **모델 연결하기.** APIMart 또는 Kie.ai를 선택해 키 하나만 붙여 넣거나, 자체 릴레이·OpenAI 호환 엔드포인트·로컬 ComfyUI를 추가하세요. 직접 설정하기 번거롭다면 [AI로 Nomi 연결하기](docs/integrate-with-your-agent-en.md) 가이드를 Claude Code나 Codex에 넘겨주세요.
2. **만들고 싶은 영상 설명하기.** 에이전트 패널에 입력하거나 스토리보드에서 이야기로 시작하세요.
3. **연출하고 내보내기.** 마음에 드는 테이크를 골라 타임라인을 다듬고 MP4로 내보내세요.

> **안내:** APIMart 링크에는 추천 코드가 포함되어 있습니다. 언제나 자신의 키로 제공사에 원가 그대로 직접 결제하게 됩니다. Nomi는 추론을 프록시하거나 재판매하지 않으며, 모든 제공사는 원하는 엔드포인트로 자유롭게 바꿀 수 있습니다.

더 보기: [빠른 시작](https://nomiaqm.com/en/quickstart) · [첫 모델 연결하기(영어)](docs/guide/model-connection-en.md) · [사용자 가이드](docs/user-guide.md) · [제공사 연동](docs/provider-integration.md) · [CLI + MCP](docs/guide/capability-core-cli-mcp.md)

## 내 에이전트에서 Nomi 사용하기

Nomi에는 24개의 MCP 도구를 제공하는 MCP 서버가 내장되어 있어 Claude Code, Codex 또는 Cursor가 Nomi를 직접 조작(생성, 배치, 편집)할 수 있으며, 기존 에이전트 구독에 포함된 크레딧도 그대로 활용할 수 있습니다. 자세한 내용은 [AI로 Nomi 연결하기](docs/integrate-with-your-agent-en.md)를 참고하세요.

## 커뮤니티

- 질문, 워크플로우 공유, 로드맵: [GitHub Discussions](https://github.com/aqm857886159/Nomi/discussions)
- 버그 제보 및 기능 제안: [GitHub Issues](https://github.com/aqm857886159/Nomi/issues)
- 릴리스 노트 및 짧은 데모: [X / Twitter](https://x.com/sdf297417627618) · [Bilibili](https://www.bilibili.com/video/BV1Lf8b6nEjf/)

WeChat 사용자는 왼쪽 QR 코드를 스캔해 사용자 그룹에 참여할 수 있습니다. 그룹 코드가 만료된 경우 오른쪽 QR 코드 또는 아이디 **TZ857886159**로 메인테이너를 추가해 주세요.

<p align="center">
  <a href="docs/media/nomi-canvas-group-wechat-2026-12-03.jpg"><img src="docs/media/nomi-canvas-group-wechat-2026-12-03.jpg" alt="Nomi 사용자 그룹 WeChat QR 코드" width="220" /></a>
  &nbsp;&nbsp;
  <a href="docs/media/qingyang-wechat.jpg"><img src="docs/media/qingyang-wechat.jpg" alt="Nomi 메인테이너 WeChat QR 코드" width="180" /></a>
</p>

버그를 발견하셨나요? 코드가 공개되어 있습니다 — 오류 메시지와 [이슈 수정 프롬프트](docs/guide/codex-issue-fix-prompt-en.md)를 Claude Code나 Codex에 전달하면 많은 경우 바로 패치를 만들어 줍니다. 다른 사용자도 겪을 수 있는 문제라면 알려 주세요. 메인 브랜치에 반영하겠습니다.

## 팀을 위한 서비스

실제 프로덕션 워크플로우에 Nomi를 도입하려는 팀을 위해 **맞춤 빌드**, **시스템 통합**, **AGPL 준수 배포**, **지속적인 고도화**를 지원합니다. [프로젝트 상담하기](https://github.com/aqm857886159/Nomi/issues/new?template=business_inquiry.yml) — 이 양식은 공개되어 있으므로 기밀이 아닌 요약만 작성하고, 인증 정보·개인 연락처·예산 세부 사항·NDA 보호 정보는 절대 올리지 마세요.

## 개발자

Node.js 20+ 및 pnpm이 필요합니다.

```bash
git clone https://github.com/aqm857886159/Nomi.git
cd Nomi
corepack enable
pnpm install
pnpm dev
```

```text
electron/    Electron main process, local runtime, storage, and model calls
src/         React + Vite + Tailwind workbench
skills/      Skill Pack v2; see docs/skill-pack-format.md
```

자주 쓰는 검사 명령: `pnpm run test` · `pnpm run typecheck` · `pnpm run gates`

리서치 도구(Douyin / Xiaohongshu / Bilibili / X에서 크리에이터 의견을 검색하는 용도)는 `TIKHUB_API_KEY` 환경 변수에서만 키를 읽습니다 — [`docs/research/tikhub-api-notes.md`](docs/research/tikhub-api-notes.md)를 참고하세요.

## 기여하기

버그 제보, 기능 제안, 문서 개선, 코드 기여 모두 환영합니다. CLA 서명은 필요 없으며, 모든 기여는 AGPL-3.0-only 라이선스로 수락됩니다.

- [버그 제보하기](https://github.com/aqm857886159/Nomi/issues/new?template=bug_report.yml)
- [기능 요청하기](https://github.com/aqm857886159/Nomi/issues/new?template=feature_request.yml)
- [질문하거나 아이디어 나누기](https://github.com/aqm857886159/Nomi/discussions)

## 라이선스

현재 릴리스는 AGPL-3.0-only 라이선스를 따릅니다. 이전에 Apache-2.0으로 배포된 과거 릴리스는 원래 라이선스를 유지합니다.

자세한 내용은 [LICENSE](LICENSE)를 참고하세요. 유료 서비스에는 AGPL을 준수하는 맞춤 개발, 통합, 배포, 교육 및 지속적인 개선이 포함될 수 있습니다. Nomi는 해당 소스 코드를 공개하지 않는 비공개(클로즈드 소스) 배포판은 제공하지 않습니다.
