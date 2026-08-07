import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProfileProvider } from './context/ProfileContext'
import { TodosProvider } from './context/TodosContext'
import { RequirementsProvider } from './context/RequirementsContext'
import { SprintsProvider } from './context/SprintsContext'
import { BugsProvider } from './context/BugsContext'
import { KpisProvider } from './context/KpisContext'
import { NewsProvider } from './context/NewsContext'
import { NavProvider } from './context/NavContext'
import { DashboardProvider } from './context/DashboardContext'
import AuthGate from './components/AuthGate'
import AppShell from './components/AppShell'
import ModulePage from './pages/ModulePage'
import AccountPage from './pages/Account'

export default function App() {
  return (
    <AuthProvider>
      <ProfileProvider>
      <TodosProvider>
        <RequirementsProvider>
          <SprintsProvider>
            <BugsProvider>
              <KpisProvider>
                <NewsProvider>
                <DashboardProvider>
                  <NavProvider>
                    <BrowserRouter>
                    <AuthGate>
                      <AppShell>
                        <Routes>
                          <Route path="/" element={<Navigate to="/modules/overview" replace />} />
                          <Route path="/modules/:id" element={<ModulePage />} />
                          <Route path="/account" element={<AccountPage />} />
                          <Route path="*" element={<Navigate to="/modules/overview" replace />} />
                        </Routes>
                      </AppShell>
                    </AuthGate>
                  </BrowserRouter>
                  </NavProvider>
                  </DashboardProvider>
                </NewsProvider>
                </KpisProvider>
            </BugsProvider>
          </SprintsProvider>
        </RequirementsProvider>
      </TodosProvider>
      </ProfileProvider>
    </AuthProvider>
  )
}
