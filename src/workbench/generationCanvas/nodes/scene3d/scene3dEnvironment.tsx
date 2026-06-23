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
