import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Check, CircleCheck, Copy, Crown, Infinity, LoaderCircle, MessageCircle, Phone, PlayCircle, ShieldCheck, Video } from 'lucide-react'
import { EVENTS, getResultImage, track } from '../funnel/data.js'
import { readSavedSelection } from '../shared/progress.js'
import { analyticsIdentity } from '../shared/analytics.js'
import { BUYER_STORAGE_KEY, PLANS, UPSELL_SEQUENCE, formatBRL, onlyDigits, validateCustomer } from '../shared/checkout.js'
import './UpsellPage.css'

const STEP_KEY = 'piskou:upsell-step'
const CHARGE_KEY = 'piskou:upsell-charge'
const POLL_MS = 4000

const OFFERS = {
  'upsell-video-pack': {
    icon: Video,
    eyebrow: 'OFERTA EXCLUSIVA',
    title: (name) => <>Veja um <em>pack de vídeos</em> da {name}</>,
    text: (name) => `Um pack só com vídeos da ${name}, liberado agora na sua conta.`,
    bullets: (name) => [`Vídeos exclusivos da ${name}`, 'Liberado logo após o pagamento', 'Pagamento único, sem mensalidade'],
    cta: 'SIM, QUERO O PACK',
    paid: 'Pack de vídeos liberado!',
  },
  'upsell-whatsapp': {
    icon: MessageCircle,
    eyebrow: 'SÓ NESTA TELA',
    title: (name) => <>Faça a {name} te chamar no <em>WhatsApp</em></>,
    text: (name) => `A ${name} chama você no seu WhatsApp, do jeitinho que você escolheu.`,
    bullets: (name) => [`A ${name} te chama no seu número`, 'Conversa direto no seu WhatsApp', 'Pagamento único, sem mensalidade'],
    cta: 'SIM, QUERO QUE ELA ME CHAME',
    paid: 'Pronto! Agora é só informar seu WhatsApp.',
  },
  'upsell-vip': {
    icon: Crown,
    eyebrow: 'ÚLTIMA OFERTA',
    title: () => <>Acesso <em>VIP vitalício</em></>,
    text: () => 'Pague uma vez e use para sempre.',
    bullets: (name) => [`Mensagens ilimitadas com a ${name}`, 'Sua conversa fica guardada para sempre', 'Pague uma vez e use para sempre'],
    cta: 'SIM, QUERO SER VIP',
    paid: 'Você agora é VIP vitalício!',
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

// Ofertas de um clique depois do pagamento: Quero gera o PIX na hora com os dados já informados; Não, obrigado passa para a próxima.
export default function UpsellPage() {
  const [selection] = useState(readSavedSelection)
  const [buyer, setBuyer] = useState(() => readJson(sessionStorage, BUYER_STORAGE_KEY) || { name: '', email: '' })
  const [step, setStep] = useState(() => Math.min(UPSELL_SEQUENCE.length, Math.max(0, Number(readJson(sessionStorage, STEP_KEY)) || 0)))
  const [charge, setCharge] = useState(() => readJson(sessionStorage, CHARGE_KEY))
  const [phase, setPhase] = useState(() => (readJson(sessionStorage, CHARGE_KEY) ? 'pix' : 'offer'))
  const [error, setError] = useState('')
  const [qrImage, setQrImage] = useState('')
  const [copied, setCopied] = useState(false)
  const [phone, setPhone] = useState('')
  const requestRef = useRef(null)
  const busy = useRef(false)

  const planId = UPSELL_SEQUENCE[step]
  const plan = PLANS[planId]
  const offer = OFFERS[planId]
  const name = selection?.name?.trim() || 'sua personagem'
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
    setQrImage('')
    setCopied(false)
    setError('')
    setPhase('offer')
    setStep((value) => value + 1)
    window.scrollTo(0, 0)
  }

  const accept = async () => {
    if (busy.current) return
    if (needsBuyer) {
      setError('Confira seu nome e e-mail para gerar o PIX.')
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
          method: 'pix',
          requestId: requestRef.current,
          selection,
          customer: buyer,
          analyticsSession: analyticsIdentity().session,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (data.code === 'owned') return next()
      if (!response.ok || data.status === 'failed' || !data.pix?.copyPaste) {
        setPhase('offer')
        setError(data.error || 'Não foi possível gerar o PIX agora. Tente novamente.')
        return
      }
      const saved = { id: data.id, planId, amount: data.amount, pix: data.pix }
      writeJson(sessionStorage, CHARGE_KEY, saved)
      setCharge(saved)
      setPhase('pix')
      track(EVENTS.PIX_GENERATED, { plan: planId, value: data.amount, currency: 'BRL' })
    } catch {
      setPhase('offer')
      setError('Sem conexão. Verifique sua internet e tente novamente.')
    } finally {
      busy.current = false
    }
  }

  // Aguarda a confirmação do PIX da oferta atual.
  useEffect(() => {
    if (phase !== 'pix' || !charge) return
    let stopped = false
    const check = async () => {
      try {
        const response = await fetch(`/api/checkout-status?id=${encodeURIComponent(charge.id)}`)
        if (!response.ok || stopped) return
        const { status } = await response.json()
        if (stopped) return
        if (status === 'paid') {
          writeJson(sessionStorage, CHARGE_KEY, null)
          track(EVENTS.PAYMENT_APPROVED, { plan: charge.planId, value: charge.amount, currency: 'BRL', method: 'pix', transaction_id: charge.id })
          setPhase('paid')
        } else if (status === 'expired' || status === 'failed') {
          writeJson(sessionStorage, CHARGE_KEY, null)
          requestRef.current = null
          setCharge(null)
          setPhase('offer')
          setError(status === 'expired' ? 'O PIX expirou. Gere um novo para continuar.' : 'Pagamento não aprovado. Tente novamente.')
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

  useEffect(() => {
    if (!charge?.pix?.copyPaste) return
    QRCode.toDataURL(charge.pix.copyPaste, { margin: 1, width: 440, errorCorrectionLevel: 'M' })
      .then(setQrImage)
      .catch(() => setQrImage(''))
  }, [charge])

  // Pack e VIP seguem sozinhos para a próxima oferta; o WhatsApp espera o número.
  useEffect(() => {
    if (phase !== 'paid' || planId === 'upsell-whatsapp') return
    const timer = setTimeout(next, 2200)
    return () => clearTimeout(timer)
  }, [phase, planId])

  const copyPix = async () => {
    try {
      await navigator.clipboard.writeText(charge.pix.copyPaste)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  const savePhone = async (event) => {
    event.preventDefault()
    const digits = onlyDigits(phone)
    if (digits.length < 10 || digits.length > 11) {
      setError('Informe seu WhatsApp com DDD.')
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
        setError(data.error || 'Não foi possível salvar agora. Tente novamente.')
        return
      }
      next()
    } catch {
      setPhase('paid')
      setError('Sem conexão. Verifique sua internet e tente novamente.')
    }
  }

  if (!plan) return <div className="app-loading" aria-label="Abrindo sua conversa" />
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
            <CircleCheck size={18} aria-hidden="true" /> Pagamento aprovado! Seu acesso já está garantido.
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
                <strong>{formatBRL(plan.price)}</strong>
                <span>{planId === 'upsell-vip' ? <><Infinity size={15} aria-hidden="true" /> para sempre</> : 'pagamento único'}</span>
              </div>
              {needsBuyer && (
                <div className="upsell-buyer">
                  <label>
                    Seu nome
                    <input value={buyer.name} onChange={(event) => setBuyer({ ...buyer, name: event.target.value })} autoComplete="name" />
                  </label>
                  <label>
                    Seu e-mail
                    <input type="email" value={buyer.email} onChange={(event) => setBuyer({ ...buyer, email: event.target.value })} autoComplete="email" />
                  </label>
                </div>
              )}
              {error && <p className="upsell-error" role="alert">{error}</p>}
              <button type="button" className="upsell-accept" onClick={accept} disabled={phase === 'creating'}>
                {phase === 'creating' ? (
                  <>
                    <LoaderCircle className="upsell-spin" size={18} /> GERANDO PIX...
                  </>
                ) : (
                  `${offer.cta} · ${formatBRL(plan.price)}`
                )}
              </button>
              <button type="button" className="upsell-decline" onClick={next} disabled={phase === 'creating'}>
                Não, obrigado
              </button>
              <p className="upsell-secure">
                <ShieldCheck size={14} aria-hidden="true" /> Um clique · PIX · sem preencher dados de novo
              </p>
            </div>
          </section>
        )}

        {phase === 'pix' && charge && (
          <section className="upsell-card upsell-pix" aria-live="polite">
            <span className="upsell-eyebrow">PAGUE COM PIX</span>
            <h1>{plan.name}</h1>
            <p className="upsell-pix-amount">{formatBRL(charge.amount)}</p>
            <div className="upsell-qr">{qrImage ? <img src={qrImage} alt="QR Code do PIX" /> : <LoaderCircle className="upsell-spin" size={28} />}</div>
            <button type="button" className="upsell-accept" onClick={copyPix}>
              {copied ? <><Check size={18} /> CÓDIGO COPIADO</> : <><Copy size={18} /> COPIAR CÓDIGO PIX</>}
            </button>
            <p className="upsell-waiting">
              <LoaderCircle className="upsell-spin" size={16} aria-hidden="true" /> Aguardando o pagamento. Esta tela atualiza sozinha.
            </p>
            {error && <p className="upsell-error" role="alert">{error}</p>}
            <button type="button" className="upsell-decline" onClick={next}>
              Não quero mais esta oferta
            </button>
          </section>
        )}

        {(phase === 'paid' || phase === 'saving') && (
          <section className="upsell-card upsell-done" aria-live="polite">
            <CircleCheck size={46} aria-hidden="true" />
            <h1>{offer.paid}</h1>
            {planId === 'upsell-whatsapp' ? (
              <form className="upsell-phone" onSubmit={savePhone}>
                <label htmlFor="upsell-phone">Seu WhatsApp com DDD</label>
                <div>
                  <Phone size={18} aria-hidden="true" />
                  <input
                    id="upsell-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder="(11) 99999-9999"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </div>
                {error && <p className="upsell-error" role="alert">{error}</p>}
                <button type="submit" className="upsell-accept" disabled={phase === 'saving'}>
                  {phase === 'saving' ? <><LoaderCircle className="upsell-spin" size={18} /> SALVANDO...</> : 'CONFIRMAR MEU WHATSAPP'}
                </button>
              </form>
            ) : (
              <>
                <p>Já está na sua conta.</p>
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
