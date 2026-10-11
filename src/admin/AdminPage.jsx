import { useEffect, useState } from 'react'
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Download,
  Eye,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Users,
} from 'lucide-react'
import './AdminPage.css'
const number = (n) => Number(n || 0).toLocaleString('pt-BR')
const percent = (a, b) =>
  b ? `${((100 * a) / b).toFixed(1).replace('.', ',')}%` : '—'
const pageName = (p) =>
  ({ '/': 'Criador', '/chat': 'Chat', '/checkout': 'Checkout' })[p] || p
const stepName = (s) =>
  ({
    style: 'Estilo',
    general: 'Características',
    face: 'Rosto',
    body: 'Corpo',
    details: 'Personalidade',
    generating: 'Revelação',
  })[s] || ''
export default function AdminPage() {
  const [data, setData] = useState(null),
    [days, setDays] = useState(7),
    [password, setPassword] = useState(''),
    [logged, setLogged] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    document.title = 'Piskou · Administração'
    document.documentElement.classList.add('admin-open')
    return () => document.documentElement.classList.remove('admin-open')
  }, [])
  useEffect(() => {
    let alive = true,
      inFlight = false,
      controller
    const load = async () => {
      if (document.visibilityState === 'hidden' || inFlight) return
      inFlight = true
      controller = new AbortController()
      try {
        const r = await fetch(`/api/admin?days=${days}`, {
          signal: controller.signal,
        })
        const d = await r.json()
        if (!alive) return
        if (r.status === 401) {
          setLogged(false)
          setData(null)
          return
        }
        if (!r.ok) throw Error(d.error)
        setData(d)
        setLogged(true)
        setError('')
      } catch (e) {
        if (alive && e.name !== 'AbortError') setError(e.message)
      } finally {
        inFlight = false
      }
    }
    load()
    const timer = logged === true ? setInterval(load, 5000) : null
    document.addEventListener('visibilitychange', load)
    return () => {
      alive = false
      controller?.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', load)
    }
  }, [days, logged === true])
  const login = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const d = await r.json()
      if (!r.ok) throw Error(d.error)
      setPassword('')
      setLogged(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  const logout = async () => {
    try {
      const r = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      })
      if (!r.ok) throw Error('Não foi possível sair')
      setLogged(false)
      setData(null)
    } catch (e) {
      setError(e.message)
    }
  }
  const funnel = data?.funnel || [],
    visits = funnel[0]?.sessions || 0,
    complete = funnel.find((x) => x.rank === 7)?.sessions || 0
  const transitions = funnel.slice(1).map((s, i) => ({
    ...s,
    previous: funnel[i].sessions,
    loss: Math.max(0, funnel[i].sessions - s.continued),
  }))
  const bottleneck = transitions
    .filter((s) => s.previous >= 5)
    .sort((a, b) => b.loss / b.previous - a.loss / a.previous)[0]
  const exportCSV = () => {
    const rows = [
      ['Etapa', 'Sessões', 'Avançaram da anterior', 'Conversão da anterior'],
      ...transitions.map((s) => [
        s.label,
        s.sessions,
        s.continued,
        percent(s.continued, s.previous),
      ]),
    ]
    const blob = new Blob(
      [
        '\ufeff' +
          rows
            .map((r) =>
              r
                .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
                .join(';'),
            )
            .join('\r\n'),
      ],
      { type: 'text/csv;charset=utf-8' },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `piskou-funil-${days}dias.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  if (logged !== true)
    return (
      <main className="admin-login">
        <form onSubmit={login}>
          <span className="admin-brand">
            PISKOU <small>ADMIN</small>
          </span>
          <div className="admin-login-icon">
            <LockKeyhole />
          </div>
          <h1>Seu funil, por dentro.</h1>
          <p>
            Acompanhe cada etapa e encontre oportunidades de melhorar a
            conversão.
          </p>
          <label htmlFor="admin-password">Senha de administrador</label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <button disabled={busy || (logged === null && !error)}>
            {busy
              ? 'Entrando…'
              : logged === null && !error
                ? 'Verificando acesso…'
                : 'Entrar no painel'}{' '}
            <ArrowRight size={16} />
          </button>
          {error && (
            <p className="admin-error" role="alert">
              {error}
            </p>
          )}
        </form>
      </main>
    )
  return (
    <div className="admin-app">
      <header className="admin-header">
        <a href="/admin" className="admin-brand">
          PISKOU <small>ADMIN</small>
        </a>
        <div>
          <a href="/" target="_blank" rel="noreferrer">
            Abrir site <ArrowRight size={14} />
          </a>
          <button onClick={logout}>
            <LogOut size={15} /> Sair
          </button>
        </div>
      </header>
      <main>
        <div className="admin-title">
          <div>
            <span className="admin-eyebrow">VISÃO GERAL</span>
            <h1>Onde sua conexão acontece.</h1>
            <p>
              Da primeira visita ao pagamento. Descubra onde o funil perde
              força.
            </p>
          </div>
          <div className="admin-filters">
            <select
              aria-label="Período"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={1}>Hoje</option>
              <option value={7}>Últimos 7 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
            </select>
            <button onClick={exportCSV} disabled={!data}>
              <Download size={16} /> CSV
            </button>
          </div>
        </div>
        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}
        {!data ? (
          <p role="status">Carregando métricas…</p>
        ) : (
          <>
            <div className="admin-cards">
              {[
                [
                  Users,
                  'Visitantes únicos',
                  number(data.visitors),
                  'Por navegador neste período',
                ],
                [
                  Eye,
                  'Sessões',
                  number(data.sessions),
                  'Nova sessão após 30 min sem atividade',
                ],
                [
                  CheckCircle2,
                  'Concluíram o criador',
                  number(complete),
                  `${percent(complete, visits)} das sessões que visitaram o criador`,
                ],
                [
                  Activity,
                  'Online agora',
                  number(data.online),
                  'Atividade nos últimos 90 segundos',
                ],
              ].map(([Icon, label, value, sub]) => (
                <article key={label}>
                  <div>
                    <span>{label}</span>
                    <Icon size={18} />
                  </div>
                  <strong>{value}</strong>
                  <small>{sub}</small>
                </article>
              ))}
            </div>
            <section className="admin-insight">
              <BarChart3 size={22} />
              <div>
                <strong>
                  {bottleneck
                    ? `Observe a passagem para: ${bottleneck.label}`
                    : 'As primeiras visitas vão revelar seus gargalos'}
                </strong>
                <p>
                  {bottleneck
                    ? `${number(bottleneck.loss)} de ${number(bottleneck.previous)} sessões da etapa anterior ainda não chegaram aqui (${percent(bottleneck.loss, bottleneck.previous)}). Parte delas pode estar navegando agora. Verifique a clareza do próximo passo e compare novamente após um ajuste.`
                    : 'O diagnóstico aparece com pelo menos 5 sessões na etapa anterior. Nenhum dado demonstrativo é misturado às suas métricas.'}
                </p>
              </div>
            </section>
            <div className="admin-grid">
              <section className="admin-panel admin-funnel">
                <div className="admin-panel-title">
                  <div>
                    <h2>Raio X do funil</h2>
                    <p>
                      Sessões por etapa e avanço em relação à etapa anterior.
                    </p>
                  </div>
                  <span>{number(visits)} entradas</span>
                </div>
                <div className="admin-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Etapa</th>
                        <th>Chegaram</th>
                        <th>Avanço</th>
                        <th>Não avançaram ainda</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funnel.map((s, i) => {
                        const prev = funnel[i - 1]?.sessions
                        const loss = Math.max(0, (prev || 0) - s.continued)
                        return (
                          <tr key={s.rank}>
                            <td>
                              <div className="admin-stage">
                                <span>{String(i + 1).padStart(2, '0')}</span>
                                <div>
                                  <strong>{s.label}</strong>
                                  <div className="admin-bar">
                                    <i
                                      style={{
                                        width: `${visits ? Math.min(100, (100 * s.sessions) / visits) : 0}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td>{number(s.sessions)}</td>
                            <td>{i ? percent(s.continued, prev) : '—'}</td>
                            <td>
                              {i
                                ? `${number(loss)} · ${percent(loss, prev)}`
                                : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="admin-note">
                  Cada sessão conta uma vez por etapa. Avanço exige ter passado
                  pela etapa anterior primeiro. Entradas diretas no chat ou
                  checkout aparecem na contagem, mas não no avanço. “Não
                  avançaram” inclui sessões ainda em andamento.
                </p>
              </section>
              <section className="admin-panel">
                <div className="admin-panel-title">
                  <div>
                    <h2>
                      <span className="admin-live-dot" /> Acontecendo agora
                    </h2>
                    <p>Atualização automática a cada 5 segundos.</p>
                  </div>
                </div>
                {data.live.length ? (
                  data.live.map((l, i) => (
                    <div className="admin-list-row" key={i}>
                      <span>
                        {pageName(l.page)}
                        {l.page === '/' && l.step
                          ? ` · ${stepName(l.step)}`
                          : ''}
                      </span>
                      <strong>{number(l.visitors)}</strong>
                    </div>
                  ))
                ) : (
                  <div className="admin-empty">
                    <Activity />
                    <p>Nenhum visitante ativo agora.</p>
                  </div>
                )}
                <p className="admin-note">
                  O painel não entra na contagem. Um visitante com mais de uma
                  aba pode aparecer em mais de uma página.
                </p>
              </section>
            </div>
            <section className="admin-panel admin-engagement">
              <h2>Dentro do chat e checkout</h2>
              <p className="admin-note">
                Sessões que realizaram cada ação. Uma tentativa de mensagem pode
                falhar; confira as respostas e os erros.
              </p>
              <div className="admin-action-grid">
                {(data.actions || []).map((a) => (
                  <div className="admin-list-row" key={a.label}>
                    <span>{a.label}</span>
                    <strong>{number(a.sessions)}</strong>
                  </div>
                ))}
              </div>
            </section>
            <div className="admin-bottom-grid">
              <section className="admin-panel">
                <h2>Visitas por dia</h2>
                {data.daily.length ? (
                  <div className="admin-daily">
                    {data.daily.map((d) => (
                      <div key={d.day}>
                        <span>
                          {d.day.slice(5).split('-').reverse().join('/')}
                        </span>
                        <div className="admin-bar">
                          <i
                            style={{
                              width: `${(100 * d.sessions) / Math.max(...data.daily.map((x) => x.sessions), 1)}%`,
                            }}
                          />
                        </div>
                        <strong>{number(d.sessions)}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="admin-note">As visitas aparecerão aqui.</p>
                )}
              </section>
              {[
                ['Páginas visitadas', data.pages, 'page'],
                ['Origem do tráfego', data.sources, 'source'],
                ['Dispositivos', data.devices, 'device'],
              ].map(([title, rows, key]) => (
                <section className="admin-panel" key={title}>
                  <h2>{title}</h2>
                  {rows.length ? (
                    rows.map((r, i) => (
                      <div className="admin-list-row" key={i}>
                        <span>
                          {key === 'page'
                            ? pageName(r[key])
                            : key === 'device'
                              ? r[key] === 'mobile'
                                ? 'Celular'
                                : 'Computador'
                              : r[key]}
                        </span>
                        <strong>{number(r.sessions)}</strong>
                      </div>
                    ))
                  ) : (
                    <p className="admin-note">Sem dados no período.</p>
                  )}
                </section>
              ))}
            </div>
            <footer className="admin-footnote">
              <RefreshCw size={12} /> Atualizado às{' '}
              {new Date(data.updatedAt).toLocaleTimeString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
              })}
              . Horários de Brasília.{' '}
              {data.collectedSince &&
                `Coleta desde ${new Date(data.collectedSince).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`}{' '}
              Histórico de até 90 dias. Visitantes são estimados por navegador;
              bloqueadores e armazenamento desativado podem reduzir a precisão.
              Pagamentos são contabilizados por confirmação do servidor.
            </footer>
          </>
        )}
      </main>
    </div>
  )
}
