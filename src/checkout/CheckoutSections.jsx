import { useState } from 'react'
import { BadgeCheck, Check, ChevronDown, Crown, Gem, Landmark, Mail, MessageCircle, Plus, ShieldCheck, X } from 'lucide-react'
import { getResultImage, optionLabel } from '../funnel/data.js'
import { BENEFIT_ICONS, BONUS_ICONS, FAQ, PLAN_BENEFITS, PLAN_BONUSES, TRUST } from '../funnel/offer.js'
import { PLANS, ORDER_BUMPS, formatPrice } from '../shared/checkout.js'

const PREMIUM = PLANS['premium-access']
const LUXURY = PLANS['luxury-access']
const LUXURY_EXTRA = formatPrice(LUXURY.price - PREMIUM.price)
const LUXURY_BONUSES = PLAN_BONUSES[LUXURY.id]

export function CheckoutBanner() {
  return <img className="checkout-banner" src="/checkout-media/banner.webp" width="800" height="325" alt="Piskou: falta poco para darle vida a tu personaje ideal. Realista o anime, personaliza apariencia, voz y personalidad a tu gusto. Finaliza tu acceso y desbloquea la experiencia Piskou." fetchPriority="high" />
}

// Personagem que a pessoa montou no funil (lida do sessionStorage). Sem ela, só o título.
export function CharacterHero({ selection }) {
  const [imageFailed, setImageFailed] = useState(false)
  if (!selection) {
    return (
      <section className="checkout-hero plain">
        <div className="checkout-hero-copy">
          <span>YA CASI</span>
          <h1>Completa tu acceso</h1>
          <p>Solo falta un paso para platicar con tu personaje.</p>
        </div>
      </section>
    )
  }
  const details = [`${selection.age} años`, selection.personality && optionLabel(selection.personality), selection.relationship && optionLabel(selection.relationship)].filter(Boolean)
  return (
    <section className="checkout-hero">
      {!imageFailed && (
        <img src={getResultImage(selection).src} alt="Tu personaje" onError={() => setImageFailed(true)} />
      )}
      <div className="checkout-hero-copy">
        <span>PERSONAJE LISTO</span>
        <h1>{selection.name ? `${selection.name} te está esperando` : 'Tu personaje está listo'}</h1>
        <ul>
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function PlanPicker({ planId, onChange }) {
  return (
    <section className="checkout-plans" id="checkout-plans" aria-labelledby="plans-title">
      <h2 id="plans-title">Elige tu plan</h2>
      <div role="radiogroup" aria-labelledby="plans-title">
        {(PLANS[planId]?.purpose === 'messages' ? [PLANS[planId === 'messages-six' ? 'messages-six' : 'messages-120'],PLANS['messages-unlimited']] : [PREMIUM,LUXURY]).map((plan) => {
          const luxury = plan.tier === 'luxury'
          const Icon = luxury ? Crown : Gem
          const selected = planId === plan.id
          return (
            <button
              key={plan.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`checkout-plan${selected ? ' selected' : ''}${luxury ? ' luxury' : ''}`}
              onClick={() => onChange(plan.id)}
            >
              {luxury && <span className="checkout-plan-badge">MÁS COMPLETO</span>}
              <span className="checkout-plan-radio" aria-hidden="true" />
              <span className="checkout-plan-copy">
                <strong>
                  <Icon size={16} aria-hidden="true" /> {plan.name}
                </strong>
                <small>{plan.purpose === 'messages' ? (plan.id !== 'messages-unlimited' ? `${plan.messageCount || 6} mensajes adicionales en esta plática` : 'Texto ilimitado en esta plática, sin renovación automática') : 'Personaje y plática por texto'}</small>
                {luxury && <em>Solo {LUXURY_EXTRA} más que Baby</em>}
              </span>
              <span className="checkout-plan-price">
                <strong>{formatPrice(plan.price)}</strong>
                <small>Pago único</small>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function TrustBadges() {
  return (
    <ul className="checkout-trust">
      <li>
        <BadgeCheck size={16} aria-hidden="true" /> Pago único, sin mensualidad
      </li>
      <li>
        <Mail size={16} aria-hidden="true" /> Acceso liberado al confirmar el pago
      </li>
      <li>
        <ShieldCheck size={16} aria-hidden="true" /> {TRUST.subtitle}
      </li>
    </ul>
  )
}

// O que o plano escolhido entrega. No Pro mostra os bônus; no Baby, o que fica de fora e o convite para o Pro.
export function PlanIncludes({ plan, onUpgrade }) {
  if (plan.purpose === 'messages') return <section className="checkout-includes"><h2>{plan.name}</h2><p>{plan.id !== 'messages-unlimited' ? `Agrega ${plan.messageCount || 6} mensajes a tu plática actual. No reinicia el historial.` : 'Mensajes de texto ilimitados en esta plática mientras el servicio esté disponible. Sin renovación automática.'}</p></section>
  const luxury = plan.tier === 'luxury'
  return (
    <section className={`checkout-includes${luxury ? ' luxury' : ''}`} aria-labelledby="includes-title">
      <h2 id="includes-title">Lo que recibes con {plan.name}</h2>
      <ul className="checkout-benefits">
        {PLAN_BENEFITS[plan.tier].map((benefit) => {
          const Icon = BENEFIT_ICONS[benefit.icon]
          return (
            <li key={benefit.icon}>
              <Icon size={18} aria-hidden="true" />
              {benefit.text}
            </li>
          )
        })}
      </ul>

      {luxury ? (
        <>
          <div className="checkout-bonus-rail" aria-label="Bonos incluidos en Pro">
            {LUXURY_BONUSES.map((bonus) => (
              <img
                key={bonus.id}
                src={bonus.image}
                alt={bonus.title}
                loading="lazy"
                width="640"
                height={bonus.id === 'lives' ? '761' : '960'}
              />
            ))}
          </div>
          <ul className="checkout-bonuses">
            {LUXURY_BONUSES.map((bonus) => {
              const Icon = BONUS_ICONS[bonus.id]
              return (
                <li key={bonus.id}>
                  <span className="checkout-bonus-icon">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{bonus.title}</strong>
                    <small>{bonus.description}</small>
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <div className="checkout-missing">
          <h3>No incluido en Baby</h3>
          <ul>
            {LUXURY_BONUSES.map((bonus) => (
              <li key={bonus.id}>
                <X size={15} aria-hidden="true" />
                <s>{bonus.title}</s>
              </li>
            ))}
          </ul>
          <button type="button" className="checkout-upgrade" onClick={onUpgrade}>
            <Crown size={17} aria-hidden="true" /> Quiero Pro con los {LUXURY.bonusCount} bonos (+ {LUXURY_EXTRA})
          </button>
        </div>
      )}
    </section>
  )
}

export function HowItWorks({ name }) {
  const steps = [
    { icon: Landmark, title: 'Paga con SPEI u OXXO', text: 'Con SPEI se confirma en segundos desde la app de tu banco; en OXXO pagas en efectivo y puede tardar unas horas.' },
    { icon: Mail, title: 'Espera la confirmación', text: 'En cuanto se confirme el pago, tu plática se abre automáticamente.' },
    {
      icon: MessageCircle,
      title: `Platica con ${name || 'tu personaje'}`,
      text: 'Ya está tal como la armaste: look, voz y personalidad.',
    },
  ]
  return (
    <section className="checkout-how" aria-labelledby="how-title">
      <h2 id="how-title">Cómo funciona</h2>
      <ol>
        {steps.map(({ icon: Icon, title, text }) => (
          <li key={title}>
            <span className="checkout-how-icon">
              <Icon size={18} aria-hidden="true" />
            </span>
            <span>
              <strong>{title}</strong>
              <small>{text}</small>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function Reviews() {
  const reviews = [
    { id: 'rafael', name: 'Rafael Gomes', text: 'Buenísimo, me encantó, las pláticas siempre son bien divertidas y atrevidas, me quedé horas y horas platicando con la mía' },
    { id: 'pedro', name: 'Pedro Santos', text: 'Lo compré para practicar cómo hablar con mujeres en la vida real porque era muy tímido, y gracias a esta app se me quitó la timidez, muchas graciaas' },
    { id: 'lucas', name: 'Lucas Ferreira', text: 'Lo compré porque se me hizo interesante el producto, y la neta sí me gustó jajaja la plataforma es bien intuitiva, las chicas son muy realistas, parece que estoy hablando con una de verdaaad' },
  ]
  return (
    <section className="checkout-reviews" aria-labelledby="reviews-title">
      <h2 id="reviews-title">Opiniones</h2>
      <div className="checkout-customer-reviews">
        {reviews.map((item) => (
          <article key={item.id}>
            <header><img src={`/checkout-media/review-${item.id}.webp`} alt="" loading="lazy" /><span><strong>{item.name}</strong></span></header>
            <p>{item.text}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

export function OrderBumps({ plan, selected, onChange, disabled }) {
  if (plan.purpose === 'messages') return null
  const items = Object.values(ORDER_BUMPS).filter((item) => item.available)
  if (items.length === 0) return null
  return <fieldset className="checkout-order-bumps"><legend>Completa tu experiencia</legend>
    {items.map((item) => {
      const included = item.includedIn?.includes(plan.id)
      const checked = !!included || selected.includes(item.id)
      const Mark = checked ? Check : Plus
      return <label key={item.id} className={`checkout-order-bump${checked ? ' selected' : ''}${included ? ' included' : ''}`}>
        <input type="checkbox" name={item.id} checked={checked} disabled={disabled || included} onChange={(event) => onChange(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} />
        <span className="checkout-bump-mark" aria-hidden="true"><Mark size={16} strokeWidth={3} /></span>
        <img src={item.image} alt={item.name} width="62" height="62" loading="lazy" />
        <span className="checkout-bump-copy"><strong>{item.name}</strong><small>{item.description}</small><span className="checkout-bump-price">{included ? <b>Incluido en {plan.name}</b> : <><del>{formatPrice(item.originalPrice)}</del><b>+{formatPrice(item.price)}</b></>}</span></span>
      </label>
    })}
  </fieldset>
}

export function Faq() {
  const [open, setOpen] = useState(null)
  return (
    <section className="checkout-faq" aria-labelledby="faq-title">
      <h2 id="faq-title">Preguntas frecuentes</h2>
      {FAQ.map((item, index) => (
        <div key={item.question} className="checkout-faq-item">
          <button type="button" aria-expanded={open === index} onClick={() => setOpen(open === index ? null : index)}>
            <span>{item.question}</span>
            <ChevronDown size={17} aria-hidden="true" />
          </button>
          {open === index && <p>{item.answer}</p>}
        </div>
      ))}
    </section>
  )
}

// Barra fixa no rodapé, visível quando o botão principal sai da tela.
export function StickyCta({ visible, plan, label, disabled, onClick }) {
  return (
    <div className={`checkout-sticky${visible ? ' visible' : ''}`} aria-hidden={!visible}>
      <div>
        <small>Piskou {plan.name}</small>
        <strong>{formatPrice(plan.price)}</strong>
      </div>
      <button
        type="button"
        className={`checkout-submit${plan.tier === 'luxury' ? ' luxury' : ''}`}
        disabled={disabled}
        tabIndex={visible ? 0 : -1}
        onClick={onClick}
      >
        {label}
      </button>
    </div>
  )
}

export function OrderSummary({ plan, selection, addons = [] }) {
  const luxury = plan.tier === 'luxury'
  const PlanIcon = luxury ? Crown : Gem
  const [imageFailed, setImageFailed] = useState(false)
  return (
    <section className={`checkout-summary${luxury ? ' luxury' : ''}`} aria-label="Resumen del pedido">
      {selection && !imageFailed ? (
        <img
          className="checkout-summary-thumb"
          src={getResultImage(selection).src}
          alt=""
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="checkout-summary-thumb icon">
          <PlanIcon size={24} />
        </span>
      )}
      <div className="checkout-summary-copy">
        <span>
          <PlanIcon size={14} aria-hidden="true" /> Piskou {plan.name}
        </span>
        <strong>{selection?.name ? `${selection.name}, ${selection.age} años` : 'Tu personaje'}</strong>
        <small>{addons.length ? addons.map((item) => item.name).join(' · ') : plan.purpose === 'messages' ? plan.name : ''}</small>
      </div>
      <div className="checkout-summary-price">
        <strong>{formatPrice(plan.price)}</strong>
        <small>Pago único</small>
      </div>
    </section>
  )
}
