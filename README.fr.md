<p align="center">
  <a href="https://nomiaqm.com/en/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="marketing/assets/promo-0.22/cover-en-dark.jpg" />
      <img src="marketing/assets/promo-0.22/cover-en-light.jpg" alt="Nomi — Vidéo IA de niveau pro. Les modèles à leur vrai prix." width="100%" />
    </picture>
  </a>
</p>

<h1 align="center">Nomi — studio vidéo IA open source et local-first</h1>

<p align="center">
  Dites à son agent ce que vous voulez réaliser. Il découpe les plans, génère les images clés et les vidéos, et les assemble sur votre timeline —<br />
  avec les modèles que <em>vous</em> connectez, au tarif facturé par <em>votre fournisseur</em>.
</p>

<p align="center">
  <a href="#téléchargement"><b>Téléchargement</b></a> ·
  <a href="https://nomiaqm.com/en/">Site web</a> ·
  <a href="https://atomgit.com/aqm857886159/Nomi">Miroir AtomGit</a> ·
  <a href="#voir-le-film">Voir le film de 90 secondes</a> ·
  <a href="https://nomiaqm.com/en/quickstart">Démarrage rapide</a> ·
  <a href="docs/integrate-with-your-agent-en.md">Laissez votre IA le connecter</a> ·
  <a href="#communauté">Communauté</a>
  <br />
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.tr.md">Türkçe</a>
</p>

<p align="center">
  <a href="https://github.com/aqm857886159/Nomi/releases/latest"><img src="https://img.shields.io/github/v/release/aqm857886159/Nomi?label=release&color=1a1816" alt="Dernière version" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-1a1816" alt="Plateforme" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-1a1816" alt="Licence" /></a>
</p>

## En un coup d'œil

- **Qu'est-ce que c'est :** un studio vidéo IA de bureau. Son agent découpe votre histoire en plans, génère les images clés et les clips vidéo, puis les dispose sur une vraie timeline que vous pouvez monter et exporter en MP4.
- **Plateformes :** macOS (Apple Silicon et Intel) et Windows.
- **Prix :** Nomi est gratuit. Vous connectez vos propres modèles et réglez directement votre fournisseur à son tarif ; aucun compte Nomi, aucun abonnement, aucune majoration.
- **Modèles :** Seedance, Kling, Wan, Hailuo, Nano Banana, GPT Image et bien d'autres, via APIMart, Kie.ai, Volcengine, ModelScope, un abonnement Dreamina, tout endpoint compatible OpenAI ou votre ComfyUI local.
- **Agents :** un serveur MCP intégré permet à Claude Code, Codex ou Cursor de piloter Nomi.
- **Local-first :** vos projets, prompts et clés restent sur votre machine.
- **Licence :** AGPL-3.0-only depuis le 2026-08-01. Les versions jusqu'à la v0.18.1 ont été publiées sous Apache-2.0 et conservent cette licence.
- **Dernière version :** voir [Releases](https://github.com/aqm857886159/Nomi/releases/latest).
- **À propos du nom :** ce Nomi est une application vidéo IA. Il n'a aucun lien avec le chatbot compagnon Nomi AI sur nomi.ai.

## Sponsors

Les sponsors aident Nomi à rester gratuit et open source. Un sponsor ne devient jamais un réglage par défaut ni une route intégrée : vous ne connectez que ce que vous choisissez, avec votre propre clé, et vous le payez directement à son tarif. [Vous souhaitez apparaître ici ?](#communauté)

<table>
<tr>
<td width="128" align="center"><a href="https://gway.dev/sign-up?aff=8j8f"><img src="docs/media/sponsors/gway-logo.png" alt="Gway" width="96" /></a></td>
<td><b><a href="https://gway.dev/sign-up?aff=8j8f">Gway</a></b> — une plateforme API spécialisée dans la vidéo IA et la génération avec références multi-images : Seedance 2.0 / 2.5, Wan 3, MiniMax et d'autres modèles majeurs, compatible OpenAI et facturée à l'usage. Nomi ne propose pas encore de préréglage intégré pour Gway ; cliquez sur <b>Let AI connect it for me</b> et Claude Code ou Codex le raccorderont avec votre clé. Merci à Gway de sponsoriser Nomi ! <i>(Les liens Gway contiennent un code de parrainage.)</i></td>
</tr>
</table>

## Pourquoi Nomi

Les relais, les API officielles, ComfyUI et les modèles locaux coûtent peu cher. Les plateformes commerciales de vidéo IA font souvent tourner exactement les mêmes modèles en facturant plusieurs fois le prix.

Nomi vous offre un flux de travail de niveau professionnel sur **vos propres** modèles. Vous payez directement votre fournisseur, à son vrai tarif. Même l'agent tourne sur le modèle que vous choisissez — sans abonnement, sans marge cachée.

## Voir le film

[![Voir le film de 90 secondes Nomi 0.22](marketing/assets/promo-0.22/film-poster-en.jpg)](https://github.com/aqm857886159/Nomi/blob/main/marketing/assets/video/nomi-0.22-film.mp4)

Chaque écran du film montre la véritable interface de Nomi, et chaque image ainsi que chaque plan vidéo y ont été générés avec Nomi.

## Ce que vous pouvez faire

### Demandez simplement — l'agent travaille sur votre canevas

<img src="marketing/assets/promo-0.22/still-agent.jpg" alt="L'agent Nomi transformant une demande en quatre images clés sur le canevas" width="100%" />

Décrivez le film que vous voulez créer. L'agent lit votre canevas, découpe l'histoire en plans, génère les images clés, les transforme en vidéo et organise la timeline. Tout ce qu'il produit arrive sur le canevas, où vous pouvez le voir et le modifier.

Vous choisissez le degré d'autonomie : **Ask each step** (demander à chaque étape), **Auto-edit** (édition auto, avec confirmation pour les générations payantes) ou **Full auto** (entièrement automatique).

### Mettez en scène chaque plan

<img src="marketing/assets/promo-0.22/still-storyboard.jpg" alt="Storyboard avec les quatre plans générés et la carte de référence du personnage verrouillée" width="100%" />

Le storyboard affiche chaque plan sur une ligne — prompt, première image, modèle, durée. Verrouillez une carte de référence pour un personnage ou un lieu : tous les plans qui l'utilisent gardent le même visage.

### Un réalisateur 3D au creux de la main

<img src="marketing/assets/promo-0.22/still-director.jpg" alt="Le réalisateur 3D avec la page de viseur sur smartphone" width="100%" />

Mettez les personnages en pose, placez les caméras et servez-vous de votre téléphone comme viseur. Les cadrages capturés reviennent directement sur le canevas.

### N'importe quel modèle, plan par plan

<img src="marketing/assets/promo-0.22/still-model.jpg" alt="La même carte vidéo régénérée avec un autre modèle" width="100%" />

Seedance, Kling, Wan, Hailuo, Nano Banana, GPT Image et plus encore — via APIMart, Kie.ai, Volcengine, ModelScope, un abonnement Dreamina, n'importe quel relais compatible OpenAI ou votre ComfyUI local. Changez de modèle sur un seul plan et lancez une autre prise.

### Un nouveau modèle sort aujourd'hui, il est dans Nomi aujourd'hui

Dès qu'un nouveau modèle arrive, cliquez sur **Let AI connect it for me** et laissez Claude Code ou Codex le brancher. Il recherche l'endpoint, les paramètres et les identifiants de modèle, vous fait coller votre clé directement dans l'interface de Nomi (l'assistant ne la voit jamais), lance un vrai test et ajoute le modèle dès qu'il fonctionne.

### Entièrement à vous

Un projet est un simple dossier sur votre disque : canevas, storyboard, timeline, chaque fichier généré et le film exporté. Aucun compte requis. Rien n'est envoyé par défaut ; les statistiques d'utilisation anonymes sont optionnelles (Settings → Privacy & diagnostics) et désactivables à tout moment. Le code est sous licence AGPL-3.0.

**Prochaine étape : le montage IA.** Nomi évolue vers un studio unique pour tout ce que vous créez avec l'IA — venez le bâtir avec nous.

## Téléchargement

| Système | Version | Téléchargement |
|---|---|---|
| macOS | Apple Silicon | [Nomi-mac-arm64.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-arm64.dmg) |
| macOS | Intel | [Nomi-mac-intel.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-intel.dmg) |
| Windows | Windows 10 / 11 x64 | [Nomi-windows-setup.exe](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-windows-setup.exe) |

Les cibles de publication prises en charge sont macOS arm64/x64 et Windows x64. Les installateurs Linux, Windows arm64 et macOS universel ne sont pas publiés pour le moment.

<details>
<summary><b>Premier lancement sur macOS</b></summary>

La version macOS actuelle **n'est ni signée ni notariée avec un Apple Developer ID**, de sorte que macOS peut bloquer son premier lancement. Utilisez uniquement les téléchargements directs ci-dessus ou les liens du site officiel de Nomi et du dépôt GitHub officiel.

1. Téléchargez le fichier DMG correspondant, ouvrez-le et glissez **Nomi** vers le dossier **Applications** dans la fenêtre.
2. Ouvrez Nomi depuis Applications. Si macOS affiche **« Nomi » n'a pas été ouvert (“Nomi” Not Opened)**, cliquez sur **OK (Done)**, ouvrez **Réglages Système → Confidentialité et sécurité (System Settings → Privacy & Security)**, descendez jusqu'à **Sécurité (Security)**, cliquez sur **Ouvrir quand même (Open Anyway)** à côté du message concernant Nomi, puis confirmez. Depuis macOS 15, le clic droit suivi de **Ouvrir** ne permet plus de passer cet avertissement ; cela fonctionne encore sous macOS 14 et versions antérieures.

Uniquement si macOS indique que Nomi est « endommagé », vérifiez d'abord que l'installateur provient bien d'un lien officiel Nomi, puis exécutez :

```bash
xattr -dr com.apple.quarantine "/Applications/Nomi.app"
```

Ne désactivez pas Gatekeeper globalement. Pour mettre à jour, téléchargez le DMG correspondant, quittez Nomi, puis glissez la nouvelle version dans Applications et choisissez **Remplacer (Replace)**.
</details>

<details>
<summary><b>Premier lancement sur Windows</b></summary>

L'installateur ne dispose pas de signature Authenticode. Dans la fenêtre SmartScreen, cliquez sur **Informations complémentaires (More info)** → **Exécuter quand même (Run anyway)**.
</details>

## Démarrage rapide

1. **Connectez un modèle.** Choisissez APIMart ou Kie.ai et collez une clé — ou ajoutez votre propre relais, un endpoint compatible OpenAI ou un ComfyUI local. Vous préférez ne pas le configurer vous-même ? Confiez [Laissez votre IA connecter Nomi](docs/integrate-with-your-agent-en.md) à Claude Code ou Codex.
2. **Décrivez ce que vous voulez réaliser.** Saisissez votre demande dans le panneau de l'agent ou commencez par une histoire dans le storyboard.
3. **Dirigez et exportez.** Gardez les prises qui vous plaisent, arrangez la timeline et exportez en MP4.

> **Transparence :** le lien APIMart contient un code de parrainage. Vous payez toujours directement les fournisseurs avec votre propre clé et à leur tarif. Nomi ne relaie ni ne revend jamais l'inférence, et chaque fournisseur peut être remplacé par votre propre endpoint.

En savoir plus : [démarrage rapide](https://nomiaqm.com/en/quickstart) · [connecter votre premier modèle (anglais)](docs/guide/model-connection-en.md) · [guide utilisateur](docs/user-guide.md) · [fournisseurs](docs/provider-integration.md) · [CLI + MCP](docs/guide/capability-core-cli-mcp.md)

## Utiliser Nomi depuis votre propre agent

Nomi embarque un serveur MCP exposant 24 outils MCP afin que Claude Code, Codex ou Cursor puissent le piloter — générer, organiser et monter — tout en réutilisant les crédits inclus dans votre abonnement d'agent. Voir [Laissez votre IA connecter Nomi](docs/integrate-with-your-agent-en.md).

## Communauté

- Questions, workflows et feuilles de route : [GitHub Discussions](https://github.com/aqm857886159/Nomi/discussions)
- Bugs et demandes de fonctionnalités : [GitHub Issues](https://github.com/aqm857886159/Nomi/issues)
- Notes de version et courtes démos : [X / Twitter](https://x.com/sdf297417627618) · [Bilibili](https://www.bilibili.com/video/BV1Lf8b6nEjf/)

Les utilisateurs de WeChat peuvent scanner le code à gauche pour rejoindre le groupe d'utilisateurs. Si le code du groupe a expiré, ajoutez le mainteneur (à droite) via **TZ857886159**.

<p align="center">
  <a href="docs/media/nomi-canvas-group-wechat-2026-12-03.jpg"><img src="docs/media/nomi-canvas-group-wechat-2026-12-03.jpg" alt="QR code WeChat du groupe d'utilisateurs Nomi" width="220" /></a>
  &nbsp;&nbsp;
  <a href="docs/media/qingyang-wechat.jpg"><img src="docs/media/qingyang-wechat.jpg" alt="QR code WeChat du mainteneur de Nomi" width="180" /></a>
</p>

Vous rencontrez un bug ? Le code est ouvert — envoyez l'erreur et le [prompt de correction d'issue](docs/guide/codex-issue-fix-prompt-en.md) à Claude Code ou Codex, qui pourra souvent le corriger pour vous. Si le problème touche d'autres utilisateurs, signalez-le-nous pour qu'il rejoigne la branche principale.

## Pour les équipes

**Builds sur mesure**, **intégrations**, **déploiement conforme à l'AGPL** et **itérations continues** pour les équipes souhaitant intégrer Nomi dans un vrai workflow de production. [Discuter d'un projet](https://github.com/aqm857886159/Nomi/issues/new?template=business_inquiry.yml) — le formulaire est public : ne partagez qu'un résumé non confidentiel et ne publiez jamais d'identifiants, de coordonnées privées, de détails budgétaires ni d'informations couvertes par un NDA.

## Développeurs

Nécessite Node.js 20+ et pnpm.

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

Vérifications utiles : `pnpm run test` · `pnpm run typecheck` · `pnpm run gates`

Les outils de recherche (pour analyser ce que disent les créateurs sur Douyin / Xiaohongshu / Bilibili / X) lisent leur clé uniquement depuis la variable d'environnement `TIKHUB_API_KEY` — voir [`docs/research/tikhub-api-notes.md`](docs/research/tikhub-api-notes.md).

## Contribuer

Les rapports de bugs, propositions de fonctionnalités, contributions à la documentation et au code sont les bienvenus. Aucune signature de CLA n'est requise ; les contributions sont acceptées sous licence AGPL-3.0-only.

- [Signaler un bug](https://github.com/aqm857886159/Nomi/issues/new?template=bug_report.yml)
- [Demander une fonctionnalité](https://github.com/aqm857886159/Nomi/issues/new?template=feature_request.yml)
- [Poser une question ou partager une idée](https://github.com/aqm857886159/Nomi/discussions)

## Licence

Les versions actuelles sont distribuées sous licence AGPL-3.0-only ; les versions antérieures publiées sous Apache-2.0 conservent leur licence d'origine.

Voir [LICENSE](LICENSE). Les prestations payantes peuvent inclure le développement sur mesure, l'intégration, le déploiement, la formation et l'itération continue conformes à l'AGPL. Nomi ne propose pas de distribution propriétaire qui retiendrait le code source correspondant.
