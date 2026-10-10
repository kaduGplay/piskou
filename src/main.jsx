import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const Funnel = lazy(() => import('./funnel/Funnel.jsx'))
const CheckoutPage = lazy(() => import('./checkout/CheckoutPage.jsx'))
const ChatPage = lazy(() => import('./chat/ChatPage.jsx'))

// /checkout abre o checkout; o resto é o funil.
// ?dev=creating abre direto na revelação; ?dev=offer abre a revelação com a oferta aberta.
function App() {
  if (window.location.pathname.replace(/\/+$/, '') === '/chat') {
    return <Suspense fallback={<div className="app-loading" aria-label="Carregando conversa" />}><ChatPage /></Suspense>
  }
  if (window.location.pathname.replace(/\/+$/, '') === '/checkout') {
    return (
      <Suspense fallback={<div className="app-loading" aria-label="Carregando" />}>
        <CheckoutPage />
      </Suspense>
    )
  }
  const dev = new URLSearchParams(window.location.search).get('dev')
  const initialPhase = ['creating', 'offer'].includes(dev) ? dev : 'quiz'
  return (
    <Suspense fallback={<div className="app-loading" aria-label="Carregando" />}>
      <Funnel initialPhase={initialPhase} />
    </Suspense>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
