import { readSavedSelection } from '../shared/progress.js'
import { analyticsIdentity } from '../shared/analytics.js'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  CircleCheck,
  Clock,
  Copy,
  Landmark,
  LoaderCircle,
  Lock,
  Store,
} from 'lucide-react'
import { EVENTS, track } from '../funnel/data.js'
import {
  CURRENCY,
  PLANS,
  SELECTION_STORAGE_KEY,
  formatPrice,
  pickCampaignParams,
  validateCustomer,
  quoteCheckout,
  BUYER_STORAGE_KEY,
} from '../shared/checkout.js'
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
  { key: 'spei', label: 'SPEI', note: 'Transferencia desde tu banco · se confirma en segundos', icon: Landmark },
  { key: 'oxxo', label: 'OXXO', note: 'Efectivo en tienda · puede tardar unas horas', icon: Store },
]

function readSelection() {
  try {
    const saved = readSavedSelection()
    return saved?.name && saved?.personality && Number(saved.age) >= 18 ? saved : null
  } catch {
    return null
  }
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
  const [method, setMethod] = useState('spei')
  const [methods, setMethods] = useState(['spei', 'oxxo'])
  const [unavailable, setUnavailable] = useState(false)
  const [configReady, setConfigReady] = useState(false)
  const submissionGuard = useRef(false)
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')
  const [phase, setPhase] = useState('form')
  const [charge, setCharge] = useState(null)
  const [copied, setCopied] = useState(false)
  const [stickyVisible, setStickyVisible] = useState(false)
  const approvedRef = useRef(false)
  // Mesmo pedido (plano, extras, forma de pagamento e personagem) reaproveita o requestId: o servidor não cria cobrança repetida.
  const requestStorageKey = (forMethod = method, forQuote = quote) =>
    `piskou:payment-request:${plan.id}:${forQuote.totalCents}:${forQuote.addonIds.join(',')}:${forMethod}:${JSON.stringify(selection)}`
  useEffect(() => {
    try {
      const saved=JSON.parse(localStorage.getItem('piskou:pendingCharge') || 'null')
      const savedQuote = saved ? quoteCheckout(planId, saved.addons || []) : null
      // Cobranças salvas antes da troca para SPEI/OXXO (sem deposit) não são retomadas.
      if(saved?.deposit?.code && saved.planId===planId && saved.amount===savedQuote.amount && Date.now()-saved.createdAt<90*86400000 && (!saved.selectionKey || saved.selectionKey === JSON.stringify(selection))) {
        setSelectedBumps(savedQuote.addonIds)
        if (saved.method) setMethod(saved.method)
        setCharge(saved)
        setPhase('deposit')
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

  // O gateway atual define as formas de pagamento (LiberPay: SPEI e OXXO).
  useEffect(() => {
    fetch('/api/checkout-config')
      .then((response) => response.json())
      .then((config) => {
        if (config.available === false) setUnavailable(true)
        if (Array.isArray(config.methods) && config.methods.length > 0) {
          setMethods(config.methods)
          setMethod((current) => (config.methods.includes(current) ? current : config.methods[0]))
        }
      })
      .catch(() => { setUnavailable(true) })
      .finally(() => setConfigReady(true))
  }, [])

  useEffect(() => {
    document.title = 'Checkout | Piskou Create'
    track(EVENTS.CHECKOUT_VIEW, { plan: plan.id, value: plan.price, currency: CURRENCY })
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
    track(EVENTS.CHECKOUT_PLAN_CHANGE, { plan: id, value: PLANS[id].price, currency: CURRENCY })
  }

  const upgradeToLuxury = () => {
    choosePlan(plan.purpose === 'messages' ? 'messages-unlimited' : 'luxury-access')
    document.getElementById('checkout-plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const collectErrors = (nextCustomer = customer) => validateCustomer(nextCustomer)

  const approve = (paidCharge) => {
    setPhase('paid')
    try { localStorage.removeItem('piskou:pendingCharge') } catch {}
    if (approvedRef.current) return
    approvedRef.current = true
    track(EVENTS.PAYMENT_APPROVED, {
      plan: plan.id,
      value: paidCharge?.amount ?? quote.amount,
      currency: CURRENCY,
      method: paidCharge?.method ?? method,
      transaction_id: paidCharge?.id,
    })
  }

  // Enquanto o SPEI ou o OXXO não é confirmado, consulta o status a cada 5 s, por até 1 hora (OXXO pode levar mais: ao voltar à página, a consulta recomeça).
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
          try { sessionStorage.removeItem(requestStorageKey(charge.method)) } catch {}
          approvedRef.current=false;
          setPhase('form')
          setServerError('Pago no aprobado. Intenta de nuevo o usa otra forma de pago.')
        }
        else if (status === 'pending' || status === 'processing') {
          approvedRef.current=false;
          if (charge.deposit?.code) setPhase('deposit')
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

  const updateCustomer = (field, value) => {
    const next = { ...customer, [field]: value }
    setCustomer(next)
    if (touched[field]) setErrors(collectErrors(next))
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
    setTouched(Object.fromEntries(Object.keys(customer).map((k) => [k, true])))
    if (Object.keys(found).length > 0) {
      document.querySelector(`[name="${Object.keys(found)[0]}"]`)?.focus()
      return
    }

    submissionGuard.current = true
    try { sessionStorage.setItem(BUYER_STORAGE_KEY, JSON.stringify({ name: customer.name.trim(), email: customer.email.trim() })) } catch {}
    setSubmitting(true)
    setServerError('')
    try {
      let requestId
      try {
        requestId = sessionStorage.getItem(requestStorageKey()) || crypto.randomUUID()
        sessionStorage.setItem(requestStorageKey(), requestId)
      } catch { requestId = crypto.randomUUID() }
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
      if (data.status !== 'failed' && data.status !== 'paid') { try { localStorage.setItem('piskou:pendingCharge',JSON.stringify({id:data.id,planId:plan.id,amount:data.amount,addons:data.addons || quote.addonIds,method,createdAt:Date.now(),deposit:data.deposit,testMode:data.testMode,selectionKey:JSON.stringify(selection)})) } catch {} }
      if (data.status === 'paid') approve(data)
      else if (data.status === 'failed') {
        try { sessionStorage.removeItem(requestStorageKey()) } catch {}
        setServerError('No se pudo generar tu pago en este momento. Intenta de nuevo en unos instantes.')
      } else if (data.status === 'processing') {
        setPhase('processing')
      } else if (data.deposit?.code) {
        setPhase('deposit')
        track(EVENTS.PIX_GENERATED, { plan: plan.id, value: data.amount, currency: CURRENCY, method })
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

  const copyCode = async (code, fieldId) => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      document.getElementById(fieldId)?.select()
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

            </fieldset>

            {!selection && <p className="checkout-error" role="alert">Configura a tu personaje antes de comprar. <a href="/">Volver al creador</a></p>}
            {(serverError || unavailable) && (
              <p className="checkout-error" role="alert">
                {unavailable ? 'El pago no está disponible en este momento. Intenta de nuevo en unos minutos.' : serverError}
              </p>
            )}

            <OrderBumps plan={plan} selected={selectedBumps} onChange={setSelectedBumps} disabled={submitting} />
            <div className="checkout-cart-total" aria-live="polite"><span>Plan {plan.name}<b>{formatPrice(plan.price)}</b></span>{quote.addons.map((item) => <span key={item.id}>{item.name}<b>+ {formatPrice(item.price)}</b></span>)}<strong>Total del pedido<b>{formatPrice(quote.amount)}</b></strong></div>

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
              ) : serverError ? (
                `INTENTAR DE NUEVO · ${formatPrice(quote.amount)}`
              ) : method === 'spei' ? (
                `PAGAR ${formatPrice(quote.amount)} CON SPEI`
              ) : (
                `GENERAR REFERENCIA OXXO · ${formatPrice(quote.amount)}`
              )}
            </button>
            <TrustBadges />
          </form>
        )}

        {phase === 'deposit' && charge?.deposit && (
          <section className="checkout-pix checkout-deposit" aria-live="polite">
            {charge.testMode && (
              <p className="checkout-test-banner">Modo de prueba: no se cobra nada. Este pago se aprueba solo en unos segundos.</p>
            )}
            <h1>{charge.deposit.method === 'oxxo' ? 'Paga en OXXO' : 'Paga con SPEI'}</h1>
            <p className="checkout-pix-amount">{formatPrice(charge.amount)}</p>
            {charge.deposit.method === 'oxxo' && charge.deposit.barcodeUrl && (
              <div className="checkout-barcode">
                <img src={charge.deposit.barcodeUrl} alt={`Código de barras de la referencia ${charge.deposit.code}`} />
              </div>
            )}
            <label className="checkout-copy">
              <span>{charge.deposit.method === 'oxxo' ? 'Referencia OXXO' : 'CLABE (18 dígitos)'}</span>
              <input id="deposit-code" readOnly value={charge.deposit.code} onFocus={(e) => e.target.select()} />
            </label>
            <button type="button" className="checkout-submit" onClick={() => copyCode(charge.deposit.code, 'deposit-code')}>
              {copied ? (
                <>
                  <Check size={18} /> COPIADO
                </>
              ) : (
                <>
                  <Copy size={18} /> {charge.deposit.method === 'oxxo' ? 'COPIAR REFERENCIA' : 'COPIAR CLABE'}
                </>
              )}
            </button>
            <p className="checkout-waiting">
              <LoaderCircle className="checkout-spin" size={15} /> Esperando el pago
            </p>
            <ol className="checkout-steps">
              {charge.deposit.method === 'oxxo' ? (
                <>
                  <li>Ve a cualquier tienda OXXO y dile al cajero que vas a hacer un pago de OXXO Pay.</li>
                  <li>Muestra el código de barras o dicta la referencia y paga {formatPrice(charge.amount)} en efectivo.</li>
                  <li>La confirmación puede tardar unas horas. Tu acceso se libera solo: vuelve a esta página para entrar.</li>
                </>
              ) : (
                <>
                  <li>Abre la app de tu banco y elige transferir por SPEI.</li>
                  <li>Pega la CLABE y envía exactamente {formatPrice(charge.amount)}.</li>
                  <li>La confirmación llega en segundos. Esta página se actualiza sola.</li>
                </>
              )}
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
            <h1>Tu pago venció</h1>
            <p>El pago no se completó a tiempo. Genera uno nuevo para terminar tu compra.</p>
            <button
              type="button"
              className={`checkout-submit${luxury ? ' luxury' : ''}`}
              onClick={() => {
                try { sessionStorage.removeItem(requestStorageKey()); localStorage.removeItem('piskou:pendingCharge') } catch {}
                setCharge(null)
                setPhase('form')
              }}
            >
              GENERAR UNO NUEVO
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

        {phase === 'deposit' && <Reviews />}

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
          label={method === 'oxxo' ? 'GENERAR REFERENCIA' : 'PAGAR CON SPEI'}
          disabled={submitting || unavailable || !configReady || !selection}
          onClick={() => formRef.current?.requestSubmit()}
        />
      )}
    </div>
  )
}
