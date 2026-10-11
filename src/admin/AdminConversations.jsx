import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  MessageCircle,
  Send,
  Sparkles,
  X,
} from 'lucide-react'
const date = (value) =>
  value
    ? new Date(value).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : 'Horário não registrado'
const short = (id) => id?.slice(0, 8)
export default function AdminConversations({ active, days }) {
  const [chats, setChats] = useState({ items: [], total: 0 }),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState(null),
    [detail, setDetail] = useState(null),
    [turns, setTurns] = useState([]),
    [draft, setDraft] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(null),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false)
  const request = useRef(null),
    list = useRef(null),
    retry = useRef(null)
  useEffect(() => setOffset(0), [days])
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (!['chats', 'advisor'].includes(active)) return
    let alive = true,
      inFlight = false,
      controller
    setLoaded(false)
    const load = async () => {
      if (document.visibilityState === 'hidden' || inFlight) return
      inFlight = true
      controller = new AbortController()
      const get = async (url) => {
        const r = await fetch(url, { signal: controller.signal })
        const d = await r.json()
        if (!r.ok) throw Error(d.error || 'Não foi possível abrir o histórico.')
        return d
      }
      try {
        if (active === 'chats') {
          const [items, conversation] = await Promise.all([
            get(`/api/admin?action=chats&days=${days}&offset=${offset}`),
            selected
              ? get(`/api/admin?action=chats&id=${selected}`)
              : Promise.resolve(null),
          ])
          if (alive) {
            setChats(items)
            setDetail(conversation)
          }
        } else {
          const d = await get('/api/admin?action=advisor')
          if (alive) setTurns(d.turns)
        }
        if (alive) {
          setLoaded(true)
          setError('')
        }
      } catch (e) {
        if (alive && e.name !== 'AbortError') {
          setError(e.message)
          setLoaded(true)
        }
      } finally {
        inFlight = false
      }
    }
    load()
    const timer = setInterval(load, 5000)
    document.addEventListener('visibilitychange', load)
    return () => {
      alive = false
      controller?.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', load)
    }
  }, [active, days, offset, selected])
  useEffect(() => {
    if (active === 'advisor')
      list.current?.scrollTo({
        top: list.current.scrollHeight,
        behavior: 'smooth',
      })
  }, [turns.length, busy, active])
  const send = async (text) => {
    const message = (text || draft).trim()
    if (!message || busy) return
    const key = JSON.stringify([message, days, selected])
    const id =
      retry.current?.key === key ? retry.current.id : crypto.randomUUID()
    retry.current = { key, id }
    setBusy(true)
    setError('')
    setPending({ id, question: message })
    setDraft('')
    const controller = new AbortController()
    request.current = controller
    const timer = setTimeout(() => controller.abort(), 75000)
    try {
      const r = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'advisor',
          id,
          message,
          days,
          chatId: selected,
        }),
        signal: controller.signal,
      })
      const d = await r.json()
      if (!r.ok) throw Error(d.error)
      setTurns((prev) => [
        ...prev.filter((t) => t.id !== id),
        {
          id,
          question: message,
          reply: d.reply,
          context: d.context,
          created_at: new Date().toISOString(),
        },
      ])
      retry.current = null
    } catch (e) {
      setError(
        e.name === 'AbortError'
          ? 'A análise demorou mais que o esperado. Tente novamente; sua pergunta foi preservada.'
          : e.message,
      )
      setDraft((current) => current || message)
    } finally {
      clearTimeout(timer)
      setBusy(false)
      setPending(null)
    }
  }
  return (
    <>
      <section hidden={active !== 'chats'} className="admin-history">
        <div className="admin-panel-title">
          <div>
            <h2>Conversas dos leads</h2>
            <p>
              Histórico privado de até 90 dias. Atualiza a cada 5 segundos nesta
              aba.
            </p>
          </div>
          <span>{chats.total} conversas</span>
        </div>
        {error && active === 'chats' && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}
        <div className="admin-chat-grid">
          <aside className="admin-panel admin-chat-list">
            <h3>Visitantes anônimos</h3>
            {!loaded && <p className="admin-note">Carregando…</p>}
            {loaded && !chats.items.length && (
              <p className="admin-note">
                Nenhuma conversa neste período. As conversas disponíveis e as
                próximas mensagens aparecerão aqui.
              </p>
            )}
            {chats.items.map((c) => (
              <button
                key={c.id}
                className={selected === c.id ? 'selected' : ''}
                onClick={() => {
                  setSelected(c.id)
                  setDetail(null)
                }}
              >
                <div>
                  <strong>Lead #{short(c.id)}</strong>
                  <small>{date(c.created_at)}</small>
                </div>
                <span>
                  {c.selection.name || 'Personagem'} · {c.selection.personality}
                </span>
                <p>
                  {c.last_message ||
                    'Pedido de mídia ou tentativa após o limite'}
                </p>
                <small>
                  {c.message_count} mensagens · {c.activity_count} ações
                </small>
              </button>
            ))}
            <div className="admin-history-pagination">
              <button
                disabled={!offset}
                onClick={() => setOffset(Math.max(0, offset - 25))}
              >
                <ArrowLeft size={14} /> Anteriores
              </button>
              <span>
                {chats.total ? offset + 1 : 0}–
                {Math.min(offset + 25, chats.total)}
              </span>
              <button
                disabled={offset + 25 >= chats.total}
                onClick={() => setOffset(offset + 25)}
              >
                Próximas <ArrowRight size={14} />
              </button>
            </div>
          </aside>
          <article className="admin-panel admin-transcript">
            {!selected ? (
              <div className="admin-empty">
                <MessageCircle />
                <p>Selecione uma conversa para ler as mensagens.</p>
              </div>
            ) : !detail ? (
              <p className="admin-note">Abrindo conversa…</p>
            ) : (
              <>
                <div className="admin-panel-title">
                  <div>
                    <h2>Lead #{short(detail.id)}</h2>
                    <p>Início: {date(detail.created_at)}</p>
                  </div>
                  <button
                    onClick={() => {
                      setSelected(null)
                      setDetail(null)
                    }}
                    aria-label="Fechar conversa"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="admin-profile-tags">
                  {[
                    'name',
                    'style',
                    'personality',
                    'relationship',
                    'occupation',
                    'speechStyle',
                    'socialEnergy',
                    'initiative',
                    'affection',
                    'humor',
                    'replyLength',
                  ].map(
                    (k) =>
                      detail.selection[k] && (
                        <span key={k}>{detail.selection[k]}</span>
                      ),
                  )}
                </div>
                <div className="admin-transcript-messages">
                  {detail.messages.map((m, i) => (
                    <div
                      key={i}
                      className={`admin-transcript-message ${m.role}`}
                    >
                      <strong>
                        {m.role === 'user'
                          ? 'Lead'
                          : detail.selection.name || 'Personagem'}
                      </strong>
                      <p>{m.text}</p>
                      {m.hasImage && <small>Imagem gerada enviada</small>}
                      <time>{date(m.at)}</time>
                    </div>
                  ))}
                  {!detail.messages.length && (
                    <p className="admin-note">
                      Ainda não há resposta concluída nesta conversa.
                    </p>
                  )}
                </div>
                {detail.activity.length > 0 && (
                  <div className="admin-chat-activity">
                    <h3>Pedidos e tentativas após o limite</h3>
                    {detail.activity.map((a) => (
                      <div key={a.id}>
                        <strong>
                          {a.kind === 'limit'
                            ? 'Tentativa de continuar'
                            : a.kind === 'photo'
                              ? 'Pediu foto'
                              : 'Pediu vídeo'}
                        </strong>
                        <p>{a.text}</p>
                        <small>{date(a.created_at)}</small>
                      </div>
                    ))}
                  </div>
                )}
                {detail.journey.length > 0 && (
                  <details className="admin-chat-activity">
                    <summary>
                      Ver trajetória no funil ({detail.journey.length} eventos)
                    </summary>
                    {detail.journey.map((e, i) => (
                      <p key={i}>
                        {e.event}
                        {e.step ? ` · ${e.step}` : ''}
                        <small> {date(e.at)}</small>
                      </p>
                    ))}
                  </details>
                )}
                <p className="admin-note">
                  O nome acima é o da personagem escolhida. Leads são
                  identificados pelo código da conversa. Horários antigos podem
                  não estar disponíveis.
                </p>
                <button
                  className="admin-analyze-lead"
                  onClick={() => {
                    setDraft(
                      'Analise esta conversa e as métricas atuais. Onde podemos melhorar a experiência e a passagem para o plano?',
                    )
                    document
                      .querySelector('[data-admin-tab="advisor"]')
                      ?.click()
                  }}
                >
                  <Sparkles size={15} /> Analisar esta conversa com IA
                </button>
              </>
            )}
          </article>
        </div>
      </section>
      <section hidden={active !== 'advisor'} className="admin-advisor">
        <div className="admin-panel-title">
          <div>
            <h2>Análise com IA</h2>
            <p>
              Converse sobre os dados reais do período selecionado. O histórico
              fica salvo.
            </p>
          </div>
          <span>{days === 1 ? 'Hoje' : `${days} dias`}</span>
        </div>
        <div className="admin-advisor-context">
          <Sparkles size={17} />
          <div>
            <strong>Métricas atualizadas a cada pergunta</strong>
            <p>
              Funil completo, páginas, fontes, dispositivos, visitas, pessoas
              online e erros.
              {selected
                ? ` Inclui a conversa do lead #${short(selected)}.`
                : ' Nenhuma conversa individual anexada.'}
            </p>
          </div>
          {selected && (
            <button
              onClick={() => setSelected(null)}
              aria-label="Remover conversa da análise"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className="admin-panel">
          <div className="admin-advisor-messages" ref={list} aria-live="polite">
            {!loaded && !turns.length && (
              <p className="admin-note">Carregando histórico…</p>
            )}
            {loaded && !turns.length && !busy && (
              <div className="admin-empty">
                <Sparkles />
                <h3>Vamos encontrar a próxima melhoria?</h3>
                <p>
                  Pergunte sobre o maior gargalo, a experiência do chat ou um
                  teste para aumentar a conversão.
                </p>
              </div>
            )}
            {turns.map((t) => (
              <div key={t.id} className="admin-advisor-turn">
                <div className="admin-advisor-question">
                  <strong>Você</strong>
                  <p>{t.question}</p>
                  <small>{date(t.created_at)}</small>
                </div>
                <div className="admin-advisor-answer">
                  <strong>
                    <Sparkles size={14} /> Analista Piskou
                  </strong>
                  <p>{t.reply}</p>
                  <small>
                    Dados: {date(t.context?.metricsAt)} · {t.context?.days} dias
                    {t.context?.chatId
                      ? ` · Lead #${short(t.context.chatId)}`
                      : ''}
                  </small>
                </div>
              </div>
            ))}
            {busy && (
              <div className="admin-advisor-answer">
                <strong>
                  <Sparkles size={14} /> Analista Piskou
                </strong>
                {pending && !turns.some((t) => t.id === pending.id) && (
                  <p className="admin-note">Sua pergunta: {pending.question}</p>
                )}
                <p role="status">
                  Analisando as métricas e preparando sugestões…
                </p>
              </div>
            )}
          </div>
          {error && active === 'advisor' && (
            <p className="admin-error" role="alert">
              {error}
            </p>
          )}
          <div className="admin-advisor-prompts">
            {[
              'Qual é o maior gargalo hoje?',
              'Quais 3 melhorias devemos testar primeiro?',
              'Como melhorar a conversão do chat para os planos?',
            ].map((text) => (
              <button disabled={busy} key={text} onClick={() => send(text)}>
                {text}
              </button>
            ))}
          </div>
          <form
            className="admin-advisor-form"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <textarea
              aria-label="Pergunta para o analista"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Vamos analisar o funil juntos…"
              maxLength={2000}
              rows={3}
            />
            <button disabled={busy || !draft.trim()} type="submit">
              <Send size={16} /> {busy ? 'Analisando…' : 'Enviar'}
            </button>
          </form>
          <p className="admin-note">
            A análise é feita pela OpenAI somente ao enviar uma pergunta. Recebe
            as métricas agregadas e, se selecionada, a conversa do lead com
            e-mails, números e chaves mascarados. Sugestões não alteram o site
            automaticamente. Últimas 100 análises no histórico; as últimas 12
            entram no contexto.
          </p>
        </div>
      </section>
    </>
  )
}
