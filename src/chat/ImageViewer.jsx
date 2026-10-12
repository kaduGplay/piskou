import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export default function ImageViewer({ src, onClose }) {
  const close = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    const root = document.getElementById('root')
    const wasInert = root?.inert
    const overflow = document.body.style.overflow
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    close.current?.focus()
    const keydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'Tab') { event.preventDefault(); close.current?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      if (root) root.inert = wasInert
      document.body.style.overflow = overflow
      previous?.focus?.({ preventScroll: true })
    }
  }, [onClose])
  return createPortal(<div className="chat-image-viewer" role="dialog" aria-modal="true" aria-label="Imagem em tela cheia" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <button ref={close} type="button" aria-label="Fechar imagem" onClick={onClose}><X size={27} /></button>
    <img src={src} alt="Imagem da conversa em tela cheia" />
  </div>, document.body)
}
