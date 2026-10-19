import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { getResultImage } from './data.js'
import { usePlaybackMode } from './playback.js'

const LOADER_VIDEO = '/funnel-media/v2/loader/loader.mp4'
const LOADER_POSTER = '/funnel-media/v2/loader/poster.webp'
const INITIAL_PROGRESS = { time: 0, progress: 0, complete: false }

// O progresso acompanha o vídeo de carregamento até 95%; a revelação acontece quando o vídeo chega ao fim.
function nextProgress(state, time, duration) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(time)) return state
  const complete = state.complete || time < state.time - 0.5 || time >= duration - 0.15
  return { time, complete, progress: complete ? 95 : Math.max(state.progress, Math.min(95, (time / duration) * 95)) }
}

function Reveal({ sel, onReady, restart }) {
  const [progress, setProgress] = useState(INITIAL_PROGRESS)
  const [imageReady, setImageReady] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const videoRef = useRef(null)
  const imageRef = useRef(null)
  const mode = usePlaybackMode()
  const result = getResultImage(sel)
  // Sem vídeo (falha, "reduzir movimento" ou economia de dados), revela assim que a imagem carregar.
  const skipVideo = videoFailed || ['reduced', 'limited'].includes(mode)
  const revealed = imageReady && (progress.complete || skipVideo)

  useEffect(() => {
    onReady(revealed)
  }, [revealed, onReady])

  useEffect(() => {
    const image = imageRef.current
    if (image?.complete && image.naturalWidth > 0) setImageReady(true)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let alive = true
    if (mode === 'play' && !revealed && !skipVideo) {
      video.play().catch(() => {
        if (alive) setVideoFailed(true)
      })
    } else video.pause()
    return () => {
      alive = false
      video.pause()
    }
  }, [mode, revealed, skipVideo])

  return (
    <div className={`creator-generated-card${revealed ? ' revealed' : ''}`}>
      <img
        ref={imageRef}
        className="creator-generated-image"
        src={result.src}
        alt={`Personaje ${sel.name || 'creado'}`}
        decoding="async"
        fetchPriority="high"
        onLoad={() => setImageReady(true)}
        onError={() => setImageFailed(true)}
        style={{ opacity: revealed ? 1 : 0 }}
      />
      <div className="creator-video-stage" aria-hidden={revealed ? true : undefined}>
        {!skipVideo && (
          <video
            ref={videoRef}
            src={LOADER_VIDEO}
            poster={LOADER_POSTER}
            loop
            muted
            playsInline
            preload="metadata"
            aria-hidden="true"
            onTimeUpdate={(event) => {
              const video = event.currentTarget
              setProgress((state) => nextProgress(state, video.currentTime, video.duration))
            }}
            onError={() => setVideoFailed(true)}
          />
        )}
        {imageFailed && (
          <div className="creator-generation-error" role="alert">
            <p>No se pudo cargar la imagen.</p>
            <button type="button" onClick={restart}>
              <RotateCcw size={17} /> Intentar de nuevo
            </button>
          </div>
        )}
      </div>
      <div className="creator-generated-top">
        <span>{revealed ? 'LOOK REVELADO' : imageFailed ? 'ERROR AL CARGAR' : `PREPARANDO LOOK · ${Math.floor(progress.progress)}%`}</span>
        <button type="button" onClick={restart} aria-label="Repetir revelación" title="Repetir revelación">
          <RotateCcw size={17} />
        </button>
      </div>
      <div
        className="creator-generation-progress"
        role="progressbar"
        aria-label="Preparando a tu personaje"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={revealed ? 100 : Math.floor(progress.progress)}
      >
        <span style={{ transform: `scaleX(${revealed ? 1 : progress.progress / 100})` }} />
      </div>
      <div className="creator-generated-bottom">
        <strong>{sel.name || 'Tu personaje'}</strong>
        <span>
          {sel.age} años · {sel.style === 'anime' ? 'Anime' : 'Realista'}
        </span>
      </div>
    </div>
  )
}

export default function GeneratingPanel(props) {
  const [attempt, setAttempt] = useState(0)
  return (
    <Reveal
      key={`${attempt}-${getResultImage(props.sel).src}`}
      {...props}
      restart={() => {
        props.onReady(false)
        setAttempt((n) => n + 1)
      }}
    />
  )
}
