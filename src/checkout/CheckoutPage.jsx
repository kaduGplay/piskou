import { readSavedSelection } from '../shared/progress.js'
import { analyticsIdentity } from '../shared/analytics.js'
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import {
  ArrowLeft,
  Check,
  CircleCheck,
  Clock,
  Copy,
  CreditCard,
  LoaderCircle,
  Lock,
  QrCode,
} from 'lucide-react'
import { EVENTS, track } from '../funnel/data.js'
import {
  PLANS,
  SELECTION_STORAGE_KEY,
  formatBRL,
  onlyDigits,
  pickCampaignParams,
  validateCustomer,
  quoteCheckout,
  BUYER_STORAGE_KEY,
} from '../shared/checkout.js'
import { tokenizeCard } from './gatewayClient.js'
import {
  CharacterHero,
  CheckoutBanner,
  Faq,
  HowItWorks,
  OrderSummary,
  PlanIncludes,
  PlanPicker,
  Reviews,
  OrderBumps,
  StickyCta,
  TrustBadges,
} from './CheckoutSections.jsx'
import './Checkout.css'

// A tela consulta o nosso servidor (que lê o status gravado pelo webhook), nunca o gateway direto.
const POLL_INTERVAL_MS = 5000
const POLL_LIMIT_MS = 60 * 60 * 1000

const PAYMENT_METHODS = [
  { key: 'pix', label: 'PIX', note: 'Aprobación al instante', icon: QrCode },
  { key: 'card', label: 'Tarjeta de crédito', note: 'En una sola exhibición', icon: CreditCard },
]

const maskCardNumber = (value) => onlyDigits(value).slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ')

function maskExpiry(value) {
  const d = onlyDigits(value).slice(0, 4)
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}

function passesLuhn(number) {
  let sum = 0
  for (let i = 0; i < number.length; i++) {
    let digit = Number(number[number.length - 1 - i])
    if (i % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}

function validateCard(card) {
  const errors = {}
  const number = onlyDigits(card.number)
  if (number.length < 13 || !passesLuhn(number)) errors.cardNumber = 'Número de tarjeta inválido.'
  if (card.holder.trim().length < 3) errors.cardHolder = 'Escribe el nombre como aparece en la tarjeta.'
  const [month, year] = card.expiry.split('/').map(Number)
  const expiresAt = new Date(2000 + year, month)
  if (!(month >= 1 && month <= 12) || !year || expiresAt <= new Date()) errors.cardExpiry = 'Fecha de vencimiento inválida.'
  if (!/^\d{3,4}$/.test(card.cvv)) errors.cardCvv = 'CVV inválido.'
  return errors
}

function readSelection() {
  try {
    const saved = readSavedSelection()
    return saved?.name && saved?.personality && Number(saved.age) >= 18 ? saved : null
  } catch {
    return null
  }
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function Field({ label, error, hint, children }) {
  return (
    <label className={`checkout-field${error ? ' invalid' : ''}`}>
      <span>{label}</span>
      {children}
      {error ? <small className="checkout-field-error">{error}</small> : hint && <small>{hint}</small>}
    </label>
  )
}

export default function CheckoutPage() {
  const params = new URLSearchParams(window.location.search)
  // Upsells só são vendidos na página de ofertas, nunca por este formulário.
  const [planId, setPlanId] = useState(() => (PLANS[params.get('plano')] && PLANS[params.get('plano')].purpose !== 'upsell' ? params.get('plano') : 'premium-access'))
  const plan = PLANS[planId]
  const afterPayment = plan.purpose ? '/chat' : '/oferta'
  const [selectedBumps, setSelectedBumps] = useState([])
  // Uma seleção salva que não vale mais para o plano não pode derrubar a página.
  let quote
  try { quote = quoteCheckout(planId, selectedBumps) } catch { quote = quoteCheckout(planId, []) }
  const totalPlan = { ...plan, price: quote.amount }
  const [selection] = useState(readSelection)
  const [customer, setCustomer] = useState({ name: '', email: '' })
  const [method, setMethod] = useState('pix')
  const [methods, setMethods] = useState(['pix'])
  const [unavailable, setUnavailable] = useState(false)
  const [configReady, setConfigReady] = useState(false)
  const submissionGuard = useRef(false)
  const [card, setCard] = useState({ number: '', holder: '', expiry: '', cvv: '' })
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')
  const [phase, setPhase] = useState('form')
  const [charge, setCharge] = useState(null)
  const [qrImage, setQrImage] = useState('')
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [stickyVisible, setStickyVisible] = useState(false)
  const approvedRef = useRef(false)
  useEffect(() => {
    try {
      const saved=JSON.parse(localStorage.getItem('piskou:pendingCharge') || 'null')
      const savedQuote = saved ? quoteCheckout(planId, saved.addons || []) : null
      if(saved && saved.planId===planId && saved.amount===savedQuote.amount && Date.now()-saved.createdAt<90*86400000 && (!saved.selectionKey || saved.selectionKey === JSON.stringify(selection))) {
        if (saved.pix?.expiresAt && new Date(saved.pix.expiresAt).getTime() <= Date.now()) {
          localStorage.removeItem('piskou:pendingCharge')
          sessionStorage.removeItem(`piskou:pix-request:${planId}:${savedQuote?.totalCents}:${savedQuote?.addonIds.join(",")}:${JSON.stringify(selection)}`)
        } else {
          setSelectedBumps(savedQuote.addonIds)
          setCharge(saved)
          setPhase(saved.pix?.copyPaste ? 'pix' : 'processing')
        }
      }
    } catch {}
  }, [])
  useEffect(() => {
    if(phase !== 'paid') return
    // Depois do Baby/Pro vêm as ofertas de um clique; pacotes de mensagens voltam direto para a conversa.
    const timer=setTimeout(()=>window.location.assign(afterPayment),1500)
    return ()=>clearTimeout(timer)
  }, [phase])
  const formRef = useRef(null)
  const submitRef = useRef(null)
  const luxury = plan.tier === 'luxury'

  // O gateway atual define as formas de pagamento (a Void Payments só aceita PIX).
  useEffect(() => {
    fetch('/api/checkout-config')
      .then((response) => response.json())
      .then((config) => {
        if (config.available === false) setUnavailable(true)
        if (Array.isArray(config.methods) && config.methods.length > 0) setMethods(config.methods)
      })
      .catch(() => { setUnavailable(true) })
      .finally(() => setConfigReady(true))
  }, [])

  useEffect(() => {
    document.title = 'Checkout | Piskou Create'
    track(EVENTS.CHECKOUT_VIEW, { plan: plan.id, value: plan.price, currency: 'BRL' })
  }, []) // só na entrada; trocas de plano têm evento próprio

  // A barra fixa aparece quando o botão principal sai da tela.
  useEffect(() => {
    const button = submitRef.current
    if (phase !== 'form' || !button || !('IntersectionObserver' in window)) {
      setStickyVisible(false)
      return
    }
    const observer = new IntersectionObserver(([entry]) => setStickyVisible(!entry.isIntersecting))
    observer.observe(button)
    return () => observer.disconnect()
  }, [phase])

  const choosePlan = (id) => {
    if (id === planId || !PLANS[id]) return
    setSelectedBumps([])
    setCharge(null)
    setPlanId(id)
    setServerError('')
    const url = new URL(window.location.href)
    url.searchParams.set('plano', id)
    window.history.replaceState(null, '', url)
    track(EVENTS.CHECKOUT_PLAN_CHANGE, { plan: id, value: PLANS[id].price, currency: 'BRL' })
  }

  const upgradeToLuxury = () => {
    choosePlan(plan.purpose === 'messages' ? 'messages-unlimited' : 'luxury-access')
    document.getElementById('checkout-plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const collectErrors = (nextCustomer = customer, nextCard = card, nextMethod = method) => ({
    ...validateCustomer(nextCustomer),
    ...(nextMethod === 'card' ? validateCard(nextCard) : {}),
  })

  const approve = (paidCharge) => {
    setPhase('paid')
    try { localStorage.removeItem('piskou:pendingCharge') } catch {}
    if (approvedRef.current) return
    approvedRef.current = true
    track(EVENTS.PAYMENT_APPROVED, {
      plan: plan.id,
      value: paidCharge?.amount ?? quote.amount,
      currency: 'BRL',
      method: paidCharge?.method ?? method,
      transaction_id: paidCharge?.id,
    })
  }

  // Enquanto o PIX (ou um cartão em análise) não é confirmado, consulta o status a cada 5 s, por até 1 hora.
  useEffect(() => {
    if (!charge) return
    let stopped = false
    const startedAt = Date.now()
    const check = async () => {
      if (Date.now() - startedAt > POLL_LIMIT_MS) {
        clearInterval(timer)
        return
      }
      try {
        const response = await fetch(`/api/checkout-status?id=${encodeURIComponent(charge.id)}`)
        if (!response.ok || stopped) return
        const { status } = await response.json()
        if (stopped) return
        if (status === 'paid') approve(charge)
        else if (status === 'expired') { approvedRef.current=false; setPhase('expired') }
        else if (status === 'failed') {
          try { sessionStorage.removeItem(`piskou:pix-request:${plan.id}:${quote.totalCents}:${quote.addonIds.join(",")}:${JSON.stringify(selection)}`) } catch {}
          approvedRef.current=false;
          setPhase('form')
          setServerError('Pago no aprobado. Intenta de nuevo o usa otra forma de pago.')
        }
        else if (status === 'pending' || status === 'processing') {
          approvedRef.current=false;
          const freshPix=charge.method==='pix' && charge.pix?.copyPaste && (!charge.pix.expiresAt || new Date(charge.pix.expiresAt).getTime()>Date.now())
          if (freshPix) setPhase('pix')
          else if (phase !== 'expired') setPhase('processing')
        }
      } catch {
        // tenta de novo no próximo intervalo
      }
    }
    const timer = setInterval(check, POLL_INTERVAL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [charge, phase])

  useEffect(() => {
    if (!charge?.pix?.copyPaste) return
    QRCode.toDataURL(charge.pix.copyPaste, { margin: 1, width: 480, errorCorrectionLevel: 'M' })
      .then(setQrImage)
      .catch(() => setQrImage(''))
  }, [charge])

  useEffect(() => {
    if (phase !== 'pix') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [phase])

  const pixRemaining = charge?.pix?.expiresAt ? new Date(charge.pix.expiresAt).getTime() - now : 0
  useEffect(() => {
    if (phase === 'pix' && charge?.pix?.expiresAt && pixRemaining <= 0) setPhase('expired')
  }, [phase, charge, pixRemaining])

  const updateCustomer = (field, value) => {
    const next = { ...customer, [field]: value }
    setCustomer(next)
    if (touched[field]) setErrors(collectErrors(next))
  }

  const updateCard = (field, value) => {
    const next = { ...card, [field]: value }
    setCard(next)
    if (touched[field]) setErrors(collectErrors(customer, next))
  }

  const blur = (field) => {
    setTouched((prev) => ({ ...prev, [field]: true }))
    setErrors(collectErrors())
  }

  const fieldError = (field) => (touched[field] ? errors[field] : undefined)

  const submit = async (event) => {
    event?.preventDefault()
    if (submissionGuard.current || unavailable || !selection) return
    const found = collectErrors()
    setErrors(found)
    setTouched(Object.fromEntries(Object.keys({ ...customer, cardNumber: 1, cardHolder: 1, cardExpiry: 1, cardCvv: 1 }).map((k) => [k, true])))
    if (Object.keys(found).length > 0) {
      document.querySelector(`[name="${Object.keys(found)[0]}"]`)?.focus()
      return
    }

    submissionGuard.current = true
    try { sessionStorage.setItem(BUYER_STORAGE_KEY, JSON.stringify({ name: customer.name.trim(), email: customer.email.trim() })) } catch {}
    setSubmitting(true)
    setServerError('')
    try {
      let cardToken
      if (method === 'card') {
        const [expMonth, expYear] = card.expiry.split('/')
        cardToken = await tokenizeCard({
          number: onlyDigits(card.number),
          holder: card.holder.trim(),
          expMonth,
          expYear: `20${expYear}`,
          cvv: card.cvv,
        })
      }
      let requestId
      if (method === 'pix') {
        const key = `piskou:pix-request:${plan.id}:${quote.totalCents}:${quote.addonIds.join(",")}:${JSON.stringify(selection)}`
        try {
          requestId = sessionStorage.getItem(key) || crypto.randomUUID()
          sessionStorage.setItem(key, requestId)
        } catch { requestId = crypto.randomUUID() }
      }
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: plan.id,
          addons: quote.addonIds,
          requestId,
          selection,
          analyticsSession: analyticsIdentity().session,
          method,
          customer,
          cardToken,
          tracking: pickCampaignParams(params),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        track('CheckoutErro')
        if (data.fields) setErrors(data.fields)
        setServerError(data.error || 'No se pudo procesar el pago. Intenta de nuevo.')
        return
      }
      setCharge(data)
      if (data.status !== 'failed' && data.status !== 'paid') { try { localStorage.setItem('piskou:pendingCharge',JSON.stringify({id:data.id,planId:plan.id,amount:data.amount,addons:data.addons || quote.addonIds,method,createdAt:Date.now(),pix:data.pix,selectionKey:JSON.stringify(selection)})) } catch {} }
      if (data.status === 'paid') approve(data)
      else if (data.status === 'failed') {
        try { sessionStorage.removeItem(`piskou:pix-request:${plan.id}:${quote.totalCents}:${quote.addonIds.join(",")}:${JSON.stringify(selection)}`) } catch {}
        setServerError(
          method === 'pix'
            ? 'No se pudo generar el PIX en este momento. Intenta de nuevo en unos instantes.'
            : 'Pago rechazado. Revisa los datos de la tarjeta o paga con PIX.',
        )
      } else if (data.status === 'processing') {
        setPhase('processing')
      } else if (method === 'pix') {
        setNow(Date.now())
        setPhase('pix')
        track(EVENTS.PIX_GENERATED, { plan: plan.id, value: data.amount, currency: 'BRL' })
      } else {
        setPhase('processing')
      }
    } catch {
      track('CheckoutErro')
      setServerError('Sin conexión. Revisa tu internet e intenta de nuevo.')
    } finally {
      submissionGuard.current = false
      setSubmitting(false)
    }
  }

  const copyPix = async () => {
    try {
      await navigator.clipboard.writeText(charge.pix.copyPaste)
    } catch {
      document.getElementById('pix-code')?.select()
      document.execCommand?.('copy')
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const goBack = (event) => {
    if (document.referrer.startsWith(window.location.origin) && window.history.length > 1) {
      event.preventDefault()
      window.history.back()
    }
  }

  return (
    <div className="checkout-root">
      <header className="checkout-topbar">
        <a href="/?edit=1" className="checkout-back" onClick={goBack} aria-label="Regresar">
          <ArrowLeft size={20} />
        </a>
        <div className="checkout-brand">
          <strong>PISKOU</strong>
          <span>CHECKOUT</span>
        </div>
        <span className="checkout-secure">
          <Lock size={13} aria-hidden="true" /> Seguro
        </span>
      </header>

      <main className={`checkout-main${phase === 'form' ? ' with-sticky' : ''}`}>
        <CheckoutBanner />
        {phase === 'form' ? (
          <>
            <CharacterHero selection={selection} />
            {!submitting && <PlanPicker planId={planId} onChange={choosePlan} />}
          </>
        ) : (
          <OrderSummary plan={totalPlan} selection={selection} addons={quote.addons} />
        )}

        {phase === 'form' && (
          <form className="checkout-form" ref={formRef} onSubmit={submit} noValidate>
            <fieldset>
              <legend>Tus datos</legend>
              <Field label="Nombre" error={fieldError('name')}>
                <input
                  name="name"
                  autoComplete="name"
                  maxLength={60}
                  value={customer.name}
                  onChange={(e) => updateCustomer('name', e.target.value)}
                  onBlur={() => blur('name')}
                  placeholder="Tu nombre"
                />
              </Field>
              <Field
                label="Correo electrónico"
                error={fieldError('email')}
                hint="Usamos tu correo para identificar tu pedido."
              >
                <input
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={customer.email}
                  onChange={(e) => updateCustomer('email', e.target.value)}
                  onBlur={() => blur('email')}
                  placeholder="tu@correo.com"
                />
              </Field>
            </fieldset>

            <fieldset>
              <legend>Pago</legend>
              <div
                className={`checkout-methods${methods.length === 1 ? ' single' : ''}`}
                role="radiogroup"
                aria-label="Forma de pago"
              >
                {PAYMENT_METHODS.filter((m) => methods.includes(m.key)).map(({ key, label, note, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={method === key}
                    className={`checkout-method${method === key ? ' selected' : ''}`}
                    onClick={() => {
                      setMethod(key)
                      setServerError('')
                      setErrors(collectErrors(customer, card, key))
                    }}
                  >
                    <Icon size={20} aria-hidden="true" />
                    <span>
                      <strong>{label}</strong>
                      <small>{note}</small>
                    </span>
                    <span className="checkout-method-radio">{method === key && <Check size={12} strokeWidth={3} />}</span>
                  </button>
                ))}
              </div>

              {method === 'card' && (
                <div className="checkout-card-fields">
                  <Field label="Número de tarjeta" error={fieldError('cardNumber')}>
                    <input
                      name="cardNumber"
                      inputMode="numeric"
                      autoComplete="cc-number"
                      value={card.number}
                      onChange={(e) => updateCard('number', maskCardNumber(e.target.value))}
                      onBlur={() => blur('cardNumber')}
                      placeholder="0000 0000 0000 0000"
                    />
                  </Field>
                  <Field label="Nombre como aparece en la tarjeta" error={fieldError('cardHolder')}>
                    <input
                      name="cardHolder"
                      autoComplete="cc-name"
                      value={card.holder}
                      onChange={(e) => updateCard('holder', e.target.value.toUpperCase())}
                      onBlur={() => blur('cardHolder')}
                      placeholder="NOMBRE COMO EN LA TARJETA"
                    />
                  </Field>
                  <div className="checkout-row">
                    <Field label="Vencimiento" error={fieldError('cardExpiry')}>
                      <input
                        name="cardExpiry"
                        inputMode="numeric"
                        autoComplete="cc-exp"
                        value={card.expiry}
                        onChange={(e) => updateCard('expiry', maskExpiry(e.target.value))}
                        onBlur={() => blur('cardExpiry')}
                        placeholder="MM/AA"
                      />
                    </Field>
                    <Field label="CVV" error={fieldError('cardCvv')}>
                      <input
                        name="cardCvv"
                        inputMode="numeric"
                        autoComplete="cc-csc"
                        value={card.cvv}
                        onChange={(e) => updateCard('cvv', onlyDigits(e.target.value).slice(0, 4))}
                        onBlur={() => blur('cardCvv')}
                        placeholder="123"
                      />
                    </Field>
                  </div>
                </div>
              )}
            </fieldset>

            {!selection && <p className="checkout-error" role="alert">Configura a tu personaje antes de comprar. <a href="/">Volver al creador</a></p>}
            {(serverError || unavailable) && (
              <p className="checkout-error" role="alert">
                {unavailable ? 'El pago no está disponible en este momento. Intenta de nuevo en unos minutos.' : serverError}
              </p>
            )}

            <OrderBumps plan={plan} selected={selectedBumps} onChange={setSelectedBumps} disabled={submitting} />
            <div className="checkout-cart-total" aria-live="polite"><span>Plan {plan.name}<b>{formatBRL(plan.price)}</b></span>{quote.addons.map((item) => <span key={item.id}>{item.name}<b>+ {formatBRL(item.price)}</b></span>)}<strong>Total del pedido<b>{formatBRL(quote.amount)}</b></strong></div>

            <button
              ref={submitRef}
              type="submit"
              className={`checkout-submit${luxury ? ' luxury' : ''}`}
              disabled={submitting || unavailable || !configReady || !selection}
            >
              {submitting ? (
                <>
                  <LoaderCircle className="checkout-spin" size={18} /> PROCESANDO...
                </>
              ) : method === 'pix' ? (
                `${serverError ? 'INTENTAR DE NUEVO ·' : 'GENERAR PIX DE'} ${formatBRL(quote.amount)}`
              ) : (
                `PAGAR ${formatBRL(quote.amount)}`
              )}
            </button>
            <TrustBadges />
          </form>
        )}

        {phase === 'pix' && charge?.pix && (
          <section className="checkout-pix" aria-live="polite">
            {charge.testMode && (
              <p className="checkout-test-banner">Modo de prueba: no se cobra nada. Este PIX se aprueba solo en unos segundos.</p>
            )}
            <h1>Paga con PIX</h1>
            <p className="checkout-pix-amount">{formatBRL(charge.amount)}</p>
            <div className="checkout-qr">
              {qrImage ? <img src={qrImage} alt="Código QR del PIX" /> : <LoaderCircle className="checkout-spin" size={28} />}
            </div>
            <label className="checkout-copy">
              <span>PIX copiar y pegar</span>
              <input id="pix-code" readOnly value={charge.pix.copyPaste} onFocus={(e) => e.target.select()} />
            </label>
            <button type="button" className="checkout-submit" onClick={copyPix}>
              {copied ? (
                <>
                  <Check size={18} /> CÓDIGO COPIADO
                </>
              ) : (
                <>
                  <Copy size={18} /> COPIAR CÓDIGO PIX
                </>
              )}
            </button>
            <p className="checkout-waiting">
              <LoaderCircle className="checkout-spin" size={15} /> Esperando el pago
              {charge.pix.expiresAt && (
                <>
                  {' '}
                  · <Clock size={13} aria-hidden="true" /> vence en {formatCountdown(pixRemaining)}
                </>
              )}
            </p>
            <ol className="checkout-steps">
              <li>Abre la app de tu banco y entra a la sección PIX.</li>
              <li>Elige pagar con código QR o con PIX copiar y pegar.</li>
              <li>Confirma el pago. Esta página se actualiza sola.</li>
            </ol>
          </section>
        )}

        {phase === 'processing' && (
          <section className="checkout-status" aria-live="polite">
            <LoaderCircle className="checkout-spin" size={36} />
            <h1>Procesando pago</h1>
            <p>Estamos verificando la confirmación de tu pago. Esta pantalla se actualiza automáticamente.</p>
          </section>
        )}

        {phase === 'expired' && (
          <section className="checkout-status">
            <Clock size={36} />
            <h1>El PIX venció</h1>
            <p>El código no se pagó a tiempo. Genera uno nuevo para completar tu compra.</p>
            <button
              type="button"
              className={`checkout-submit${luxury ? ' luxury' : ''}`}
              onClick={() => {
                try { sessionStorage.removeItem(`piskou:pix-request:${plan.id}:${quote.totalCents}:${quote.addonIds.join(",")}:${JSON.stringify(selection)}`); localStorage.removeItem('piskou:pendingCharge') } catch {}
                setCharge(null)
                setQrImage('')
                setPhase('form')
              }}
            >
              GENERAR NUEVO PIX
            </button>
          </section>
        )}

        {phase === 'form' && (
          <>
            <PlanIncludes plan={plan} onUpgrade={upgradeToLuxury} />
            <HowItWorks name={selection?.name} />
            <Reviews />
            <Faq />
          </>
        )}

        {phase === 'pix' && <Reviews />}

        {phase === 'paid' && (
          <section className="checkout-status success" aria-live="polite">
            <CircleCheck size={44} />
            <h1>¡Pago aprobado!</h1>
            <p>
              Tu acceso está confirmado. {afterPayment === '/chat' ? 'Estamos abriendo tu plática.' : 'Un momento.'}
            </p>
            <a href={afterPayment}>{afterPayment === '/chat' ? 'Ir a la plática' : 'Continuar'}</a>
          </section>
        )}
      </main>

      {phase === 'form' && (
        <StickyCta
          visible={stickyVisible}
          plan={totalPlan}
          label={method === 'pix' ? 'GENERAR PIX' : 'PAGAR'}
          disabled={submitting || unavailable || !configReady || !selection}
          onClick={() => formRef.current?.requestSubmit()}
        />
      )}
    </div>
  )
}
