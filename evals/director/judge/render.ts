import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { chromium, type Browser } from 'playwright'
import type { DirectorProject } from '../../../src/workbench/generationCanvas/nodes/director/model/directorTypes'
import type { HeadlessCaptureFrameReadback } from '../../../src/workbench/generationCanvas/nodes/director/agent/DirectorHeadlessCapture'
import { DIRECTOR_EXPORT_FPS } from '../../../src/workbench/generationCanvas/nodes/director/model/exportSize'
import { compareCaptureReadback, type MeasurementSideGap, type ReadbackMismatch } from './readback'

export type RenderedVideo = {
  video: string
  contactSheet: string
  frames: string[]
  times: number[]
  width: number
  height: number
  cameraIds: Array<string | null>
  frameReadbacks: HeadlessCaptureFrameReadback[]
  readbackMismatches: ReadbackMismatch[]
  measurementSideGaps: MeasurementSideGap[]
  unanimatedCharacterIds: string[]
}
export const JUDGE_RENDER_WIDTH = 480
export const JUDGE_RENDER_HEIGHT = 270

export function charactersWithoutActionClips(project: DirectorProject): string[] {
  const scene = project.scenes.find((item) => item.id === project.activeSceneId) ?? project.scenes[0]
  return (scene?.objects ?? [])
    .filter(
      (object) =>
        object.type === 'character' &&
        object.visible &&
        object.actionTrackEnabled !== false &&
        !(object.actionClips ?? []).some((clip) => clip.clipType === 'action'),
    )
    .map((object) => object.id)
}

function startVite(repoRoot: string): ChildProcess {
  return spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '5187'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      /* booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Vite did not start at ${url}`)
}

function contentEnd(project: DirectorProject): number {
  return Math.max(
    0,
    ...project.scenes.flatMap((scene) =>
      [...scene.cameras, ...scene.objects].flatMap((entity) => [
        ...(entity.trajectoryClips ?? []).map((clip) => clip.endTime),
        ...('actionClips' in entity ? (entity.actionClips ?? []).map((clip) => clip.endTime) : []),
        ...('closeupClips' in entity ? (entity.closeupClips ?? []).map((clip) => clip.endTime) : []),
      ]),
    ),
  )
}

function ffmpegRun(args: string[]): void {
  const result = spawnSync(ffmpeg.path, args, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${(result.stderr || result.stdout || '').trim()}`)
}

export type RenderOptions = { fps?: number; subjectIds?: ReadonlySet<string> }

export async function renderProject(
  project: DirectorProject,
  outDir: string,
  label: string,
  options: RenderOptions = {},
): Promise<RenderedVideo> {
  const fps = options.fps ?? DIRECTOR_EXPORT_FPS
  await fs.mkdir(outDir, { recursive: true })
  const duration = Math.max(1 / fps, contentEnd(project))
  const times = Array.from({ length: Math.max(1, Math.ceil(duration * fps)) }, (_, index) => index / fps)
  const server = startVite(process.cwd())
  let browser: Browser | undefined
  try {
    await waitForServer('http://127.0.0.1:5187/director-render.html')
    // Metal keeps readPixels on the native GPU path on macOS; SwiftShader makes a
    // 30 fps judge run several times slower and is retained only as Chromium's fallback.
    browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu'] })
    const page = await browser.newPage({
      viewport: { width: JUDGE_RENDER_WIDTH, height: JUDGE_RENDER_HEIGHT },
      deviceScaleFactor: 1,
    })
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[director-render browser] ${message.text()}`)
    })
    page.on('pageerror', (error) => console.error(`[director-render pageerror] ${error.message}`))
    await page.goto('http://127.0.0.1:5187/director-render.html', { waitUntil: 'commit' })
    await page.waitForFunction(() =>
      Boolean((window as Window & { __nomiDirectorRenderReady?: boolean }).__nomiDirectorRenderReady),
    )
    await page.evaluate((request) => window.postMessage({ type: 'nomi-director-render-start', request }, '*'), {
      project,
      times,
      width: JUDGE_RENDER_WIDTH,
      height: JUDGE_RENDER_HEIGHT,
    })
    const result = await page.evaluate(
      () =>
        new Promise<{
          frames: string[]
          width: number
          height: number
          cameraIds: Array<string | null>
          frameReadbacks: HeadlessCaptureFrameReadback[]
        }>((resolve, reject) => {
          const timer = window.setInterval(() => {
            const value = (window as Window & { __nomiDirectorRenderResult?: unknown }).__nomiDirectorRenderResult
            if (!value) return
            window.clearInterval(timer)
            if ('error' in (value as Record<string, unknown>))
              reject(new Error(String((value as { error: string }).error)))
            else
              resolve(
                value as {
                  frames: string[]
                  width: number
                  height: number
                  cameraIds: Array<string | null>
                  frameReadbacks: HeadlessCaptureFrameReadback[]
                },
              )
          }, 100)
          window.setTimeout(() => {
            window.clearInterval(timer)
            reject(new Error('render timed out after 10 minutes'))
          }, 600_000)
        }),
    )
    const safe = label.replace(/[^a-z0-9_-]/gi, '_')
    const frameDir = path.join(outDir, `${safe}-frames`)
    await fs.mkdir(frameDir, { recursive: true })
    const framePaths: string[] = []
    for (const [index, dataUrl] of result.frames.entries()) {
      const target = path.join(frameDir, `${String(index).padStart(6, '0')}.png`)
      await fs.writeFile(target, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'))
      framePaths.push(target)
    }
    const video = path.join(outDir, `${safe}.mp4`)
    ffmpegRun([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-framerate',
      String(fps),
      '-i',
      path.join(frameDir, '%06d.png'),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      video,
    ])
    const contactSheet = path.join(outDir, `${safe}-contact.png`)
    const font = [
      '/System/Library/Fonts/Supplemental/Arial.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ].find((candidate) => existsSync(candidate))
    const drawtext = `drawtext=${font ? `fontfile=${font}:` : ''}text='t=%{pts\\:1.1f}s':x=12:y=12:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.65`
    ffmpegRun([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      path.join(frameDir, '%06d.png'),
      '-vf',
      `fps=2,${drawtext},tile=4x4:padding=6:margin=6`,
      '-frames:v',
      '1',
      contactSheet,
    ])
    const readback = compareCaptureReadback(
      project,
      times,
      result.frameReadbacks,
      result.width,
      result.height,
      options.subjectIds,
    )
    return {
      video,
      contactSheet,
      frames: framePaths,
      times,
      width: result.width,
      height: result.height,
      cameraIds: result.cameraIds,
      frameReadbacks: result.frameReadbacks,
      readbackMismatches: readback.mismatches,
      measurementSideGaps: readback.measurementSideGaps,
      unanimatedCharacterIds: charactersWithoutActionClips(project),
    }
  } finally {
    await browser?.close()
    server.kill('SIGTERM')
  }
}
