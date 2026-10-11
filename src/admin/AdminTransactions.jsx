import { useEffect, useRef, useState, useId } from 'react'
import { PLANS, formatBRL } from '../shared/checkout.js'
const LABELS = {
  pending: 'Pendente',
  paid: 'Pago',
  failed: 'Falhou',
  expired: 'Expirou',
}
const date = (value) =>
  value
    ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : '—'
function Transaction({ item, onSaved }) {
  const fieldId = useId()
  const [editing, setEditing] = useState(false),
    [status, setStatus] = useState(''),
    [note, setNote] = useState(''),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const guard = useRef(false)
  async function save(event) {
    event.preventDefault()
    if (guard.current) return
    guard.current = true
    setBusy(true)
    setError('')
    try {
      const r = await fetch('/api/admin?action=transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          status: status || null,
          note,
          revision,
        }),
        signal: AbortSignal.timeout(15000),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setEditing(false)
      onSaved()
    } catch (e) {
      setError(e.message || 'Não foi possível salvar.')
    } finally {
      guard.current = false
      setBusy(false)
    }
  }
  return (
    <article className="admin-transaction">
      <div className="admin-transaction-heading">
        <strong>
          {PLANS[item.plan_id]?.name || item.plan_id || 'Plano não registrado'}
        </strong>
        <strong>{formatBRL(Number(item.amount) || 0)}</strong>
      </div>
      <p>
        {date(item.created_at)} · {String(item.method || '').toUpperCase()} ·{' '}
        {item.character_name || 'Personagem não registrada'}
      </p>
      <p>
        {item.customer_name || 'Comprador não registrado'}
        {item.customer_email ? ' · ' + item.customer_email : ''}
      </p>
      <p>
        <strong>Status: {LABELS[item.status] || item.status}</strong> ·{' '}
        {item.manual_status ? 'Marcação manual' : 'Gateway'}
        <br />
        Gateway: {LABELS[item.gateway_status] || item.gateway_status}
      </p>
      <small className="admin-transaction-id">
        Transação: {item.id}
        <br />
        Pedido: {item.order_id || '—'}
      </small>
      {item.note && <p>Observação: {item.note}</p>}
      {!editing ? (
        <button
          type="button"
          onClick={() => {
            setStatus(item.manual_status || '')
            setNote(item.note)
            setRevision(item.revision)
            setEditing(true)
            setError('')
          }}
        >
          Alterar status / observação
        </button>
      ) : (
        <form onSubmit={save}>
          <label>
            Status interno
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={busy}
            >
              <option value="">Acompanhar o gateway</option>
              {Object.entries(LABELS).map(([key, label]) => (
                <option value={key} key={key}>
                  {label} (manual)
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={fieldId}>Observação</label>
          <textarea
            id={fieldId}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
          />
          <p>
            A marcação é interna. Não altera o gateway nem libera ou remove
            créditos do chat.
          </p>
          {error && (
            <p role="alert" className="admin-error">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar alteração'}
          </button>{' '}
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            Cancelar
          </button>
        </form>
      )}
      {!!item.audit?.length && (
        <details>
          <summary>
            Histórico de alterações ({item.audit.length} mais recentes)
          </summary>
          <ul>
            {item.audit.map((entry, index) => (
              <li key={index}>
                {date(entry.created_at)} ·{' '}
                {entry.previous_status
                  ? LABELS[entry.previous_status]
                  : 'Gateway'}{' '}
                → {entry.status ? LABELS[entry.status] : 'Gateway'}
                {entry.note ? ' · ' + entry.note : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  )
}
export default function AdminTransactions({ active, days }) {
  const [data, setData] = useState(null),
    [status, setStatus] = useState('all'),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0)
  useEffect(() => {
    setOffset(0)
  }, [status, days])
  useEffect(() => {
    if (!active) return
    let alive = true,
      inFlight = false
    const controller = new AbortController()
    const load = async () => {
      if (inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      try {
        const r = await fetch(
          `/api/admin?action=transactions&days=${days}&status=${status}&offset=${offset}`,
          { signal: controller.signal },
        )
        const d = await r.json()
        if (!r.ok) throw new Error(d.error)
        if (alive) {
          setData(d)
          setError('')
        }
      } catch (e) {
        if (alive && e.name !== 'AbortError') setError(e.message)
      } finally {
        inFlight = false
      }
    }
    load()
    const timer = setInterval(load, 5000)
    document.addEventListener('visibilitychange', load)
    return () => {
      alive = false
      controller.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', load)
    }
  }, [active, days, status, offset, refresh])
  if (!active) return null
  return (
    <section className="admin-panel admin-transactions">
      <h2>Transações geradas e pagas</h2>
      <p>
        Atualiza a cada 5 segundos com esta aba visível. Os totais seguem o
        período selecionado acima.
      </p>
      <p>
        “Pago pelo gateway” é uma confirmação do pagamento. Marcações manuais
        são apenas para sua conferência interna.
      </p>
      {data && (
        <div className="admin-cards">
          {[
            ['Geradas', data.summary.generated],
            ['Pagas pelo gateway', data.summary.gatewayPaid],
            [
              'Valor confirmado pelo gateway',
              formatBRL(Number(data.summary.gatewayPaidAmount) || 0),
            ],
            ['Marcadas pagas, sem confirmação', data.summary.manualPaid],
          ].map(([title, value]) => (
            <article key={title}>
              <span>{title}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
      )}
      <label>
        Filtrar status
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Todos</option>
          {Object.entries(LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      {!data ? (
        <p role="status">Carregando transações…</p>
      ) : (
        <>
          <p>
            {data.total} transações · Atualizado às {date(data.updatedAt)}
          </p>
          {!data.transactions.length && <p>Nenhuma transação neste filtro.</p>}
          <div className="admin-transactions-list">
            {data.transactions.map((item) => (
              <Transaction
                key={item.id}
                item={item}
                onSaved={() => setRefresh((value) => value + 1)}
              />
            ))}
          </div>
          <div className="admin-transaction-pagination">
            <button
              type="button"
              disabled={!offset}
              onClick={() => setOffset((value) => Math.max(0, value - 50))}
            >
              Anterior
            </button>
            <span>Página {Math.floor(offset / 50) + 1}</span>
            <button
              type="button"
              disabled={offset + 50 >= data.total || offset >= 10000}
              onClick={() => setOffset((value) => value + 50)}
            >
              Próxima
            </button>
          </div>
        </>
      )}
    </section>
  )
}
