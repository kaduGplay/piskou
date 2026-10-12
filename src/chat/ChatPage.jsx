import { chatTimeline } from '../shared/chatTimeline.js'
import { createChatClient } from '../shared/chatClient.js'
import ChatMessage from './ChatMessage.jsx'
import AudioMessage from './AudioMessage.jsx'
import ChatRecorder from './ChatRecorder.jsx'
import { sendAnalytics } from '../shared/analytics.js'
import { CHARACTER_TASTES } from '../shared/characterTastes.js'
import { currentPreferences } from '../shared/conversationPreferences.js'
import ChatMemoryPanel from './ChatMemoryPanel.jsx'
import { mediaOfferMessage } from '../shared/mediaOffer.js'
import {
  readSavedSelection,
  readProgress,
  saveProgress,
} from '../shared/progress.js'
import { analyticsIdentity } from '../shared/analytics.js'
import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  ArrowLeft,
  ChevronRight,
  Heart,
  Image as ImageIcon,
  LockKeyhole,
  MessageCircle,
  Play,
  Phone,
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

function readSelection() {
  try {
    return {
      ...DEFAULT_SELECTION,
      ...readSavedSelection(),
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
  const [bannerVisible, setBannerVisible] = useState(true)
  const [loading, setLoading] = useState(true)
  const [remaining, setRemaining] = useState(0)
  const [requiresPayment, setRequiresPayment] = useState(false)
  const [hasPaidAccess, setHasPaidAccess] = useState(false)
  const [chatError, setChatError] = useState('')
  const [draft, setDraft] = useState(() =>
    String(readProgress().draft || '').slice(0, 500),
  )
  useEffect(() => {
    saveProgress({ draft })
  }, [draft])
  const [recordingAudio, setRecordingAudio] = useState(false)
  const [typing, setTyping] = useState(false)
  const [rhythmVariant, setRhythmVariant] = useState(null)
  const [replyTo, setReplyTo] = useState(null)
  const [hasNewMessages, setHasNewMessages] = useState(false)
  const nearBottom = useRef(true)
  const scrollAnchor = useRef(null)
  const previousLength = useRef(0)
  const clientRef = useRef(null)
  const accessRef = useRef(null)
  const [paywallReached, setPaywallReached] = useState(
    () =>
      readProgress().chatSelection === JSON.stringify(sel) &&
      readProgress().paywallReached === true,
  )
  const [profileOpen, setProfileOpen] = useState(false)
  const [offerOpen, setOfferOpen] = useState(false)
  const [callOffer, setCallOffer] = useState(null)
  const [mediaRequests, setMediaRequests] = useState(() => {
    const saved = readProgress()
    return saved.chatSelection === JSON.stringify(sel) &&
      Array.isArray(saved.mediaRequests)
      ? saved.mediaRequests
          .slice(-30)
          .filter((item) => ['photo', 'video', 'audio'].includes(item.kind))
          .map((item) => ({ ...item, phase: 'media' }))
      : []
  })
  useEffect(() => {
    saveProgress({
      chatSelection: JSON.stringify(sel),
      paywallReached,
      mediaRequests: mediaRequests.slice(-30),
    })
  }, [sel, paywallReached, mediaRequests])
  const mediaTimers = useRef([])
  const mediaBusy = useRef(false)
  const appRef = useRef(null)
  const messagesRef = useRef(null)
  const profileRef = useRef(null)
  const profileTrigger = useRef(null)
  const mediaPending = mediaRequests.some((item) => item.phase !== 'media')
  const sent = messages.filter((m) => m.role === 'user').length
  const locked = remaining !== null && remaining <= 0
  const dateLabel = (message) =>
    message?.sentAt
      ? new Date(message.sentAt).toLocaleDateString('pt-BR')
      : message?.localState
        ? 'Envio aguardando confirmação'
        : 'Histórico anterior · data não registrada'

  useEffect(() => {
    const timer = setTimeout(() => setBannerVisible(false), 4_000)
    return () => clearTimeout(timer)
  }, [])

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
      const nearBottom =
        !list || list.scrollHeight - list.scrollTop - list.clientHeight < 80
      fullHeight = Math.max(fullHeight, height)
      const focused =
        appRef.current?.contains(document.activeElement) &&
        document.activeElement?.matches('input, textarea')
      appRef.current?.style.setProperty('--chat-viewport-height', `${height}px`)
      appRef.current?.style.setProperty(
        '--chat-viewport-top',
        `${viewport?.offsetTop || 0}px`,
      )
      appRef.current?.classList.toggle(
        'keyboard-open',
        Boolean(focused && fullHeight - height > 120),
      )
      // Scroll only the message list, never the document or its ancestors.
      if (list && height !== previousHeight && nearBottom)
        list.scrollTop = list.scrollHeight
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
    window.addEventListener('focus', schedule)
    window.addEventListener('pageshow', schedule)
    document.addEventListener('visibilitychange', schedule)
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    return () => {
      cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('focus', schedule)
      window.removeEventListener('pageshow', schedule)
      document.removeEventListener('visibilitychange', schedule)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
      document.body.classList.remove('chat-page')
    }
  }, [])

  useEffect(() => {
    let alive = true
    const client = createChatClient({
      selection: sel,
      onSnapshot: (data) => {
        if (!alive) return
        const list = messagesRef.current
        if (list && !nearBottom.current) {
          const top = list.getBoundingClientRect().top
          const anchor = [...list.querySelectorAll('[data-message-id]')].find(
            (node) => node.getBoundingClientRect().bottom > top,
          )
          scrollAnchor.current = anchor
            ? {
                id: anchor.dataset.messageId,
                offset: anchor.getBoundingClientRect().top - top,
              }
            : null
        }
        setMessages(data.messages || [])
        setMediaRequests((items) => items.map((item) =>
          item.afterMessageId === undefined
            ? { ...item, afterMessageId: data.messages?.at(-1)?.id || null }
            : item,
        ))
        if (data.remaining !== undefined) setRemaining(data.remaining)
        setTyping(data.preparing === true)
        if (data.requiresPayment !== undefined) {
          if (data.requiresPayment && !accessRef.current?.requiresPayment)
            setOfferOpen(true)
          if (
            !data.requiresPayment &&
            (data.remaining === null || data.remaining > 0) &&
            accessRef.current?.remaining === 0
          ) {
            setPaywallReached(false)
            setOfferOpen(false)
          }
          setRequiresPayment(data.requiresPayment === true)
          setHasPaidAccess(data.hasPaidAccess === true)
          accessRef.current = data
        }
      },
      onError: (message) => {
        if (alive) setChatError(message)
      },
      onResponse: (data) => {
        if (!alive) return
        window.dispatchEvent(new Event('piskou:memory-updated'))
        track('ChatRespostaRecebida')
        setRhythmVariant('grouped')
        const last = data.messages.filter((m) => m.role === 'character').at(-1)
        if (['photo', 'video', 'audio'].includes(last?.mediaRequest))
          requestMedia(last.mediaRequest, true, last.id)
      },
    })
    clientRef.current = client
    client
      .start()
      .catch((error) => {
        if (alive) setChatError(error.message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
      client.dispose()
      clientRef.current = null
      mediaTimers.current.forEach(clearTimeout)
    }
  }, [sel])
  useLayoutEffect(() => {
    const list = messagesRef.current
    if (!list) return
    if (nearBottom.current)
      list.scrollTo({ top: list.scrollHeight, behavior: 'auto' })
    else {
      const anchor = scrollAnchor.current
      const node =
        anchor &&
        [...list.querySelectorAll('[data-message-id]')].find(
          (n) => n.dataset.messageId === anchor.id,
        )
      if (node)
        list.scrollTop +=
          node.getBoundingClientRect().top -
          list.getBoundingClientRect().top -
          anchor.offset
      if (messages.length > previousLength.current) setHasNewMessages(true)
    }
    previousLength.current = messages.length
    scrollAnchor.current = null
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

  const openOffer = (callKind = null) => {
    setCallOffer(typeof callKind === 'string' ? callKind : null)
    if (document.activeElement?.matches('input, textarea'))
      document.activeElement.blur()
    setProfileOpen(false)
    setOfferOpen(true)
  }
  const logChatAction = (kind, text, eventId = crypto.randomUUID()) => {
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'log',
        selection: sel,
        analyticsSession: analyticsIdentity().session,
        eventId,
        kind,
        text,
      }),
      keepalive: true,
    }).catch(() => {})
  }
  const requestMedia = (kind, fromChat = false, afterMessageId = messages.at(-1)?.id || null) => {
    if ((!fromChat && (loading || typing)) || mediaBusy.current) return
    setProfileOpen(false)
    const id = crypto.randomUUID()
    if (!fromChat)
      logChatAction(
        kind,
        kind === 'video' ? 'Me manda um vídeo?' : 'Me manda uma foto sua?',
        id,
      )
    setMediaRequests((previous) => {
      if (fromChat && previous.some((item) =>
        item.fromChat && item.afterMessageId === afterMessageId && item.kind === kind,
      )) return previous
      return [...previous, { id, kind, fromChat, afterMessageId, phase: 'media' }]
    })
    if (kind !== 'audio') track(kind === 'video' ? 'ChatVideoSolicitado' : 'ChatFotoSolicitada', {
      visual_style: sel.style,
    })
  }
  const requestPhoto = () => send('Me manda uma foto sua?')
  const requestVideo = () => send('Me manda um vídeo?')
  const send = (text = draft, recording) => {
    const content = text.trim().slice(0, 500)
    if (loading || !content || !clientRef.current) return
    if (locked) {
      openOffer()
      return
    }
    setChatError('')
    const id = clientRef.current.send(content, {
      replyTo: replyTo?.id,
      recording,
    })
    if (!id) return
    setDraft('')
    setReplyTo(null)
    nearBottom.current = true
    track('ChatMensagemEnviada', {
      message_number: sent + 1,
      visual_style: sel.style,
    })
  }

  const renderMediaRequest = (item) => (
            <div className="chat-media-request" key={item.id}>
              {!item.fromChat && (
                <div className="chat-message user">
                  <div className="chat-bubble">
                    <p>
                      {item.kind === 'video'
                        ? 'Me manda um vídeo? 💕'
                        : 'Me manda uma foto sua? 💕'}
                    </p>
                    <span>Solicitação de mídia</span>
                  </div>
                </div>
              )}
              {!item.fromChat && (
                <div className="chat-message character">
                  <img className="chat-message-avatar" src={image} alt="" />
                  <div className="chat-bubble">
                    <p>
                      {mediaOfferMessage(
                        sel,
                        item.kind,
                        currentPreferences(messages, ''),
                      )}
                    </p>
                    <span>{name}</span>
                  </div>
                </div>
              )}
              {item.phase !== 'typing' && (
                <div className="chat-locked-wrap">
                  <div className="chat-continue-notice">
                    <LockKeyhole size={19} />
                    <div>
                      <strong>
                        {item.kind === 'video'
                          ? 'Vídeos no plano Luxo'
                          : item.kind === 'audio' ? 'Áudios · Premium e Luxo' : 'Fotos nos planos Premium e Luxo'}
                      </strong>
                      <p>
                        Conheça os recursos e escolha o plano que combina com
                        você.
                      </p>
                      <button
                        type="button"
                        className="chat-continue-button"
                        onClick={openOffer}
                      >
                        Ver planos <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
  )

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
        <p className="chat-processing-explanation">
          Personagem de IA · Disponível para conversar. “Visualizada” significa
          incluída no processamento pela IA.
        </p>
        <h3>Do seu jeito</h3>
        <p>
          Você escolheu cada detalhe. Agora conheça {name} em uma nova conversa.
        </p>
        <dl>
          {[
            ['Estilo', sel.style === 'anime' ? 'Anime' : 'Realista'],
            [
              'Personalidade',
              [
                sel.personality,
                sel.secondaryPersonality !== 'Nenhum' &&
                  sel.secondaryPersonality,
              ]
                .filter(Boolean)
                .join(' · '),
            ],
            ...Object.entries(CHAT_PREFERENCES).map(([key, setting]) => [
              setting.title,
              sel[key],
            ]),
            ...Object.entries(CHARACTER_TASTES).map(([key, setting]) => [
              setting.title,
              sel[key] || 'Pelo perfil',
            ]),
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
        {sent < 2 && <><button
          type="button"
          className="chat-primary"
          disabled={loading || typing || mediaPending}
          onClick={requestVideo}
        >
          <Video size={17} /> Pedir um vídeo
        </button>
        <button
          type="button"
          className="chat-primary"
          disabled={loading || typing || mediaPending}
          onClick={requestPhoto}
        >
          <ImageIcon size={17} /> Pedir uma foto
        </button></>}
        {!loading && <ChatMemoryPanel selection={sel} />}
        {sent < 2 && <p className="chat-profile-note">
          Fotos disponíveis a partir do Premium.
        </p>}
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
            href="/messages"
            aria-label="Voltar às mensagens"
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
              <small>
                {loading
                  ? 'Carregando conversa…'
                  : 'Disponível para conversar · IA'}
              </small>
            </span>
            <ChevronRight size={17} />
          </button>
          <div className="chat-call-actions" aria-label="Chamadas">
            <button type="button" className="chat-icon-button" aria-label="Ligação de voz" title="Ligação de voz" onClick={() => openOffer('voice-call')}><Phone size={20} /></button>
            <button type="button" className="chat-icon-button" aria-label="Videochamada" title="Videochamada" onClick={() => openOffer('video-call')}><Video size={21} /></button>
          </div>
          <button
            type="button"
            className="chat-icon-button"
            onClick={() => setProfileOpen(true)}
            aria-label="Abrir características"
          >
            <UserRound size={21} />
          </button>
        </header>
        {bannerVisible && (
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
        )}
        <div
          className="chat-messages"
          ref={messagesRef}
          onScroll={() => {
            const list = messagesRef.current
            nearBottom.current =
              list.scrollHeight - list.scrollTop - list.clientHeight < 80
            if (nearBottom.current) setHasNewMessages(false)
          }}
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
              {messages.length
                ? `Você e ${name}`
                : `Que tal mandar um oi para ${name}?`}
            </h1>
            <p>
              {messages.length
                ? 'Toda conexão começa com uma conversa.'
                : remaining === null
                  ? 'Converse do seu jeito. Suas mensagens por texto são ilimitadas nesta conversa.'
                  : `Escolha uma sugestão ou escreva do seu jeito. Você tem ${remaining} mensagens disponíveis nesta conversa.`}
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
          {chatTimeline(messages, mediaRequests).map((entry) => {
            if (entry.type === 'media') return renderMediaRequest(entry.item)
            const { message, index: i } = entry
            const date = dateLabel(message)
            const previousDate = dateLabel(messages[i - 1])
            return (
              <Fragment key={message.id || `legacy-${i}`}>
                {(i === 0 || date !== previousDate) && (
                  <div className="chat-day">
                    <span>
                      {date === new Date().toLocaleDateString('pt-BR')
                        ? 'Hoje'
                        : date}
                    </span>
                  </div>
                )}
                <ChatMessage
                  message={message}
                  messages={messages}
                  name={name}
                  image={image}
                  selection={sel}
                  onReply={setReplyTo}
                  onDelete={(id) => clientRef.current.remove(id)}
                  onRetry={(id) =>
                    clientRef.current
                      .retry(id)
                      .catch((e) => setChatError(e.message))
                  }
                  onChanged={() => clientRef.current?.sync()}
                />
                {message.role === 'character' && !message.deleted && message.mediaRequest === 'audio-reply' && <div className="chat-message character chat-voice-message" data-voice-message-id={message.id}>
                  <img className="chat-message-avatar" src={image} alt="" />
                  <div className="chat-bubble"><AudioMessage message={message} selection={sel} onChanged={() => clientRef.current?.sync()} /><span className="chat-message-meta">{name} · Voz gerada por IA</span></div>
                </div>}
              </Fragment>
            )
          })}
          {typing && (
            <div className="chat-message character">
              <img className="chat-message-avatar" src={image} alt="" />
              <div
                className="chat-typing"
                role="status"
                aria-label="Preparando resposta"
              >
                <span className="chat-sent-status">Preparando resposta</span>
                <i aria-hidden="true" />
                <i aria-hidden="true" />
                <i aria-hidden="true" />
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
                    <p>
                      Para continuar conversando com {name}, escolha seu plano.
                    </p>
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

        </div>
        <footer className="chat-composer">
          {chatError && (
            <p className="chat-error" role="alert">
              {chatError}
            </p>
          )}
          {loading && <p role="status">Abrindo sua conversa…</p>}
          {sent < 2 && <div className="chat-suggestions">
            {(sent === 0
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
              disabled={loading || typing || mediaPending}
              onClick={requestVideo}
            >
              <Video size={13} /> Pedir um vídeo
            </button>
            <button
              type="button"
              className="chat-photo-request"
              disabled={loading || typing || mediaPending}
              onClick={requestPhoto}
            >
              <ImageIcon size={13} /> Pedir uma foto
            </button>
          </div>}
          {hasNewMessages && (
            <button
              className="chat-new-messages"
              type="button"
              onClick={() => {
                nearBottom.current = true
                setHasNewMessages(false)
                messagesRef.current?.scrollTo({
                  top: messagesRef.current.scrollHeight,
                  behavior: 'smooth',
                })
              }}
            >
              Ver mensagens novas ↓
            </button>
          )}
          {replyTo && (
            <div className="chat-composer-reply">
              <span>
                Respondendo a:{' '}
                {!messages.find((m) => m.id === replyTo.id) ||
                messages.find((m) => m.id === replyTo.id)?.deleted
                  ? 'Mensagem apagada'
                  : replyTo.audio
                    ? 'Mensagem de áudio'
                    : messages.find((m) => m.id === replyTo.id)?.text}
              </span>
              <button
                type="button"
                aria-label="Cancelar resposta à mensagem"
                onClick={() => setReplyTo(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <form
            className={recordingAudio ? 'is-recording' : ''}
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
            <ChatRecorder
              disabled={loading || paywallReached}
              onRecordingChange={setRecordingAudio}
              onRecorded={(recording) => send('Mensagem de áudio', recording)}
            />
            <button
              type={paywallReached ? 'button' : 'submit'}
              onPointerDown={(event) => {
                // Keep the keyboard open when sending a message.
                if (!paywallReached) event.preventDefault()
              }}
              onClick={paywallReached ? openOffer : undefined}
              disabled={
                !paywallReached && (loading || mediaPending || !draft.trim())
              }
              aria-label={
                paywallReached ? 'Desbloquear conversa' : 'Enviar mensagem'
              }
            >
              {paywallReached ? <LockKeyhole size={19} /> : <Send size={19} />}
            </button>
          </form>
          {rhythmVariant && !typing && (
            <div
              className="chat-rhythm-feedback"
              aria-label="Avaliação do ritmo"
            >
              <span>Como está o ritmo?</span>
              {['Rápido', 'Adequado', 'Lento'].map((label, index) => (
                <button
                  type="button"
                  key={label}
                  onClick={() => {
                    sendAnalytics(`ChatRhythm_${rhythmVariant}_rating`, {
                      rhythm_step: ['fast', 'okay', 'slow'][index],
                    })
                    setRhythmVariant(null)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <p>
            <Sparkles size={11} /> Personagem virtual · Respostas por IA · 18+
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
          <PaywallSheet
            source={callOffer || (
              locked && !requiresPayment
                ? hasPaidAccess
                  ? 'messages'
                  : 'trial'
                : 'chat'
            )}
            sel={sel}
            onClose={() => { setOfferOpen(false); setCallOffer(null) }}
          />
        </Suspense>
      )}
    </div>
  )
}
