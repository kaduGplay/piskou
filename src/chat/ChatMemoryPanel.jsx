import { useEffect, useState } from 'react'
import { Brain, RefreshCw, Trash2 } from 'lucide-react'
const LABELS = {
  'user:name': 'Como você prefere ser chamado',
  'preference:nicknames': 'Apelidos',
  'preference:candor': 'Franqueza',
  'preference:repetition': 'Variação das respostas',
  'preference:flirt': 'Flerte',
  'preference:humor': 'Brincadeiras',
  'preference:length': 'Tamanho das respostas',
  'preference:emojis': 'Emojis',
  'preference:questions': 'Perguntas',
}
const label = (fact) =>
  fact.kind === 'open_topic'
    ? 'Assunto: ' +
      ({
        interview: 'Entrevista',
        project: 'Projeto',
        recipe: 'Receita',
        film: 'Filme',
      }[fact.key.slice(6)] || 'Em aberto')
    : LABELS[fact.key] || 'Interesse informado'
const value = (fact) =>
  fact.key === 'preference:repetition'
    ? 'evitar respostas repetitivas'
    : fact.key === 'preference:candor'
      ? 'sem elogios automáticos'
      : typeof fact.value === 'boolean'
        ? fact.value
          ? 'permitidos'
          : 'evitar'
        : { short: 'respostas curtas', detailed: 'respostas detalhadas' }[
            fact.value
          ] || fact.value
export default function ChatMemoryPanel({ selection }) {
  const [state, setState] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false)
  const load = async (signal) => {
    const response = await fetch(
      '/api/chat-memory?selection=' +
        encodeURIComponent(JSON.stringify(selection)),
      { signal },
    )
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Memória indisponível.')
    setState((previous) =>
      previous?.revision > data.state.revision ? previous : data.state,
    )
    setError('')
  }
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).catch((e) => {
      if (e.name !== 'AbortError') setError(e.message)
    })
    const refresh = () =>
      load(controller.signal).catch((e) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
    window.addEventListener('piskou:memory-updated', refresh)
    return () => {
      controller.abort()
      window.removeEventListener('piskou:memory-updated', refresh)
    }
  }, [selection])
  const change = async (patch) => {
    if (busy || !state) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/chat-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, selection, revision: state.revision }),
      })
      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error || 'Não foi possível atualizar.')
      setState((previous) =>
        previous?.revision > data.state.revision ? previous : data.state,
      )
      setConfirm(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="chat-memory-panel" aria-label="Memória desta conversa">
      <h3>
        <Brain size={18} /> Memória da conversa
      </h3>
      <p>
        Guarde assuntos em aberto, preferências e interesses que você informar a
        esta personagem. Cenas imaginadas não viram lembranças reais.
      </p>
      <button
        type="button"
        className="chat-memory-toggle"
        role="switch"
        aria-checked={state?.enabled === true}
        disabled={busy || !state}
        onClick={() => change({ action: 'toggle', enabled: !state.enabled })}
      >
        <span>Guardar lembranças</span>
        <strong>{state?.enabled ? 'Ativada' : 'Desativada'}</strong>
      </button>
      <small>
        Desativar também apaga as lembranças salvas. Não apaga o histórico nem
        as configurações da personagem. O contexto recente continua disponível
        no chat.
      </small>
      {error && (
        <p role="alert" className="chat-memory-error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="chat-memory-reload"
        disabled={busy}
        onClick={() => load().catch((e) => setError(e.message))}
      >
        <RefreshCw size={13} /> Atualizar lembranças
      </button>
      {state?.enabled && (
        <>
          <ul>
            {state.facts.map((fact) => (
              <li key={fact.key}>
                <div>
                  <strong>
                    {label(fact)}: {value(fact)}
                  </strong>
                  {fact.kind === 'open_topic' && (
                    <small>
                      {fact.status === 'resolved' ? 'Resolvido' : 'Em aberto'} ·{' '}
                      {fact.revisit === 'declined'
                        ? 'Não retomar'
                        : fact.lastAskedAt
                          ? 'Já retomado'
                          : 'Retomada permitida'}{' '}
                      · {fact.eventDate || 'Data desconhecida'}
                    </small>
                  )}
                  <blockquote>“{fact.source.quote}”</blockquote>
                  <small>
                    Sua mensagem {fact.source.turn} · Registrado em{' '}
                    {new Date(fact.updatedAt).toLocaleString('pt-BR')}
                  </small>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={'Apagar lembrança: ' + label(fact)}
                  onClick={() => change({ action: 'delete', key: fact.key })}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
          {!state.facts.length && (
            <p>
              Nenhuma lembrança salva. A partir da ativação, declarações
              suportadas como “gosto de cozinhar” ou “sem apelidos” podem ser
              guardadas. Dados sensíveis não são salvos automaticamente.
            </p>
          )}
          {!!state.facts.length &&
            (confirm ? (
              <div className="chat-memory-confirm">
                <p>Apagar todas as lembranças desta personagem?</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => change({ action: 'clear' })}
                >
                  Apagar lembranças
                </button>
                <button type="button" onClick={() => setConfirm(false)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="chat-memory-reload"
                onClick={() => setConfirm(true)}
              >
                <Trash2 size={13} /> Apagar todas as lembranças
              </button>
            ))}
        </>
      )}
    </section>
  )
}
