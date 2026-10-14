import { useEffect, useRef } from 'react'
import { PhoneOff } from 'lucide-react'

// Tela da ligação de voz, aberta só para quem comprou o adicional 'voice-call' no checkout.
// Ponto de integração: conecte aqui a IA de voz em tempo real (iniciar no useEffect, encerrar no cleanup).
export default function VoiceCall({ name, image, onClose }) {
  const closeRef = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    closeRef.current?.focus()
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [onClose])
  return (
    <div className="chat-call-screen" role="dialog" aria-modal="true" aria-label={`Ligação de voz com ${name}`}>
      <div className="chat-call-person">
        <span className="chat-call-avatar"><img src={image} alt="" /></span>
        <strong>{name}</strong>
        <small>Ligação de voz liberada na sua conta</small>
      </div>
      <button ref={closeRef} type="button" className="chat-call-hangup" onClick={onClose} aria-label="Encerrar ligação">
        <PhoneOff size={26} />
      </button>
    </div>
  )
}
