import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import Layout from './components/Layout'
import SecurityProvider from './components/SecurityProvider'
import { scheduleChainPackRpcBootstrap } from './store/walletStore'

const Home = lazy(() => import('./pages/Home'))
const Governance = lazy(() => import('./pages/Governance'))
const Staking = lazy(() => import('./pages/Staking'))
const Lending = lazy(() => import('./pages/Lending'))
const Insurance = lazy(() => import('./pages/Insurance'))
const Crowdfunding = lazy(() => import('./pages/Crowdfunding'))
const StagedCapital = lazy(() => import('./pages/StagedCapital'))
const YieldFarming = lazy(() => import('./pages/YieldFarming'))
const Derivatives = lazy(() => import('./pages/Derivatives'))
const Wallet = lazy(() => import('./pages/Wallet'))
const Bridge = lazy(() => import('./pages/Bridge'))
const Swap = lazy(() => import('./pages/Swap'))
const Liquidity = lazy(() => import('./pages/Liquidity'))
const TreasuryIncentives = lazy(() => import('./pages/TreasuryIncentives'))
const ShieldedEcosystem = lazy(() => import('./pages/ShieldedEcosystem'))

const Loading = () => (
  <div className="flex items-center justify-center min-h-[50vh]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-terminal-accent"></div>
  </div>
)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30000,
    },
    mutations: {
      retry: 0, // Don't retry mutations automatically
    },
  },
})

function App() {
  useEffect(() => {
    scheduleChainPackRpcBootstrap()
  }, [])

  return (
    <SecurityProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Layout>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/governance" element={<Governance />} />
                <Route path="/staking" element={<Staking />} />
                <Route path="/lending" element={<Lending />} />
                <Route path="/insurance" element={<Insurance />} />
                <Route path="/crowdfunding" element={<Crowdfunding />} />
                <Route path="/staged-capital" element={<StagedCapital />} />
                <Route path="/yield-farming" element={<YieldFarming />} />
                <Route path="/derivatives" element={<Derivatives />} />
                <Route path="/swap" element={<Swap />} />
                <Route path="/liquidity" element={<Liquidity />} />
                <Route path="/treasury-incentives" element={<TreasuryIncentives />} />
                <Route path="/bridge" element={<Bridge />} />
                <Route path="/shielded-ecosystem" element={<ShieldedEcosystem />} />
                <Route path="/wallet" element={<Wallet />} />
              </Routes>
            </Suspense>
          </Layout>
        </BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#ffffff',
            color: '#1d1d1f',
            border: '1px solid #d2d2d7',
            fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
          },
          success: {
            iconTheme: {
              primary: '#34c759',
              secondary: '#ffffff',
            },
          },
          error: {
            iconTheme: {
              primary: '#ff3b30',
              secondary: '#ffffff',
            },
          },
        }}
      />
      </QueryClientProvider>
    </SecurityProvider>
  )
}

export default App

