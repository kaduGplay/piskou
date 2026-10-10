import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  CheckCheck,
  ChevronRight,
  Heart,
  LockKeyhole,
  MessageCircle,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import {
  DEFAULT_SELECTION,
  EVENTS,
  getResultImage,
  track,
} from '../funnel/data.js'
import { PLANS, SELECTION_STORAGE_KEY, formatBRL } from '../shared/checkout.js'
import './ChatPage.css'

const PaywallSheet = lazy(() => import('../funnel/PaywallSheet.jsx'))
const CHAT_KEY = 'piskou:chat-preview'

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
  const identity = JSON.stringify(sel)
  const [messages, setMessages] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(CHAT_KEY) || 'null')
      return saved?.identity === identity && Array.isArray(saved.messages)
        ? saved.messages.slice(
            0,
            Math.min(4, Math.floor(saved.messages.length / 2) * 2),
          )
        : []
    } catch {
      return []
    }
  })
  const [draft, setDraft] = useState('')
  const [typing, setTyping] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [offerOpen, setOfferOpen] = useState(false)
  const endRef = useRef(null)
  const timerRef = useRef(null)
  const sendGuard = useRef(false)
  const profileRef = useRef(null)
  const profileTrigger = useRef(null)
  const sent = messages.filter((m) => m.role === 'user').length
  const locked = messages.filter((m) => m.role === 'character').length >= 2

  useEffect(() => () => clearTimeout(timerRef.current), [])
  useEffect(() => {
    try {
      sessionStorage.setItem(CHAT_KEY, JSON.stringify({ identity, messages }))
    } catch {
      /* armazenamento opcional */
    }
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [identity, messages, typing])
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
    setProfileOpen(false)
    setOfferOpen(true)
  }
  const send = (text = draft) => {
    const content = text.trim().slice(0, 500)
    if (typing || sendGuard.current) return
    if (sent >= 2) return openOffer()
    if (!content) return
    sendGuard.current = true
    setMessages((prev) => [...prev, { role: 'user', text: content }])
    setDraft('')
    setTyping(true)
    track('ChatMensagemEnviada', {
      message_number: sent + 1,
      visual_style: sel.style,
    })
    timerRef.current = setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'character',
          text:
            sent === 0
              ? `Oi, amor! Que bom te conhecer 💕 Eu sou ${name}. Me conta: como foi seu dia?`
              : 'Adorei ter você por aqui 💕 Que tal conhecer um pouco mais de mim? Veja minha prévia abaixo.',
        },
      ])
      setTyping(false)
      sendGuard.current = false
    }, 1100)
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
        <button type="button" className="chat-primary" onClick={openOffer}>
          <LockKeyhole size={17} /> Pedir uma foto exclusiva
        </button>
        <p className="chat-profile-note">Disponível nos planos de acesso.</p>
      </div>
    </>
  )

  return (
    <div className="chat-app">
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
              <small>Personagem virtual · conversa de demonstração</small>
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
              {messages.length ? `Você e ${name}` : `Diga oi para ${name}`}
            </h1>
            <p>
              {messages.length
                ? 'Toda conexão começa com uma conversa.'
                : 'Ela tem o nome, o estilo e a personalidade que você escolheu. Sua história começa com um oi.'}
            </p>
            {!messages.length && (
              <button
                type="button"
                className="chat-start"
                onClick={() => send('Oi! Quero te conhecer 💕')}
              >
                <MessageCircle size={17} /> Começar uma conversa
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
          {locked && (
            <div className="chat-locked-wrap">
              <div className="chat-locked-media">
                <img src={image} alt="Prévia da foto bloqueada" />
                <div className="chat-locked-copy">
                  <span className="chat-lock-circle">
                    <LockKeyhole size={24} />
                  </span>
                  <span className="chat-eyebrow">PRÉVIA EXCLUSIVA</span>
                  <h2>Conheça mais de {name}</h2>
                  <p>
                    Escolha seu acesso para continuar a conversa e explorar o
                    conteúdo do seu plano.
                  </p>
                  <button
                    type="button"
                    className="chat-primary"
                    onClick={openOffer}
                  >
                    <LockKeyhole size={16} /> Desbloquear minha conexão
                  </button>
                  <small>Premium ou Luxo · Pagamento único</small>
                </div>
              </div>
              <p className="chat-locked-caption">
                <ShieldCheck size={13} /> Sem assinatura. Você escolhe como
                continuar.
              </p>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <footer className="chat-composer">
          <div className="chat-suggestions">
            {!locked &&
              (sent === 0
                ? ['Oi! 💕', 'Quero te conhecer', 'Como você está?']
                : ['Meu dia ficou melhor agora 💕', 'Me conta mais sobre você']
              ).map((text) => (
                <button
                  type="button"
                  key={text}
                  onClick={() => send(text)}
                  disabled={typing || sent >= 2}
                >
                  {text}
                </button>
              ))}
            <button
              type="button"
              className="chat-photo-request"
              onClick={openOffer}
            >
              <LockKeyhole size={13} /> Pedir uma foto
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
              placeholder={
                locked
                  ? 'Desbloqueie para continuar a conversa…'
                  : `Escreva para ${name}…`
              }
              maxLength={500}
              value={draft}
              disabled={locked || typing || sent >= 2}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              type={locked ? 'button' : 'submit'}
              onClick={locked ? openOffer : undefined}
              disabled={!locked && (typing || sent >= 2 || !draft.trim())}
              aria-label={locked ? 'Desbloquear conversa' : 'Enviar mensagem'}
            >
              {locked ? <LockKeyhole size={19} /> : <Send size={19} />}
            </button>
          </form>
          <p>
            <Sparkles size={11} /> Demonstração com respostas pré-definidas ·
            Personagem virtual · 18+
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
          <PaywallSheet sel={sel} onClose={() => setOfferOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
