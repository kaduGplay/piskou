import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  OrthographicCamera,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three'
import { getResultImage } from './data.js'

const ALL_SILHOUETTES = Array.from({ length: 7 }, (_, i) => `/loading-states/silhouette-${i + 1}.webp`)

// Sorteia 3 silhuetas espaçadas (usado só quando nenhuma lista é passada).
function pickSilhouettes(paths = ALL_SILHOUETTES) {
  const start = Math.floor(Math.random() * paths.length)
  return [paths[start], paths[(start + 2) % paths.length], paths[(start + 4) % paths.length]]
}

// Lê a máscara (silhueta branca em fundo preto) e devolve os pixels claros como pontos centrados em -0.85..0.85.
function loadSilhouettePoints(src, { sampleSize = 224, signal, threshold = 190 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const cleanup = () => {
      img.onload = null
      img.onerror = null
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      img.src = ''
      reject(new DOMException('Silhouette load aborted', 'AbortError'))
    }

    img.onload = () => {
      cleanup()
      const canvas = document.createElement('canvas')
      canvas.width = sampleSize
      canvas.height = sampleSize
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        reject(new Error('Canvas 2D is unavailable'))
        return
      }
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, sampleSize, sampleSize)
      const scale = Math.min(sampleSize / img.width, sampleSize / img.height)
      const w = img.width * scale
      const h = img.height * scale
      ctx.drawImage(img, (sampleSize - w) / 2, (sampleSize - h) / 2, w, h)

      const { data } = ctx.getImageData(0, 0, sampleSize, sampleSize)
      const points = []
      let minX = sampleSize
      let minY = sampleSize
      let maxX = 0
      let maxY = 0
      for (let y = 0; y < sampleSize; y += 2) {
        for (let x = 0; x < sampleSize; x += 2) {
          const i = (y * sampleSize + x) * 4
          const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3
          if (data[i + 3] < 128 || brightness < threshold) continue
          points.push([x, y])
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
      if (points.length === 0) {
        reject(new Error(`No white pixels found in ${src}`))
        return
      }
      const fit = 1.7 / Math.max(maxX - minX, maxY - minY, 1)
      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2
      resolve(points.map(([x, y]) => [(x - centerX) * fit, (centerY - y) * fit, 0]))
    }
    img.onerror = () => {
      cleanup()
      reject(new Error(`Could not load ${src}`))
    }

    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    img.src = src
  })
}

// Distribui `count` partículas pelos pontos da silhueta (sequência de razão áurea, sem repetir padrão).
function silhouettePositions(points, count) {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    const point = points[Math.floor(((i * 0.61803398875) % 1) * points.length)]
    positions[i * 3] = point[0]
    positions[i * 3 + 1] = point[1]
    positions[i * 3 + 2] = point[2]
  }
  return positions
}

function randomCloud(count, spread = 1.55) {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    const k = i * 3
    positions[k] = (Math.random() * 2 - 1) * spread
    positions[k + 1] = (Math.random() * 2 - 1) * spread
    positions[k + 2] = (Math.random() * 2 - 1) * 0.3
  }
  return positions
}

// Interpola de `from` para `to` com suavização e um giro em espiral (`twist`) no meio do caminho.
function morph(from, to, out, t, twist = 0) {
  const eased = t * t * (3 - 2 * t)
  const angle = twist * Math.sin(t * Math.PI) * Math.PI * 2
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  for (let i = 0; i < out.length; i += 3) {
    const dx = from[i] - to[i]
    const dy = from[i + 1] - to[i + 1]
    out[i] = to[i] + (dx * cos - dy * sin) * (1 - eased)
    out[i + 1] = to[i + 1] + (dx * sin + dy * cos) * (1 - eased)
    out[i + 2] = from[i + 2] + (to[i + 2] - from[i + 2]) * eased
  }
}

const DEFAULT_CONFIG = {
  pointSize: 2.2,
  pointColor: '#ff0000',
  attractionSpeed: 1,
  gatherDurationMs: 1250,
  holdDurationMs: 340,
  releaseDurationMs: 950,
  scatterDurationMs: 280,
  revealDurationMs: 1650,
}

const clamp01 = (v) => Math.max(0, Math.min(1, v))

const VERTEX_SHADER = `
  attribute float aSeed;
  uniform float uTime;
  uniform float uFlow;
  uniform float uPointSize;
  varying float vLight;
  void main() {
    vec3 particle = position;
    float phase = aSeed * 40.0;
    particle.x += sin(uTime * 1.7 + phase + position.y * 4.0) * uFlow;
    particle.y += cos(uTime * 1.4 + phase + position.x * 3.0) * uFlow;
    particle.z += sin(uTime + phase) * uFlow * 0.6;
    vLight = 0.25 + 0.65 * pow(0.5 + 0.5 * sin(position.y * 5.0 - uTime * 2.3 + aSeed), 3.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(particle, 1.0);
    gl_PointSize = uPointSize * (0.8 + aSeed * 0.55);
  }
`

const FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vLight;
  void main() {
    float distanceToCenter = length(gl_PointCoord - vec2(0.5));
    if (distanceToCenter > 0.5) discard;
    float glow = 1.0 - smoothstep(0.08, 0.5, distanceToCenter);
    vec3 color = mix(uColor, vec3(1.0, 0.77, 0.7), vLight * 0.45);
    gl_FragColor = vec4(color, glow * uOpacity);
  }
`

function ParticleMaterializer({ onProgress, onReveal, onComplete, config = DEFAULT_CONFIG, silhouettePaths }) {
  const containerRef = useRef(null)
  const callbacksRef = useRef({ onProgress, onReveal, onComplete })
  const pathsRef = useRef(null)
  const [showFallback, setShowFallback] = useState(false)
  callbacksRef.current = { onProgress, onReveal, onComplete }
  if (!pathsRef.current) pathsRef.current = silhouettePaths ?? pickSilhouettes()

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const cfg = { ...DEFAULT_CONFIG, ...config }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const mobile = window.matchMedia('(max-width: 600px)').matches
    const lowEnd = (navigator.hardwareConcurrency || 8) <= 4
    const particleCount = Math.min(cfg.particleCount ?? 2800, lowEnd ? 1300 : mobile ? 1600 : 3200)
    const dustCount = cfg.backgroundParticleCount ?? (mobile ? 75 : 140)
    const gatherDuration = cfg.gatherDurationMs / Math.max(cfg.attractionSpeed, 0.1)

    // Linha do tempo: dispersão → (juntar, segurar, soltar) por silhueta; a última termina em "reveal".
    const timeline = [{ type: 'drift', duration: cfg.scatterDurationMs }]
    pathsRef.current.forEach((_, index) => {
      const last = index === pathsRef.current.length - 1
      timeline.push({ type: 'gather', index, duration: gatherDuration })
      timeline.push({ type: 'hold', index, duration: cfg.holdDurationMs })
      timeline.push({
        type: last ? 'reveal' : 'release',
        index,
        duration: last ? cfg.revealDurationMs : cfg.releaseDurationMs,
      })
    })
    const totalDuration = timeline.reduce((sum, phase) => sum + phase.duration, 0)

    const abort = new AbortController()
    let renderer
    let geometry
    let dustGeometry
    let material
    let dustMaterial
    let resizeObserver
    let frame = 0
    let disposed = false
    let completed = false
    let useFallback = reducedMotion
    let fallbackStart = performance.now()
    let startTime = 0
    let lastFrame = 0
    let lastProgressEmit = 0
    let lastRevealEmit = 0
    let targets = null
    let releaseClouds = null

    const complete = () => {
      if (completed || disposed) return
      completed = true
      callbacksRef.current.onReveal?.(1)
      callbacksRef.current.onProgress?.(100)
      callbacksRef.current.onComplete?.()
    }
    const emitProgress = (time, value) => {
      if (time - lastProgressEmit < 80 && value < 100) return
      lastProgressEmit = time
      callbacksRef.current.onProgress?.(value)
    }
    const emitReveal = (time, value) => {
      if (time - lastRevealEmit < 60 && value < 1) return
      lastRevealEmit = time
      callbacksRef.current.onReveal?.(value)
    }

    if (reducedMotion) setShowFallback(true)

    let scene
    let camera
    let positions
    let startPositions
    let dustPositions
    let dustBase

    if (!reducedMotion) {
      try {
        renderer = new WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5))
        renderer.setClearColor(0, 0)
        renderer.domElement.setAttribute('aria-hidden', 'true')
        container.appendChild(renderer.domElement)

        scene = new Scene()
        camera = new OrthographicCamera(-1.2, 1.2, 1.2, -1.2, 0.1, 10)
        camera.position.z = 5

        positions = randomCloud(particleCount)
        startPositions = positions.slice()
        geometry = new BufferGeometry()
        geometry.setAttribute('position', new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage))
        geometry.setAttribute(
          'aSeed',
          new BufferAttribute(
            Float32Array.from({ length: particleCount }, (_, i) => (i * 0.61803398875) % 1),
            1,
          ),
        )
        material = new ShaderMaterial({
          vertexShader: VERTEX_SHADER,
          fragmentShader: FRAGMENT_SHADER,
          uniforms: {
            uTime: { value: 0 },
            uFlow: { value: 0.066 },
            uPointSize: { value: cfg.pointSize * renderer.getPixelRatio() },
            uColor: { value: new Color(cfg.pointColor) },
            uOpacity: { value: 0.96 },
          },
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
        })
        scene.add(new Points(geometry, material))

        // Poeira de fundo que flutua devagar.
        dustPositions = randomCloud(dustCount, 1.8)
        dustBase = dustPositions.slice()
        dustGeometry = new BufferGeometry()
        dustGeometry.setAttribute('position', new BufferAttribute(dustPositions, 3).setUsage(DynamicDrawUsage))
        dustMaterial = new PointsMaterial({
          color: '#ffffff',
          size: mobile ? 1.2 : 1.6,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          blending: AdditiveBlending,
        })
        scene.add(new Points(dustGeometry, dustMaterial))

        const resize = () => {
          const { width, height } = container.getBoundingClientRect()
          const w = Math.max(width, 1)
          const h = Math.max(height, 1)
          renderer.setSize(w, h, false)
          const halfHeight = 1.22
          const halfWidth = halfHeight * (w / h)
          camera.left = -halfWidth
          camera.right = halfWidth
          camera.top = halfHeight
          camera.bottom = -halfHeight
          camera.updateProjectionMatrix()
        }
        resize()
        resizeObserver = new ResizeObserver(resize)
        resizeObserver.observe(container)

        Promise.all(
          pathsRef.current.map((src) =>
            loadSilhouettePoints(src, { signal: abort.signal, threshold: src.includes('final-mask') ? 245 : 190 }),
          ),
        )
          .then((loaded) => {
            if (disposed) return
            targets = loaded.map((points) => silhouettePositions(points, particleCount))
            releaseClouds = targets.map((_, i) => randomCloud(particleCount, i === targets.length - 1 ? 2.2 : 1.55))
            startTime = performance.now()
          })
          .catch(() => {
            if (disposed) return
            useFallback = true
            fallbackStart = performance.now()
            setShowFallback(true)
          })
      } catch {
        useFallback = true
        fallbackStart = performance.now()
        setShowFallback(true)
      }
    }

    const tick = (time) => {
      if (disposed || completed) return
      const fallbackDuration = reducedMotion ? 1200 : totalDuration

      // Sem WebGL ou com movimento reduzido: só avança a barra e revela a imagem.
      if (useFallback) {
        const t = clamp01((time - fallbackStart) / fallbackDuration)
        emitProgress(time, t * 100)
        emitReveal(time, Math.max(0, (t - 0.55) / 0.45))
        if (t >= 1) return complete()
        frame = requestAnimationFrame(tick)
        return
      }

      // Limita a 30 fps no celular e 45 fps no desktop.
      if (time - lastFrame < (mobile ? 1000 / 30 : 1000 / 45)) {
        frame = requestAnimationFrame(tick)
        return
      }
      lastFrame = time

      const elapsed = targets ? Math.min(time - startTime, totalDuration) : 0
      const positionAttr = geometry.getAttribute('position')
      let phase = timeline[0]
      let t = 0
      if (targets) {
        let acc = 0
        for (const p of timeline) {
          const end = acc + p.duration
          if (elapsed <= end) {
            phase = p
            t = clamp01((elapsed - acc) / p.duration)
            break
          }
          acc = end
        }
      }

      const uniforms = material.uniforms
      const eased = t * t * (3 - 2 * t)
      uniforms.uTime.value = time * 0.001
      uniforms.uOpacity.value = 0.96
      uniforms.uFlow.value = 0.016
      dustMaterial.opacity = 0.22

      if (!targets || phase.type === 'drift') {
        positions.set(startPositions)
        uniforms.uFlow.value = 0.066
        uniforms.uOpacity.value = 0.62
      } else if (phase.type === 'gather') {
        const from = phase.index === 0 ? startPositions : releaseClouds[phase.index - 1]
        morph(from, targets[phase.index], positions, t, 0.2)
        uniforms.uFlow.value = 0.016 + 0.05 * (1 - eased)
        uniforms.uOpacity.value = 0.62 + eased * 0.34
      } else if (phase.type === 'hold') {
        positions.set(targets[phase.index])
      } else {
        morph(targets[phase.index], releaseClouds[phase.index], positions, t, phase.type === 'reveal' ? 0.12 : -0.24)
        uniforms.uFlow.value = 0.016 + 0.05 * eased
        uniforms.uOpacity.value = 0.96 * (1 - eased) + (phase.type === 'release' ? 0.62 * eased : 0)
        if (phase.type === 'reveal') {
          dustMaterial.opacity = 0.22 * (1 - eased)
          emitReveal(time, eased)
        }
      }
      positionAttr.needsUpdate = true

      for (let i = 0; i < dustPositions.length; i += 3) {
        dustPositions[i] = dustBase[i] + Math.sin(time * 16e-5 + i) * 0.025
        dustPositions[i + 1] = dustBase[i + 1] + Math.cos(time * 2e-4 + i) * 0.035
      }
      dustGeometry.getAttribute('position').needsUpdate = true

      renderer.render(scene, camera)
      if (targets) emitProgress(time, (elapsed / totalDuration) * 100)
      if (targets && elapsed >= totalDuration) return complete()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      disposed = true
      abort.abort()
      cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      geometry?.dispose()
      dustGeometry?.dispose()
      material?.dispose()
      dustMaterial?.dispose()
      renderer?.dispose()
      renderer?.forceContextLoss()
      renderer?.domElement.remove()
    }
  }, [config])

  return (
    <div
      ref={containerRef}
      aria-label="Materializando personagem"
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    >
      {showFallback && (
        <img
          src={pathsRef.current[0]}
          alt=""
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            opacity: 0.45,
            filter: 'drop-shadow(0 0 1.5rem rgba(255,0,0,0.5))',
          }}
        />
      )}
    </div>
  )
}

const PANEL_CONFIG = { particleCount: 2600, backgroundParticleCount: 55, pointSize: 2.8 }

export default function GeneratingPanel({ sel, onReady }) {
  const [run, setRun] = useState(0)
  const [progress, setProgress] = useState(0)
  const [reveal, setReveal] = useState(0)
  const [done, setDone] = useState(false)
  const result = getResultImage(sel)
  const silhouettes = [
    '/loading-states/silhouette-3.webp',
    '/loading-states/silhouette-7.webp',
    sel.style === 'anime' ? '/loading-states/anime-final-mask.webp' : '/loading-states/real-final-mask.webp',
  ]

  const replay = () => {
    setDone(false)
    setProgress(0)
    setReveal(0)
    onReady(false)
    setRun((n) => n + 1)
  }

  return (
    <div className="creator-generated-card">
      <img
        className="creator-generated-image"
        src={result.src}
        alt={`Personagem ${sel.name || 'criada'}`}
        decoding="async"
        fetchPriority="high"
        style={{ transform: `scale(${1.035 - reveal * 0.035})`, opacity: reveal }}
      />
      {!done && (
        <div className="creator-particle-stage" key={run} style={{ backgroundColor: `rgba(9,9,13,${(1 - reveal) ** 2})` }}>
          <ParticleMaterializer
            silhouettePaths={silhouettes}
            config={PANEL_CONFIG}
            onProgress={setProgress}
            onReveal={setReveal}
            onComplete={() => {
              setDone(true)
              onReady(true)
            }}
          />
        </div>
      )}
      <div className="creator-generated-top">
        <span>{done ? 'VISUAL REVELADO' : `MATERIALIZANDO · ${Math.round(progress)}%`}</span>
        <button type="button" onClick={replay} aria-label="Repetir revelação" title="Repetir revelação">
          <RotateCcw size={17} />
        </button>
      </div>
      {!done && (
        <div
          className="creator-generation-progress"
          role="progressbar"
          aria-label="Preparando sua personagem"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <span style={{ transform: `scaleX(${progress / 100})` }} />
        </div>
      )}
      <div className="creator-generated-bottom">
        <strong>{sel.name || 'Sua personagem'}</strong>
        <span>
          {sel.age} anos · {sel.style === 'anime' ? 'Anime' : 'Realista'}
        </span>
      </div>
    </div>
  )
}
