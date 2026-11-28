<p align="center">
  <a href="https://nomiaqm.com/en/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="marketing/assets/promo-0.22/cover-en-dark.jpg" />
      <img src="marketing/assets/promo-0.22/cover-en-light.jpg" alt="Nomi — Vídeo com IA em nível profissional. Modelos pelo preço real." width="100%" />
    </picture>
  </a>
</p>

<h1 align="center">Nomi — estúdio de vídeo com IA de código aberto e local-first</h1>

<p align="center">
  Diga ao agente o que você quer criar. Ele planeja os planos, gera quadros-chave e vídeos e organiza tudo na sua linha do tempo —<br />
  com os modelos que <em>você</em> conecta, pelo preço que <em>o seu provedor</em> cobra.
</p>

<p align="center">
  <a href="#download"><b>Download</b></a> ·
  <a href="https://nomiaqm.com/en/">Site</a> ·
  <a href="https://atomgit.com/aqm857886159/Nomi">Espelho AtomGit</a> ·
  <a href="#assista-ao-filme">Assista ao filme de 90 segundos</a> ·
  <a href="https://nomiaqm.com/en/quickstart">Início rápido</a> ·
  <a href="docs/integrate-with-your-agent-en.md">Deixe sua IA conectar</a> ·
  <a href="#comunidade">Comunidade</a>
  <br />
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.tr.md">Türkçe</a>
</p>

<p align="center">
  <a href="https://github.com/aqm857886159/Nomi/releases/latest"><img src="https://img.shields.io/github/v/release/aqm857886159/Nomi?label=release&color=1a1816" alt="Última versão" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-1a1816" alt="Plataforma" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-1a1816" alt="Licença" /></a>
</p>

## Em resumo

- **O que é:** um estúdio desktop de vídeo com IA. Seu agente divide a história em planos, gera quadros-chave e vídeos e os posiciona em uma linha do tempo real que você pode editar e exportar em MP4.
- **Plataformas:** macOS (Apple Silicon e Intel) e Windows.
- **Preço:** o Nomi em si é gratuito. Você conecta seus próprios modelos e paga diretamente ao provedor pelo preço dele; sem conta Nomi, sem assinatura e sem margem extra.
- **Modelos:** Seedance, Kling, Wan, Hailuo, Nano Banana, GPT Image e muito mais, via APIMart, Kie.ai, Volcengine, ModelScope, assinatura Dreamina, qualquer endpoint compatível com OpenAI ou seu ComfyUI local.
- **Agentes:** um servidor MCP integrado permite que Claude Code, Codex ou Cursor controlem o Nomi.
- **Local-first:** projetos, prompts e chaves ficam na sua máquina.
- **Licença:** AGPL-3.0-only desde 2026-08-01. Versões até a v0.18.1 foram publicadas sob Apache-2.0 e mantêm essa licença.
- **Última versão:** veja [Releases](https://github.com/aqm857886159/Nomi/releases/latest).
- **Sobre o nome:** este Nomi é um aplicativo de vídeo com IA. Não tem nenhuma relação com o chatbot companheiro Nomi AI em nomi.ai.

## Patrocinadores

Os patrocinadores ajudam a manter o Nomi gratuito e de código aberto. Um patrocinador nunca vira opção padrão nem rota embutida: você conecta apenas o que escolher, com sua própria chave, e paga diretamente pelo preço dele. [Quer aparecer aqui?](#comunidade)

<table>
<tr>
<td width="128" align="center"><a href="https://gway.dev/sign-up?aff=8j8f"><img src="docs/media/sponsors/gway-logo.png" alt="Gway" width="96" /></a></td>
<td><b><a href="https://gway.dev/sign-up?aff=8j8f">Gway</a></b> — uma plataforma de API focada em vídeo com IA e geração com referência de múltiplas imagens: Seedance 2.0 / 2.5, Wan 3, MiniMax e outros modelos populares, compatível com OpenAI e com pagamento conforme o uso. O Nomi ainda não tem um preset nativo para ela; clique em <b>Let AI connect it for me</b> e o Claude Code ou o Codex fazem a conexão com a sua chave. Obrigado à Gway por patrocinar o Nomi! <i>(Os links da Gway contêm um código de indicação.)</i></td>
</tr>
</table>

## Por que o Nomi

Relays, APIs oficiais, ComfyUI e modelos locais são baratos. Produtos comerciais de vídeo com IA costumam rodar exatamente os mesmos modelos cobrando várias vezes mais.

O Nomi entrega um fluxo de trabalho profissional sobre **os seus próprios** modelos. Você paga direto ao provedor, pelo preço real dele. Até o agente roda no modelo que você escolher — sem assinatura, sem acréscimo.

## Assista ao filme

[![Assista ao filme de 90 segundos do Nomi 0.22](marketing/assets/promo-0.22/film-poster-en.jpg)](https://github.com/aqm857886159/Nomi/blob/main/marketing/assets/video/nomi-0.22-film.mp4)

Todas as telas do filme mostram a interface real do Nomi, e todas as imagens e clipes nele foram gerados com o Nomi.

## O que você pode fazer

### Basta pedir — o agente trabalha no seu canvas

<img src="marketing/assets/promo-0.22/still-agent.jpg" alt="O agente do Nomi transformando um pedido em quatro quadros-chave no canvas" width="100%" />

Descreva o filme que você quer criar. O agente lê o seu canvas, divide a história em planos, gera quadros-chave, transforma em vídeo e organiza a linha do tempo. Tudo o que ele produz cai direto no canvas, onde você pode visualizar e alterar.

Você decide o quanto ele pergunta: **Ask each step** (perguntar a cada etapa), **Auto-edit** (edição automática — gerações pagas continuam pedindo confirmação) ou **Full auto** (totalmente automático).

### Dirija cada plano

<img src="marketing/assets/promo-0.22/still-storyboard.jpg" alt="Storyboard com todos os quatro planos gerados e o cartão de referência do personagem travado" width="100%" />

O storyboard coloca cada plano em uma linha — prompt, primeiro quadro, modelo e duração. Trave um cartão de referência para um personagem ou cenário e todos os planos que o utilizarem manterão o mesmo rosto.

### Um diretor 3D na palma da mão

<img src="marketing/assets/promo-0.22/still-director.jpg" alt="O diretor 3D com a página de visor no celular" width="100%" />

Posicione personagens, ajuste câmeras e use o celular como visor. Os quadros capturados vão direto de volta para o canvas.

### Qualquer modelo, plano por plano

<img src="marketing/assets/promo-0.22/still-model.jpg" alt="O mesmo cartão de vídeo gerado novamente com outro modelo" width="100%" />

Seedance, Kling, Wan, Hailuo, Nano Banana, GPT Image e mais — via APIMart, Kie.ai, Volcengine, ModelScope, assinatura Dreamina, qualquer relay compatível com OpenAI ou seu ComfyUI local. Troque o modelo em um único plano e gere outra tomada.

### Modelo novo hoje, no Nomi hoje mesmo

Quando um novo modelo for lançado, clique em **Let AI connect it for me** e deixe o Claude Code ou o Codex configurarem tudo. Ele busca o endpoint, os parâmetros e os IDs de modelo, pede que você cole sua chave na própria página do Nomi (o assistente nunca vê a chave), faz um teste real e lista o modelo assim que funcionar.

### Tudo seu

Cada projeto é uma pasta comum no seu disco: canvas, storyboard, linha do tempo, todos os arquivos gerados e o vídeo exportado. Sem conta. Nada é enviado por padrão; estatísticas anônimas de uso são opcionais (Settings → Privacy & diagnostics) e podem ser desativadas a qualquer momento. O código é AGPL-3.0.

**A seguir: edição com IA.** O Nomi caminha para ser um estúdio único para tudo o que você cria com IA — venha construir com a gente.

## Download

| Sistema | Build | Download |
|---|---|---|
| macOS | Apple Silicon | [Nomi-mac-arm64.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-arm64.dmg) |
| macOS | Intel | [Nomi-mac-intel.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-intel.dmg) |
| Windows | Windows 10 / 11 x64 | [Nomi-windows-setup.exe](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-windows-setup.exe) |

Os alvos de lançamento suportados são macOS arm64/x64 e Windows x64. Instaladores para Linux, Windows arm64 e macOS universal não são publicados no momento.

<details>
<summary><b>Primeira execução no macOS</b></summary>

O build atual para macOS **não é assinado nem notarizado com Apple Developer ID**, então o macOS pode bloqueá-lo na primeira abertura. Use apenas os downloads diretos acima ou links do site oficial do Nomi e do repositório oficial no GitHub.

1. Baixe o DMG correspondente, abra-o e arraste o **Nomi** para a pasta **Aplicativos (Applications)** na janela.
2. Abra o Nomi pela pasta Aplicativos. Se o macOS exibir **“Nomi” Não Foi Aberto (“Nomi” Not Opened)**, clique em **OK (Done)**, abra **Ajustes do Sistema → Privacidade e Segurança (System Settings → Privacy & Security)**, role até **Segurança (Security)**, clique em **Abrir Mesmo Assim (Open Anyway)** ao lado do aviso do Nomi e confirme. A partir do macOS 15, clicar com o botão direito no app e escolher **Abrir** não passa mais por esse bloqueio; no macOS 14 e anteriores ainda funciona.

Somente se o macOS disser que o Nomi está “danificado”, confirme primeiro que o instalador veio de um link oficial do Nomi e então execute:

```bash
xattr -dr com.apple.quarantine "/Applications/Nomi.app"
```

Não desative o Gatekeeper globalmente. Para atualizar, baixe o DMG correspondente, encerre o Nomi, arraste o novo Nomi para Aplicativos e escolha **Substituir (Replace)**.
</details>

<details>
<summary><b>Primeira execução no Windows</b></summary>

O instalador não possui assinatura Authenticode. No aviso do SmartScreen, escolha **Mais informações (More info)** → **Executar assim mesmo (Run anyway)**.
</details>

## Início rápido

1. **Conecte um modelo.** Escolha APIMart ou Kie.ai e cole uma chave — ou adicione seu próprio relay, endpoint compatível com OpenAI ou ComfyUI local. Prefere não configurar manualmente? Entregue [Deixe sua IA conectar o Nomi](docs/integrate-with-your-agent-en.md) ao Claude Code ou ao Codex.
2. **Diga o que você quer criar.** Digite no painel do agente ou comece por uma história no storyboard.
3. **Dirija e exporte.** Fique com as tomadas de que gostar, ajuste a linha do tempo e exporte em MP4.

> **Transparência:** o link da APIMart contém um código de indicação. Você sempre paga diretamente aos provedores com sua própria chave e pelo preço deles. O Nomi nunca faz proxy nem revende inferência, e qualquer provedor pode ser trocado pelo seu próprio endpoint.

Saiba mais: [início rápido](https://nomiaqm.com/en/quickstart) · [conecte seu primeiro modelo (inglês)](docs/guide/model-connection-en.md) · [guia do usuário](docs/user-guide.md) · [provedores](docs/provider-integration.md) · [CLI + MCP](docs/guide/capability-core-cli-mcp.md)

## Use o Nomi a partir do seu próprio agente

O Nomi traz um servidor MCP com 24 ferramentas MCP para que Claude Code, Codex ou Cursor possam operá-lo — gerar, organizar e editar — reaproveitando os créditos que já vêm na sua assinatura de agente. Veja [Deixe sua IA conectar o Nomi](docs/integrate-with-your-agent-en.md).

## Comunidade

- Dúvidas, fluxos de trabalho e novidades: [GitHub Discussions](https://github.com/aqm857886159/Nomi/discussions)
- Bugs e sugestões de recursos: [GitHub Issues](https://github.com/aqm857886159/Nomi/issues)
- Notas de versão e demos curtas: [X / Twitter](https://x.com/sdf297417627618) · [Bilibili](https://www.bilibili.com/video/BV1Lf8b6nEjf/)

Usuários do WeChat podem escanear o código à esquerda para entrar no grupo de usuários. Se o código do grupo tiver expirado, adicione o mantenedor (à direita) em **TZ857886159**.

<p align="center">
  <a href="docs/media/nomi-canvas-group-wechat-2026-12-03.jpg"><img src="docs/media/nomi-canvas-group-wechat-2026-12-03.jpg" alt="QR code do WeChat do grupo de usuários do Nomi" width="220" /></a>
  &nbsp;&nbsp;
  <a href="docs/media/qingyang-wechat.jpg"><img src="docs/media/qingyang-wechat.jpg" alt="QR code do WeChat do mantenedor do Nomi" width="180" /></a>
</p>

Encontrou um bug? O código é aberto — envie o erro e o [prompt de correção de issues](docs/guide/codex-issue-fix-prompt-en.md) para o Claude Code ou o Codex, e muitas vezes ele consegue corrigir para você. O que afetar todo mundo, avise a gente para entrar na branch principal.

## Para equipes

**Builds personalizados**, **integrações**, **implantação em conformidade com a AGPL** e **iteração contínua** para equipes que querem colocar o Nomi em um fluxo real de produção. [Converse sobre um projeto](https://github.com/aqm857886159/Nomi/issues/new?template=business_inquiry.yml) — o formulário é público, portanto compartilhe apenas um resumo não confidencial e nunca publique credenciais, contatos privados, valores de orçamento ou informações protegidas por NDA.

## Desenvolvedores

Requer Node.js 20+ e pnpm.

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

Verificações úteis: `pnpm run test` · `pnpm run typecheck` · `pnpm run gates`

As ferramentas de pesquisa (para buscar o que criadores comentam no Douyin / Xiaohongshu / Bilibili / X) leem sua chave apenas da variável de ambiente `TIKHUB_API_KEY` — veja [`docs/research/tikhub-api-notes.md`](docs/research/tikhub-api-notes.md).

## Como contribuir

Relatos de bugs, sugestões de recursos, documentação e contribuições de código são muito bem-vindos. Não é preciso assinar um CLA; as contribuições são aceitas sob AGPL-3.0-only.

- [Relatar um bug](https://github.com/aqm857886159/Nomi/issues/new?template=bug_report.yml)
- [Solicitar um recurso](https://github.com/aqm857886159/Nomi/issues/new?template=feature_request.yml)
- [Fazer uma pergunta ou compartilhar uma ideia](https://github.com/aqm857886159/Nomi/discussions)

## Licença

As versões atuais são licenciadas sob AGPL-3.0-only; versões históricas publicadas sob Apache-2.0 mantêm sua licença original.

Veja [LICENSE](LICENSE). Serviços pagos podem incluir desenvolvimento personalizado, integração, implantação, treinamento e iteração contínua em conformidade com a AGPL. O Nomi não oferece distribuição de código fechado que retenha o código-fonte correspondente.
