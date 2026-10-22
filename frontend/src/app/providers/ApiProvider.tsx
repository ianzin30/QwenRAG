import { createContext, useContext, type ReactNode } from 'react';
import type { RagApi } from '../../services/api';

const ApiContext = createContext<RagApi | null>(null);

export function ApiProvider({ api, children }: { api: RagApi; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): RagApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside <ApiProvider>');
  return api;
}
