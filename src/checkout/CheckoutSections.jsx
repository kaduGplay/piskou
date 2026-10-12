import { useState } from 'react'
import { BadgeCheck, ChevronDown, Crown, Gem, Mail, MessageCircle, QrCode, ShieldCheck, X } from 'lucide-react'
import { getResultImage } from '../funnel/data.js'
import { BENEFIT_ICONS, BONUS_ICONS, FAQ, PLAN_BENEFITS, PLAN_BONUSES, TESTIMONIALS, TRUST } from '../funnel/offer.js'
import { PLANS, formatBRL } from '../shared/checkout.js'

const PREMIUM = PLANS['premium-access']
const LUXURY = PLANS['luxury-access']
const LUXURY_EXTRA = formatBRL(LUXURY.price - PREMIUM.price)
const LUXURY_BONUSES = PLAN_BONUSES[LUXURY.id]

// Personagem que a pessoa montou no funil (lida do sessionStorage). Sem ela, só o título.
export function CharacterHero({ selection }) {
  const [imageFailed, setImageFailed] = useState(false)
  if (!selection) {
    return (
      <section className="checkout-hero plain">
        <div className="checkout-hero-copy">
          <span>QUASE LÁ</span>
          <h1>Finalize seu acesso</h1>
          <p>Falta só um passo para conversar com sua personagem.</p>
        </div>
      </section>
    )
  }
  const details = [`${selection.age} anos`, selection.personality, selection.relationship].filter(Boolean)
  return (
    <section className="checkout-hero">
      {!imageFailed && (
        <img src={getResultImage(selection).src} alt="Sua personagem" onError={() => setImageFailed(true)} />
      )}
      <div className="checkout-hero-copy">
        <span>PERSONAGEM PRONTA</span>
        <h1>{selection.name ? `${selection.name} está esperando por você` : 'Sua personagem está pronta'}</h1>
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
      <h2 id="plans-title">Escolha seu plano</h2>
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
              {luxury && <span className="checkout-plan-badge">MAIS COMPLETO</span>}
              <span className="checkout-plan-radio" aria-hidden="true" />
              <span className="checkout-plan-copy">
                <strong>
                  <Icon size={16} aria-hidden="true" /> {plan.name}
                </strong>
                <small>{plan.purpose === 'messages' ? (plan.id !== 'messages-unlimited' ? `${plan.messageCount || 6} mensagens adicionais nesta conversa` : 'Texto ilimitado nesta conversa, sem renovação automática') : 'Personagem e conversa por texto'}</small>
                {luxury && <em>Só {LUXURY_EXTRA} a mais que o Premium</em>}
              </span>
              <span className="checkout-plan-price">
                <strong>{formatBRL(plan.price)}</strong>
                <small>Pagamento único</small>
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
        <BadgeCheck size={16} aria-hidden="true" /> Pagamento único, sem mensalidade
      </li>
      <li>
        <Mail size={16} aria-hidden="true" /> Acesso liberado após confirmação
      </li>
      <li>
        <ShieldCheck size={16} aria-hidden="true" /> {TRUST.subtitle}
      </li>
    </ul>
  )
}

// O que o plano escolhido entrega. No Luxo mostra os bônus; no Premium, o que fica de fora e o convite para o Luxo.
export function PlanIncludes({ plan, onUpgrade }) {
  if (plan.purpose === 'messages') return <section className="checkout-includes"><h2>{plan.name}</h2><p>{plan.id !== 'messages-unlimited' ? `Adiciona ${plan.messageCount || 6} mensagens à sua conversa atual. Não reinicia o histórico.` : 'Mensagens por texto ilimitadas nesta conversa durante a disponibilidade do serviço. Sem renovação automática.'}</p></section>
  const luxury = plan.tier === 'luxury'
  return (
    <section className={`checkout-includes${luxury ? ' luxury' : ''}`} aria-labelledby="includes-title">
      <h2 id="includes-title">O que você recebe no {plan.name}</h2>
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
          <div className="checkout-bonus-rail" aria-label="Bônus incluídos no Luxo">
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
          <h3>Não incluído no Premium</h3>
          <ul>
            {LUXURY_BONUSES.map((bonus) => (
              <li key={bonus.id}>
                <X size={15} aria-hidden="true" />
                <s>{bonus.title}</s>
              </li>
            ))}
          </ul>
          <button type="button" className="checkout-upgrade" onClick={onUpgrade}>
            <Crown size={17} aria-hidden="true" /> Quero o Luxo com os {LUXURY.bonusCount} bônus (+ {LUXURY_EXTRA})
          </button>
        </div>
      )}
    </section>
  )
}

export function HowItWorks({ name }) {
  const steps = [
    { icon: QrCode, title: 'Pague com PIX', text: 'A confirmação é na hora, direto no app do seu banco.' },
    { icon: Mail, title: 'Aguarde a confirmação', text: 'Assim que o pagamento for confirmado, sua conversa abre automaticamente.' },
    {
      icon: MessageCircle,
      title: `Converse com ${name || 'sua personagem'}`,
      text: 'Ela já está do jeito que você montou: visual, voz e personalidade.',
    },
  ]
  return (
    <section className="checkout-how" aria-labelledby="how-title">
      <h2 id="how-title">Como funciona</h2>
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
  if (TESTIMONIALS.length === 0) return null
  return (
    <section className="checkout-reviews" aria-labelledby="reviews-title">
      <h2 id="reviews-title">Avaliações de quem já criou</h2>
      <p className="checkout-reviews-trust">
        <ShieldCheck size={18} aria-hidden="true" />
        <span>
          <strong>{TRUST.title}</strong>
          <small>{TRUST.subtitle}</small>
        </span>
      </p>
      <div className="checkout-reviews-rail">
        {TESTIMONIALS.map((item) => (
          <article key={item.id}>
            <img src={item.image} alt={`Depoimento ${item.id} anonimizado: ${item.quote}`} loading="lazy" />
          </article>
        ))}
      </div>
    </section>
  )
}

export function Faq() {
  const [open, setOpen] = useState(null)
  return (
    <section className="checkout-faq" aria-labelledby="faq-title">
      <h2 id="faq-title">Perguntas frequentes</h2>
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
        <strong>{formatBRL(plan.price)}</strong>
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

export function OrderSummary({ plan, selection }) {
  const luxury = plan.tier === 'luxury'
  const PlanIcon = luxury ? Crown : Gem
  const [imageFailed, setImageFailed] = useState(false)
  return (
    <section className={`checkout-summary${luxury ? ' luxury' : ''}`} aria-label="Resumo do pedido">
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
        <strong>{selection?.name ? `${selection.name}, ${selection.age} anos` : 'Sua personagem'}</strong>
        <small>{plan.purpose === 'messages' ? plan.name : ''}</small>
      </div>
      <div className="checkout-summary-price">
        <strong>{formatBRL(plan.price)}</strong>
        <small>Pagamento único</small>
      </div>
    </section>
  )
}
