import { useEffect, useRef, useState } from 'react'
import { Mic, Send, Trash2 } from 'lucide-react'
import { audioTime } from './audioWaveform.js'

export default function ChatRecorder({ disabled, onRecorded, onRecordingChange }) {
  const session = useRef(null), alive = useRef(true), callbacks = useRef({ onRecorded, onRecordingChange })
  callbacks.current = { onRecorded, onRecordingChange }
  const [recording, setRecording] = useState(false), [busy, setBusy] = useState(false),
    [error, setError] = useState(''), [elapsed, setElapsed] = useState(0),
    [levels, setLevels] = useState(() => Array(36).fill(0))
  const release = (current) => {
    clearTimeout(current.limit)
    cancelAnimationFrame(current.frame)
    current.stream?.getTracks().forEach((track) => track.stop())
    current.context?.close().catch(() => {})
  }
  const stop = (cancel = false) => {
    const current = session.current
    if (!current) return
    current.canceled = cancel
    if (current.media?.state === 'recording') current.media.stop()
    release(current)
    if (alive.current) {
      setRecording(false)
      callbacks.current.onRecordingChange?.(false)
    }
  }
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      const current = session.current
      if (current) {
        current.canceled = true
        if (current.media?.state === 'recording') current.media.stop()
        release(current)
      }
    }
  }, [])
  const start = async () => {
    if (session.current || busy || disabled) return
    document.activeElement?.blur?.()
    setError('')
    setBusy(true)
    const current = { chunks: [], canceled: false }
    session.current = current
    try {
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder)
        throw new Error('Este navegador não suporta gravação. Você pode enviar texto.')
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext
      if (AudioContext) {
        current.context = new AudioContext()
        await current.context.resume()
      }
      current.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!alive.current || current.canceled) { release(current); return }
      const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((type) => MediaRecorder.isTypeSupported(type))
      const media = new MediaRecorder(current.stream, mime ? { mimeType: mime } : undefined)
      current.media = media
      media.ondataavailable = (event) => { if (event.data.size) current.chunks.push(event.data) }
      media.onerror = () => {
        stop(true)
        session.current = null
        if (alive.current) setError('Não foi possível gravar. Tente novamente.')
      }
      media.onstop = async () => {
        release(current)
        if (session.current === current) session.current = null
        if (!alive.current) return
        setRecording(false)
        callbacks.current.onRecordingChange?.(false)
        if (current.canceled) return
        setBusy(true)
        try {
          const blob = new Blob(current.chunks, { type: media.mimeType })
          if (!blob.size || blob.size > 2097152) throw new Error('Grave um áudio menor, de até 2 MB.')
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result).split(',')[1])
            reader.onerror = () => reject(new Error('Não foi possível ler a gravação.'))
            reader.readAsDataURL(blob)
          })
          if (alive.current) callbacks.current.onRecorded({ mime: blob.type.split(';')[0], base64 })
        } catch (e) { if (alive.current) setError(e.message) }
        finally { if (alive.current) setBusy(false) }
      }
      let analyser, samples
      if (current.context) {
        analyser = current.context.createAnalyser()
        analyser.fftSize = 256
        current.context.createMediaStreamSource(current.stream).connect(analyser)
        samples = new Float32Array(analyser.fftSize)
      }
      const started = performance.now()
      let lastSample = 0
      const meter = (now) => {
        if (current.canceled || media.state !== 'recording') return
        if (now - lastSample >= 80) {
          lastSample = now
          setElapsed((now - started) / 1000)
          if (analyser) {
            analyser.getFloatTimeDomainData(samples)
            const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
            setLevels((values) => [...values.slice(1), Math.min(1, rms * 5)])
          }
        }
        current.frame = requestAnimationFrame(meter)
      }
      setElapsed(0)
      setLevels(Array(36).fill(0))
      media.start()
      setRecording(true)
      callbacks.current.onRecordingChange?.(true)
      current.frame = requestAnimationFrame(meter)
      current.limit = setTimeout(() => stop(), 30000)
    } catch (e) {
      release(current)
      if (session.current === current) session.current = null
      if (alive.current) setError(e.name === 'NotAllowedError' ? 'Permita o microfone para gravar, ou envie texto.' : e.message)
    } finally { if (alive.current) setBusy(false) }
  }
  return (
    <div className={`chat-recorder${recording ? ' is-recording' : ''}`}>
      {recording ? <div className="chat-recording-bar" aria-label="Gravação de áudio">
        <button type="button" className="chat-recording-cancel" aria-label="Cancelar gravação" onClick={() => stop(true)}><Trash2 size={19} /></button>
        <span className="chat-recording-dot" aria-hidden="true" />
        <time aria-label="Tempo de gravação">{audioTime(elapsed)}</time>
        <div className="chat-recording-wave" aria-label="Nível da voz em tempo real" role="img">
          {levels.map((level, i) => <i key={i} style={{ height: `${3 + level * 27}px` }} />)}
        </div>
        <span className="chat-recording-limit">30 s máx.</span>
        <button type="button" aria-label="Parar gravação e enviar áudio" onClick={() => stop()}><Send size={19} /></button>
      </div> : <button type="button" disabled={busy || disabled} aria-label={busy ? 'Preparando microfone' : 'Gravar mensagem de áudio'} onClick={start}><Mic size={18} /></button>}
      {error && <span className="chat-recording-error" role="alert">{error}</span>}
    </div>
  )
}
