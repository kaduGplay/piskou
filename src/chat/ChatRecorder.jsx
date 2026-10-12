import { useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
export default function ChatRecorder({ disabled, onRecorded }) {
  const recorder = useRef(null),
    stream = useRef(null),
    limit = useRef(null),
    chunks = useRef([]),
    alive = useRef(true)
  const [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(limit.current)
      if (recorder.current?.state === 'recording') recorder.current.stop()
      stream.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])
  const start = async () => {
    setError('')
    setBusy(true)
    try {
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder)
        throw new Error(
          'Este navegador não suporta gravação. Você pode enviar texto.',
        )
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })
      if (!alive.current) {
        stream.current.getTracks().forEach((t) => t.stop())
        return
      }
      const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) =>
        MediaRecorder.isTypeSupported(t),
      )
      const media = new MediaRecorder(
        stream.current,
        mime ? { mimeType: mime } : undefined,
      )
      recorder.current = media
      chunks.current = []
      media.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data)
      }
      media.onstop = async () => {
        clearTimeout(limit.current)
        stream.current?.getTracks().forEach((t) => t.stop())
        if (!alive.current) return
        setRecording(false)
        const blob = new Blob(chunks.current, { type: media.mimeType })
        if (!blob.size || blob.size > 2097152) {
          setError('Grave um áudio menor, de até 2 MB.')
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          if (alive.current)
            onRecorded({
              mime: blob.type.split(';')[0],
              base64: String(reader.result).split(',')[1],
            })
        }
        reader.readAsDataURL(blob)
      }
      media.start()
      setRecording(true)
      limit.current = setTimeout(() => {
        if (media.state === 'recording') media.stop()
      }, 30000)
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop())
      setError(
        e.name === 'NotAllowedError'
          ? 'Permita o microfone para gravar, ou envie texto.'
          : e.message,
      )
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return (
    <div className="chat-recorder">
      <button
        type="button"
        disabled={busy || (disabled && !recording)}
        aria-label={
          recording
            ? 'Parar gravação e enviar áudio'
            : 'Gravar mensagem de áudio'
        }
        aria-pressed={recording}
        onClick={() => (recording ? recorder.current.stop() : start())}
      >
        {recording ? <Square size={18} /> : <Mic size={18} />}
      </button>
      {recording && (
        <small role="status">
          Gravando · até 30 s{' '}
          <button
            type="button"
            onClick={() => {
              recorder.current.onstop = () => {
                clearTimeout(limit.current)
                stream.current?.getTracks().forEach((t) => t.stop())
                setRecording(false)
              }
              recorder.current.stop()
            }}
          >
            Cancelar
          </button>
        </small>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  )
}
