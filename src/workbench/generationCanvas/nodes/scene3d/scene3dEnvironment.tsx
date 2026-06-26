import React from 'react'
import { Environment, Sky } from '@react-three/drei'
import { useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Scene3DState } from './scene3dTypes'

const PANORAMA_STANDARD_FRONT_OFFSET = Math.PI
const PANORAMA_SPHERE_WIDTH_SEGMENTS = 128
const PANORAMA_SPHERE_HEIGHT_SEGMENTS = 64

type EnvironmentResourceBoundaryProps = {
  children: React.ReactNode
  fallback: React.ReactNode
  resetKey: string
}

type EnvironmentResourceBoundaryState = {
  hasError: boolean
}

class EnvironmentResourceBoundary extends React.Component<
  EnvironmentResourceBoundaryProps,
  EnvironmentResourceBoundaryState
> {
  state: EnvironmentResourceBoundaryState = { hasError: false }

  static getDerivedStateFromError(): EnvironmentResourceBoundaryState {
    return { hasError: true }
  }

  componentDidUpdate(previousProps: EnvironmentResourceBoundaryProps): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  componentDidCatch(error: unknown): void {
    console.warn('[nomi] 3D scene environment failed to load; using fallback lighting.', error)
  }

  render(): React.ReactNode {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

function panoramaYaw(rotation: number): number {
  // Standard equirectangular panoramas join at the left/right image edge.
  // Keep that longitude behind the scene by default so the image center is the first visible direction.
  return rotation + PANORAMA_STANDARD_FRONT_OFFSET
}

function usePanoramaTextureClone(url: string): THREE.Texture {
  const sourceTexture = useLoader(THREE.TextureLoader, url)
  const texture = React.useMemo(() => sourceTexture.clone(), [sourceTexture])

  React.useEffect(() => () => {
    texture.dispose()
  }, [texture])

  return texture
}

function configurePanoramaColorTexture(texture: THREE.Texture, anisotropy = 1): void {
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.anisotropy = anisotropy
  texture.needsUpdate = true
}

function PanoramaEnvironment({
  url,
  rotation,
}: {
  url: string
  rotation: number
}): JSX.Element {
  const texture = usePanoramaTextureClone(url)
  const gl = useThree((three) => three.gl)

  React.useLayoutEffect(() => {
    configurePanoramaColorTexture(texture, gl.capabilities.getMaxAnisotropy())
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.needsUpdate = true
  }, [gl, texture])

  return (
    <Environment
      background
      map={texture}
      backgroundRotation={[0, panoramaYaw(rotation), 0]}
      environmentRotation={[0, panoramaYaw(rotation), 0]}
      environmentIntensity={0.82}
    />
  )
}

export function Scene3DLocalEnvironmentLights({
  darkMode,
}: {
  darkMode: boolean
}): JSX.Element {
  return (
    <>
      <hemisphereLight
        args={darkMode ? ['#8fa8ff', '#10131f', 0.55] : ['#f8fbff', '#d8c9b0', 0.8]}
      />
      <directionalLight
        castShadow={false}
        intensity={darkMode ? 1.1 : 1.35}
        position={[4, 7, 5]}
      />
      <directionalLight
        castShadow={false}
        color={darkMode ? '#8fb3ff' : '#c8ddff'}
        intensity={darkMode ? 0.35 : 0.28}
        position={[-5, 3, -4]}
      />
    </>
  )
}

export function PanoramaSphere({
  url,
  rotation,
  radius,
}: {
  url: string
  rotation: number
  radius: number
}): JSX.Element {
  const visibleTexture = usePanoramaTextureClone(url)
  const environmentTexture = usePanoramaTextureClone(url)
  const gl = useThree((three) => three.gl)

  const geometry = React.useMemo(() => {
    const geom = new THREE.SphereGeometry(radius, PANORAMA_SPHERE_WIDTH_SEGMENTS, PANORAMA_SPHERE_HEIGHT_SEGMENTS)
    const uv = geom.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) {
      uv.setX(i, 1 - uv.getX(i))
    }
    uv.needsUpdate = true
    return geom
  }, [radius])

  React.useLayoutEffect(() => {
    configurePanoramaColorTexture(visibleTexture, gl.capabilities.getMaxAnisotropy())
    visibleTexture.mapping = THREE.UVMapping
    visibleTexture.needsUpdate = true
  }, [gl, visibleTexture])

  React.useLayoutEffect(() => {
    configurePanoramaColorTexture(environmentTexture, gl.capabilities.getMaxAnisotropy())
    environmentTexture.mapping = THREE.EquirectangularReflectionMapping
    environmentTexture.needsUpdate = true
  }, [environmentTexture, gl])

  return (
    <>
      <Environment
        map={environmentTexture}
        background={false}
        environmentRotation={[0, panoramaYaw(rotation), 0]}
        environmentIntensity={0.82}
      />
      <mesh geometry={geometry} rotation={[0, panoramaYaw(rotation), 0]}>
        <meshBasicMaterial map={visibleTexture} side={THREE.BackSide} toneMapped={false} />
      </mesh>
    </>
  )
}

export function SafePanoramaSphere({
  url,
  rotation,
  radius,
  fallback,
}: {
  url: string
  rotation: number
  radius: number
  fallback: React.ReactNode
}): JSX.Element {
  return (
    <EnvironmentResourceBoundary fallback={fallback} resetKey={url}>
      <React.Suspense fallback={fallback}>
        <PanoramaSphere url={url} rotation={rotation} radius={radius} />
      </React.Suspense>
    </EnvironmentResourceBoundary>
  )
}

export function SafePanoramaEnvironment({
  url,
  rotation,
  fallback,
}: {
  url: string
  rotation: number
  fallback: React.ReactNode
}): JSX.Element {
  return (
    <EnvironmentResourceBoundary fallback={fallback} resetKey={url}>
      <React.Suspense fallback={fallback}>
        <PanoramaEnvironment url={url} rotation={rotation} />
      </React.Suspense>
    </EnvironmentResourceBoundary>
  )
}

export function Scene3DEnvironmentLayer({
  environment,
  ambientIntensity = 0.65,
}: {
  environment: Scene3DState['environment']
  ambientIntensity?: number
}): JSX.Element {
  const panoramaUrl = environment.panoramaUrl

  return (
    <>
      {(!panoramaUrl || environment.environmentMode === 'sphere') ? (
        <color attach="background" args={[environment.backgroundColor]} />
      ) : null}
      <ambientLight intensity={ambientIntensity} />
      <Scene3DLocalEnvironmentLights darkMode={environment.darkMode} />
      {!panoramaUrl && environment.showSky ? <Sky sunPosition={[2, 1, 4]} /> : null}
      {panoramaUrl && environment.environmentMode === 'sphere' ? (
        <SafePanoramaSphere
          url={panoramaUrl}
          rotation={environment.panoramaRotation}
          radius={environment.sphereRadius}
          fallback={<color attach="background" args={[environment.backgroundColor]} />}
        />
      ) : panoramaUrl ? (
        <SafePanoramaEnvironment
          url={panoramaUrl}
          rotation={environment.panoramaRotation}
          fallback={<color attach="background" args={[environment.backgroundColor]} />}
        />
      ) : null}
    </>
  )
}
