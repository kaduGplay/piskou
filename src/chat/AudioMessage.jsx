import { useEffect, useRef, useState } from 'react'
import { Play, Pause, LoaderCircle } from 'lucide-react'
import { audioTime, waveformPeaks } from './audioWaveform.js'

export default function AudioMessage({ message, selection, onChanged }) {
  const [url, setURL] = useState(''), [error, setError] = useState(''),
    [busy, setBusy] = useState(false), [speed, setSpeed] = useState(1),
    [playing, setPlaying] = useState(false), [duration, setDuration] = useState(0),
    [position, setPosition] = useState(0), [peaks, setPeaks] = useState(null)
  const audioRef = useRef(null), alive = useRef(true), autoplay = useRef(false), loading = useRef(false), initializedAudio = useRef(false)
  useEffect(() => {
    alive.current = true
    const pauseOther = (event) => {
      if (event.detail !== message.id) audioRef.current?.pause()
    }
    window.addEventListener('piskou:audio-play', pauseOther)
    return () => {
      alive.current = false
      audioRef.current?.pause()
      window.removeEventListener('piskou:audio-play', pauseOther)
    }
  }, [])
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    let context
    const decode = async () => {
      try {
        const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext
        if (!AudioContext) return
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) return
        const bytes = await response.arrayBuffer()
        if (controller.signal.aborted) return
        context = new AudioContext()
        const buffer = await context.decodeAudioData(bytes)
        if (!controller.signal.aborted) {
          setPeaks(waveformPeaks(buffer.getChannelData(0)))
          setDuration(buffer.duration)
        }
      } catch { /* Playback remains available when waveform decoding is unsupported. */ }
      finally { context?.close().catch(() => {}) }
    }
    decode()
    if (autoplay.current) {
      autoplay.current = false
      audioRef.current?.play().catch(() => {})
    }
    return () => { controller.abort(); context?.close().catch(() => {}) }
  }, [url])
  const load = async (play = true) => {
    if (loading.current) return
    loading.current = true
    setBusy(true)
    setError('')
    try {
      if (!message.audio) {
        const response = await fetch('/api/chat-audio', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'speech', messageId: message.id, selection }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        onChanged?.()
      }
      const response = await fetch('/api/chat-audio?messageId=' + encodeURIComponent(message.id), { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      if (alive.current) { autoplay.current = play; setURL(data.url) }
    } catch (e) { if (alive.current) setError(e.message || 'Áudio indisponível') }
    finally { loading.current = false; if (alive.current) setBusy(false) }
  }
  useEffect(() => {
    if ((message.audio || message.mediaRequest === 'audio-reply') && !message.localState && !initializedAudio.current) {
      initializedAudio.current = true
      load(false)
    }
  }, [message.audio, message.localState])
  const toggle = () => {
    if (!url) { load(); return }
    if (playing) audioRef.current?.pause()
    else audioRef.current?.play().catch(() => setError('Não foi possível reproduzir. Toque para tentar novamente.'))
  }
  const progress = duration ? position / duration : 0
  return <div className="chat-audio-message">
    <div className="chat-audio-player">
      <button type="button" className="chat-audio-play" disabled={busy || !!message.localState}
        aria-label={busy ? 'Preparando áudio' : playing ? 'Pausar áudio' : message.audio ? 'Reproduzir áudio' : 'Ouvir resposta · voz de IA'} onClick={toggle}>
        {busy ? <LoaderCircle size={20} className="chat-audio-loading" /> : playing ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <div className="chat-audio-track">
        <div className="chat-audio-wave" aria-hidden="true">
          {(peaks || Array(40).fill(0)).map((peak, i) => <i key={i}
            className={i / 40 < progress ? 'played' : ''} style={{ height: `${3 + peak * 29}px` }} />)}
        </div>
        <input type="range" aria-label="Posição do áudio" min="0" max={duration || 1} step="0.1" value={position}
          disabled={!url || !duration} onChange={(event) => {
            const value = Number(event.target.value)
            if (audioRef.current) audioRef.current.currentTime = value
            setPosition(value)
          }} />
        <div className="chat-audio-caption"><time>{audioTime(position || duration)}</time>
          <span>{busy ? 'Preparando…' : message.role === 'character' ? 'Voz de IA' : message.localState === 'sending' ? 'Enviando…' : 'Áudio'}</span>
        </div>
      </div>
      <button type="button" className="chat-audio-speed" aria-label="Velocidade do áudio" onClick={() => {
        const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1
        setSpeed(next)
        if (audioRef.current) audioRef.current.playbackRate = next
      }}>{String(speed).replace('.', ',')}x</button>
    </div>
    {url && <audio ref={audioRef} src={url} preload="metadata" playsInline className="chat-audio-element"
      onPlay={() => { window.dispatchEvent(new CustomEvent('piskou:audio-play', { detail: message.id })); setPlaying(true); setError(''); if (audioRef.current) audioRef.current.playbackRate = speed }}
      onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPosition(0) }}
      onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
      onDurationChange={(event) => { if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration) }}
      onError={() => { setURL(''); setPlaying(false); setError('Toque novamente para renovar o acesso ao áudio.') }} />}
    {message.audio && message.role === 'user' && <details><summary>Ver transcrição</summary><p>{message.text}</p></details>}
    {error && <small role="alert">{error}</small>}
  </div>
}
