import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  CircleUserRound,
  FileText,
  Heart,
  Image,
  MapPin,
  Pause,
  PersonStanding,
  Play,
  Smile,
  WandSparkles,
  X,
} from 'lucide-react'
import {
  BODY_TYPES,
  CHAT_PREFERENCES,
  BREAST_SIZES,
  BUTT_SIZES,
  DEFAULT_SELECTION,
  ETHNICITIES,
  EVENTS,
  HAIR_COLORS,
  HAIR_STYLES,
  OCCUPATIONS,
  PERSONALITIES,
  RELATIONSHIPS,
  STEPS,
  VOICES,
  getOptionMedia,
  getResultImage,
  track,
} from './data.js'
import './Funnel.css'
import { SELECTION_STORAGE_KEY } from '../shared/checkout.js'

const loadGeneratingPanel = () => import('./GeneratingPanel.jsx')
const GeneratingPanel = lazy(loadGeneratingPanel)
const PaywallSheet = lazy(() => import('./PaywallSheet.jsx'))

const STEP_ICONS = [CircleUserRound, MapPin, Smile, PersonStanding, FileText, Image]
const AGES = Array.from({ length: 53 }, (_, i) => i + 18)

const CHOICE_SHEETS = {
  ...Object.fromEntries(Object.entries(CHAT_PREFERENCES).map(([key, setting]) => [key, { title: setting.title, icon: Smile, options: setting.options.map(value => ({ value, label: value })) }])),
  voice: { title: 'Voz', icon: AudioLines, options: VOICES.map((v, i) => ({ value: i, label: v.label })) },
  personality: { title: 'Personalidade', icon: Smile, options: PERSONALITIES.map((v) => ({ value: v, label: v })) },
  occupation: { title: 'Profissão', icon: BriefcaseBusiness, options: OCCUPATIONS.map((v) => ({ value: v, label: v })) },
  relationship: { title: 'Relacionamento', icon: Heart, options: RELATIONSHIPS.map((v) => ({ value: v, label: v })) },
}

const mod = (n, m) => ((n % m) + m) % m

function centeredScrollLeft(item, rail) {
  return item.offsetLeft + item.offsetWidth / 2 - rail.clientWidth / 2
}

function nearestIndex(rail, count) {
  const first = rail.children[0]
  const second = rail.children[1]
  if (!first || !second) return 0
  const step = second.offsetLeft - first.offsetLeft
  if (!step) return 0
  const firstCenter = first.offsetLeft + first.offsetWidth / 2
  return Math.max(0, Math.min(count - 1, Math.round((rail.scrollLeft + rail.clientWidth / 2 - firstCenter) / step)))
}

// Carrossel infinito: a lista é renderizada 3 vezes e o scroll é reposicionado no bloco do meio.
// O item que fica no centro vira o valor selecionado.
function useInfiniteRail(values, value, onChange) {
  const railRef = useRef(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  valueRef.current = value
  onChangeRef.current = onChange

  useLayoutEffect(() => {
    const rail = railRef.current
    const index = values.indexOf(valueRef.current)
    if (rail && index >= 0) rail.scrollLeft = centeredScrollLeft(rail.children[values.length + index], rail)
  }, [values])

  return {
    railRef,
    onScroll: () => {
      const rail = railRef.current
      if (!rail) return
      const count = values.length
      let index = nearestIndex(rail, count * 3)
      const loopWidth = rail.children[count].offsetLeft - rail.children[0].offsetLeft
      if (index < count) {
        rail.scrollLeft += loopWidth
        index += count
      } else if (index >= count * 2) {
        rail.scrollLeft -= loopWidth
        index -= count
      }
      const next = values[mod(index, count)]
      if (next !== valueRef.current) {
        valueRef.current = next
        onChangeRef.current(next)
      }
    },
    select: (next, item) => {
      valueRef.current = next
      onChangeRef.current(next)
      const rail = railRef.current
      rail?.scrollTo({ left: centeredScrollLeft(item, rail), behavior: 'smooth' })
    },
  }
}

// Imagem do card; com o card selecionado e visível, toca o vídeo em loop por cima.
function OptionMedia({ media, selected, eager = false }) {
  const ref = useRef(null)
  const [videoReady, setVideoReady] = useState(false)
  const [visible, setVisible] = useState(false)
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => setVideoReady(false), [media?.video, selected])

  useEffect(() => {
    if (!selected || !ref.current) return
    if (!('IntersectionObserver' in window)) {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver((entries) => setVisible(entries[0]?.intersectionRatio > 0.5), {
      threshold: [0, 0.5],
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [selected])

  if (!media) return null

  return (
    <span ref={ref} className="creator-option-media" aria-hidden="true">
      <img src={media.image} alt="" loading={eager ? 'eager' : 'lazy'} />
      {selected && visible && !reducedMotion && (
        <video
          key={media.video}
          src={media.video}
          poster={media.image}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onLoadedData={() => setVideoReady(true)}
          onError={() => setVideoReady(false)}
          className={videoReady ? 'playing' : ''}
        />
      )}
    </span>
  )
}

function ChoiceSheet({ title, icon: Icon, options, value, onChange, onClose, onPreview, previewingValue }) {
  const dialogRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [closing, setClosing] = useState(false)
  const close = () => setClosing(true)

  useEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    dialog.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true })
    return () => dialog.close()
  }, [])

  // Espera a animação de saída antes de desmontar.
  useEffect(() => {
    if (!closing) return
    const timer = setTimeout(() => onCloseRef.current(), 180)
    return () => clearTimeout(timer)
  }, [closing])

  const choose = (next) => {
    onChange(next)
    close()
  }

  const onKeyDown = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const radios = Array.from(dialogRef.current.querySelectorAll('[role="radio"]'))
    const current = radios.indexOf(event.target)
    const step = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? radios.length - 1 : (current + step + radios.length) % radios.length
    radios[next].focus()
  }

  return (
    <dialog
      ref={dialogRef}
      className={`creator-choice-dialog${closing ? ' closing' : ''}`}
      aria-labelledby="detail-choice-title"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section className="creator-choice-sheet">
        <div className="creator-choice-handle" aria-hidden="true" />
        <header>
          <span className="creator-choice-heading-icon">
            <Icon size={22} />
          </span>
          <div>
            <small>DETALHES DA SUA PERSONAGEM</small>
            <h2 id="detail-choice-title">{title}</h2>
          </div>
          <button type="button" className="creator-choice-close" aria-label="Fechar opções" onClick={close}>
            <X size={20} />
          </button>
        </header>
        <div className="creator-choice-options" role="radiogroup" aria-label={title} onKeyDown={onKeyDown}>
          {options.map((option) => (
            <div key={option.value} className={`creator-choice-row${value === option.value ? ' selected' : ''}`}>
              <button
                type="button"
                role="radio"
                aria-checked={value === option.value}
                tabIndex={value === option.value ? 0 : -1}
                onClick={() => choose(option.value)}
              >
                <span className="creator-choice-radio">
                  {value === option.value && <Check size={13} strokeWidth={3} />}
                </span>
                <span>{option.label}</span>
              </button>
              {onPreview && (
                <button
                  type="button"
                  className="creator-choice-preview"
                  aria-label={`${previewingValue === option.value ? 'Pausar' : 'Ouvir'} ${option.label}`}
                  onClick={() => onPreview(option.value)}
                >
                  {previewingValue === option.value ? <Pause size={17} /> : <Play size={17} />}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </dialog>
  )
}

function OptionGrid({ title, values, value, onChange, style, field }) {
  return (
    <fieldset className="creator-fieldset creator-origin-field">
      <legend>{title}</legend>
      <div className="creator-origin-grid">
        {values.map((option) => (
          <button
            key={option}
            type="button"
            className={`creator-origin-card${field === 'hairStyle' ? ' creator-hair-card' : ''}${
              option === 'Personalizado' ? ' custom' : ''
            }${value === option ? ' selected' : ''}`}
            aria-label={option}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {option === 'Personalizado' ? (
              <span className="creator-hair-custom-icon">
                <WandSparkles size={25} aria-hidden="true" />
              </span>
            ) : (
              <OptionMedia
                media={getOptionMedia(style, field, option)}
                selected={value === option}
                eager={field === 'ethnicity'}
              />
            )}
            <strong>{option}</strong>
            {value === option && <Check size={16} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function ColorSwatches({ title, values, value, onChange }) {
  return (
    <fieldset className="creator-fieldset">
      <legend>{title}</legend>
      <div className="creator-swatches">
        {values.map((option) => (
          <button
            key={option.label}
            type="button"
            className={`creator-swatch${value === option.label ? ' selected' : ''}`}
            aria-label={`${title}: ${option.label}`}
            aria-pressed={value === option.label}
            onClick={() => onChange(option.label)}
          >
            <span style={{ background: option.color }}>
              {value === option.label && <Check size={17} strokeWidth={3} />}
            </span>
            <small>{option.label}</small>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function CardCarousel({ title, values, value, onChange, sel, field }) {
  const { railRef, onScroll, select } = useInfiniteRail(values, value, onChange)
  return (
    <fieldset className="creator-fieldset creator-carousel-field">
      <legend>{title}</legend>
      <div className="creator-card-rail" ref={railRef} onScroll={onScroll}>
        {[...values, ...values, ...values].map((option, i) => (
          <button
            key={`${i}-${option}`}
            type="button"
            className={`creator-body-card${value === option ? ' selected' : ''}`}
            aria-label={`${title}: ${option}`}
            aria-pressed={value === option}
            onClick={(event) => select(option, event.currentTarget)}
          >
            <OptionMedia media={getOptionMedia(sel.style, field, option)} selected={value === option} />
            <strong>{option}</strong>
            {value === option && <Check size={15} />}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function AgeCarousel({ age, onChange }) {
  const { railRef, onScroll, select } = useInfiniteRail(AGES, Number(age), onChange)
  return (
    <div className="creator-age-wrap">
      <strong>Idade</strong>
      <div className="creator-age-rail" ref={railRef} onScroll={onScroll}>
        {[...AGES, ...AGES, ...AGES].map((value, i) => (
          <button
            key={`${i}-${value}`}
            type="button"
            data-age={value}
            className={Number(age) === value ? 'selected' : ''}
            aria-label={`${value} anos`}
            aria-pressed={Number(age) === value}
            onClick={(event) => select(value, event.currentTarget)}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  )
}

function DetailTile({ title, icon: Icon, value, onOpen }) {
  return (
    <button
      type="button"
      className="creator-detail-tile"
      aria-label={`${title}: ${value}`}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      <span className="creator-detail-icon">
        <Icon size={20} />
      </span>
      <span className="creator-detail-copy">
        <small>{title}</small>
        <strong className={value.length > 11 && !value.includes(' ') ? 'creator-detail-long' : undefined}>{value}</strong>
      </span>
      <ChevronDown className="creator-detail-chevron" size={15} />
    </button>
  )
}

function VoiceTile({ voice, playing, onPlay, onOpen }) {
  return (
    <div className="creator-detail-tile">
      <button
        type="button"
        className="creator-detail-icon creator-play"
        onClick={onPlay}
        title={playing ? 'Pausar voz' : 'Ouvir voz'}
        aria-label={playing ? 'Pausar voz' : 'Ouvir voz'}
      >
        {playing ? <Pause size={19} /> : <Play size={19} />}
      </button>
      <button
        type="button"
        className="creator-voice-trigger"
        aria-label={`Voz: ${VOICES[voice].label}`}
        aria-haspopup="dialog"
        onClick={onOpen}
      >
        <span className="creator-detail-copy">
          <small>Voz</small>
          <strong>{VOICES[voice].label}</strong>
        </span>
        <ChevronDown className="creator-detail-chevron" size={15} />
      </button>
      <div className={`creator-wave${playing ? ' playing' : ''}`} aria-hidden="true">
        {Array.from({ length: 11 }, (_, i) => (
          <i key={i} style={{ '--i': i }} />
        ))}
      </div>
    </div>
  )
}

function SummaryRow({ title, value, image, color }) {
  return (
    <div className="creator-summary-row">
      {(image || color) && (
        <span className="creator-summary-thumb">
          {image ? <img src={image} alt="" /> : <i style={{ backgroundColor: color }} />}
        </span>
      )}
      <span className="creator-summary-copy">
        <small>{title}</small>
        <strong>{value}</strong>
      </span>
    </div>
  )
}

function Creator({ sel, update, initialStep = 0, initialPaywallOpen = false, onComplete }) {
  const [step, setStep] = useState(initialStep)
  const [revealDone, setRevealDone] = useState(false)
  const [paywallOpen, setPaywallOpen] = useState(initialPaywallOpen)
  const [summaryTab, setSummaryTab] = useState('appearance')
  const [playingVoice, setPlayingVoice] = useState(null)
  const [openSheet, setOpenSheet] = useState(null)
  const audioRef = useRef(null)
  const bodyRef = useRef(null)

  useEffect(() => {
    track(EVENTS.QUIZ_START)
    return () => audioRef.current?.pause()
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('landing-open', paywallOpen)
    return () => document.documentElement.classList.remove('landing-open')
  }, [paywallOpen])

  // Na etapa de detalhes já baixa a animação, as máscaras e a imagem final.
  useEffect(() => {
    if (step !== 4) return
    loadGeneratingPanel().catch(() => {})
    const preload = [
      '/loading-states/silhouette-3.webp',
      '/loading-states/silhouette-7.webp',
      `/loading-states/${sel.style === 'anime' ? 'anime' : 'real'}-final-mask.webp`,
      getResultImage(sel).src,
    ]
    for (const src of preload) {
      const img = new window.Image()
      img.src = src
    }
  }, [step, sel.style, sel.ethnicity, sel.hairColor, sel.bodyType, sel.breastSize, sel.buttSize])

  const goToStep = (next) => {
    audioRef.current?.pause()
    setPlayingVoice(null)
    setOpenSheet(null)
    setRevealDone(false)
    setStep(next)
    bodyRef.current?.scrollTo(0, 0)
    track(EVENTS.STEP_VIEW, { step: STEPS[next].key, visual_style: sel.style })
  }

  const toggleVoice = (voice = sel.voice) => {
    if (!audioRef.current) audioRef.current = new Audio()
    if (playingVoice === voice) {
      audioRef.current.pause()
      setPlayingVoice(null)
      return
    }
    audioRef.current.pause()
    audioRef.current.src = `/audios/${VOICES[voice].file}`
    audioRef.current.onended = () => setPlayingVoice(null)
    audioRef.current
      .play()
      .then(() => setPlayingVoice(voice))
      .catch(() => setPlayingVoice(null))
  }

  const canContinue = step !== 4 || (sel.name.trim().length >= 2 && Number(sel.age) >= 18)

  const openOffer = () => {
    onComplete()
    try { sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(sel)) } catch { /* armazenamento opcional */ }
    window.location.assign(`/chat${window.location.search}`)
  }

  const mediaImage = (field, value) => getOptionMedia(sel.style, field, value)?.image
  const hairColor = HAIR_COLORS.find((c) => c.label === sel.hairColor)?.color

  return (
    <div className="creator-root">
      <header className="creator-topbar">
        <div className="creator-brand">
          <strong>PISKOU</strong>
          <span>CREATE</span>
        </div>
        <nav className="creator-progress" aria-label={`Etapa ${step + 1} de ${STEPS.length}`}>
          {STEPS.map((item, i) => {
            const Icon = STEP_ICONS[i]
            return (
              <button
                key={item.key}
                type="button"
                title={item.label}
                aria-label={`Ir para ${item.label}`}
                aria-current={step === i ? 'step' : undefined}
                disabled={i > step}
                className={`creator-progress-step${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}
                onClick={() => goToStep(i)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
      </header>

      <main className="creator-body" ref={bodyRef}>
        <div className="creator-content">
          {step === 0 && (
            <>
              <div className="creator-heading">
                <p>PASSO 01 · ESTILO</p>
                <h1>
                  Crie sua <em>garota de IA</em> dos sonhos
                </h1>
                <span>Escolha o visual da sua personagem adulta.</span>
              </div>
              <div className="creator-style-grid">
                {[
                  { key: 'realista', label: 'REALISTA' },
                  { key: 'anime', label: 'ANIME' },
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`creator-style${sel.style === option.key ? ' selected' : ''}`}
                    aria-pressed={sel.style === option.key}
                    onClick={() => update('style', option.key)}
                  >
                    <OptionMedia
                      media={getOptionMedia(option.key, 'style', option.key)}
                      selected={sel.style === option.key}
                      eager
                    />
                    <strong>{option.label}</strong>
                    {sel.style === option.key && <Check className="creator-style-check" size={18} />}
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="creator-heading">
                <p>PASSO 02 · GERAL</p>
                <h1>
                  De onde vem <em>ela?</em>
                </h1>
                <span>Escolha a origem da sua personagem.</span>
              </div>
              <OptionGrid
                title="Origem"
                field="ethnicity"
                style={sel.style}
                values={ETHNICITIES}
                value={sel.ethnicity}
                onChange={(v) => update('ethnicity', v)}
              />
            </>
          )}

          {step === 2 && (
            <>
              <div className="creator-heading">
                <p>PASSO 03 · ROSTO</p>
                <h1>
                  O rosto que você <em>imagina</em>
                </h1>
                <span>Escolha o cabelo dela.</span>
              </div>
              <OptionGrid
                title="Estilo do cabelo"
                field="hairStyle"
                style={sel.style}
                values={HAIR_STYLES}
                value={sel.hairStyle}
                onChange={(v) => update('hairStyle', v)}
              />
              <ColorSwatches
                title="Cor do cabelo"
                values={HAIR_COLORS}
                value={sel.hairColor}
                onChange={(v) => update('hairColor', v)}
              />
            </>
          )}

          {step === 3 && (
            <>
              <div className="creator-heading">
                <p>PASSO 04 · CORPO</p>
                <h1>
                  Defina a <em>silhueta</em>
                </h1>
                <span>Deslize e escolha suas preferências.</span>
              </div>
              <CardCarousel
                title="Tipo de corpo"
                values={BODY_TYPES}
                value={sel.bodyType}
                onChange={(v) => update('bodyType', v)}
                sel={sel}
                field="bodyType"
              />
              <CardCarousel
                title="Tamanho dos seios"
                values={BREAST_SIZES}
                value={sel.breastSize}
                onChange={(v) => update('breastSize', v)}
                sel={sel}
                field="breastSize"
              />
              <CardCarousel
                title="Tamanho do bumbum"
                values={BUTT_SIZES}
                value={sel.buttSize}
                onChange={(v) => update('buttSize', v)}
                sel={sel}
                field="buttSize"
              />
            </>
          )}

          {step === 4 && (
            <>
              <div className="creator-heading creator-detail-heading">
                <p>PASSO 05 · DETALHES</p>
                <h1>
                  Quem é <em>ela?</em>
                </h1>
              </div>
              <label className="creator-name-field">
                Nome da personagem
                <input
                  maxLength={28}
                  value={sel.name}
                  onChange={(event) => update('name', event.target.value)}
                  placeholder="Nome dela"
                  autoComplete="off"
                />
              </label>
              <AgeCarousel age={sel.age} onChange={(v) => update('age', v)} />
              <div className="creator-detail-label">
                <strong>Detalhes da personalidade</strong>
                <span>Defina como ela conversa com você</span>
              </div>
              <div className="creator-details-grid">
                <VoiceTile
                  voice={sel.voice}
                  playing={playingVoice === sel.voice}
                  onPlay={() => toggleVoice()}
                  onOpen={() => setOpenSheet('voice')}
                />
                {['personality', 'speechStyle', 'socialEnergy', 'initiative', 'occupation', 'relationship'].map((key) => (
                  <DetailTile
                    key={key}
                    title={CHOICE_SHEETS[key].title}
                    icon={CHOICE_SHEETS[key].icon}
                    value={sel[key]}
                    onOpen={() => setOpenSheet(key)}
                  />
                ))}
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <Suspense
                fallback={
                  <div className="creator-generator-fallback">
                    <AudioLines size={28} />
                  </div>
                }
              >
                <GeneratingPanel
                  key={`${sel.style}-${sel.hairColor}-${sel.bodyType}-${sel.breastSize}`}
                  sel={sel}
                  onReady={setRevealDone}
                />
              </Suspense>
              <div className="creator-summary-tabs" role="tablist" aria-label="Resumo da personagem">
                <button
                  type="button"
                  role="tab"
                  aria-selected={summaryTab === 'appearance'}
                  className={summaryTab === 'appearance' ? 'active' : ''}
                  onClick={() => setSummaryTab('appearance')}
                >
                  Aparência
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={summaryTab === 'personality'}
                  className={summaryTab === 'personality' ? 'active' : ''}
                  onClick={() => setSummaryTab('personality')}
                >
                  Personalidade
                </button>
              </div>
              <div className="creator-summary-list" role="tabpanel">
                {summaryTab === 'appearance' ? (
                  <>
                    <SummaryRow
                      title="Estilo"
                      value={sel.style === 'anime' ? 'Anime' : 'Realista'}
                      image={mediaImage('style', sel.style)}
                    />
                    <SummaryRow title="Origem" value={sel.ethnicity} image={mediaImage('ethnicity', sel.ethnicity)} />
                    <SummaryRow
                      title="Estilo do cabelo"
                      value={sel.hairStyle}
                      image={mediaImage('hairStyle', sel.hairStyle)}
                      color={hairColor}
                    />
                    <SummaryRow title="Cor do cabelo" value={sel.hairColor} color={hairColor} />
                    <SummaryRow title="Tipo de corpo" value={sel.bodyType} image={mediaImage('bodyType', sel.bodyType)} />
                    <SummaryRow
                      title="Tamanho dos seios"
                      value={sel.breastSize}
                      image={mediaImage('breastSize', sel.breastSize)}
                    />
                    <SummaryRow
                      title="Tamanho do bumbum"
                      value={sel.buttSize}
                      image={mediaImage('buttSize', sel.buttSize)}
                    />
                  </>
                ) : (
                  <>
                    <SummaryRow title="Nome" value={sel.name} />
                    <SummaryRow title="Idade" value={`${sel.age} anos`} />
                    <SummaryRow title="Voz" value={VOICES[sel.voice].label} />
                    <SummaryRow title="Personalidade" value={sel.personality} />
                    {Object.entries(CHAT_PREFERENCES).map(([key, setting]) => (
                      <SummaryRow key={key} title={setting.title} value={sel[key]} />
                    ))}
                    <SummaryRow title="Profissão" value={sel.occupation} />
                    <SummaryRow title="Relacionamento" value={sel.relationship} />
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      <footer className="creator-footer">
        <div className="creator-footer-inner">
          {step > 0 && (
            <button type="button" className="creator-back" onClick={() => goToStep(step - 1)} aria-label="Voltar">
              <ArrowLeft size={20} />
            </button>
          )}
          <button
            type="button"
            className="creator-next"
            disabled={!canContinue || (step === 5 && !revealDone)}
            onClick={() => (step === 5 ? openOffer() : goToStep(step + 1))}
          >
            {step === 5 ? 'DÊ VIDA À SUA IA' : step === 0 ? 'COMEÇAR' : 'PRÓXIMO'} <ArrowRight size={18} />
          </button>
        </div>
      </footer>

      {paywallOpen && (
        <Suspense fallback={null}>
          <PaywallSheet sel={sel} onClose={() => setPaywallOpen(false)} />
        </Suspense>
      )}

      {openSheet && (
        <ChoiceSheet
          {...CHOICE_SHEETS[openSheet]}
          value={sel[openSheet]}
          onChange={(value) => {
            update(openSheet, value)
            if (openSheet === 'voice') {
              audioRef.current?.pause()
              setPlayingVoice(null)
            }
          }}
          onClose={() => {
            setOpenSheet(null)
            if (openSheet === 'voice') {
              audioRef.current?.pause()
              setPlayingVoice(null)
            }
          }}
          onPreview={openSheet === 'voice' ? toggleVoice : undefined}
          previewingValue={playingVoice}
        />
      )}
    </div>
  )
}

export default function Funnel({ initialPhase = 'quiz' }) {
  const [sel, setSel] = useState(DEFAULT_SELECTION)
  return (
    <Creator
      sel={sel}
      update={(key, value) => setSel((prev) => ({ ...prev, [key]: value }))}
      initialStep={initialPhase === 'creating' || initialPhase === 'offer' ? 5 : 0}
      initialPaywallOpen={initialPhase === 'offer'}
      onComplete={() => track(EVENTS.QUIZ_COMPLETE, { visual_style: sel.style })}
    />
  )
}
