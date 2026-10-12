import { useEffect, useState, Suspense, lazy } from 'react'
import { Plus, MessageCircle, LockKeyhole, ChevronRight, LoaderCircle } from 'lucide-react'
import { DEFAULT_SELECTION, getResultImage } from '../funnel/data.js'
import { readSavedSelection, saveSelection, saveProgress } from '../shared/progress.js'
import './MessagesPage.css'
const PaywallSheet = lazy(() => import('../funnel/PaywallSheet.jsx'))
export default function MessagesPage() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [opening, setOpening] = useState(null), [offer, setOffer] = useState(false)
  const selection = data?.conversations.find((item) => item.id === data.active)?.selection || { ...DEFAULT_SELECTION, ...readSavedSelection() }
  const load = () => {
    setError('')
    fetch('/api/conversations', { cache: 'no-store' }).then(async (response) => {
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setData(result)
    }).catch((e) => setError(e.message || 'Não foi possível carregar suas conversas.'))
  }
  useEffect(() => { load() }, [])
  const open = async (item) => {
    if (opening) return
    setOpening(item.id); setError('')
    try {
      const response = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: item.id }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      saveSelection(result.selection)
      saveProgress({ draft: '', path: '/chat', paywallReached: false, mediaRequests: [] })
      window.location.assign('/chat')
    } catch (e) { setError(e.message); setOpening(null) }
  }
  const create = async () => {
    if (opening) return
    if (!data?.canCreate) { setOffer(true); return }
    setOpening('new'); setError('')
    try {
      const response = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create' }) })
      const result = await response.json()
      if (!response.ok) {
        if (result.code === 'premium_required') setOffer(true)
        throw new Error(result.error)
      }
    } catch (e) { setError(e.message); setOpening(null); return }
    saveSelection(DEFAULT_SELECTION)
    saveProgress({ path: '/', step: 0, draft: '', paywallReached: false, mediaRequests: [] })
    window.location.assign('/?edit=1')
  }
  return <main className="messages-page">
    <section className="messages-inbox" aria-label="Lista de conversas" inert={offer ? true : undefined}>
      <header><div><span className="messages-brand">PISKOU</span><h1>Mensagens</h1></div>
        <button type="button" className="messages-create-icon" aria-label="Criar outra personagem" onClick={create} disabled={!data}><Plus size={24} /></button>
      </header>
      <button type="button" className="messages-create" onClick={create} disabled={!data}>
        <span className="messages-new-avatar"><Plus size={22} /></span><span><strong>Criar outra personagem</strong><small>{data?.canCreate ? 'Uma nova conexão, uma nova conversa' : 'Disponível com Premium ou Luxo'}</small></span>{!data?.canCreate && <LockKeyhole size={17} />}
      </button>
      {error && <div className="messages-error" role="alert">{error}<button type="button" onClick={load}>Tentar novamente</button></div>}
      {!data && !error && <p className="messages-empty" role="status"><LoaderCircle size={20} /> Carregando conversas…</p>}
      {data?.conversations.map((item) => <button type="button" className="messages-row" key={item.id} onClick={() => open(item)} disabled={!!opening}>
        <img src={getResultImage(item.selection).src} alt="" /><span className="messages-row-copy"><strong>{item.selection.name || 'Sua personagem'}</strong><small>{item.preview}</small></span>
        <span className="messages-row-end">{item.updatedAt && <time>{new Date(item.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>}<ChevronRight size={17} /></span>
      </button>)}
      {data && !data.conversations.length && <div className="messages-empty"><MessageCircle size={32} /><p>Suas conversas aparecerão aqui.</p><a href="/?edit=1">Criar minha primeira personagem</a></div>}
      <footer>Personagens virtuais · Conversas deste navegador · 18+</footer>
    </section>
    {offer && <Suspense fallback={<div className="messages-empty" role="status">Carregando planos…</div>}><PaywallSheet sel={selection} source="new-character" onClose={() => setOffer(false)} /></Suspense>}
  </main>
}
