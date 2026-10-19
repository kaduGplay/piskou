import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Check,
  MessageCircle,
  Infinity,
  ChevronDown,
  CreditCard,
  Crown,
  Gem,
  ShieldCheck,
  X,
} from 'lucide-react'
import { EVENTS, getResultImage, track } from './data.js'
import {
  BENEFIT_ICONS,
  BONUS_ICONS,
  FAQ,
  PLAN_BENEFITS,
  PLAN_BONUSES,
  TESTIMONIALS,
  TRUST,
} from './offer.js'
import {
  CAMPAIGN_PARAMS,
  PLANS as CATALOG,
  SELECTION_STORAGE_KEY,
  formatBRL,
} from '../shared/checkout.js'
import './PaywallSheet.css'

const PLANS = {
  premium: [CATALOG['premium-access']],
  luxury: [CATALOG['luxury-access']],
}
// Link do checkout interno, levando junto as UTMs da URL atual.
function checkoutHref(plan, search = '') {
  const target = new URL('/checkout', window.location.origin)
  target.searchParams.set('plano', plan.id)
  const current = new URLSearchParams(search)
  for (const key of CAMPAIGN_PARAMS) {
    if (current.has(key)) target.searchParams.set(key, current.get(key))
  }
  return `${target.pathname}${target.search}`
}

// Dispara o rastreio antes de sair da página e dá um instante para o Pixel enviar o AddToCart.
function trackThenNavigate(event, trackFn, location = window.location) {
  const href = event.currentTarget.href
  event.preventDefault()
  try {
    trackFn()
  } catch {
    // segue para o checkout mesmo se o rastreio falhar
  }
  setTimeout(
    () => location.assign(href),
    typeof window.fbq === 'function' ? 300 : 0,
  )
}

const Laurel = ({ right = false }) => (
  <span className={`paywall-laurel${right ? ' right' : ''}`} aria-hidden="true">
    {Array.from({ length: 7 }, (_, i) => (
      <i key={i} />
    ))}
  </span>
)

export default function PaywallSheet({ sel, onClose, source }) {
  useEffect(() => {
    track(EVENTS.OFFER_VIEW, {
      visual_style: sel.style,
      source: source || 'creator',
    })
  }, [])
  const callKind = source === 'voice-call' ? 'Llamadas de voz' : source === 'video-call' ? 'Videollamadas' : null
  const newCharacter = source === 'new-character'
  const trialEnded = source === 'trial'
  const fromChat = source === 'chat' || trialEnded
  const characterName = sel.name || 'tu personaje'
  const [tier, setTier] = useState('premium')
  const [openFaq, setOpenFaq] = useState(null)
  const result = getResultImage(sel)
  const plan = PLANS[tier][0]
  const luxuryPlan = PLANS.luxury[0]
  const bonuses = PLAN_BONUSES[luxuryPlan.id]
  const isLuxury = tier === 'luxury'
  const planHref = checkoutHref(plan, window.location.search)
  const luxuryHref = checkoutHref(luxuryPlan, window.location.search)

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    if (source !== 'messages') return
    const previousFocus = document.activeElement
    const dialog = document
      .getElementById('message-plans-title')
      ?.closest('[role="dialog"]')
    dialog?.querySelector('button')?.focus()
    const trapFocus = (event) => {
      if (event.key !== 'Tab' || !dialog) return
      const controls = [
        ...dialog.querySelectorAll('button, a[href], input:checked'),
      ]
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    dialog?.addEventListener('keydown', trapFocus)
    return () => {
      dialog?.removeEventListener('keydown', trapFocus)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [source])

  const goToCheckout = (event, chosen) =>
    trackThenNavigate(event, () => {
      try {
        sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(sel))
      } catch {
        // sem storage o checkout só não mostra a personagem no resumo
      }
      track(EVENTS.CHECKOUT_CLICK, {
        plan: chosen.id,
        value: chosen.price,
        currency: 'BRL',
        visual_style: sel.style,
      })
    })

  if (source === 'messages') {
    const chosen =
      CATALOG[tier === 'luxury' ? 'messages-unlimited' : 'messages-120']
    return (
      <div
        className="paywall-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <motion.section
          className="message-upgrade"
          role="dialog"
          aria-modal="true"
          aria-labelledby="message-plans-title"
          aria-describedby="message-plans-description"
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <button
            className="message-upgrade-close"
            type="button"
            onClick={onClose}
            aria-label="Cerrar oferta"
          >
            <X size={20} />
          </button>
          <div className="message-upgrade-icon">
            <MessageCircle size={28} />
          </div>
          <span className="message-upgrade-eyebrow">La plática continúa</span>
          <h1 id="message-plans-title">
            Todavía hay mucho de qué platicar con <em>{characterName}</em>
          </h1>
          <p id="message-plans-description">
            Retoma donde se quedaron. Tu plática y tus elecciones siguen
            aquí.
          </p>
          <div
            className="message-upgrade-options"
            role="radiogroup"
            aria-label="Elige cómo continuar"
          >
            {[
              ['premium', 'messages-120'],
              ['luxury', 'messages-unlimited'],
            ].map(([value, id]) => {
              const option = CATALOG[id]
              const unlimited = value === 'luxury'
              return (
                <label
                  key={id}
                  className={`message-upgrade-option${tier === value ? ' selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="message-package"
                    value={value}
                    checked={tier === value}
                    onChange={() => setTier(value)}
                  />
                  <span className="message-upgrade-radio" aria-hidden="true">
                    {tier === value && <Check size={13} />}
                  </span>
                  <span className="message-upgrade-option-copy">
                    <strong>
                      {unlimited ? (
                        <>
                          <Infinity size={19} /> Mensajes ilimitados
                        </>
                      ) : (
                        '120 mensajes más'
                      )}
                    </strong>
                    <small>
                      {unlimited
                        ? 'Platica sin contar mensajes'
                        : 'Más espacio para conocerse'}
                    </small>
                  </span>
                  <span className="message-upgrade-price">
                    <strong>{formatBRL(option.price)}</strong>
                    <small>pago único</small>
                  </span>
                </label>
              )
            })}
          </div>
          <a
            className="message-upgrade-cta"
            href={checkoutHref(chosen, window.location.search)}
            onClickCapture={(event) => goToCheckout(event, chosen)}
          >
            Continuar con{' '}
            {tier === 'luxury' ? 'mensajes ilimitados' : '120 mensajes'}{' '}
            <ArrowRight size={19} />
          </a>
          <div className="message-upgrade-trust">
            <ShieldCheck size={16} /> Sin suscripción ni renovación automática
          </div>
          <p className="message-upgrade-details">
            Mensajes de texto en esta plática. El acceso ilimitado es válido mientras
            el servicio esté disponible.
          </p>
        </motion.section>
      </div>
    )
  }

  return (
    <div
      className="paywall-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <motion.section
        className="paywall-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-title"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 35 }}
      >
        <button
          className="paywall-close"
          type="button"
          onClick={onClose}
          aria-label="Cerrar oferta"
        >
          <X size={20} />
        </button>
        <div className="paywall-scroll">
          <div className="paywall-hero">
            <img src={result.src} alt="Tu personaje" />
            <div className="paywall-hero-copy">
              <span>
                {newCharacter ? 'MÁS PERSONAJES · BABY' : callKind ? 'LLAMADAS · MUY PRONTO' : trialEnded ? 'SE ACABARON TUS MENSAJES GRATIS' : fromChat ? 'LA PLÁTICA APENAS EMPIEZA' : 'PERSONAJE LISTO'}
              </span>
              <h1 id="paywall-title">
                {newCharacter ? 'Crea otro personaje' : callKind ? `${callKind} con ${characterName}` : fromChat
                  ? `Sigue platicando con ${characterName}`
                  : `Dale vida a ${characterName}`}
              </h1>
              <p>
                {newCharacter ? 'Obtén Baby o Pro para crear otros personajes y mantener tus pláticas separadas.' : callKind ? 'Las llamadas están en preparación. Conoce lo que incluye cada plan; la compra todavía no habilita llamadas.' : trialEnded
                  ? 'Tu plática está guardada. Elige un plan y retoma donde se quedaron, con la personalidad que elegiste.'
                  : fromChat
                  ? `¿Te gustó conocer a ${characterName}? Elige tu acceso para seguir la plática a tu manera, con la personalidad que elegiste.`
                  : 'Elige el acceso que va contigo.'}
              </p>
            </div>
          </div>

          <div className="paywall-inner">
            <div
              className="paywall-tier-tabs"
              role="tablist"
              aria-label="Categoría del plan"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tier === 'premium'}
                className={tier === 'premium' ? 'active' : ''}
                onClick={() => setTier('premium')}
              >
                <Gem size={17} /> Baby
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tier === 'luxury'}
                className={tier === 'luxury' ? 'active luxury' : ''}
                onClick={() => setTier('luxury')}
              >
                <Crown size={17} /> Pro
              </button>
            </div>

            <div
              className="paywall-plans"
              role="group"
              aria-label="Elige tu plan"
            >
              {Object.entries(PLANS).map(([key, [option]]) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={tier === key}
                  onClick={() => setTier(key)}
                  className={`paywall-plan${tier === key ? ' selected' : ''}${key === 'luxury' ? ' luxury' : ''}`}
                >
                  <span className="paywall-plan-copy">
                    <span>
                      {key === 'luxury' ? (
                        <Crown size={17} aria-hidden="true" />
                      ) : (
                        <Gem size={17} aria-hidden="true" />
                      )}
                      {option.name}
                    </span>
                    <small>
                      {fromChat
                        ? option.bonusCount
                          ? `Plática + ${option.bonusCount} bonos incluidos`
                          : `Sigue tu plática con ${characterName}`
                        : option.bonusCount
                          ? `${option.bonusCount} bonos incluidos`
                          : 'Personaje y plática por texto'}
                    </small>
                  </span>
                  <span className="paywall-plan-price">
                    <strong>{formatBRL(option.price)}</strong>
                    <small>Pago único</small>
                  </span>
                </button>
              ))}
            </div>

            <div className="paywall-one-payment">
              <CreditCard size={17} aria-hidden="true" />
              <span>
                <strong>Sin suscripción. Sin mensualidad.</strong> Pagas una
                sola vez.
              </span>
            </div>

            <div className={`paywall-benefits${isLuxury ? ' luxury' : ''}`}>
              <h2>Incluido en {tier === 'premium' ? 'Baby' : 'Pro'}</h2>
              {PLAN_BENEFITS[tier].map((benefit) => {
                const Icon = BENEFIT_ICONS[benefit.icon]
                return (
                  <div key={benefit.icon}>
                    <Icon size={19} aria-hidden="true" />
                    <span>{benefit.text}</span>
                  </div>
                )
              })}
              <ul
                className={`paywall-bonus-summary${isLuxury ? '' : ' excluded'}`}
                aria-label={
                  isLuxury
                    ? 'Bonos incluidos en Pro'
                    : 'Bonos no incluidos en Baby'
                }
              >
                {bonuses.map((bonus) => {
                  const Icon = isLuxury ? BONUS_ICONS[bonus.id] : X
                  return (
                    <li key={bonus.id}>
                      <Icon size={18} aria-hidden="true" />
                      {isLuxury ? (
                        <span>{bonus.title}</span>
                      ) : (
                        <s>{bonus.title}</s>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>

            <a
              href={planHref}
              className={`paywall-cta${isLuxury ? ' luxury' : ''}`}
              onClickCapture={(event) => goToCheckout(event, plan)}
            >
              {fromChat
                ? `SEGUIR LA PLÁTICA · ${formatBRL(plan.price)}`
                : `DESBLOQUEAR ${plan.name.toUpperCase()} POR ${formatBRL(plan.price)}`}{' '}
              <ArrowRight size={17} />
            </a>
            <p className="paywall-checkout-note">
              <ShieldCheck size={14} aria-hidden="true" /> Pago seguro con
              PIX · Sin renovación automática
            </p>

            <div className="paywall-trust">
              <Laurel />
              <div className="paywall-trust-copy">
                <strong>{TRUST.title}</strong>
                <span>{TRUST.subtitle}</span>
              </div>
              <Laurel right />
            </div>

            <section className="paywall-bonus" aria-labelledby="bonus-title">
              <div className="paywall-bonus-heading">
                <span>INCLUIDOS EN PRO</span>
                <h2 id="bonus-title">8 bonos incluidos</h2>
                <p>
                  {isLuxury
                    ? 'Todos incluidos en el pago único de Pro.'
                    : 'Exclusivos de Pro. No incluidos en Baby.'}
                </p>
              </div>
              {/* Dois grupos iguais para o letreiro rolar sem emenda; o segundo é só visual. */}
              <div
                className="paywall-bonus-window"
                aria-label="Bonos exclusivos de Pro"
              >
                <div className="paywall-bonus-rail">
                  {[0, 1].map((group) => (
                    <div
                      key={group}
                      className="paywall-bonus-group"
                      aria-hidden={group === 1}
                      inert={group === 1}
                    >
                      {bonuses.map((bonus) => (
                        <article key={bonus.id}>
                          <img
                            src={bonus.image}
                            alt={bonus.title}
                            decoding="async"
                            width="640"
                            height={bonus.id === 'lives' ? '761' : '960'}
                          />
                        </article>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <a
                href={luxuryHref}
                className="paywall-bonus-cta"
                onClickCapture={(event) => goToCheckout(event, luxuryPlan)}
              >
                QUIERO PRO CON LOS 8 BONOS <ArrowRight size={16} />
              </a>
            </section>

            {TESTIMONIALS.length > 0 && (
              <section className="paywall-proof" aria-labelledby="proof-title">
                <h2 id="proof-title">Testimonios</h2>
                <div
                  className="paywall-proof-window"
                  aria-label="Testimonios de clientes"
                >
                  <div className="paywall-proof-track">
                    {[0, 1].map((group) => (
                      <div
                        key={group}
                        className="paywall-proof-group"
                        aria-hidden={group === 1}
                        inert={group === 1}
                      >
                        {TESTIMONIALS.map((item) => (
                          <article key={item.id}>
                            <img
                              src={item.image}
                              alt={`Testimonio ${item.id} anónimo: ${item.quote}`}
                              loading="lazy"
                            />
                          </article>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            <div className="paywall-proof-checkout">
              <a
                href={planHref}
                className={`paywall-cta paywall-cta-after-proof${isLuxury ? ' luxury' : ''}`}
                onClickCapture={(event) => goToCheckout(event, plan)}
              >
                {fromChat
                  ? `SEGUIR LA PLÁTICA · ${formatBRL(plan.price)}`
                  : `DESBLOQUEAR ${plan.name.toUpperCase()} POR ${formatBRL(plan.price)}`}{' '}
                <ArrowRight size={17} />
              </a>
              <p className="paywall-checkout-note">
                <ShieldCheck size={14} aria-hidden="true" /> Pago único · Sin suscripción
              </p>
            </div>

            <section className="paywall-faq" aria-labelledby="faq-title">
              <h2 id="faq-title">Preguntas frecuentes</h2>
              {FAQ.map((item, index) => (
                <div key={item.question} className="paywall-faq-item">
                  <button
                    type="button"
                    aria-expanded={openFaq === index}
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  >
                    <span>{item.question}</span>
                    <ChevronDown size={17} />
                  </button>
                  {openFaq === index && <p>{item.answer}</p>}
                </div>
              ))}
            </section>
          </div>
        </div>
      </motion.section>
    </div>
  )
}
