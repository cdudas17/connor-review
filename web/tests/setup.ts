import '@testing-library/jest-dom/vitest';
import { beforeAll, afterAll, afterEach } from 'vitest';
import { server } from './msw/server.js';
import { _resetPRDetailsCacheForTests } from '../src/hooks/usePRDetails.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  _resetPRDetailsCacheForTests();
});
afterAll(() => server.close());
