<p align="center">
  <a href="https://nomiaqm.com/en/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="marketing/assets/promo-0.22/cover-en-dark.jpg" />
      <img src="marketing/assets/promo-0.22/cover-en-light.jpg" alt="Nomi — プロ品質の AI 動画。モデルは本来の価格で。" width="100%" />
    </picture>
  </a>
</p>

<h1 align="center">Nomi — オープンソースでローカルファーストな AI 動画スタジオ</h1>

<p align="center">
  作りたいものをエージェントに伝えるだけ。カット割りを考え、キーフレームと動画を生成し、タイムラインに並べます —<br />
  <em>あなたが</em>接続したモデルで、<em>プロバイダーが</em>請求する価格のままで。
</p>

<p align="center">
  <a href="#ダウンロード"><b>ダウンロード</b></a> ·
  <a href="https://nomiaqm.com/en/">公式サイト</a> ·
  <a href="https://atomgit.com/aqm857886159/Nomi">AtomGit ミラー</a> ·
  <a href="#フィルムを見る">90 秒のフィルムを見る</a> ·
  <a href="https://nomiaqm.com/en/quickstart">クイックスタート</a> ·
  <a href="docs/integrate-with-your-agent-en.md">AI に接続してもらう</a> ·
  <a href="#コミュニティ">コミュニティ</a> ·
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/aqm857886159/Nomi/releases/latest"><img src="https://img.shields.io/github/v/release/aqm857886159/Nomi?label=release&color=1a1816" alt="最新リリース" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-1a1816" alt="プラットフォーム" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-1a1816" alt="ライセンス" /></a>
</p>

## 概要

- **何であるか：** デスクトップ版の AI 動画スタジオです。エージェントがストーリーをカットに分け、キーフレームと動画を生成し、編集して MP4 として書き出せる本物のタイムラインに並べます。
- **対応プラットフォーム：** macOS（Apple Silicon と Intel）と Windows。
- **価格：** Nomi 自体は無料です。自分のモデルを接続し、プロバイダーにその価格で直接支払います。Nomi のアカウントも、サブスクリプションも、上乗せ料金もありません。
- **モデル：** Seedance、Kling、Wan、Hailuo、Nano Banana、GPT Image など。APIMart、Kie.ai、Volcengine、ModelScope、Dreamina のメンバーシップ、任意の OpenAI 互換エンドポイント、またはローカルの ComfyUI 経由で使えます。
- **エージェント：** 組み込みの MCP サーバーにより、Claude Code、Codex、Cursor から Nomi を操作できます。
- **ローカルファースト：** プロジェクト、プロンプト、キーはあなたのマシンに残ります。
- **ライセンス：** 2026-08-01 から AGPL-3.0-only です。v0.18.1 までのリリースは Apache-2.0 で公開されており、そのライセンスのままです。
- **最新バージョン：** [Releases](https://github.com/aqm857886159/Nomi/releases/latest) を参照してください。
- **名前について：** この Nomi は AI 動画アプリです。nomi.ai の AI コンパニオンチャットボットの Nomi とは無関係です。

## スポンサー

スポンサーのおかげで、Nomi は無料かつオープンソースであり続けられます。スポンサーが既定のものや組み込みのルートになることはありません。接続するのは自分で選んだものだけで、自分のキーを使い、その価格で直接支払います。[ここに載りたいですか？](#コミュニティ)

<table>
<tr>
<td width="128" align="center"><a href="https://gway.dev/sign-up?aff=8j8f"><img src="docs/media/sponsors/gway-logo.png" alt="Gway" width="96" /></a></td>
<td><b><a href="https://gway.dev/sign-up?aff=8j8f">Gway</a></b> — AI 動画と複数画像リファレンスによる生成に特化した API プラットフォームです。Seedance 2.0 / 2.5、Wan 3、MiniMax などの主要モデルに対応し、OpenAI 互換で従量課金です。Nomi にはまだ組み込みのプリセットがありません。<b>Let AI connect it for me</b> をクリックすると、Claude Code または Codex があなたのキーで接続してくれます。Nomi を支援してくれている Gway に感謝します！ <i>（Gway のリンクには紹介コードが含まれています。）</i></td>
</tr>
</table>

## なぜ Nomi なのか

リレー、公式 API、ComfyUI、ローカルモデルは安価です。商用の AI 動画サービスは、まったく同じモデルを動かしていながら、数倍の料金を請求することがよくあります。

Nomi は、**あなた自身の**モデルの上に、プロ品質のワークフローを提供します。プロバイダーにその価格で直接支払い、エージェントさえも、あなたが選んだモデルで動きます — サブスクリプションも、上乗せ料金もありません。

## フィルムを見る

[![90 秒の Nomi 0.22 フィルムを見る](marketing/assets/promo-0.22/film-poster-en.jpg)](https://github.com/aqm857886159/Nomi/blob/main/marketing/assets/video/nomi-0.22-film.mp4)

フィルムに映る画面はすべて Nomi の実際の UI で、映像や動画のクリップもすべて Nomi で生成したものです。

## できること

### 頼むだけ — エージェントがキャンバス上で作業します

<img src="marketing/assets/promo-0.22/still-agent.jpg" alt="Nomi のエージェントが 1 つの依頼をキャンバス上の 4 枚のキーフレームにしているところ" width="100%" />

作りたいフィルムを説明してください。エージェントはキャンバスを読み取り、ストーリーをカットに分け、キーフレームを生成し、それを動画にして、タイムラインを整えます。作ったものはすべてキャンバスに置かれ、確認も変更もできます。

どこまで確認を求めるかは、あなたが決められます：**Ask each step**、**Auto-edit**（有料の生成では確認します）、**Full auto**。

### すべてのカットを演出する

<img src="marketing/assets/promo-0.22/still-storyboard.jpg" alt="4 カットがすべて生成され、キャラクターのリファレンスカードがロックされたストーリーボード" width="100%" />

ストーリーボードでは、各カットが 1 行に並びます — プロンプト、最初のフレーム、モデル、長さ。キャラクターや場所のリファレンスカードをロックすれば、それを使うすべてのカットで同じ顔が保たれます。

### 手の中で扱える 3D ディレクター

<img src="marketing/assets/promo-0.22/still-director.jpg" alt="スマートフォンのビューファインダーページを備えた 3D ディレクター" width="100%" />

キャラクターにポーズを取らせ、カメラを配置し、スマートフォンをビューファインダーとして使えます。撮影したフレームは、そのままキャンバスに戻ります。

### カットごとに、好きなモデルで

<img src="marketing/assets/promo-0.22/still-model.jpg" alt="同じ動画カードを別のモデルで再生成したところ" width="100%" />

Seedance、Kling、Wan、Hailuo、Nano Banana、GPT Image など — APIMart、Kie.ai、Volcengine、ModelScope、Dreamina のメンバーシップ、任意の OpenAI 互換リレー、またはローカルの ComfyUI 経由で使えます。1 つのカットだけモデルを替えて、別のテイクを生成できます。

### 新しいモデルを、その日のうちに Nomi で

新しいモデルが登場したら、**Let AI connect it for me** をクリックして、Claude Code か Codex に接続してもらいましょう。エンドポイント、パラメータ、モデル ID を調べ、Nomi 自身のページにキーを貼り付けてもらい（アシスタントがキーを見ることはありません）、実際のテストを 1 回実行し、動作したらそのモデルを一覧に載せます。

### あなたのもの

プロジェクトは、ディスク上の普通のフォルダです。キャンバス、ストーリーボード、タイムライン、生成したすべてのファイル、書き出したフィルムが入っています。アカウントは不要です。既定では何も送信されません。匿名の利用統計はオプトインで（Settings → Privacy & diagnostics）、いつでもオフにできます。コードは AGPL-3.0 です。

**次の目標：AI 編集。** Nomi は、AI で作るすべてのものを 1 つに集めたスタジオを目指しています — 一緒に作りましょう。

## ダウンロード

| システム | ビルド | ダウンロード |
|---|---|---|
| macOS | Apple Silicon | [Nomi-mac-arm64.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-arm64.dmg) |
| macOS | Intel | [Nomi-mac-intel.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-intel.dmg) |
| Windows | Windows 10 / 11 x64 | [Nomi-windows-setup.exe](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-windows-setup.exe) |

対応しているリリース対象は、macOS arm64/x64 と Windows x64 です。Linux、Windows arm64、macOS ユニバーサルのインストーラーは、現在公開していません。

<details>
<summary><b>macOS での初回起動</b></summary>

現在の macOS ビルドは **Apple Developer ID による署名も公証もされていない**ため、初回起動時に macOS にブロックされることがあります。上の直接ダウンロードか、公式の Nomi ウェブサイトと GitHub リポジトリからのリンクだけを使ってください。

1. 対応する DMG をダウンロードして開き、ウィンドウ内で **Nomi** を **Applications** にドラッグします。
2. Applications から Nomi を開きます。macOS が **“Nomi” Not Opened** と表示したら、**Done** をクリックし、**System Settings → Privacy & Security** を開いて **Security** までスクロールし、Nomi のメッセージの横にある **Open Anyway** をクリックして確定します。macOS 15 以降では、アプリを右クリックして **Open** を選んでも、このプロンプトを通過できなくなりました。macOS 14 以前では今も通過できます。

macOS が Nomi を「壊れている」と表示した場合に限り、まずインストーラーが公式の Nomi のリンクから入手したものであることを確認してから、次を実行してください。

```bash
xattr -dr com.apple.quarantine "/Applications/Nomi.app"
```

Gatekeeper をシステム全体で無効にしないでください。更新するには、対応する DMG をダウンロードし、Nomi を終了してから、新しい Nomi を Applications にドラッグして **Replace** を選びます。
</details>

<details>
<summary><b>Windows での初回起動</b></summary>

インストーラーには Authenticode 署名がありません。SmartScreen のプロンプトで、**More info** → **Run anyway** を選んでください。
</details>

## クイックスタート

1. **モデルを接続する。** APIMart か Kie.ai を選んでキーを 1 つ貼り付けるか、自分のリレー、OpenAI 互換エンドポイント、ローカルの ComfyUI を追加します。自分でやりたくない場合は、[AI に Nomi を接続してもらう](docs/integrate-with-your-agent-en.md)を Claude Code か Codex に渡してください。
2. **作りたいものを伝える。** エージェントパネルに入力するか、ストーリーボードのストーリーから始めます。
3. **演出して書き出す。** 気に入ったテイクを残し、タイムラインを整えて、MP4 を書き出します。

> **開示：** APIMart のリンクには紹介コードが含まれています。常に自分のキーで、プロバイダーにその価格で直接支払います。Nomi が推論をプロキシしたり再販したりすることはなく、どのプロバイダーも自分のエンドポイントに置き換えられます。

その他：[クイックスタート](https://nomiaqm.com/en/quickstart) · [最初のモデルを接続する（英語）](docs/guide/model-connection-en.md) · [ユーザーガイド](docs/user-guide.md) · [プロバイダー](docs/provider-integration.md) · [CLI + MCP](docs/guide/capability-core-cli-mcp.md)

## 自分のエージェントから Nomi を使う

Nomi は 24 個の MCP ツールを備えた MCP サーバーを同梱しており、Claude Code、Codex、Cursor から — 生成、配置、編集まで — 操作できます。エージェントのサブスクリプションに付いてくるクレジットも、そのまま使えます。[AI に Nomi を接続してもらう](docs/integrate-with-your-agent-en.md)を参照してください。

## コミュニティ

- 質問、ワークフロー、今後の予定：[GitHub Discussions](https://github.com/aqm857886159/Nomi/discussions)
- バグと機能リクエスト：[GitHub Issues](https://github.com/aqm857886159/Nomi/issues)
- リリースノートと短いデモ：[X / Twitter](https://x.com/sdf297417627618) · [Bilibili](https://www.bilibili.com/video/BV1Lf8b6nEjf/)

WeChat をお使いの方は、スキャンしてユーザーグループに参加できます（左）。グループの QR コードの期限が切れている場合は、メンテナー（右）を **TZ857886159** で追加してください。

<p align="center">
  <a href="docs/media/nomi-canvas-group-wechat-2026-11-13.jpg"><img src="docs/media/nomi-canvas-group-wechat-2026-11-13.jpg" alt="Nomi ユーザーグループの WeChat QR コード" width="220" /></a>
  &nbsp;&nbsp;
  <a href="docs/media/qingyang-wechat.jpg"><img src="docs/media/qingyang-wechat.jpg" alt="Nomi メンテナーの WeChat QR コード" width="180" /></a>
</p>

バグに遭遇しましたか？ コードは公開されています — エラーと[issue 修正用プロンプト](docs/guide/codex-issue-fix-prompt-en.md)を Claude Code か Codex に送れば、多くの場合は自動で修正してくれます。みんなが遭遇する問題は、ぜひ私たちに教えてください。本流に取り込みます。

## チーム向け

**カスタムビルド**、**統合**、**AGPL に準拠したデプロイ**、**継続的な改良**を、Nomi を実際の制作ワークフローに組み込みたいチーム向けに提供します。[プロジェクトについて相談する](https://github.com/aqm857886159/Nomi/issues/new?template=business_inquiry.yml) — フォームは公開されているので、機密でない概要だけを記入し、認証情報、個人の連絡先、予算の詳細、NDA で保護された情報は決して投稿しないでください。

## 開発者向け

Node.js 20 以上と pnpm が必要です。

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

便利なチェック：`pnpm run test` · `pnpm run typecheck` · `pnpm run gates`

リサーチ用ツール（Douyin / Xiaohongshu / Bilibili / X でクリエイターが語っている内容の検索）は、キーを環境変数 `TIKHUB_API_KEY` からのみ読み取ります — [`docs/research/tikhub-api-notes.md`](docs/research/tikhub-api-notes.md) を参照してください。

## コントリビューション

バグ報告、機能の提案、ドキュメント、コードによる貢献を歓迎します。コントリビューターが CLA に署名する必要はなく、貢献は AGPL-3.0-only のもとで受け入れられます。

- [バグを報告する](https://github.com/aqm857886159/Nomi/issues/new?template=bug_report.yml)
- [機能をリクエストする](https://github.com/aqm857886159/Nomi/issues/new?template=feature_request.yml)
- [質問する、アイデアを共有する](https://github.com/aqm857886159/Nomi/discussions)

## ライセンス

現行のリリースは AGPL-3.0-only でライセンスされています。Apache-2.0 で公開された過去のリリースは、元のライセンスのままです。

[LICENSE](LICENSE) を参照してください。有償サービスには、AGPL に準拠したカスタム開発、統合、デプロイ、トレーニング、継続的な改良が含まれることがあります。Nomi は、対応するソースコードを開示しないクローズドソースでの配布は行いません。
