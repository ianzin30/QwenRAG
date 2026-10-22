import type { RagApi } from './RagApi';
import { HttpRagApi } from './httpAdapter';

export type { RagApi } from './RagApi';
export * from './types';
export { ApiError, describeError, isAbortError } from './errors';

/**
 * Picks the adapter from build-time env. Mock code is loaded with a dynamic import,
 * so it is split out of the bundle and never runs unless mock mode is chosen explicitly.
 */
export async function createApi(): Promise<RagApi> {
  const mode = import.meta.env.MODE === 'mock' ? 'mock' : import.meta.env.VITE_API_MODE ?? 'http';
  if (mode === 'mock') {
    const { MockRagApi } = await import('../../mocks/mockAdapter');
    return new MockRagApi();
  }
  return new HttpRagApi(import.meta.env.VITE_API_BASE_URL || '/api');
}
