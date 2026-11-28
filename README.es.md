<p align="center">
  <a href="https://nomiaqm.com/en/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="marketing/assets/promo-0.22/cover-en-dark.jpg" />
      <img src="marketing/assets/promo-0.22/cover-en-light.jpg" alt="Nomi — Video con IA de nivel profesional. Modelos a su precio real." width="100%" />
    </picture>
  </a>
</p>

<h1 align="center">Nomi — estudio de video con IA de código abierto y local-first</h1>

<p align="center">
  Dile a su agente qué quieres producir. Planifica los planos, genera fotogramas clave y video, y los monta en tu línea de tiempo —<br />
  con los modelos que <em>tú</em> conectas, al precio que cobra <em>tu proveedor</em>.
</p>

<p align="center">
  <a href="#descargar"><b>Descargar</b></a> ·
  <a href="https://nomiaqm.com/en/">Sitio web</a> ·
  <a href="https://atomgit.com/aqm857886159/Nomi">Espejo en AtomGit</a> ·
  <a href="#ver-el-video">Ver el video de 90 segundos</a> ·
  <a href="https://nomiaqm.com/en/quickstart">Inicio rápido</a> ·
  <a href="docs/integrate-with-your-agent-en.md">Deja que tu IA lo conecte</a> ·
  <a href="#comunidad">Comunidad</a>
  <br />
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.tr.md">Türkçe</a>
</p>

<p align="center">
  <a href="https://github.com/aqm857886159/Nomi/releases/latest"><img src="https://img.shields.io/github/v/release/aqm857886159/Nomi?label=release&color=1a1816" alt="Última versión" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-1a1816" alt="Plataforma" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-1a1816" alt="Licencia" /></a>
</p>

## En resumen

- **Qué es:** un estudio de escritorio para video con IA. Su agente divide tu historia en planos, genera fotogramas clave y clips de video, y los coloca en una línea de tiempo real que puedes editar y exportar en MP4.
- **Plataformas:** macOS (Apple Silicon e Intel) y Windows.
- **Precio:** Nomi es gratuito. Conectas tus propios modelos y pagas directamente al proveedor a su tarifa oficial; sin cuenta de Nomi, sin suscripción y sin recargos.
- **Modelos:** Seedance, Kling, Wan, Hailuo, Nano Banana, GPT Image y más, a través de APIMart, Kie.ai, Volcengine, ModelScope, una membresía de Dreamina, cualquier endpoint compatible con OpenAI o tu ComfyUI local.
- **Agentes:** incluye un servidor MCP integrado para que Claude Code, Codex o Cursor puedan controlar Nomi.
- **Local-first:** tus proyectos, prompts y claves permanecen en tu equipo.
- **Licencia:** AGPL-3.0-only desde el 2026-08-01. Las versiones hasta la v0.18.1 se publicaron bajo Apache-2.0 y conservan esa licencia.
- **Última versión:** consulta [Releases](https://github.com/aqm857886159/Nomi/releases/latest).
- **Nombre:** este Nomi es una aplicación de video con IA. No tiene relación con el chatbot de compañía Nomi AI en nomi.ai.

## Patrocinadores

Los patrocinadores ayudan a que Nomi siga siendo gratuito y de código abierto. Un patrocinador nunca se convierte en opción predeterminada ni en ruta integrada: tú conectas solo lo que eliges, con tu propia clave, y pagas directamente a su precio. [¿Quieres aparecer aquí?](#comunidad)

<table>
<tr>
<td width="128" align="center"><a href="https://gway.dev/sign-up?aff=8j8f"><img src="docs/media/sponsors/gway-logo.png" alt="Gway" width="96" /></a></td>
<td><b><a href="https://gway.dev/sign-up?aff=8j8f">Gway</a></b> — plataforma de API centrada en video con IA y generación con referencia de múltiples imágenes: Seedance 2.0 / 2.5, Wan 3, MiniMax y otros modelos principales, compatible con OpenAI y de pago por uso. Nomi aún no incluye un ajuste preestablecido para Gway; haz clic en <b>Let AI connect it for me</b> y Claude Code o Codex lo configurarán con tu clave. ¡Gracias a Gway por patrocinar Nomi! <i>(Los enlaces de Gway incluyen un código de referido.)</i></td>
</tr>
</table>

## Por qué Nomi

Los intermediarios (relays), las API oficiales, ComfyUI y los modelos locales son económicos. Muchos productos comerciales de video con IA ejecutan exactamente los mismos modelos y cobran varias veces más.

Nomi te ofrece un flujo de trabajo profesional sobre **tus propios** modelos. Pagas directamente a tu proveedor, a su precio real. Incluso el agente funciona con el modelo que tú elijas — sin suscripción ni sobreprecio.

## Ver el video

[![Ver el video de 90 segundos de Nomi 0.22](marketing/assets/promo-0.22/film-poster-en.jpg)](https://github.com/aqm857886159/Nomi/blob/main/marketing/assets/video/nomi-0.22-film.mp4)

Cada pantalla del video es la interfaz real de Nomi, y todas las imágenes y clips fueron generados con Nomi.

## Qué puedes hacer

### Solo pídelo — el agente trabaja en tu lienzo

<img src="marketing/assets/promo-0.22/still-agent.jpg" alt="El agente de Nomi convirtiendo una solicitud en cuatro fotogramas clave sobre el lienzo" width="100%" />

Describe el video que quieres crear. El agente lee tu lienzo, divide la historia en planos, genera los fotogramas clave, los convierte en video y organiza la línea de tiempo. Todo lo que crea aparece en el lienzo para que puedas verlo y modificarlo.

Tú decides cuánto pregunta: **Ask each step** (preguntar en cada paso), **Auto-edit** (edición automática; la generación de pago sigue pidiendo confirmación) o **Full auto** (totalmente automático).

### Dirige cada plano

<img src="marketing/assets/promo-0.22/still-storyboard.jpg" alt="Storyboard con los cuatro planos generados y la ficha de referencia del personaje bloqueada" width="100%" />

El storyboard muestra cada plano en una fila — prompt, primer fotograma, modelo y duración. Bloquea una ficha de referencia para un personaje o escenario y todos los planos que la usen conservarán el mismo rostro.

### Un director 3D en la palma de tu mano

<img src="marketing/assets/promo-0.22/still-director.jpg" alt="El director 3D junto a la pantalla de visor en el teléfono" width="100%" />

Coloca a los personajes en pose, ubica las cámaras y usa tu teléfono como visor. Los encuadres que captures vuelven directamente al lienzo.

### Cualquier modelo, plano por plano

<img src="marketing/assets/promo-0.22/still-model.jpg" alt="La misma tarjeta de video regenerada con un modelo diferente" width="100%" />

Seedance, Kling, Wan, Hailuo, Nano Banana, GPT Image y más — mediante APIMart, Kie.ai, Volcengine, ModelScope, una membresía de Dreamina, cualquier relay compatible con OpenAI o tu ComfyUI local. Cambia de modelo en un solo plano y genera otra toma.

### Nuevo modelo hoy, en Nomi hoy mismo

Cuando salga un nuevo modelo, haz clic en **Let AI connect it for me** y deja que Claude Code o Codex lo integren. Investiga el endpoint, los parámetros y los ID de modelo, te pide pegar tu clave en la propia página de Nomi (el asistente nunca la ve), ejecuta una prueba real y añade el modelo a la lista en cuanto funciona.

### Totalmente tuyo

Cada proyecto es una carpeta común en tu disco: lienzo, storyboard, línea de tiempo, cada archivo generado y el video exportado. Sin cuenta. No se envía nada por defecto; las estadísticas anónimas de uso son opcionales (Settings → Privacy & diagnostics) y se pueden desactivar en cualquier momento. El código es AGPL-3.0.

**Próximo paso: edición con IA.** Nomi avanza hacia un único estudio para todo lo que creas con IA — ven a construirlo con nosotros.

## Descargar

| Sistema | Compilación | Descarga |
|---|---|---|
| macOS | Apple Silicon | [Nomi-mac-arm64.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-arm64.dmg) |
| macOS | Intel | [Nomi-mac-intel.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-intel.dmg) |
| Windows | Windows 10 / 11 x64 | [Nomi-windows-setup.exe](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-windows-setup.exe) |

Los objetivos de publicación compatibles son macOS arm64/x64 y Windows x64. Actualmente no se publican instaladores para Linux, Windows arm64 ni macOS universal.

<details>
<summary><b>Primer inicio en macOS</b></summary>

La compilación actual de macOS **no está firmada ni notarizada con Apple Developer ID**, por lo que macOS puede bloquearla al abrirla por primera vez. Usa únicamente las descargas directas anteriores o enlaces del sitio web oficial de Nomi y del repositorio oficial en GitHub.

1. Descarga el DMG correspondiente, ábrelo y arrastra **Nomi** a la carpeta **Aplicaciones (Applications)** en la ventana.
2. Abre Nomi desde Aplicaciones. Si macOS muestra **No se abrió “Nomi” (“Nomi” Not Opened)**, haz clic en **OK (Done)**, abre **Ajustes del Sistema → Privacidad y seguridad** (o **Configuración del Sistema → Privacidad y seguridad**, en inglés **System Settings → Privacy & Security**), baja hasta **Seguridad (Security)**, haz clic en **Abrir de todos modos (Open Anyway)** junto al aviso de Nomi y confirma. Desde macOS 15, hacer clic derecho en la app y elegir **Abrir** ya no omite este aviso; en macOS 14 y anteriores sigue funcionando.

Solo si macOS indica que Nomi está “dañado”, confirma primero que el instalador provenga de un enlace oficial de Nomi y luego ejecuta:

```bash
xattr -dr com.apple.quarantine "/Applications/Nomi.app"
```

No desactives Gatekeeper a nivel global. Para actualizar, descarga el DMG correspondiente, cierra Nomi, arrastra el nuevo Nomi a Aplicaciones y elige **Reemplazar (Replace)**.
</details>

<details>
<summary><b>Primer inicio en Windows</b></summary>

El instalador no tiene firma Authenticode. En el aviso de SmartScreen, selecciona **Más información (More info)** → **Ejecutar de todas formas (Run anyway)**.
</details>

## Inicio rápido

1. **Conecta un modelo.** Elige APIMart o Kie.ai y pega una clave — o añade tu propio relay, un endpoint compatible con OpenAI o ComfyUI local. ¿Prefieres no hacerlo a mano? Pasa [Deja que tu IA conecte Nomi](docs/integrate-with-your-agent-en.md) a Claude Code o Codex.
2. **Di qué quieres crear.** Escríbelo en el panel del agente o empieza con una historia en el storyboard.
3. **Dirige y exporta.** Quédate con las tomas que te gusten, ajusta la línea de tiempo y exporta en MP4.

> **Aviso:** el enlace de APIMart incluye un código de referido. Siempre pagas directamente a los proveedores con tu propia clave y a su precio. Nomi nunca hace de proxy ni revende inferencia, y cualquier proveedor puede sustituirse por tu propio endpoint.

Más recursos: [inicio rápido](https://nomiaqm.com/en/quickstart) · [conecta tu primer modelo (inglés)](docs/guide/model-connection-en.md) · [guía de usuario](docs/user-guide.md) · [proveedores](docs/provider-integration.md) · [CLI + MCP](docs/guide/capability-core-cli-mcp.md)

## Usa Nomi desde tu propio agente

Nomi incluye un servidor MCP con 24 herramientas MCP para que Claude Code, Codex o Cursor puedan controlarlo — generar, organizar y editar — aprovechando los créditos incluidos en tu suscripción de agente. Consulta [Deja que tu IA conecte Nomi](docs/integrate-with-your-agent-en.md).

## Comunidad

- Preguntas, flujos de trabajo y próximos pasos: [GitHub Discussions](https://github.com/aqm857886159/Nomi/discussions)
- Errores y solicitudes de funciones: [GitHub Issues](https://github.com/aqm857886159/Nomi/issues)
- Notas de versión y demos breves: [X / Twitter](https://x.com/sdf297417627618) · [Bilibili](https://www.bilibili.com/video/BV1Lf8b6nEjf/)

Quienes usen WeChat pueden escanear el código de la izquierda para unirse al grupo de usuarios. Si el código del grupo ha caducado, añade al mantenedor (derecha) en **TZ857886159**.

<p align="center">
  <a href="docs/media/nomi-canvas-group-wechat-2026-12-03.jpg"><img src="docs/media/nomi-canvas-group-wechat-2026-12-03.jpg" alt="Código QR de WeChat del grupo de usuarios de Nomi" width="220" /></a>
  &nbsp;&nbsp;
  <a href="docs/media/qingyang-wechat.jpg"><img src="docs/media/qingyang-wechat.jpg" alt="Código QR de WeChat del mantenedor de Nomi" width="180" /></a>
</p>

¿Encontraste un error? El código es abierto: envía el mensaje de error y el [prompt para corregir issues](docs/guide/codex-issue-fix-prompt-en.md) a Claude Code o Codex, y a menudo podrá preparar el parche por ti. Si es un problema que afecta a todos, cuéntanoslo para integrarlo en la rama principal.

## Para equipos

**Compilaciones a medida**, **integraciones**, **despliegue conforme a AGPL** e **iteración continua** para equipos que quieran llevar Nomi a un flujo de producción real. [Habla sobre un proyecto](https://github.com/aqm857886159/Nomi/issues/new?template=business_inquiry.yml) — el formulario es público, así que comparte únicamente un resumen no confidencial y nunca publiques credenciales, datos de contacto privados, presupuestos ni información protegida por NDA.

## Desarrolladores

Requiere Node.js 20+ y pnpm.

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

Comprobaciones útiles: `pnpm run test` · `pnpm run typecheck` · `pnpm run gates`

Las herramientas de investigación (para buscar qué comentan los creadores en Douyin / Xiaohongshu / Bilibili / X) leen su clave únicamente desde la variable de entorno `TIKHUB_API_KEY` — consulta [`docs/research/tikhub-api-notes.md`](docs/research/tikhub-api-notes.md).

## Contribuir

Se agradecen reportes de errores, propuestas de funciones, documentación y contribuciones de código. No es necesario firmar un CLA; las contribuciones se aceptan bajo AGPL-3.0-only.

- [Reportar un error](https://github.com/aqm857886159/Nomi/issues/new?template=bug_report.yml)
- [Solicitar una función](https://github.com/aqm857886159/Nomi/issues/new?template=feature_request.yml)
- [Hacer una pregunta o compartir una idea](https://github.com/aqm857886159/Nomi/discussions)

## Licencia

Las versiones actuales se distribuyen bajo AGPL-3.0-only; las versiones históricas publicadas bajo Apache-2.0 mantienen su licencia original.

Consulta [LICENSE](LICENSE). Los servicios de pago pueden incluir desarrollo a medida, integración, despliegue, formación e iteración continua conformes a AGPL. Nomi no ofrece una distribución de código cerrado que oculte el código fuente correspondiente.
