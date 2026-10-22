import { useEffect, useState } from 'react';
import { createApi, type RagApi } from '../services/api';
import { ApiProvider, useApi } from './providers/ApiProvider';
import { ThemeProvider } from './providers/ThemeProvider';
import { ToastProvider } from './providers/ToastProvider';
import { StoreProvider, useActions, useAppState } from './store/StoreProvider';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { DesktopShell } from './layouts/DesktopShell';
import { MobileShell } from './layouts/MobileShell';
import { BrandMark } from '../components/icons/Icon';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Primitives';

export function App() {
  const [api, setApi] = useState<RagApi | null>(null);
  useEffect(() => {
    void createApi().then(setApi);
  }, []);

  return (
    <ThemeProvider>
      {api ? (
        <ApiProvider api={api}>
          <ToastProvider>
            <StoreProvider>
              <Root />
            </StoreProvider>
          </ToastProvider>
        </ApiProvider>
      ) : (
        <BootScreen />
      )}
    </ThemeProvider>
  );
}

function Root() {
  const { boot } = useAppState();
  const { retryBoot } = useActions();
  const api = useApi();
  const mobile = useMediaQuery('(max-width: 640px)');

  if (boot.status === 'loading') return <BootScreen />;
  if (boot.status === 'error') {
    return (
      <div className="boot-screen">
        <div className="boot-card" role="alert">
          <BrandMark size={32} />
          <h1>Não foi possível conectar ao servidor</h1>
          <p>{boot.error}</p>
          <p className="mono small muted">
            Modo: {api.mode} · API: {import.meta.env.VITE_API_BASE_URL || '/api'}
          </p>
          <Button variant="primary" onClick={retryBoot}>
            Tentar de novo
          </Button>
        </div>
      </div>
    );
  }
  return (
    <>
      {api.mode === 'mock' && <div className="mock-badge mono" title="Dados de demonstração — nenhuma chamada ao backend">mock</div>}
      {mobile ? <MobileShell /> : <DesktopShell />}
    </>
  );
}

function BootScreen() {
  return (
    <div className="boot-screen" aria-busy="true">
      <div className="boot-card boot-card--quiet">
        <BrandMark size={32} />
        <Spinner size={16} />
      </div>
    </div>
  );
}
