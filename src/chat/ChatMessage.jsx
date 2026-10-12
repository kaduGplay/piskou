import { useEffect, useRef, useState } from 'react'
import {
  Check,
  CheckCheck,
  Clock3,
  MoreHorizontal,
  AlertCircle,
  X,
} from 'lucide-react'
export const messageState = (message) =>
  message.deleted
    ? 'Mensagem apagada'
    : message.localState === 'failed'
      ? 'Falha no envio'
      : message.localState === 'sending'
        ? 'Enviando'
        : message.viewedAt
          ? 'Visualizada'
          : message.sentAt
            ? 'Enviada'
            : 'Estado histórico não registrado'
const clock = (value) =>
  value
    ? new Date(value).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''
const fullTime = (value) =>
  value ? new Date(value).toLocaleString('pt-BR') : 'Ainda não registrado'
export function AudioMessage({ message, selection, onChanged }) {
  const [url, setURL] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [speed, setSpeed] = useState(1)
  const audioRef = useRef(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      audioRef.current?.pause()
    }
  }, [])
  const load = async () => {
    setBusy(true)
    setError('')
    try {
      if (!message.audio) {
        const response = await fetch('/api/chat-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'speech',
            messageId: message.id,
            selection,
          }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        onChanged?.()
      }
      const response = await fetch(
        '/api/chat-audio?messageId=' + encodeURIComponent(message.id),
        { cache: 'no-store' },
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      if (alive.current) setURL(data.url)
    } catch (e) {
      if (alive.current) setError(e.message || 'Áudio indisponível')
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  return (
    <div className="chat-audio-message">
      {!url ? (
        <button
          type="button"
          disabled={busy || !!message.localState}
          onClick={load}
        >
          {busy
            ? 'Preparando áudio…'
            : message.audio
              ? 'Reproduzir áudio'
              : 'Ouvir resposta · voz de IA'}
        </button>
      ) : (
        <>
          <audio
            ref={audioRef}
            src={url}
            controls
            preload="none"
            onError={() => {
              setURL('')
              setError('Toque novamente para renovar o acesso ao áudio.')
            }}
          />
          <button
            type="button"
            aria-label="Velocidade do áudio"
            onClick={() => {
              const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1
              setSpeed(next)
              if (audioRef.current) audioRef.current.playbackRate = next
            }}
          >
            {String(speed).replace('.', ',')}x
          </button>
        </>
      )}
      {message.audio && message.role === 'user' && (
        <details>
          <summary>Ver transcrição</summary>
          <p>{message.text}</p>
        </details>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  )
}
export default function ChatMessage({
  message,
  messages,
  name,
  image,
  selection,
  onReply,
  onDelete,
  onRetry,
  onChanged,
}) {
  const [menu, setMenu] = useState(false),
    [info, setInfo] = useState(false),
    [notice, setNotice] = useState('')
  const press = useRef(null),
    origin = useRef(null),
    infoRef = useRef(null),
    menuRef = useRef(null),
    triggerRef = useRef(null)
  useEffect(() => () => clearTimeout(press.current), [])
  useEffect(() => {
    if (!menu && !info) return
    const previous = document.activeElement
    const panel = info ? infoRef.current : menuRef.current
    panel?.querySelector('button')?.focus()
    const keydown = (event) => {
      if (event.key === 'Escape') {
        setMenu(false)
        setInfo(false)
      }
      if (event.key === 'Tab' && info) {
        const items = [...panel.querySelectorAll('button')]
        if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault()
          items.at(-1)?.focus()
        } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
          event.preventDefault()
          items[0]?.focus()
        }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      previous?.focus?.()
    }
  }, [menu, info])
  const quoted = messages.find((m) => m.id === message.replyTo)
  const state = messageState(message)
  return (
    <div
      className={'chat-message ' + message.role}
      data-message-id={message.id}
    >
      {message.role === 'character' && (
        <img className="chat-message-avatar" src={image} alt="" />
      )}
      <div
        className="chat-message-content"
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu(true)
        }}
        onPointerDown={(e) => {
          if (
            e.pointerType === 'mouse' ||
            e.target.closest('button,audio,a,summary')
          )
            return
          origin.current = [e.clientX, e.clientY]
          press.current = setTimeout(() => setMenu(true), 450)
        }}
        onPointerMove={(e) => {
          if (
            origin.current &&
            Math.hypot(
              e.clientX - origin.current[0],
              e.clientY - origin.current[1],
            ) > 10
          )
            clearTimeout(press.current)
        }}
        onPointerUp={() => clearTimeout(press.current)}
        onPointerCancel={() => clearTimeout(press.current)}
      >
        {message.replyTo && (
          <blockquote className="chat-reply-preview">
            {!quoted || quoted.deleted
              ? 'Mensagem apagada'
              : quoted.audio
                ? 'Mensagem de áudio'
                : quoted.text}
          </blockquote>
        )}
        {message.deleted ? (
          <p className="chat-deleted">Mensagem apagada</p>
        ) : (
          <>
            {(!message.audio || message.role === 'character') && (
              <p>{message.text}</p>
            )}
            {message.media?.src && (
              <figure className="chat-inline-image">
                <a
                  href={message.media.src}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Abrir imagem"
                >
                  <img
                    src={message.media.src}
                    alt="Imagem solicitada na conversa"
                  />
                </a>
                <figcaption>Imagem gerada</figcaption>
              </figure>
            )}
            {(message.audio ||
              (message.role === 'character' && message.id)) && (
              <AudioMessage
                message={message}
                selection={selection}
                onChanged={onChanged}
              />
            )}
          </>
        )}
        <span className="chat-message-meta">
          {message.role === 'character' ? name : 'Você'} ·{' '}
          <time dateTime={message.sentAt || undefined}>
            {clock(message.sentAt) || 'Horário não registrado'}
          </time>
          {message.role === 'user' && (
            <span title={state} aria-label={state}>
              {message.localState === 'failed' ? (
                <AlertCircle size={14} />
              ) : message.localState === 'sending' ? (
                <Clock3 size={14} />
              ) : message.viewedAt ? (
                <CheckCheck className="chat-viewed" size={14} />
              ) : message.sentAt ? (
                <Check size={14} />
              ) : null}
            </span>
          )}
          <button
            ref={triggerRef}
            type="button"
            className="chat-message-menu-trigger"
            aria-label="Ações da mensagem"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={17} />
          </button>
        </span>
        {message.localState === 'failed' && (
          <button type="button" onClick={() => onRetry(message.id)}>
            Tentar enviar novamente
          </button>
        )}
        {message.responseState === 'failed' && !message.deleted && (
          <div className="chat-response-error" role="alert">
            Não foi possível gerar a resposta. Sua mensagem está salva.{' '}
            <button type="button" onClick={() => onRetry(message.id)}>
              Tentar gerar novamente
            </button>
          </div>
        )}
        {notice && <small role="status">{notice}</small>}
        {menu && (
          <div
            className="chat-message-actions"
            ref={menuRef}
            role="group"
            aria-label="Ações da mensagem"
          >
            {!message.deleted && (
              <button
                type="button"
                onClick={() => {
                  onReply(message)
                  setMenu(false)
                }}
              >
                Responder
              </button>
            )}
            {!message.deleted && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(message.text)
                    setNotice('Texto copiado')
                  } catch {
                    setNotice('Não foi possível copiar o texto')
                  }
                  setMenu(false)
                }}
              >
                Copiar texto
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMenu(false)
                setInfo(true)
              }}
            >
              Informações
            </button>
            {!message.deleted && (
              <button
                type="button"
                onClick={async () => {
                  setMenu(false)
                  try {
                    await onDelete(message.id)
                    setNotice(
                      'Mensagem apagada. A resposta já recebida permanece no histórico.',
                    )
                  } catch (e) {
                    setNotice(e.message || 'Não foi possível apagar')
                  }
                }}
              >
                Apagar mensagem
              </button>
            )}
            <button type="button" onClick={() => setMenu(false)}>
              Fechar
            </button>
          </div>
        )}
      </div>
      {info && (
        <div
          className="chat-message-info-backdrop"
          onClick={() => setInfo(false)}
        >
          <section
            ref={infoRef}
            role="dialog"
            aria-modal="true"
            aria-label="Informações da mensagem"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Fechar informações"
              onClick={() => setInfo(false)}
            >
              <X size={20} />
            </button>
            <h3>Informações da mensagem</h3>
            <dl>
              <dt>Estado</dt>
              <dd>{state}</dd>
              <dt>Envio confirmado pelo servidor</dt>
              <dd>{fullTime(message.sentAt)}</dd>
              <dt>Encaminhada para processamento</dt>
              <dd>{fullTime(message.viewedAt)}</dd>
              <dt>Fuso exibido</dt>
              <dd>{Intl.DateTimeFormat().resolvedOptions().timeZone}</dd>
              {(message.localState === 'failed' || message.responseError) && (
                <>
                  <dt>Erro</dt>
                  <dd>{message.responseError || 'Envio não confirmado'}</dd>
                </>
              )}
            </dl>
            <p>
              “Visualizada” significa recebida para processamento pela
              personagem de IA. Nenhuma pessoa humana abriu a conversa.
            </p>
            <p>
              Apagar remove o conteúdo ativo, o áudio e a transcrição. A
              resposta recebida permanece. Backups e dados já enviados ao
              provedor podem seguir seus próprios prazos de retenção.
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
