import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  ChevronDown,
  CreditCard,
  Crown,
  Gem,
  ShieldCheck,
  X,
} from 'lucide-react'
import { EVENTS, getResultImage, track } from './data.js'
import { BENEFIT_ICONS, BONUS_ICONS, FAQ, PLAN_BENEFITS, PLAN_BONUSES, TESTIMONIALS, TRUST } from './offer.js'
import { CAMPAIGN_PARAMS, PLANS as CATALOG, SELECTION_STORAGE_KEY, formatBRL } from '../shared/checkout.js'
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
  setTimeout(() => location.assign(href), typeof window.fbq === 'function' ? 300 : 0)
}

const Laurel = ({ right = false }) => (
  <span className={`paywall-laurel${right ? ' right' : ''}`} aria-hidden="true">
    {Array.from({ length: 7 }, (_, i) => (
      <i key={i} />
    ))}
  </span>
)

export default function PaywallSheet({ sel, onClose, source }) {
  const fromChat = source === 'chat'
  const characterName = sel.name || 'sua personagem'
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

  const goToCheckout = (event, chosen) =>
    trackThenNavigate(event, () => {
      try {
        sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(sel))
      } catch {
        // sem storage o checkout só não mostra a personagem no resumo
      }
      track(EVENTS.CHECKOUT_CLICK, { plan: chosen.id, value: chosen.price, currency: 'BRL', visual_style: sel.style })
    })

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
        <button className="paywall-close" type="button" onClick={onClose} aria-label="Fechar oferta">
          <X size={20} />
        </button>
        <div className="paywall-scroll">
          <div className="paywall-hero">
            <img src={result.src} alt="Personagem escolhida" />
            <div className="paywall-hero-copy">
              <span>{fromChat ? 'A CONVERSA SÓ COMEÇOU' : 'PERSONAGEM PRONTA'}</span>
              <h1 id="paywall-title">{fromChat ? `Continue conversando com ${characterName}` : `Dê vida à ${characterName}`}</h1>
              <p>{fromChat ? `Gostou de conhecer ${characterName}? Escolha seu acesso para continuar a conversa do seu jeito, com a personalidade que você escolheu.` : 'Escolha o acesso que combina com você.'}</p>
            </div>
          </div>

          <div className="paywall-inner">
            <div className="paywall-tier-tabs" role="tablist" aria-label="Categoria do plano">
              <button
                type="button"
                role="tab"
                aria-selected={tier === 'premium'}
                className={tier === 'premium' ? 'active' : ''}
                onClick={() => setTier('premium')}
              >
                <Gem size={17} /> Premium
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tier === 'luxury'}
                className={tier === 'luxury' ? 'active luxury' : ''}
                onClick={() => setTier('luxury')}
              >
                <Crown size={17} /> Luxo
              </button>
            </div>

            <div className="paywall-plans" role="group" aria-label="Escolha seu plano">
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
                      {key === 'luxury' ? <Crown size={17} aria-hidden="true" /> : <Gem size={17} aria-hidden="true" />}
                      {option.name}
                    </span>
                    <small>
                      {fromChat ? (option.bonusCount ? `Conversa + ${option.bonusCount} bônus incluídos` : `Continue sua conversa com ${characterName}`) : (option.bonusCount ? `${option.bonusCount} bônus incluídos` : 'Personagem e conversa por texto')}
                    </small>
                  </span>
                  <span className="paywall-plan-price">
                    <strong>{formatBRL(option.price)}</strong>
                    <small>Pagamento único</small>
                  </span>
                </button>
              ))}
            </div>

            <div className="paywall-one-payment">
              <CreditCard size={17} aria-hidden="true" />
              <span>
                <strong>Sem assinatura. Sem mensalidade.</strong> Você paga uma única vez.
              </span>
            </div>

            <div className={`paywall-benefits${isLuxury ? ' luxury' : ''}`}>
              <h2>Incluído no {tier === 'premium' ? 'Premium' : 'Luxo'}</h2>
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
                aria-label={isLuxury ? 'Bônus incluídos no Luxo' : 'Bônus não incluídos no Premium'}
              >
                {bonuses.map((bonus) => {
                  const Icon = isLuxury ? BONUS_ICONS[bonus.id] : X
                  return (
                    <li key={bonus.id}>
                      <Icon size={18} aria-hidden="true" />
                      {isLuxury ? <span>{bonus.title}</span> : <s>{bonus.title}</s>}
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
              {fromChat ? 'CONTINUAR A CONVERSA' : `LIBERAR ${plan.name.toUpperCase()}`} · {formatBRL(plan.price)} <ArrowRight size={17} />
            </a>
            <p className="paywall-checkout-note">
              <ShieldCheck size={14} aria-hidden="true" /> Pagamento seguro via PIX · Sem renovação automática
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
                <span>INCLUÍDOS NO LUXO</span>
                <h2 id="bonus-title">8 Bonus incluso</h2>
                <p>{isLuxury ? 'Todos incluídos no pagamento único do Luxo.' : 'Exclusivos do Luxo. Não incluídos no Premium.'}</p>
              </div>
              {/* Dois grupos iguais para o letreiro rolar sem emenda; o segundo é só visual. */}
              <div className="paywall-bonus-window" aria-label="Bônus exclusivos do Luxo">
                <div className="paywall-bonus-rail">
                  {[0, 1].map((group) => (
                    <div key={group} className="paywall-bonus-group" aria-hidden={group === 1} inert={group === 1}>
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
              <a href={luxuryHref} className="paywall-bonus-cta" onClickCapture={(event) => goToCheckout(event, luxuryPlan)}>
                QUERO O LUXO COM OS 8 BÔNUS <ArrowRight size={16} />
              </a>
            </section>

            {TESTIMONIALS.length > 0 && (
              <section className="paywall-proof" aria-labelledby="proof-title">
                <h2 id="proof-title">Depoimentos</h2>
                <div className="paywall-proof-window" aria-label="Depoimentos de clientes">
                  <div className="paywall-proof-track">
                    {[0, 1].map((group) => (
                      <div key={group} className="paywall-proof-group" aria-hidden={group === 1} inert={group === 1}>
                        {TESTIMONIALS.map((item) => (
                          <article key={item.id}>
                            <img src={item.image} alt={`Depoimento ${item.id} anonimizado: ${item.quote}`} loading="lazy" />
                          </article>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            <section className="paywall-faq" aria-labelledby="faq-title">
              <h2 id="faq-title">Perguntas frequentes</h2>
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
