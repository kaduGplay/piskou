import { useEffect, useRef, useState } from 'react'
import { Check, CircleCheck, Copy, Crown, Infinity, LoaderCircle, MessageCircle, Phone, PlayCircle, ShieldCheck, Video } from 'lucide-react'
import { EVENTS, getResultImage, track } from '../funnel/data.js'
import { readSavedSelection } from '../shared/progress.js'
import { analyticsIdentity } from '../shared/analytics.js'
import { BUYER_STORAGE_KEY, CURRENCY, PLANS, UPSELL_SEQUENCE, formatPrice, onlyDigits, validateCustomer } from '../shared/checkout.js'
import './UpsellPage.css'

const STEP_KEY = 'piskou:upsell-step'
const CHARGE_KEY = 'piskou:upsell-charge'
const POLL_MS = 4000

const OFFERS = {
  'upsell-video-pack': {
    icon: Video,
    eyebrow: 'OFERTA EXCLUSIVA',
    title: (name) => <>Mira un <em>pack de videos</em> de {name}</>,
    text: (name) => `Un pack solo con videos de ${name}, desbloqueado ahora mismo en tu cuenta.`,
    bullets: (name) => [`Videos exclusivos de ${name}`, 'Se desbloquea justo después del pago', 'Pago único, sin mensualidad'],
    cta: 'SÍ, QUIERO EL PACK',
    paid: '¡Pack de videos desbloqueado!',
  },
  'upsell-whatsapp': {
    icon: MessageCircle,
    eyebrow: 'SOLO EN ESTA PANTALLA',
    title: (name) => <>Haz que {name} te escriba por <em>WhatsApp</em></>,
    text: (name) => `${name} te escribe a tu WhatsApp, tal como la elegiste.`,
    bullets: (name) => [`${name} te escribe a tu número`, 'Platica directo en tu WhatsApp', 'Pago único, sin mensualidad'],
    cta: 'SÍ, QUIERO QUE ME ESCRIBA',
    paid: '¡Listo! Ahora solo escribe tu WhatsApp.',
  },
  'upsell-vip': {
    icon: Crown,
    eyebrow: 'ÚLTIMA OFERTA',
    title: () => <>Acceso <em>VIP de por vida</em></>,
    text: () => 'Paga una vez y úsalo para siempre.',
    bullets: (name) => [`Mensajes ilimitados con ${name}`, 'Tu plática se guarda para siempre', 'Paga una vez y úsalo para siempre'],
    cta: 'SÍ, QUIERO SER VIP',
    paid: '¡Ya eres VIP de por vida!',
  },
}

const readJson = (storage, key) => {
  try {
    return JSON.parse(storage.getItem(key) || 'null')
  } catch {
    return null
  }
}
const writeJson = (storage, key, value) => {
  try {
    if (value === null) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify(value))
  } catch {
    /* sem storage o fluxo só não é retomado ao recarregar */
  }
}

// Ofertas de um clique depois do pagamento: Quero gera a CLABE do SPEI na hora com os dados já informados; Não, obrigado passa para a próxima.
export default function UpsellPage() {
  const [selection] = useState(readSavedSelection)
  const [buyer, setBuyer] = useState(() => readJson(sessionStorage, BUYER_STORAGE_KEY) || { name: '', email: '' })
  const [step, setStep] = useState(() => Math.min(UPSELL_SEQUENCE.length, Math.max(0, Number(readJson(sessionStorage, STEP_KEY)) || 0)))
  const [charge, setCharge] = useState(() => (readJson(sessionStorage, CHARGE_KEY)?.deposit?.code ? readJson(sessionStorage, CHARGE_KEY) : null))
  const [phase, setPhase] = useState(() => (readJson(sessionStorage, CHARGE_KEY)?.deposit?.code ? 'pay' : 'offer'))
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [phone, setPhone] = useState('')
  const requestRef = useRef(null)
  const busy = useRef(false)

  const planId = UPSELL_SEQUENCE[step]
  const plan = PLANS[planId]
  const offer = OFFERS[planId]
  const name = selection?.name?.trim() || 'tu personaje'
  const image = getResultImage({ ...selection }).src
  const needsBuyer = Object.keys(validateCustomer(buyer)).length > 0

  useEffect(() => writeJson(sessionStorage, STEP_KEY, step), [step])
  useEffect(() => {
    if (step >= UPSELL_SEQUENCE.length) window.location.replace('/chat')
  }, [step])

  const next = () => {
    writeJson(sessionStorage, CHARGE_KEY, null)
    requestRef.current = null
    setCharge(null)
    setCopied(false)
    setError('')
    setPhase('offer')
    setStep((value) => value + 1)
    window.scrollTo(0, 0)
  }

  const accept = async () => {
    if (busy.current) return
    if (needsBuyer) {
      setError('Revisa tu nombre y correo para generar tu pago.')
      return
    }
    busy.current = true
    setPhase('creating')
    setError('')
    requestRef.current ||= crypto.randomUUID()
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          method: 'spei',
          requestId: requestRef.current,
          selection,
          customer: buyer,
          analyticsSession: analyticsIdentity().session,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (data.code === 'owned') return next()
      if (!response.ok || data.status === 'failed' || !data.deposit?.code) {
        setPhase('offer')
        setError(data.error || 'No se pudo generar tu pago en este momento. Intenta de nuevo.')
        return
      }
      const saved = { id: data.id, planId, amount: data.amount, deposit: data.deposit }
      writeJson(sessionStorage, CHARGE_KEY, saved)
      setCharge(saved)
      setPhase('pay')
      track(EVENTS.PIX_GENERATED, { plan: planId, value: data.amount, currency: CURRENCY, method: 'spei' })
    } catch {
      setPhase('offer')
      setError('Sin conexión. Revisa tu internet e intenta de nuevo.')
    } finally {
      busy.current = false
    }
  }

  // Aguarda a confirmação do SPEI da oferta atual.
  useEffect(() => {
    if (phase !== 'pay' || !charge) return
    let stopped = false
    const check = async () => {
      try {
        const response = await fetch(`/api/checkout-status?id=${encodeURIComponent(charge.id)}`)
        if (!response.ok || stopped) return
        const { status } = await response.json()
        if (stopped) return
        if (status === 'paid') {
          writeJson(sessionStorage, CHARGE_KEY, null)
          track(EVENTS.PAYMENT_APPROVED, { plan: charge.planId, value: charge.amount, currency: CURRENCY, method: 'spei', transaction_id: charge.id })
          setPhase('paid')
        } else if (status === 'expired' || status === 'failed') {
          writeJson(sessionStorage, CHARGE_KEY, null)
          requestRef.current = null
          setCharge(null)
          setPhase('offer')
          setError(status === 'expired' ? 'Tu pago venció. Genera uno nuevo para continuar.' : 'Pago no aprobado. Intenta de nuevo.')
        }
      } catch {
        /* tenta de novo no próximo ciclo */
      }
    }
    check()
    const timer = setInterval(check, POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [phase, charge])

  // Pack e VIP seguem sozinhos para a próxima oferta; o WhatsApp espera o número.
  useEffect(() => {
    if (phase !== 'paid' || planId === 'upsell-whatsapp') return
    const timer = setTimeout(next, 2200)
    return () => clearTimeout(timer)
  }, [phase, planId])

  const copyClabe = async () => {
    try {
      await navigator.clipboard.writeText(charge.deposit.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  const savePhone = async (event) => {
    event.preventDefault()
    // Acepta el número con o sin +52 / +521.
    const digits = onlyDigits(phone).replace(/^52(1)?(?=\d{10}$)/, '')
    if (digits.length !== 10) {
      setError('Escribe tu WhatsApp a 10 dígitos.')
      return
    }
    setPhase('saving')
    setError('')
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'whatsapp', phone: digits }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setPhase('paid')
        setError(data.error || 'No se pudo guardar en este momento. Intenta de nuevo.')
        return
      }
      next()
    } catch {
      setPhase('paid')
      setError('Sin conexión. Revisa tu internet e intenta de nuevo.')
    }
  }

  if (!plan) return <div className="app-loading" aria-label="Abriendo tu plática" />
  const Icon = offer.icon

  return (
    <div className="upsell-root">
      <header className="upsell-topbar">
        <div className="upsell-brand">
          <strong>PISKOU</strong>
          <span>VIP</span>
        </div>
        <ol className="upsell-steps" aria-label={`Oferta ${step + 1} de ${UPSELL_SEQUENCE.length}`}>
          {UPSELL_SEQUENCE.map((id, index) => (
            <li key={id} className={index < step ? 'done' : index === step ? 'active' : ''} aria-current={index === step ? 'step' : undefined} />
          ))}
        </ol>
      </header>

      <main className="upsell-main">
        {step === 0 && phase === 'offer' && (
          <p className="upsell-approved">
            <CircleCheck size={18} aria-hidden="true" /> ¡Pago aprobado! Tu acceso ya está asegurado.
          </p>
        )}

        {(phase === 'offer' || phase === 'creating') && (
          <section className="upsell-card" aria-labelledby="upsell-title">
            <div className="upsell-visual">
              <img src={image} alt={`Retrato de ${name}`} />
              <span className="upsell-visual-icon" aria-hidden="true">
                {planId === 'upsell-video-pack' ? <PlayCircle size={34} /> : <Icon size={30} />}
              </span>
              <span className="upsell-eyebrow">{offer.eyebrow}</span>
            </div>
            <div className="upsell-copy">
              <h1 id="upsell-title">{offer.title(name)}</h1>
              <p>{offer.text(name)}</p>
              <ul>
                {offer.bullets(name).map((item) => (
                  <li key={item}>
                    <Check size={16} strokeWidth={3} aria-hidden="true" /> {item}
                  </li>
                ))}
              </ul>
              <div className="upsell-price">
                <strong>{formatPrice(plan.price)}</strong>
                <span>{planId === 'upsell-vip' ? <><Infinity size={15} aria-hidden="true" /> para siempre</> : 'pago único'}</span>
              </div>
              {needsBuyer && (
                <div className="upsell-buyer">
                  <label>
                    Tu nombre
                    <input value={buyer.name} onChange={(event) => setBuyer({ ...buyer, name: event.target.value })} autoComplete="name" />
                  </label>
                  <label>
                    Tu correo
                    <input type="email" value={buyer.email} onChange={(event) => setBuyer({ ...buyer, email: event.target.value })} autoComplete="email" />
                  </label>
                </div>
              )}
              {error && <p className="upsell-error" role="alert">{error}</p>}
              <button type="button" className="upsell-accept" onClick={accept} disabled={phase === 'creating'}>
                {phase === 'creating' ? (
                  <>
                    <LoaderCircle className="upsell-spin" size={18} /> GENERANDO CLABE...
                  </>
                ) : (
                  `${offer.cta} · ${formatPrice(plan.price)}`
                )}
              </button>
              <button type="button" className="upsell-decline" onClick={next} disabled={phase === 'creating'}>
                No, gracias
              </button>
              <p className="upsell-secure">
                <ShieldCheck size={14} aria-hidden="true" /> Un clic · SPEI · sin volver a llenar tus datos
              </p>
            </div>
          </section>
        )}

        {phase === 'pay' && charge && (
          <section className="upsell-card upsell-pix" aria-live="polite">
            <span className="upsell-eyebrow">PAGA CON SPEI</span>
            <h1>{plan.name}</h1>
            <p className="upsell-pix-amount">{formatPrice(charge.amount)}</p>
            <label className="upsell-clabe">
              CLABE (18 dígitos)
              <input id="upsell-clabe" readOnly value={charge.deposit.code} onFocus={(event) => event.target.select()} />
            </label>
            <button type="button" className="upsell-accept" onClick={copyClabe}>
              {copied ? <><Check size={18} /> CLABE COPIADA</> : <><Copy size={18} /> COPIAR CLABE</>}
            </button>
            <p className="upsell-waiting">
              <LoaderCircle className="upsell-spin" size={16} aria-hidden="true" /> Transfiere exactamente {formatPrice(charge.amount)} por SPEI desde la app de tu banco. Esta pantalla se actualiza sola.
            </p>
            {error && <p className="upsell-error" role="alert">{error}</p>}
            <button type="button" className="upsell-decline" onClick={next}>
              Ya no quiero esta oferta
            </button>
          </section>
        )}

        {(phase === 'paid' || phase === 'saving') && (
          <section className="upsell-card upsell-done" aria-live="polite">
            <CircleCheck size={46} aria-hidden="true" />
            <h1>{offer.paid}</h1>
            {planId === 'upsell-whatsapp' ? (
              <form className="upsell-phone" onSubmit={savePhone}>
                <label htmlFor="upsell-phone">Tu WhatsApp a 10 dígitos</label>
                <div>
                  <Phone size={18} aria-hidden="true" />
                  <input
                    id="upsell-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder="55 1234 5678"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </div>
                {error && <p className="upsell-error" role="alert">{error}</p>}
                <button type="submit" className="upsell-accept" disabled={phase === 'saving'}>
                  {phase === 'saving' ? <><LoaderCircle className="upsell-spin" size={18} /> GUARDANDO...</> : 'CONFIRMAR MI WHATSAPP'}
                </button>
              </form>
            ) : (
              <>
                <p>Ya está en tu cuenta.</p>
                <button type="button" className="upsell-accept" onClick={next}>
                  CONTINUAR
                </button>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
