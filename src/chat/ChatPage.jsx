import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  CheckCheck,
  ChevronRight,
  Heart,
  LockKeyhole,
  MessageCircle,
  Play,
  Video,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import {
  DEFAULT_SELECTION,
  CHAT_PREFERENCES,
  CHAT_PREVIEW_LIMIT,
  EVENTS,
  getResultImage,
  track,
} from '../funnel/data.js'
import { PLANS, SELECTION_STORAGE_KEY, formatBRL } from '../shared/checkout.js'
import './ChatPage.css'

const PaywallSheet = lazy(() => import('../funnel/PaywallSheet.jsx'))
const FREE_MESSAGES = CHAT_PREVIEW_LIMIT
const UPGRADE_DELAY_MS = 2_000

function mediaPreviewMessage(selection, kind) {
  const media = kind === 'video' ? 'do vídeo' : 'da foto'
  const affectionate = selection.relationship !== 'Confidente' && selection.affection !== 'Discreta'
  const address = affectionate ? ', amor' : ''
  if (selection.speechStyle === 'Direta' || selection.humor === 'Mais séria') return `Aqui está a prévia ${media}${address}.`
  if (selection.speechStyle === 'Bem-humorada' || selection.personality === 'Divertida')
    return `Bateu a curiosidade${address}? Dá uma olhada nesta prévia 💕`
  if (selection.socialEnergy === 'Reservada' || selection.personality === 'Reservada' || selection.speechStyle === 'Delicada')
    return `Aqui vai uma pequena prévia${address}. Espero que goste 💕`
  if (selection.socialEnergy === 'Extrovertida' || selection.personality === 'Confiante')
    return `Olha só esta prévia${address}! Quero saber o que achou 💕`
  return `Aqui está uma prévia para você${address} 💕`
}

function readSelection() {
  try {
    return {
      ...DEFAULT_SELECTION,
      ...JSON.parse(sessionStorage.getItem(SELECTION_STORAGE_KEY) || 'null'),
    }
  } catch {
    return DEFAULT_SELECTION
  }
}

export default function ChatPage() {
  const [sel] = useState(readSelection)
  const image = getResultImage(sel).src
  const name = sel.name || 'Sua personagem'
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [chatError, setChatError] = useState('')
  const [draft, setDraft] = useState('')
  const [typing, setTyping] = useState(false)
  const [paywallReached, setPaywallReached] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [offerOpen, setOfferOpen] = useState(false)
  const [mediaRequests, setMediaRequests] = useState([])
  const mediaTimers = useRef([])
  const mediaBusy = useRef(false)
  const appRef = useRef(null)
  const messagesRef = useRef(null)
  const requestRef = useRef(null)
  const sendGuard = useRef(false)
  const upgradeTimer = useRef(null)
  const profileRef = useRef(null)
  const profileTrigger = useRef(null)
  const mediaPending = mediaRequests.some(item => item.phase !== 'media')
  const sent = messages.filter((m) => m.role === 'user').length
  const locked =
    messages.filter((m) => m.role === 'character').length >= FREE_MESSAGES

  useEffect(() => {
    const viewport = window.visualViewport
    document.body.classList.add('chat-page')
    let frame = 0
    let previousHeight = viewport?.height || window.innerHeight
    let fullHeight = previousHeight
    const syncViewport = () => {
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return
      const height = viewport?.height || window.innerHeight
      const list = messagesRef.current
      const nearBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 80
      fullHeight = Math.max(fullHeight, height)
      const focused = appRef.current?.contains(document.activeElement) &&
        document.activeElement?.matches('input, textarea')
      appRef.current?.style.setProperty('--chat-viewport-height', `${height}px`)
      appRef.current?.style.setProperty('--chat-viewport-top', `${viewport?.offsetTop || 0}px`)
      appRef.current?.classList.toggle('keyboard-open', Boolean(focused && fullHeight - height > 120))
      // Scroll only the message list, never the document or its ancestors.
      if (list && height !== previousHeight && nearBottom) list.scrollTop = list.scrollHeight
      previousHeight = height
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(syncViewport)
    }
    syncViewport()
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    return () => {
      cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
      document.body.classList.remove('chat-page')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/chat?selection=${encodeURIComponent(JSON.stringify(sel))}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        setMessages(data.messages || [])
      })
      .catch((error) => {
        if (error.name !== 'AbortError')
          setChatError(error.message || 'Não foi possível abrir a conversa.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      controller.abort()
      requestRef.current?.abort()
      clearTimeout(upgradeTimer.current)
      mediaTimers.current.forEach(clearTimeout)
    }
  }, [sel])
  useEffect(() => {
    const list = messagesRef.current
    list?.scrollTo({ top: list.scrollHeight, behavior: typing ? 'auto' : 'smooth' })
  }, [messages, typing, mediaRequests, paywallReached])
  useEffect(() => {
    if (!profileOpen) return
    const previous = document.activeElement
    profileRef.current?.querySelector('button')?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape') setProfileOpen(false)
      if (event.key !== 'Tab') return
      const items = profileRef.current?.querySelectorAll('button, a[href]')
      if (!items?.length) return
      const first = items[0],
        last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [profileOpen])

  const openOffer = () => {
    track(EVENTS.OFFER_VIEW, { visual_style: sel.style, source: 'chat' })
    if (document.activeElement?.matches('input, textarea')) document.activeElement.blur()
    setProfileOpen(false)
    setOfferOpen(true)
  }
  const requestMedia = (kind) => {
    if (loading || typing || mediaBusy.current) return
    setProfileOpen(false)
    mediaBusy.current = true
    const id = crypto.randomUUID()
    setMediaRequests(previous => [...previous, { id, kind, phase: 'typing' }])
    track(kind === 'video' ? 'ChatVideoSolicitado' : 'ChatFotoSolicitada', { visual_style: sel.style })
    const advance = (phase) => setMediaRequests(previous => previous.map(item => item.id === id ? { ...item, phase } : item))
    mediaTimers.current.push(setTimeout(() => advance('reply'), 3000))
    mediaTimers.current.push(setTimeout(() => {
      advance('media')
      mediaBusy.current = false
    }, 5000))
  }
  const requestPhoto = () => requestMedia('photo')
  const requestVideo = () => requestMedia('video')
  const send = async (text = draft) => {
    const content = text.trim().slice(0, 500)
    if (loading || typing || sendGuard.current || mediaBusy.current) return
    if (!content) return
    if (locked) {
      if (paywallReached) return openOffer()
      sendGuard.current = true
      setMessages((previous) => [...previous, { role: 'user', text: content }])
      setDraft('')
      setChatError('')
      setTyping(true)
      upgradeTimer.current = setTimeout(() => {
        setTyping(false)
        sendGuard.current = false
        setPaywallReached(true)
      }, UPGRADE_DELAY_MS)
      return
    }
    sendGuard.current = true
    setMessages((prev) => [...prev, { role: 'user', text: content }])
    setDraft('')
    setTyping(true)
    track('ChatMensagemEnviada', {
      message_number: sent + 1,
      visual_style: sel.style,
    })
    setChatError('')
    const previous = messages
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, selection: sel }),
        signal: controller.signal,
      })
      const data = await response.json()
      if (!response.ok) {
        if (data.locked && data.messages) {
          setMessages(data.messages)
          setPaywallReached(true)
          openOffer()
          return
        }
        throw new Error(data.error || 'Não foi possível receber a resposta.')
      }
      setMessages(data.messages)
    } catch (error) {
      if (error.name !== 'AbortError') {
        setMessages(previous)
        setDraft(content)
        setChatError(error.message || 'Tente novamente em instantes.')
      }
    } finally {
      setTyping(false)
      sendGuard.current = false
    }
  }

  const profile = (
    <>
      <div className="chat-profile-photo">
        <img src={image} alt={`Retrato de ${name}`} />
        <div>
          <span>
            <Sparkles size={13} /> Personagem virtual
          </span>
          <h2>
            {name}, {sel.age}
          </h2>
        </div>
      </div>
      <div className="chat-profile-details">
        <h3>Do seu jeito</h3>
        <p>
          Você escolheu cada detalhe. Agora conheça {name} em uma nova conversa.
        </p>
        <dl>
          {[
            ['Estilo', sel.style === 'anime' ? 'Anime' : 'Realista'],
            ['Personalidade', sel.personality],
            ...Object.entries(CHAT_PREFERENCES).map(([key, setting]) => [setting.title, sel[key]]),
            ['Relacionamento', sel.relationship],
            ['Profissão', sel.occupation],
            ['Cabelo', `${sel.hairColor} · ${sel.hairStyle}`],
            ['Corpo', sel.bodyType],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="chat-primary" disabled={loading || typing || mediaPending} onClick={requestPhoto}>
          <LockKeyhole size={17} /> Pedir uma foto · Premium
        </button>
        <button type="button" className="chat-primary" disabled={loading || typing || mediaPending} onClick={requestVideo}>
          <Video size={17} /> Pedir um vídeo · Prévia
        </button>
        <p className="chat-profile-note">
          Fotos disponíveis a partir do Premium.
        </p>
      </div>
    </>
  )

  return (
    <div className="chat-app" ref={appRef}>
      <aside
        className="chat-sidebar"
        aria-label="Conversas"
        inert={profileOpen || offerOpen ? true : undefined}
      >
        <a className="chat-wordmark" href="/">
          PISKOU<span>YOUR OWN CONNECTION</span>
        </a>
        <div className="chat-sidebar-title">
          <MessageCircle size={18} /> Suas conversas
        </div>
        <button
          type="button"
          className="chat-conversation"
          onClick={() => profileTrigger.current?.focus()}
        >
          <img src={image} alt="" />
          <span>
            <strong>{name}</strong>
            <small>Sua personagem, sua história</small>
          </span>
          <i />
        </button>
        <div className="chat-sidebar-bottom">
          <ShieldCheck size={17} />
          <span>
            Um espaço só seu<small>Personagens virtuais · 18+</small>
          </span>
        </div>
      </aside>
      <main
        className="chat-main"
        inert={profileOpen || offerOpen ? true : undefined}
      >
        <header className="chat-header">
          <a
            className="chat-icon-button"
            href={`/${window.location.search}`}
            aria-label="Voltar ao criador"
          >
            <ArrowLeft size={21} />
          </a>
          <button
            type="button"
            className="chat-header-person"
            ref={profileTrigger}
            onClick={() => setProfileOpen(true)}
            aria-label={`Ver perfil de ${name}`}
          >
            <span className="chat-avatar">
              <img src={image} alt="" />
              <i />
            </span>
            <span>
              <strong>{name}</strong>
              <small>Personagem virtual · respostas por IA</small>
            </span>
            <ChevronRight size={17} />
          </button>
          <button
            type="button"
            className="chat-icon-button"
            onClick={() => setProfileOpen(true)}
            aria-label="Abrir características"
          >
            <UserRound size={21} />
          </button>
        </header>
        <div className="chat-upgrade">
          <span className="chat-upgrade-heart">
            <Heart size={20} fill="currentColor" />
          </span>
          <span>
            <strong>Sua conexão começa aqui</strong>
            <small>
              Conheça os planos a partir de{' '}
              {formatBRL(PLANS['premium-access'].price)}
            </small>
          </span>
          <button type="button" onClick={openOffer}>
            Ver planos <ChevronRight size={14} />
          </button>
        </div>
        <div
          className="chat-messages"
          ref={messagesRef}
          role="log"
          aria-label={`Conversa com ${name}`}
          aria-live="polite"
        >
          <div className={`chat-intro${messages.length ? ' compact' : ''}`}>
            <button
              type="button"
              className="chat-intro-photo"
              onClick={() => setProfileOpen(true)}
              aria-label={`Ampliar foto de ${name}`}
            >
              <img src={image} alt={name} />
              <span>
                <Heart size={15} fill="currentColor" />
              </span>
            </button>
            <span className="chat-eyebrow">FEITA DO SEU JEITO</span>
            <h1>
              {messages.length ? `Você e ${name}` : `Que tal mandar um oi para ${name}?`}
            </h1>
            <p>
              {messages.length
                ? 'Toda conexão começa com uma conversa.'
                : `Escolha uma sugestão ou escreva do seu jeito. Você tem ${FREE_MESSAGES} mensagens gratuitas para conhecer sua personagem.`}
            </p>
            {!messages.length && (
              <button
                type="button"
                className="chat-start"
                disabled={loading || typing || mediaPending}
                onClick={() => send('Oi! 💕')}
              >
                <MessageCircle size={17} /> Mandar um oi 💕
              </button>
            )}
          </div>
          {!!messages.length && (
            <div className="chat-day">
              <span>Hoje</span>
            </div>
          )}
          {messages.map((message, i) => (
            <div key={i} className={`chat-message ${message.role}`}>
              {message.role === 'character' && (
                <img className="chat-message-avatar" src={image} alt="" />
              )}
              <div className="chat-bubble">
                <p>{message.text}</p>
                <span>
                  {message.role === 'character' ? name : 'Você'}{' '}
                  {message.role === 'user' && <CheckCheck size={13} />}
                </span>
              </div>
            </div>
          ))}
          {typing && (
            <div className="chat-message character">
              <img className="chat-message-avatar" src={image} alt="" />
              <div
                className="chat-typing"
                aria-label={`${name} está digitando`}
              >
                <i />
                <i />
                <i />
              </div>
            </div>
          )}
          {paywallReached && (
            <div className="chat-locked-wrap">
              {paywallReached && (
                <div className="chat-continue-notice">
                  <LockKeyhole size={19} />
                  <div>
                    <strong>Continue conversando com {name}</strong>
                    <p>Para continuar conversando com {name}, escolha seu plano.</p>
                    <button
                      type="button"
                      className="chat-continue-button"
                      onClick={openOffer}
                    >
                      Ver planos para continuar <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}

            </div>
          )}
          {mediaRequests.map(item => (
            <div className="chat-media-request" key={item.id}>
              <div className="chat-message user">
                <div className="chat-bubble">
                  <p>{item.kind === 'video' ? 'Quero ver uma prévia de vídeo 💕' : 'Quero ver uma prévia de foto 💕'}</p>
                  <span>Você <CheckCheck size={13} /></span>
                </div>
              </div>
              <div className="chat-message character">
                <img className="chat-message-avatar" src={image} alt="" />
                {item.phase === 'typing' ? (
                  <div className="chat-typing" aria-label={`${name} está digitando`}><i /><i /><i /></div>
                ) : (
                  <div className="chat-bubble">
                    <p>{mediaPreviewMessage(sel, item.kind)}</p>
                    <span>{name} · Prévia</span>
                  </div>
                )}
              </div>
              {item.phase === 'reply' && <p className="chat-media-loading" role="status">Carregando prévia…</p>}
              {item.phase === 'media' && (
                <div className="chat-locked-wrap">
                  <div className={`chat-locked-media${item.kind === 'video' ? ' chat-locked-video' : ''}`}>
                    <img src={image} alt={`Prévia ilustrativa ${item.kind === 'video' ? 'do vídeo' : 'da foto'} de ${name}`} />
                    <div className="chat-locked-copy">
                      <span className="chat-lock-circle">{item.kind === 'video' ? <Play size={24} fill="currentColor" /> : <LockKeyhole size={24} />}</span>
                      <span className="chat-eyebrow">PRÉVIA {item.kind === 'video' ? 'DE VÍDEO' : 'DA FOTO'} · BLOQUEADA</span>
                      <h2>Uma prévia de {name} para você</h2>
                      <p>{item.kind === 'video' ? 'Conheça os planos e os recursos de vídeo do Luxo.' : 'Conheça os planos e o recurso de fotos do Premium e Luxo.'}</p>
                      <button type="button" className="chat-primary" onClick={openOffer}>
                        <LockKeyhole size={16} /> Desbloquear · Ver planos
                      </button>
                      <small>Imagem ilustrativa da personagem · Nenhuma mídia nova gerada</small>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <footer className="chat-composer">
          {chatError && (
            <p className="chat-error" role="alert">
              {chatError}
            </p>
          )}
          {loading && <p role="status">Abrindo sua conversa…</p>}
          <div className="chat-suggestions">
            {!locked &&
              (sent === 0
                ? ['Oi! 💕', 'Olá! Como foi seu dia?', 'Quero te conhecer melhor']
                : ['Me conta mais sobre você', 'O que você gosta de fazer?']
              ).map((text) => (
                <button
                  type="button"
                  key={text}
                  onClick={() => send(text)}
                  disabled={loading || typing || mediaPending}
                >
                  {text}
                </button>
              ))}
            <button
              type="button"
              className="chat-photo-request"
              disabled={loading || typing || mediaPending} onClick={requestPhoto}
            >
              <LockKeyhole size={13} /> Pedir uma foto · Premium
            </button>
            <button type="button" className="chat-photo-request" disabled={loading || typing || mediaPending} onClick={requestVideo}>
              <Video size={13} /> Pedir um vídeo
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              send()
            }}
          >
            <input
              aria-label="Sua mensagem"
              type="text"
              lang="pt-BR"
              spellCheck={true}
              autoCorrect="on"
              autoCapitalize="sentences"
              enterKeyHint="send"
              placeholder={
                paywallReached
                  ? 'Desbloqueie para continuar a conversa…'
                  : `Escreva para ${name}…`
              }
              maxLength={500}
              value={draft}
              disabled={loading || paywallReached}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              type={paywallReached ? 'button' : 'submit'}
              onPointerDown={(event) => {
                // Keep the keyboard open when sending a message.
                if (!paywallReached) event.preventDefault()
              }}
              onClick={paywallReached ? openOffer : undefined}
              disabled={
                !paywallReached && (loading || typing || mediaPending || !draft.trim())
              }
              aria-label={paywallReached ? 'Desbloquear conversa' : 'Enviar mensagem'}
            >
              {paywallReached ? <LockKeyhole size={19} /> : <Send size={19} />}
            </button>
          </form>
          <p>
            <Sparkles size={11} /> Personagem virtual · Conversa com IA · 18+
          </p>
        </footer>
      </main>
      <aside
        className="chat-desktop-profile"
        aria-label="Perfil da personagem"
        inert={profileOpen || offerOpen ? true : undefined}
      >
        {profile}
      </aside>
      {profileOpen && (
        <div
          className="chat-profile-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setProfileOpen(false)
          }}
        >
          <section
            className="chat-profile-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Perfil de ${name}`}
            ref={profileRef}
          >
            <button
              type="button"
              className="chat-profile-close"
              onClick={() => setProfileOpen(false)}
              aria-label="Fechar perfil"
            >
              <X size={21} />
            </button>
            {profile}
          </section>
        </div>
      )}
      {offerOpen && (
        <Suspense
          fallback={
            <div className="chat-offer-loading" role="status">
              Carregando planos…
            </div>
          }
        >
          <PaywallSheet source="chat" sel={sel} onClose={() => setOfferOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
