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
} from '../shared/checkout.js'
import { tokenizeCard } from './gatewayClient.js'
import {
  CharacterHero,
  Faq,
  HowItWorks,
  OrderSummary,
  PlanIncludes,
  PlanPicker,
  Reviews,
  StickyCta,
  TrustBadges,
} from './CheckoutSections.jsx'
import './Checkout.css'

// A tela consulta o nosso servidor (que lê o status gravado pelo webhook), nunca o gateway direto.
const POLL_INTERVAL_MS = 5000
const POLL_LIMIT_MS = 60 * 60 * 1000

const PAYMENT_METHODS = [
  { key: 'pix', label: 'PIX', note: 'Aprovação na hora', icon: QrCode },
  { key: 'card', label: 'Cartão de crédito', note: 'À vista', icon: CreditCard },
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
  if (number.length < 13 || !passesLuhn(number)) errors.cardNumber = 'Número do cartão inválido.'
  if (card.holder.trim().length < 3) errors.cardHolder = 'Informe o nome impresso no cartão.'
  const [month, year] = card.expiry.split('/').map(Number)
  const expiresAt = new Date(2000 + year, month)
  if (!(month >= 1 && month <= 12) || !year || expiresAt <= new Date()) errors.cardExpiry = 'Validade inválida.'
  if (!/^\d{3,4}$/.test(card.cvv)) errors.cardCvv = 'CVV inválido.'
  return errors
}

function readSelection() {
  try {
    return JSON.parse(sessionStorage.getItem(SELECTION_STORAGE_KEY) ?? 'null')
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
  const [planId, setPlanId] = useState(() => (PLANS[params.get('plano')] ? params.get('plano') : 'premium-access'))
  const plan = PLANS[planId]
  const [selection] = useState(readSelection)
  const [customer, setCustomer] = useState({ name: '', email: '' })
  const [method, setMethod] = useState('pix')
  const [methods, setMethods] = useState(['pix'])
  const [unavailable, setUnavailable] = useState(false)
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
      .catch(() => {})
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
    setPlanId(id)
    setServerError('')
    const url = new URL(window.location.href)
    url.searchParams.set('plano', id)
    window.history.replaceState(null, '', url)
    track(EVENTS.CHECKOUT_PLAN_CHANGE, { plan: id, value: PLANS[id].price, currency: 'BRL' })
  }

  const upgradeToLuxury = () => {
    choosePlan('luxury-access')
    document.getElementById('checkout-plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const collectErrors = (nextCustomer = customer, nextCard = card, nextMethod = method) => ({
    ...validateCustomer(nextCustomer),
    ...(nextMethod === 'card' ? validateCard(nextCard) : {}),
  })

  const approve = (paidCharge) => {
    setPhase('paid')
    if (approvedRef.current) return
    approvedRef.current = true
    track(EVENTS.PAYMENT_APPROVED, {
      plan: plan.id,
      value: plan.price,
      currency: 'BRL',
      method: paidCharge?.method ?? method,
      transaction_id: paidCharge?.id,
    })
  }

  // Enquanto o PIX (ou um cartão em análise) não é confirmado, consulta o status a cada 5 s, por até 1 hora.
  useEffect(() => {
    if (!charge || (phase !== 'pix' && phase !== 'processing')) return
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
        else if (status === 'expired') setPhase('expired')
        else if (status === 'failed') {
          setPhase('form')
          setServerError('Pagamento não aprovado. Tente novamente ou use outra forma de pagamento.')
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
    event.preventDefault()
    const found = collectErrors()
    setErrors(found)
    setTouched(Object.fromEntries(Object.keys({ ...customer, cardNumber: 1, cardHolder: 1, cardExpiry: 1, cardCvv: 1 }).map((k) => [k, true])))
    if (Object.keys(found).length > 0) {
      document.querySelector(`[name="${Object.keys(found)[0]}"]`)?.focus()
      return
    }

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
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: plan.id,
          method,
          customer,
          cardToken,
          tracking: pickCampaignParams(params),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data.fields) setErrors(data.fields)
        setServerError(data.error || 'Não foi possível processar o pagamento. Tente novamente.')
        return
      }
      setCharge(data)
      if (data.status === 'paid') approve(data)
      else if (data.status === 'failed') {
        setServerError(
          method === 'pix'
            ? 'Não foi possível gerar o PIX agora. Tente novamente em instantes.'
            : 'Pagamento recusado. Confira os dados do cartão ou pague com PIX.',
        )
      } else if (method === 'pix') {
        setNow(Date.now())
        setPhase('pix')
        track(EVENTS.PIX_GENERATED, { plan: plan.id, value: plan.price, currency: 'BRL' })
      } else {
        setPhase('processing')
      }
    } catch {
      setServerError('Sem conexão. Verifique sua internet e tente novamente.')
    } finally {
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
        <a href="/" className="checkout-back" onClick={goBack} aria-label="Voltar">
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
        {phase === 'form' ? (
          <>
            <CharacterHero selection={selection} />
            <PlanPicker planId={planId} onChange={choosePlan} />
          </>
        ) : (
          <OrderSummary plan={plan} selection={selection} />
        )}

        {phase === 'form' && (
          <form className="checkout-form" ref={formRef} onSubmit={submit} noValidate>
            <fieldset>
              <legend>Sua conta</legend>
              <Field label="Como você prefere ser chamado?" error={fieldError('name')}>
                <input
                  name="name"
                  autoComplete="nickname"
                  maxLength={60}
                  value={customer.name}
                  onChange={(e) => updateCustomer('name', e.target.value)}
                  onBlur={() => blur('name')}
                  placeholder="Seu nome ou apelido"
                />
              </Field>
              <Field
                label="E-mail para criar sua conta"
                error={fieldError('email')}
                hint="Você vai usar este e-mail para entrar. O acesso também chega nele."
              >
                <input
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={customer.email}
                  onChange={(e) => updateCustomer('email', e.target.value)}
                  onBlur={() => blur('email')}
                  placeholder="voce@email.com"
                />
              </Field>
            </fieldset>

            <fieldset>
              <legend>Pagamento</legend>
              <div
                className={`checkout-methods${methods.length === 1 ? ' single' : ''}`}
                role="radiogroup"
                aria-label="Forma de pagamento"
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
                  <Field label="Número do cartão" error={fieldError('cardNumber')}>
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
                  <Field label="Nome impresso no cartão" error={fieldError('cardHolder')}>
                    <input
                      name="cardHolder"
                      autoComplete="cc-name"
                      value={card.holder}
                      onChange={(e) => updateCard('holder', e.target.value.toUpperCase())}
                      onBlur={() => blur('cardHolder')}
                      placeholder="NOME COMO NO CARTÃO"
                    />
                  </Field>
                  <div className="checkout-row">
                    <Field label="Validade" error={fieldError('cardExpiry')}>
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

            {(serverError || unavailable) && (
              <p className="checkout-error" role="alert">
                {unavailable ? 'O pagamento está indisponível no momento. Tente novamente em alguns minutos.' : serverError}
              </p>
            )}

            <button
              ref={submitRef}
              type="submit"
              className={`checkout-submit${luxury ? ' luxury' : ''}`}
              disabled={submitting || unavailable}
            >
              {submitting ? (
                <>
                  <LoaderCircle className="checkout-spin" size={18} /> PROCESSANDO...
                </>
              ) : method === 'pix' ? (
                `GERAR PIX DE ${formatBRL(plan.price)}`
              ) : (
                `PAGAR ${formatBRL(plan.price)}`
              )}
            </button>
            <TrustBadges />
          </form>
        )}

        {phase === 'pix' && charge?.pix && (
          <section className="checkout-pix" aria-live="polite">
            {charge.testMode && (
              <p className="checkout-test-banner">Modo de teste: nada é cobrado. Este PIX é aprovado sozinho em alguns segundos.</p>
            )}
            <h1>Pague com PIX</h1>
            <p className="checkout-pix-amount">{formatBRL(plan.price)}</p>
            <div className="checkout-qr">
              {qrImage ? <img src={qrImage} alt="QR Code do PIX" /> : <LoaderCircle className="checkout-spin" size={28} />}
            </div>
            <label className="checkout-copy">
              <span>PIX copia e cola</span>
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
              <LoaderCircle className="checkout-spin" size={15} /> Aguardando pagamento
              {charge.pix.expiresAt && (
                <>
                  {' '}
                  · <Clock size={13} aria-hidden="true" /> expira em {formatCountdown(pixRemaining)}
                </>
              )}
            </p>
            <ol className="checkout-steps">
              <li>Abra o app do seu banco e entre na área PIX.</li>
              <li>Escolha pagar com QR Code ou PIX copia e cola.</li>
              <li>Confirme o pagamento. Esta página atualiza sozinha.</li>
            </ol>
          </section>
        )}

        {phase === 'processing' && (
          <section className="checkout-status" aria-live="polite">
            <LoaderCircle className="checkout-spin" size={36} />
            <h1>Processando pagamento</h1>
            <p>Estamos confirmando com a operadora do cartão. Não feche esta página.</p>
          </section>
        )}

        {phase === 'expired' && (
          <section className="checkout-status">
            <Clock size={36} />
            <h1>O PIX expirou</h1>
            <p>O código não foi pago a tempo. Gere um novo para concluir a compra.</p>
            <button
              type="button"
              className={`checkout-submit${luxury ? ' luxury' : ''}`}
              onClick={() => {
                setCharge(null)
                setQrImage('')
                setPhase('form')
              }}
            >
              GERAR NOVO PIX
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
            <h1>Pagamento aprovado!</h1>
            <p>
              Enviamos o acesso para <strong>{customer.email.trim()}</strong>. Se não encontrar, confira a caixa de spam.
            </p>
          </section>
        )}
      </main>

      {phase === 'form' && (
        <StickyCta
          visible={stickyVisible}
          plan={plan}
          label={method === 'pix' ? 'GERAR PIX' : 'PAGAR'}
          disabled={submitting || unavailable}
          onClick={() => formRef.current?.requestSubmit()}
        />
      )}
    </div>
  )
}
