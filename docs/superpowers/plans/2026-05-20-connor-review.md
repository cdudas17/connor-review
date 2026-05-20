# Connor Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Vite+React frontend and Fastify+TypeScript backend that lets the user paste GitHub PR URLs, review them in a side drawer with unified/split diffs, leave inline + summary comments + thread replies, and Approve / Request Changes / Comment / Next through the queue with prefetched diffs.

**Architecture:** Two top-level dirs in `~/workspace/connor-review` — `web/` (Vite + React + TS) and `server/` (Fastify + TS). Root `package.json` runs both via `concurrently`. Server shells out to the user's `gh` CLI for all GitHub access and holds a 20-entry LRU cache of meta+threads and diffs keyed by `${owner}/${repo}#${number}@${headSha}`. Frontend persists the tracked PR list + status (`untouched`/`reviewed`/`approved`) in `localStorage`; staged review drafts live in `App`-level state keyed by `owner/repo/number` so they survive drawer close/reopen but not page reload.

**Tech Stack:** TypeScript 5.x, Node ≥20, Fastify 5, `tsx`, vitest, msw. React 18, Vite 6, `react-diff-view`, `prismjs`. Tooling installed via `npm` (no monorepo tooling, no pnpm workspaces).

**Spec:** `docs/superpowers/specs/2026-05-20-connor-review-design.md`.

---

## File Structure

```
connor-review/
  package.json                              # root: concurrently dev
  tsconfig.base.json                        # shared TS config
  .gitignore
  README.md

  server/
    package.json
    tsconfig.json
    vitest.config.ts
    src/
      index.ts                              # Fastify bootstrap, port 5174
      routes/pulls.ts                       # PR routes
      lib/ghExec.ts                         # gh CLI wrapper
      lib/lruCache.ts                       # Map-based LRU
      lib/parseRouteParams.ts               # validate owner/repo/number
      queries/pullRequest.graphql.ts        # PR meta + threads query
      queries/addPullRequestReview.graphql.ts
      queries/addPullRequestReviewThreadReply.graphql.ts
    tests/
      ghExec.test.ts
      lruCache.test.ts
      parseRouteParams.test.ts
      routes/pulls.test.ts

  web/
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/
      main.tsx                              # Vite entry
      App.tsx                               # owns tracked PRs + drafts + drawer state
      types.ts                              # shared types
      lib/parsePRUrl.ts                     # URL → {owner,repo,number}
      lib/api.ts                            # fetch wrapper to backend
      hooks/useTrackedPRs.ts                # tracked list + status, localStorage
      hooks/usePRDetails.ts                 # meta+threads+diff fetch
      hooks/useDrafts.ts                    # staged inline comments / summary / replies
      hooks/useNextPRPrefetch.ts            # warm next PR cache
      components/AddPRBar.tsx
      components/PRList.tsx
      components/FilterToggle.tsx
      components/StatusBadge.tsx
      components/ReviewDrawer.tsx
      components/PRHeader.tsx
      components/DiffViewer.tsx
      components/ReviewFooter.tsx
      components/DiscardDraftsModal.tsx
      components/AuthRequiredBanner.tsx
      components/ErrorToast.tsx
      styles/app.css
    tests/
      lib/parsePRUrl.test.ts
      hooks/useTrackedPRs.test.tsx
      hooks/useDrafts.test.tsx
      hooks/usePRDetails.test.tsx
      hooks/useNextPRPrefetch.test.tsx
      components/AddPRBar.test.tsx
      components/PRList.test.tsx
      components/FilterToggle.test.tsx
      components/ReviewFooter.test.tsx
      components/DiscardDraftsModal.test.tsx
      flows/ReviewDrawer.flow.test.tsx      # end-to-end happy path with msw
      msw/handlers.ts                       # shared msw handlers
      msw/server.ts                         # msw test server

  docs/
    superpowers/
      specs/2026-05-20-connor-review-design.md
      plans/2026-05-20-connor-review.md     # this file
```

---

## Task 1: Repo scaffolding

**Files:**
- Create: `package.json` (root), `.gitignore`, `tsconfig.base.json`, `README.md`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules
dist
.vite
coverage
.env
.env.local
.DS_Store
.superpowers/
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "connor-review",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "concurrently -n server,web -c cyan,magenta \"npm --prefix server run dev\" \"npm --prefix web run dev\"",
    "test": "npm --prefix server test && npm --prefix web test",
    "typecheck": "npm --prefix server run typecheck && npm --prefix web run typecheck",
    "install:all": "npm install && npm --prefix server install && npm --prefix web install"
  },
  "engines": { "node": ">=20" },
  "devDependencies": {
    "concurrently": "^9.1.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitOverride": true
  }
}
```

- [ ] **Step 4: Create `README.md`**

```markdown
# Connor Review

Local PR review tool. See [the design spec](docs/superpowers/specs/2026-05-20-connor-review-design.md).

## Run

```bash
npm run install:all
npm run dev
```

Then open http://localhost:5173. Requires `gh auth login` to be active.
```

- [ ] **Step 5: Install root deps and commit**

```bash
cd ~/workspace/connor-review
npm install
git add package.json package-lock.json tsconfig.base.json .gitignore README.md
git commit -m "feat: scaffold repo root"
```

---

## Task 2: Server scaffolding

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/src/index.ts`

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "connor-review-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node --import tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.1",
    "fastify": "^5.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Create `server/src/index.ts` (boot-only, no routes yet)**

```ts
import Fastify from 'fastify';
import cors from '@fastify/cors';

export async function buildServer() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: 'http://localhost:5173' });
  app.get('/api/health', async () => ({ ok: true }));
  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = await buildServer();
  await app.listen({ port: 5174, host: '127.0.0.1' });
}
```

- [ ] **Step 5: Write a smoke test that hits /api/health**

Create `server/tests/health.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/index.js';

describe('health route', () => {
  it('returns ok', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
```

- [ ] **Step 6: Install + run test**

```bash
cd ~/workspace/connor-review/server
npm install
npm test
```

Expected: 1 passed, exit 0.

- [ ] **Step 7: Commit**

```bash
cd ~/workspace/connor-review
git add server
git commit -m "feat(server): scaffold fastify + vitest with /api/health"
```

---

## Task 3: Server — `ghExec` wrapper

**Files:**
- Create: `server/src/lib/ghExec.ts`, `server/tests/ghExec.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/tests/ghExec.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import * as childProcess from 'node:child_process';
import { ghExec, GhCliError } from '../src/lib/ghExec.js';

vi.mock('node:child_process', () => {
  const execFile = vi.fn();
  return { execFile };
});

function mockExecFile(stdout: string, stderr = '', code = 0) {
  (childProcess.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], cb: (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void) => {
      if (code === 0) cb(null, stdout, stderr);
      else {
        const err = new Error(`exit ${code}`) as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        cb(err, stdout, stderr);
      }
    },
  );
}

describe('ghExec', () => {
  it('returns stdout on success', async () => {
    mockExecFile('hello\n');
    const out = await ghExec(['api', 'user']);
    expect(out).toBe('hello\n');
  });

  it('throws GhCliError tagged AUTH_REQUIRED when stderr mentions gh auth login', async () => {
    mockExecFile('', 'error: gh auth login required', 1);
    await expect(ghExec(['api', 'user'])).rejects.toMatchObject({
      name: 'GhCliError',
      code: 'AUTH_REQUIRED',
    });
  });

  it('throws GhCliError tagged GH_API_ERROR when stderr is a GraphQL error', async () => {
    mockExecFile('', 'GraphQL error: Could not resolve to a PullRequest', 1);
    await expect(ghExec(['api', 'graphql', '-f', 'query=x'])).rejects.toMatchObject({
      name: 'GhCliError',
      code: 'GH_API_ERROR',
    });
  });

  it('throws GhCliError tagged GH_CLI_FAILED for any other nonzero exit', async () => {
    mockExecFile('', 'some other failure', 1);
    await expect(ghExec(['pr', 'diff', '1'])).rejects.toMatchObject({
      name: 'GhCliError',
      code: 'GH_CLI_FAILED',
    });
  });
});
```

- [ ] **Step 2: Run the test — verify it fails (module not found)**

```bash
cd ~/workspace/connor-review/server
npx vitest run tests/ghExec.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `ghExec`**

Create `server/src/lib/ghExec.ts`:

```ts
import { execFile } from 'node:child_process';

export type GhErrorCode = 'AUTH_REQUIRED' | 'GH_API_ERROR' | 'GH_CLI_FAILED';

export class GhCliError extends Error {
  readonly name = 'GhCliError';
  constructor(
    readonly code: GhErrorCode,
    message: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

const AUTH_PATTERNS = [/gh auth login/i, /not authenticated/i, /no token/i];
const GRAPHQL_PATTERNS = [/graphql error/i, /^\s*\{[\s\S]*"errors"/i];

function classify(stderr: string): GhErrorCode {
  if (AUTH_PATTERNS.some((r) => r.test(stderr))) return 'AUTH_REQUIRED';
  if (GRAPHQL_PATTERNS.some((r) => r.test(stderr))) return 'GH_API_ERROR';
  return 'GH_CLI_FAILED';
}

export function ghExec(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const code = classify(stderr || (err as Error).message);
        reject(new GhCliError(code, `gh ${args.join(' ')} failed: ${stderr.trim()}`, stderr));
        return;
      }
      resolve(stdout);
    });
  });
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
npx vitest run tests/ghExec.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd ~/workspace/connor-review
git add server/src/lib/ghExec.ts server/tests/ghExec.test.ts
git commit -m "feat(server): add gh CLI wrapper with typed errors"
```

---

## Task 4: Server — `lruCache`

**Files:**
- Create: `server/src/lib/lruCache.ts`, `server/tests/lruCache.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/tests/lruCache.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LRUCache } from '../src/lib/lruCache.js';

describe('LRUCache', () => {
  it('returns undefined for a miss', () => {
    const c = new LRUCache<string, number>(3);
    expect(c.get('a')).toBeUndefined();
  });

  it('returns the same reference on a hit', () => {
    const c = new LRUCache<string, { v: number }>(3);
    const obj = { v: 1 };
    c.set('a', obj);
    expect(c.get('a')).toBe(obj);
  });

  it('evicts the least-recently-used entry at capacity', () => {
    const c = new LRUCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');           // touches a → a is most-recent
    c.set('c', 3);        // should evict b
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('c')).toBe(3);
  });

  it('overwrites and refreshes recency on a set of an existing key', () => {
    const c = new LRUCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('a', 11);   // refresh + overwrite
    c.set('c', 3);    // should evict b
    expect(c.get('a')).toBe(11);
    expect(c.get('b')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
npx vitest run tests/lruCache.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `LRUCache`**

Create `server/src/lib/lruCache.ts`:

```ts
export class LRUCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error('capacity must be >= 1');
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
npx vitest run tests/lruCache.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/lruCache.ts server/tests/lruCache.test.ts
git commit -m "feat(server): add map-based LRU cache"
```

---

## Task 5: Server — route param validator

**Files:**
- Create: `server/src/lib/parseRouteParams.ts`, `server/tests/parseRouteParams.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/tests/parseRouteParams.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parsePullParams, BadParamsError } from '../src/lib/parseRouteParams.js';

describe('parsePullParams', () => {
  it('returns owner/repo/number for valid input', () => {
    expect(parsePullParams({ owner: 'Gusto', repo: 'zenpayroll', number: '341597' })).toEqual({
      owner: 'Gusto',
      repo: 'zenpayroll',
      number: 341597,
    });
  });

  it('rejects non-numeric number', () => {
    expect(() => parsePullParams({ owner: 'a', repo: 'b', number: 'oops' })).toThrow(BadParamsError);
  });

  it('rejects invalid owner characters', () => {
    expect(() => parsePullParams({ owner: 'has space', repo: 'b', number: '1' })).toThrow(BadParamsError);
  });

  it('rejects empty repo', () => {
    expect(() => parsePullParams({ owner: 'a', repo: '', number: '1' })).toThrow(BadParamsError);
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
npx vitest run tests/parseRouteParams.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `server/src/lib/parseRouteParams.ts`:

```ts
export class BadParamsError extends Error {
  readonly name = 'BadParamsError';
}

const SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export interface PullParams {
  owner: string;
  repo: string;
  number: number;
}

export function parsePullParams(raw: { owner?: string; repo?: string; number?: string }): PullParams {
  const { owner, repo, number } = raw;
  if (!owner || !SLUG.test(owner)) throw new BadParamsError('invalid owner');
  if (!repo || !SLUG.test(repo)) throw new BadParamsError('invalid repo');
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) throw new BadParamsError('invalid number');
  return { owner, repo, number: n };
}
```

- [ ] **Step 4: Run — verify pass**

```bash
npx vitest run tests/parseRouteParams.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/parseRouteParams.ts server/tests/parseRouteParams.test.ts
git commit -m "feat(server): validate pull-route params"
```

---

## Task 6: Server — GraphQL query strings

**Files:**
- Create: `server/src/queries/pullRequest.graphql.ts`, `server/src/queries/addPullRequestReview.graphql.ts`, `server/src/queries/addPullRequestReviewThreadReply.graphql.ts`

These are constant strings; no tests of their own (they're exercised through route tests in Task 7).

- [ ] **Step 1: Create `pullRequest.graphql.ts`**

```ts
export const PULL_REQUEST_QUERY = /* GraphQL */ `
  query PullRequest($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        id
        number
        title
        author { login }
        state
        merged
        baseRefName
        headRefName
        headRefOid
        url
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            path
            line
            originalLine
            startLine
            startSide
            diffSide
            comments(first: 50) {
              nodes {
                id
                author { login }
                body
                createdAt
              }
            }
          }
        }
      }
    }
  }
`;
```

- [ ] **Step 2: Create `addPullRequestReview.graphql.ts`**

```ts
export const ADD_PULL_REQUEST_REVIEW_MUTATION = /* GraphQL */ `
  mutation AddReview($pullRequestId: ID!, $event: PullRequestReviewEvent!, $body: String, $comments: [DraftPullRequestReviewComment!]) {
    addPullRequestReview(input: {
      pullRequestId: $pullRequestId
      event: $event
      body: $body
      comments: $comments
    }) {
      pullRequestReview { id state }
    }
  }
`;
```

- [ ] **Step 3: Create `addPullRequestReviewThreadReply.graphql.ts`**

```ts
export const ADD_PULL_REQUEST_REVIEW_THREAD_REPLY_MUTATION = /* GraphQL */ `
  mutation AddReply($pullRequestReviewThreadId: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: {
      pullRequestReviewThreadId: $pullRequestReviewThreadId
      body: $body
    }) {
      comment { id body }
    }
  }
`;
```

- [ ] **Step 4: Commit**

```bash
git add server/src/queries
git commit -m "feat(server): add GraphQL queries and mutations"
```

---

## Task 7: Server — pulls routes + tests

**Files:**
- Create: `server/src/routes/pulls.ts`, `server/tests/routes/pulls.test.ts`
- Modify: `server/src/index.ts` (register routes)

- [ ] **Step 1: Write failing route tests**

Create `server/tests/routes/pulls.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildServer } from '../../src/index.js';

vi.mock('../../src/lib/ghExec.js', () => {
  const ghExec = vi.fn();
  return { ghExec, GhCliError: class extends Error { constructor(public code: string, msg: string, public stderr: string) { super(msg); this.name = 'GhCliError'; } } };
});

import { ghExec } from '../../src/lib/ghExec.js';
const mocked = ghExec as unknown as ReturnType<typeof vi.fn>;

const PR_GRAPHQL_RESPONSE = JSON.stringify({
  data: {
    repository: {
      pullRequest: {
        id: 'PR_abc',
        number: 1,
        title: 'Test PR',
        author: { login: 'octocat' },
        state: 'OPEN',
        merged: false,
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'sha-1',
        url: 'https://github.com/Gusto/zenpayroll/pull/1',
        reviewThreads: { nodes: [] },
      },
    },
  },
});

const DIFF_RESPONSE = `diff --git a/file.txt b/file.txt\nindex 0..1 100644\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n`;

describe('pulls routes', () => {
  beforeEach(() => mocked.mockReset());

  it('GET /api/pulls/:o/:r/:n returns parsed PR meta + caches by headSha', async () => {
    mocked.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    const app = await buildServer();
    const first = await app.inject({ url: '/api/pulls/Gusto/zenpayroll/1' });
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.id).toBe('PR_abc');
    expect(body.headSha).toBe('sha-1');
    expect(body.reviewThreads).toEqual([]);

    const second = await app.inject({ url: '/api/pulls/Gusto/zenpayroll/1' });
    expect(second.statusCode).toBe(200);
    expect(mocked).toHaveBeenCalledTimes(1); // cache hit on second call

    await app.close();
  });

  it('GET ?fresh=1 bypasses the meta cache', async () => {
    mocked.mockResolvedValue(PR_GRAPHQL_RESPONSE);
    const app = await buildServer();
    await app.inject({ url: '/api/pulls/Gusto/zenpayroll/1' });
    await app.inject({ url: '/api/pulls/Gusto/zenpayroll/1?fresh=1' });
    expect(mocked).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('GET /diff returns unified diff text', async () => {
    mocked.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE); // for meta-fetch to get headSha
    mocked.mockResolvedValueOnce(DIFF_RESPONSE);
    const app = await buildServer();
    const res = await app.inject({ url: '/api/pulls/Gusto/zenpayroll/1/diff' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('diff --git');
    await app.close();
  });

  it('POST /reviews calls addPullRequestReview mutation with the right input', async () => {
    mocked.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE); // meta fetch (route looks up PR id)
    mocked.mockResolvedValueOnce(JSON.stringify({ data: { addPullRequestReview: { pullRequestReview: { id: 'R_1', state: 'APPROVED' } } } }));
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/reviews',
      payload: { event: 'APPROVE', body: 'lgtm', comments: [{ path: 'file.txt', line: 2, side: 'RIGHT', body: 'nit' }] },
    });
    expect(res.statusCode).toBe(200);
    const lastCall = mocked.mock.calls.at(-1)![0] as string[];
    expect(lastCall[0]).toBe('api');
    expect(lastCall[1]).toBe('graphql');
    // verify the variables we passed include the pull request id and comments
    const joined = lastCall.join(' ');
    expect(joined).toContain('pullRequestId=PR_abc');
    expect(joined).toContain('event=APPROVE');
    await app.close();
  });

  it('POST /threads/:id/reply calls the reply mutation', async () => {
    mocked.mockResolvedValueOnce(JSON.stringify({ data: { addPullRequestReviewThreadReply: { comment: { id: 'C_1', body: 'ack' } } } }));
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/threads/THREAD_1/reply',
      payload: { body: 'ack' },
    });
    expect(res.statusCode).toBe(200);
    const call = mocked.mock.calls.at(-1)![0] as string[];
    expect(call.join(' ')).toContain('pullRequestReviewThreadId=THREAD_1');
    await app.close();
  });

  it('returns 400 on invalid params', async () => {
    const app = await buildServer();
    const res = await app.inject({ url: '/api/pulls/bad owner/repo/abc' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_PARAMS');
    await app.close();
  });

  it('returns 401 when ghExec throws AUTH_REQUIRED', async () => {
    const { GhCliError } = await import('../../src/lib/ghExec.js') as any;
    mocked.mockRejectedValueOnce(new GhCliError('AUTH_REQUIRED', 'need login', 'gh auth login required'));
    const app = await buildServer();
    const res = await app.inject({ url: '/api/pulls/Gusto/zenpayroll/1' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_REQUIRED');
    await app.close();
  });
});
```

- [ ] **Step 2: Implement `routes/pulls.ts`**

Create `server/src/routes/pulls.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { ghExec, GhCliError } from '../lib/ghExec.js';
import { LRUCache } from '../lib/lruCache.js';
import { BadParamsError, parsePullParams } from '../lib/parseRouteParams.js';
import { PULL_REQUEST_QUERY } from '../queries/pullRequest.graphql.js';
import { ADD_PULL_REQUEST_REVIEW_MUTATION } from '../queries/addPullRequestReview.graphql.js';
import { ADD_PULL_REQUEST_REVIEW_THREAD_REPLY_MUTATION } from '../queries/addPullRequestReviewThreadReply.graphql.js';

interface PullRequestMeta {
  id: string;
  number: number;
  title: string;
  authorLogin: string | null;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  merged: boolean;
  baseRefName: string;
  headRefName: string;
  headSha: string;
  url: string;
  reviewThreads: ReviewThread[];
}

interface ReviewThread {
  id: string;
  isResolved: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  startSide: 'LEFT' | 'RIGHT' | null;
  diffSide: 'LEFT' | 'RIGHT' | null;
  comments: Array<{ id: string; authorLogin: string | null; body: string; createdAt: string }>;
}

interface ReviewSubmission {
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  body?: string;
  comments?: Array<{ path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }>;
}

const metaCache = new LRUCache<string, PullRequestMeta>(20);
const diffCache = new LRUCache<string, string>(20);

function metaKey(p: { owner: string; repo: string; number: number }) {
  return `${p.owner}/${p.repo}#${p.number}`;
}
function diffKey(p: { owner: string; repo: string; number: number; headSha: string }) {
  return `${p.owner}/${p.repo}#${p.number}@${p.headSha}`;
}

async function fetchMeta(owner: string, repo: string, number: number): Promise<PullRequestMeta> {
  const stdout = await ghExec([
    'api',
    'graphql',
    '-f', `query=${PULL_REQUEST_QUERY}`,
    '-F', `owner=${owner}`,
    '-F', `repo=${repo}`,
    '-F', `number=${number}`,
  ]);
  const data = JSON.parse(stdout);
  const pr = data?.data?.repository?.pullRequest;
  if (!pr) throw new Error('PR not found in GraphQL response');
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    authorLogin: pr.author?.login ?? null,
    state: pr.state,
    merged: pr.merged,
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    headSha: pr.headRefOid,
    url: pr.url,
    reviewThreads: (pr.reviewThreads?.nodes ?? []).map((t: any) => ({
      id: t.id,
      isResolved: t.isResolved,
      path: t.path,
      line: t.line,
      originalLine: t.originalLine,
      startLine: t.startLine,
      startSide: t.startSide,
      diffSide: t.diffSide,
      comments: (t.comments?.nodes ?? []).map((c: any) => ({
        id: c.id,
        authorLogin: c.author?.login ?? null,
        body: c.body,
        createdAt: c.createdAt,
      })),
    })),
  };
}

export async function registerPullsRoutes(app: FastifyInstance) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof BadParamsError) {
      reply.code(400).send({ code: 'BAD_PARAMS', message: err.message });
      return;
    }
    if (err instanceof GhCliError) {
      const status = err.code === 'AUTH_REQUIRED' ? 401 : err.code === 'GH_API_ERROR' ? 502 : 500;
      reply.code(status).send({ code: err.code, message: err.message, stderr: err.stderr });
      return;
    }
    reply.code(500).send({ code: 'INTERNAL', message: err.message });
  });

  app.get<{ Params: { owner: string; repo: string; number: string }; Querystring: { fresh?: string } }>(
    '/api/pulls/:owner/:repo/:number',
    async (req) => {
      const params = parsePullParams(req.params);
      const key = metaKey(params);
      if (req.query.fresh !== '1') {
        const cached = metaCache.get(key);
        if (cached) return cached;
      }
      const meta = await fetchMeta(params.owner, params.repo, params.number);
      metaCache.set(key, meta);
      return meta;
    },
  );

  app.get<{ Params: { owner: string; repo: string; number: string }; Querystring: { fresh?: string } }>(
    '/api/pulls/:owner/:repo/:number/diff',
    async (req, reply) => {
      const params = parsePullParams(req.params);
      const metaCached = metaCache.get(metaKey(params));
      const meta = metaCached ?? (await fetchMeta(params.owner, params.repo, params.number));
      if (!metaCached) metaCache.set(metaKey(params), meta);

      const dkey = diffKey({ ...params, headSha: meta.headSha });
      if (req.query.fresh !== '1') {
        const cached = diffCache.get(dkey);
        if (cached !== undefined) {
          reply.type('text/plain; charset=utf-8');
          return cached;
        }
      }
      const diff = await ghExec(['pr', 'diff', String(params.number), '--repo', `${params.owner}/${params.repo}`]);
      diffCache.set(dkey, diff);
      reply.type('text/plain; charset=utf-8');
      return diff;
    },
  );

  app.post<{
    Params: { owner: string; repo: string; number: string };
    Body: ReviewSubmission;
  }>('/api/pulls/:owner/:repo/:number/reviews', async (req) => {
    const params = parsePullParams(req.params);
    const meta = metaCache.get(metaKey(params)) ?? (await fetchMeta(params.owner, params.repo, params.number));
    metaCache.set(metaKey(params), meta);
    const args = [
      'api', 'graphql',
      '-f', `query=${ADD_PULL_REQUEST_REVIEW_MUTATION}`,
      '-F', `pullRequestId=${meta.id}`,
      '-F', `event=${req.body.event}`,
    ];
    if (req.body.body) args.push('-f', `body=${req.body.body}`);
    if (req.body.comments?.length) {
      args.push('-f', `comments=${JSON.stringify(req.body.comments)}`);
    }
    const out = await ghExec(args);
    return JSON.parse(out);
  });

  app.post<{
    Params: { owner: string; repo: string; number: string; threadId: string };
    Body: { body: string };
  }>('/api/pulls/:owner/:repo/:number/threads/:threadId/reply', async (req) => {
    parsePullParams(req.params);
    const out = await ghExec([
      'api', 'graphql',
      '-f', `query=${ADD_PULL_REQUEST_REVIEW_THREAD_REPLY_MUTATION}`,
      '-F', `pullRequestReviewThreadId=${req.params.threadId}`,
      '-f', `body=${req.body.body}`,
    ]);
    return JSON.parse(out);
  });
}
```

- [ ] **Step 3: Register routes in `server/src/index.ts`**

Replace the body of `buildServer`:

```ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerPullsRoutes } from './routes/pulls.js';

export async function buildServer() {
  const app = Fastify({ logger: { level: 'warn' } });
  await app.register(cors, { origin: 'http://localhost:5173' });
  app.get('/api/health', async () => ({ ok: true }));
  await registerPullsRoutes(app);
  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = await buildServer();
  await app.listen({ port: 5174, host: '127.0.0.1' });
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
cd ~/workspace/connor-review/server
npm test
```

Expected: all tests pass (health + ghExec + lruCache + parseRouteParams + pulls).

- [ ] **Step 5: Commit**

```bash
git add server/src server/tests
git commit -m "feat(server): add /api/pulls routes (meta, diff, review, reply)"
```

---

## Task 8: Web — scaffold Vite + React + TS

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles/app.css`

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "connor-review-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-diff-view": "^3.2.1",
    "prismjs": "^1.29.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/prismjs": "^1.26.5",
    "@types/react": "^18.3.17",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "msw": "^2.7.0",
    "typescript": "^5.7.3",
    "vite": "^6.0.7",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `web/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5174',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
```

- [ ] **Step 4: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Connor Review</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `web/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Create placeholder `web/src/App.tsx`**

```tsx
export function App() {
  return <main className="app"><h1>Connor Review</h1></main>;
}
```

- [ ] **Step 7: Create minimal `web/src/styles/app.css`**

```css
:root {
  color-scheme: light dark;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
body { margin: 0; }
.app { padding: 16px; }
```

- [ ] **Step 8: Create `web/tests/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 9: Install and verify build**

```bash
cd ~/workspace/connor-review/web
npm install
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 10: Commit**

```bash
cd ~/workspace/connor-review
git add web
git commit -m "feat(web): scaffold vite + react + ts"
```

---

## Task 9: Web — `parsePRUrl`

**Files:**
- Create: `web/src/lib/parsePRUrl.ts`, `web/tests/lib/parsePRUrl.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { parsePRUrl } from '../../src/lib/parsePRUrl.js';

describe('parsePRUrl', () => {
  it('parses a canonical PR URL', () => {
    expect(parsePRUrl('https://github.com/Gusto/zenpayroll/pull/341597')).toEqual({
      owner: 'Gusto', repo: 'zenpayroll', number: 341597,
    });
  });
  it('parses with trailing slash', () => {
    expect(parsePRUrl('https://github.com/Gusto/zenpayroll/pull/341597/')).toEqual({
      owner: 'Gusto', repo: 'zenpayroll', number: 341597,
    });
  });
  it('parses with /files suffix', () => {
    expect(parsePRUrl('https://github.com/Gusto/zenpayroll/pull/341597/files')).toEqual({
      owner: 'Gusto', repo: 'zenpayroll', number: 341597,
    });
  });
  it('parses with hash anchor', () => {
    expect(parsePRUrl('https://github.com/Gusto/zenpayroll/pull/341597#discussion_r123')).toEqual({
      owner: 'Gusto', repo: 'zenpayroll', number: 341597,
    });
  });
  it('returns null for an issue URL', () => {
    expect(parsePRUrl('https://github.com/Gusto/zenpayroll/issues/1')).toBeNull();
  });
  it('returns null for a non-github URL', () => {
    expect(parsePRUrl('https://gitlab.com/Gusto/zenpayroll/pull/1')).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(parsePRUrl('not a url')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
cd ~/workspace/connor-review/web
npx vitest run tests/lib/parsePRUrl.test.ts
```

- [ ] **Step 3: Implement**

```ts
export interface ParsedPR { owner: string; repo: string; number: number; }

const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[\/?#].*)?$/;

export function parsePRUrl(input: string): ParsedPR | null {
  try {
    const u = new URL(input.trim());
    if (u.hostname !== 'github.com') return null;
    const match = PR_PATH.exec(u.pathname);
    if (!match) return null;
    return { owner: match[1], repo: match[2], number: Number(match[3]) };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
npx vitest run tests/lib/parsePRUrl.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/parsePRUrl.ts web/tests/lib/parsePRUrl.test.ts
git commit -m "feat(web): parse GitHub PR URLs"
```

---

## Task 10: Web — shared types

**Files:**
- Create: `web/src/types.ts`

- [ ] **Step 1: Create types**

```ts
export type PRStatus = 'untouched' | 'reviewed' | 'approved';

export interface TrackedPR {
  owner: string;
  repo: string;
  number: number;
  title: string;
  authorLogin: string | null;
  status: PRStatus;
  addedAt: number;
}

export interface PullRequestMeta {
  id: string;
  number: number;
  title: string;
  authorLogin: string | null;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  merged: boolean;
  baseRefName: string;
  headRefName: string;
  headSha: string;
  url: string;
  reviewThreads: ReviewThread[];
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  startSide: 'LEFT' | 'RIGHT' | null;
  diffSide: 'LEFT' | 'RIGHT' | null;
  comments: Array<{ id: string; authorLogin: string | null; body: string; createdAt: string }>;
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export interface StagedInlineComment {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  body: string;
}

export interface StagedThreadReply {
  threadId: string;
  body: string;
}

export interface ReviewDrafts {
  summary: string;
  inlineComments: StagedInlineComment[];
  replies: StagedThreadReply[];
}

export interface ApiError {
  code: string;
  message: string;
  stderr?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/types.ts
git commit -m "feat(web): shared types"
```

---

## Task 11: Web — `api.ts` fetch wrapper

**Files:**
- Create: `web/src/lib/api.ts`

(No unit tests for thin fetch wrappers; integration coverage comes via msw in hook + flow tests.)

- [ ] **Step 1: Create**

```ts
import type { PullRequestMeta, ReviewEvent, StagedInlineComment } from '../types.js';

class ApiCallError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    let payload: { code?: string; message?: string } = {};
    try { payload = await res.json(); } catch { /* ignore */ }
    throw new ApiCallError(payload.code ?? 'UNKNOWN', payload.message ?? res.statusText, res.status);
  }
  const contentType = res.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? (res.json() as Promise<T>) : ((await res.text()) as unknown as T);
}

export { ApiCallError };

export const api = {
  getPullRequest(owner: string, repo: string, number: number, opts?: { fresh?: boolean }): Promise<PullRequestMeta> {
    const qs = opts?.fresh ? '?fresh=1' : '';
    return call<PullRequestMeta>(`/api/pulls/${owner}/${repo}/${number}${qs}`);
  },
  getDiff(owner: string, repo: string, number: number, opts?: { fresh?: boolean }): Promise<string> {
    const qs = opts?.fresh ? '?fresh=1' : '';
    return call<string>(`/api/pulls/${owner}/${repo}/${number}/diff${qs}`);
  },
  submitReview(owner: string, repo: string, number: number, body: {
    event: ReviewEvent; body?: string; comments?: StagedInlineComment[];
  }): Promise<{ data: { addPullRequestReview: { pullRequestReview: { id: string; state: string } } } }> {
    return call(`/api/pulls/${owner}/${repo}/${number}/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  replyToThread(owner: string, repo: string, number: number, threadId: string, body: string) {
    return call(`/api/pulls/${owner}/${repo}/${number}/threads/${threadId}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "feat(web): backend api wrapper"
```

---

## Task 12: Web — `useTrackedPRs` hook

**Files:**
- Create: `web/src/hooks/useTrackedPRs.ts`, `web/tests/hooks/useTrackedPRs.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTrackedPRs, STORAGE_KEY } from '../../src/hooks/useTrackedPRs.js';

describe('useTrackedPRs', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty when localStorage is empty', () => {
    const { result } = renderHook(() => useTrackedPRs());
    expect(result.current.prs).toEqual([]);
  });

  it('adds a PR and persists to localStorage', () => {
    const { result } = renderHook(() => useTrackedPRs());
    act(() => result.current.add({
      owner: 'Gusto', repo: 'zenpayroll', number: 1, title: 'x', authorLogin: 'a',
    }));
    expect(result.current.prs).toHaveLength(1);
    expect(result.current.prs[0].status).toBe('untouched');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);
  });

  it('does not add a duplicate (same owner/repo/number)', () => {
    const { result } = renderHook(() => useTrackedPRs());
    act(() => result.current.add({ owner: 'a', repo: 'b', number: 1, title: 'x', authorLogin: 'a' }));
    act(() => result.current.add({ owner: 'a', repo: 'b', number: 1, title: 'x', authorLogin: 'a' }));
    expect(result.current.prs).toHaveLength(1);
  });

  it('setStatus updates and persists', () => {
    const { result } = renderHook(() => useTrackedPRs());
    act(() => result.current.add({ owner: 'a', repo: 'b', number: 1, title: 'x', authorLogin: 'a' }));
    act(() => result.current.setStatus({ owner: 'a', repo: 'b', number: 1 }, 'approved'));
    expect(result.current.prs[0].status).toBe('approved');
  });

  it('remove drops the PR', () => {
    const { result } = renderHook(() => useTrackedPRs());
    act(() => result.current.add({ owner: 'a', repo: 'b', number: 1, title: 'x', authorLogin: 'a' }));
    act(() => result.current.remove({ owner: 'a', repo: 'b', number: 1 }));
    expect(result.current.prs).toEqual([]);
  });

  it('survives a remount via localStorage', () => {
    const first = renderHook(() => useTrackedPRs());
    act(() => first.result.current.add({ owner: 'a', repo: 'b', number: 1, title: 'x', authorLogin: 'a' }));
    first.unmount();
    const second = renderHook(() => useTrackedPRs());
    expect(second.result.current.prs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
cd ~/workspace/connor-review/web
npx vitest run tests/hooks/useTrackedPRs.test.tsx
```

- [ ] **Step 3: Implement**

```ts
import { useCallback, useEffect, useState } from 'react';
import type { PRStatus, TrackedPR } from '../types.js';

export const STORAGE_KEY = 'connor-review.trackedPRs.v1';

interface Identity { owner: string; repo: string; number: number; }
function same(a: Identity, b: Identity) {
  return a.owner === b.owner && a.repo === b.repo && a.number === b.number;
}

function load(): TrackedPR[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function save(prs: TrackedPR[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prs));
}

export function useTrackedPRs() {
  const [prs, setPrs] = useState<TrackedPR[]>(() => load());

  useEffect(() => { save(prs); }, [prs]);

  const add = useCallback((pr: Omit<TrackedPR, 'status' | 'addedAt'>) => {
    setPrs((cur) => (cur.some((p) => same(p, pr)) ? cur : [...cur, { ...pr, status: 'untouched', addedAt: Date.now() }]));
  }, []);

  const remove = useCallback((id: Identity) => {
    setPrs((cur) => cur.filter((p) => !same(p, id)));
  }, []);

  const setStatus = useCallback((id: Identity, status: PRStatus) => {
    setPrs((cur) => cur.map((p) => (same(p, id) ? { ...p, status } : p)));
  }, []);

  return { prs, add, remove, setStatus };
}
```

- [ ] **Step 4: Run — verify pass**

```bash
npx vitest run tests/hooks/useTrackedPRs.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useTrackedPRs.ts web/tests/hooks/useTrackedPRs.test.tsx
git commit -m "feat(web): tracked-PR hook backed by localStorage"
```

---

## Task 13: Web — `useDrafts` hook

**Files:**
- Create: `web/src/hooks/useDrafts.ts`, `web/tests/hooks/useDrafts.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDrafts } from '../../src/hooks/useDrafts.js';

const id = { owner: 'a', repo: 'b', number: 1 };

describe('useDrafts', () => {
  it('returns empty drafts for an unknown PR', () => {
    const { result } = renderHook(() => useDrafts());
    expect(result.current.getDrafts(id)).toEqual({ summary: '', inlineComments: [], replies: [] });
  });

  it('updates and reads summary', () => {
    const { result } = renderHook(() => useDrafts());
    act(() => result.current.setSummary(id, 'hello'));
    expect(result.current.getDrafts(id).summary).toBe('hello');
  });

  it('adds inline comment and reply', () => {
    const { result } = renderHook(() => useDrafts());
    act(() => result.current.addInlineComment(id, { path: 'f', line: 2, side: 'RIGHT', body: 'nit' }));
    act(() => result.current.addReply(id, { threadId: 'T_1', body: 'ack' }));
    const d = result.current.getDrafts(id);
    expect(d.inlineComments).toHaveLength(1);
    expect(d.replies).toEqual([{ threadId: 'T_1', body: 'ack' }]);
  });

  it('hasAny returns true when any draft exists', () => {
    const { result } = renderHook(() => useDrafts());
    expect(result.current.hasAny(id)).toBe(false);
    act(() => result.current.setSummary(id, 'x'));
    expect(result.current.hasAny(id)).toBe(true);
  });

  it('clear empties drafts for a PR', () => {
    const { result } = renderHook(() => useDrafts());
    act(() => result.current.setSummary(id, 'x'));
    act(() => result.current.clear(id));
    expect(result.current.hasAny(id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — verify fail**

- [ ] **Step 3: Implement**

```ts
import { useCallback, useState } from 'react';
import type { ReviewDrafts, StagedInlineComment, StagedThreadReply } from '../types.js';

interface Identity { owner: string; repo: string; number: number; }
function key(id: Identity) { return `${id.owner}/${id.repo}#${id.number}`; }
const EMPTY: ReviewDrafts = { summary: '', inlineComments: [], replies: [] };

export function useDrafts() {
  const [byPR, setByPR] = useState<Record<string, ReviewDrafts>>({});

  const getDrafts = useCallback((id: Identity): ReviewDrafts => byPR[key(id)] ?? EMPTY, [byPR]);
  const hasAny = useCallback((id: Identity) => {
    const d = byPR[key(id)];
    if (!d) return false;
    return d.summary.trim().length > 0 || d.inlineComments.length > 0 || d.replies.length > 0;
  }, [byPR]);

  const update = useCallback((id: Identity, fn: (d: ReviewDrafts) => ReviewDrafts) => {
    setByPR((cur) => ({ ...cur, [key(id)]: fn(cur[key(id)] ?? EMPTY) }));
  }, []);

  const setSummary = useCallback((id: Identity, summary: string) => update(id, (d) => ({ ...d, summary })), [update]);
  const addInlineComment = useCallback((id: Identity, c: StagedInlineComment) => update(id, (d) => ({ ...d, inlineComments: [...d.inlineComments, c] })), [update]);
  const removeInlineComment = useCallback((id: Identity, idx: number) => update(id, (d) => ({ ...d, inlineComments: d.inlineComments.filter((_, i) => i !== idx) })), [update]);
  const addReply = useCallback((id: Identity, r: StagedThreadReply) => update(id, (d) => ({ ...d, replies: [...d.replies, r] })), [update]);
  const clear = useCallback((id: Identity) => setByPR((cur) => { const next = { ...cur }; delete next[key(id)]; return next; }), []);

  return { getDrafts, hasAny, setSummary, addInlineComment, removeInlineComment, addReply, clear };
}
```

- [ ] **Step 4: Run — verify pass**

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useDrafts.ts web/tests/hooks/useDrafts.test.tsx
git commit -m "feat(web): staged drafts hook"
```

---

## Task 14: Web — msw fixtures

**Files:**
- Create: `web/tests/msw/handlers.ts`, `web/tests/msw/server.ts`

These are shared test infrastructure used by Tasks 15, 17, 19.

- [ ] **Step 1: Create handlers**

```ts
import { http, HttpResponse } from 'msw';
import type { PullRequestMeta } from '../../src/types.js';

export const META_FIXTURE: PullRequestMeta = {
  id: 'PR_abc',
  number: 1,
  title: 'Test PR',
  authorLogin: 'octocat',
  state: 'OPEN',
  merged: false,
  baseRefName: 'main',
  headRefName: 'feature',
  headSha: 'sha-1',
  url: 'https://github.com/Gusto/zenpayroll/pull/1',
  reviewThreads: [],
};

export const META_FIXTURE_2: PullRequestMeta = { ...META_FIXTURE, id: 'PR_def', number: 2, title: 'Second PR', headSha: 'sha-2' };

export const DIFF_FIXTURE = `diff --git a/file.txt b/file.txt\nindex 0..1 100644\n--- a/file.txt\n+++ b/file.txt\n@@ -1,1 +1,1 @@\n-old\n+new\n`;

export const handlers = [
  http.get('/api/pulls/:owner/:repo/:number', ({ params }) => {
    const n = Number(params.number);
    if (n === 2) return HttpResponse.json(META_FIXTURE_2);
    return HttpResponse.json(META_FIXTURE);
  }),
  http.get('/api/pulls/:owner/:repo/:number/diff', () => HttpResponse.text(DIFF_FIXTURE)),
  http.post('/api/pulls/:owner/:repo/:number/reviews', async () => HttpResponse.json({ data: { addPullRequestReview: { pullRequestReview: { id: 'R_1', state: 'APPROVED' } } } })),
  http.post('/api/pulls/:owner/:repo/:number/threads/:threadId/reply', async () => HttpResponse.json({ data: { addPullRequestReviewThreadReply: { comment: { id: 'C_1', body: 'ack' } } } })),
];
```

- [ ] **Step 2: Create server**

```ts
import { setupServer } from 'msw/node';
import { handlers } from './handlers.js';

export const server = setupServer(...handlers);
```

- [ ] **Step 3: Wire msw into setup**

Update `web/tests/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { beforeAll, afterAll, afterEach } from 'vitest';
import { server } from './msw/server.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

- [ ] **Step 4: Commit**

```bash
git add web/tests/msw web/tests/setup.ts
git commit -m "test(web): set up msw fixtures"
```

---

## Task 15: Web — `AddPRBar` component

**Files:**
- Create: `web/src/components/AddPRBar.tsx`, `web/tests/components/AddPRBar.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddPRBar } from '../../src/components/AddPRBar.js';

describe('AddPRBar', () => {
  it('calls onAdd with parsed PR when URL is valid', async () => {
    const onAdd = vi.fn();
    render(<AddPRBar onAdd={onAdd} />);
    await userEvent.type(screen.getByPlaceholderText(/paste a github pr url/i), 'https://github.com/Gusto/zenpayroll/pull/341597');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onAdd).toHaveBeenCalledWith({ owner: 'Gusto', repo: 'zenpayroll', number: 341597 });
  });

  it('shows an error and does not call onAdd for invalid URL', async () => {
    const onAdd = vi.fn();
    render(<AddPRBar onAdd={onAdd} />);
    await userEvent.type(screen.getByPlaceholderText(/paste a github pr url/i), 'not a url');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByText(/not a valid github pr url/i)).toBeInTheDocument();
  });

  it('clears input after successful add', async () => {
    render(<AddPRBar onAdd={() => {}} />);
    const input = screen.getByPlaceholderText(/paste a github pr url/i) as HTMLInputElement;
    await userEvent.type(input, 'https://github.com/Gusto/zenpayroll/pull/1');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(input.value).toBe('');
  });
});
```

- [ ] **Step 2: Run — verify fail**

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react';
import { parsePRUrl, type ParsedPR } from '../lib/parsePRUrl.js';

interface Props {
  onAdd: (pr: ParsedPR) => void;
}

export function AddPRBar({ onAdd }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const parsed = parsePRUrl(value);
    if (!parsed) {
      setError('Not a valid GitHub PR URL');
      return;
    }
    setError(null);
    setValue('');
    onAdd(parsed);
  };

  return (
    <div className="add-pr-bar">
      <input
        type="url"
        placeholder="Paste a GitHub PR URL"
        value={value}
        onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
      <button type="button" onClick={submit}>Add</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run — verify pass**

- [ ] **Step 5: Commit**

```bash
git add web/src/components/AddPRBar.tsx web/tests/components/AddPRBar.test.tsx
git commit -m "feat(web): AddPRBar component"
```

---

## Task 16: Web — `StatusBadge` + `FilterToggle`

**Files:**
- Create: `web/src/components/StatusBadge.tsx`, `web/src/components/FilterToggle.tsx`, `web/tests/components/FilterToggle.test.tsx`

- [ ] **Step 1: Failing tests for FilterToggle**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterToggle } from '../../src/components/FilterToggle.js';

describe('FilterToggle', () => {
  it('renders the current mode label', () => {
    render(<FilterToggle mode="untouched-only" onChange={() => {}} />);
    expect(screen.getByText(/untouched only/i)).toBeInTheDocument();
  });

  it('calls onChange with the other mode on click', async () => {
    const onChange = vi.fn();
    render(<FilterToggle mode="untouched-only" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenCalledWith('all');
  });
});
```

- [ ] **Step 2: Implement**

`web/src/components/StatusBadge.tsx`:

```tsx
import type { PRStatus } from '../types.js';

const LABEL: Record<PRStatus, string> = {
  untouched: 'Untouched',
  reviewed: 'Reviewed',
  approved: 'Approved',
};

export function StatusBadge({ status }: { status: PRStatus }) {
  return <span className={`status-badge status-${status}`}>{LABEL[status]}</span>;
}
```

`web/src/components/FilterToggle.tsx`:

```tsx
export type FilterMode = 'untouched-only' | 'all';

interface Props {
  mode: FilterMode;
  onChange: (mode: FilterMode) => void;
}

export function FilterToggle({ mode, onChange }: Props) {
  const next = mode === 'untouched-only' ? 'all' : 'untouched-only';
  const label = mode === 'untouched-only' ? 'Untouched only' : 'Showing all';
  return (
    <button type="button" className="filter-toggle" onClick={() => onChange(next)} aria-pressed={mode === 'untouched-only'}>
      {label}
    </button>
  );
}
```

- [ ] **Step 3: Run — verify pass**

```bash
cd ~/workspace/connor-review/web
npx vitest run tests/components/FilterToggle.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/StatusBadge.tsx web/src/components/FilterToggle.tsx web/tests/components/FilterToggle.test.tsx
git commit -m "feat(web): StatusBadge + FilterToggle"
```

---

## Task 17: Web — `PRList` component

**Files:**
- Create: `web/src/components/PRList.tsx`, `web/tests/components/PRList.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PRList } from '../../src/components/PRList.js';
import type { TrackedPR } from '../../src/types.js';

const PRS: TrackedPR[] = [
  { owner: 'a', repo: 'b', number: 1, title: 'First', authorLogin: 'alice', status: 'untouched', addedAt: 1 },
  { owner: 'a', repo: 'b', number: 2, title: 'Second', authorLogin: 'bob', status: 'reviewed', addedAt: 2 },
  { owner: 'a', repo: 'b', number: 3, title: 'Third', authorLogin: 'carol', status: 'approved', addedAt: 3 },
];

describe('PRList', () => {
  it('renders all PRs in `all` mode', () => {
    render(<PRList prs={PRS} mode="all" onOpen={() => {}} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText('Third')).toBeInTheDocument();
  });

  it('hides reviewed and approved PRs in `untouched-only`', () => {
    render(<PRList prs={PRS} mode="untouched-only" onOpen={() => {}} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.queryByText('Second')).not.toBeInTheDocument();
    expect(screen.queryByText('Third')).not.toBeInTheDocument();
  });

  it('calls onOpen with identity on row click', async () => {
    const onOpen = vi.fn();
    render(<PRList prs={PRS} mode="all" onOpen={onOpen} />);
    await userEvent.click(screen.getByText('Second'));
    expect(onOpen).toHaveBeenCalledWith({ owner: 'a', repo: 'b', number: 2 });
  });

  it('shows empty state when filtered list is empty', () => {
    render(<PRList prs={[]} mode="all" onOpen={() => {}} />);
    expect(screen.getByText(/no prs/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
import type { TrackedPR } from '../types.js';
import { StatusBadge } from './StatusBadge.js';
import type { FilterMode } from './FilterToggle.js';

interface Props {
  prs: TrackedPR[];
  mode: FilterMode;
  onOpen: (id: { owner: string; repo: string; number: number }) => void;
}

export function PRList({ prs, mode, onOpen }: Props) {
  const filtered = mode === 'untouched-only' ? prs.filter((p) => p.status === 'untouched') : prs;
  if (filtered.length === 0) {
    return <p className="empty">No PRs to review.</p>;
  }
  return (
    <ul className="pr-list">
      {filtered.map((p) => (
        <li key={`${p.owner}/${p.repo}#${p.number}`} className="pr-row" onClick={() => onOpen({ owner: p.owner, repo: p.repo, number: p.number })}>
          <span className="pr-title">{p.title}</span>
          <span className="pr-meta">{p.owner}/{p.repo}#{p.number} · {p.authorLogin ?? 'unknown'}</span>
          <StatusBadge status={p.status} />
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Run — verify pass**

- [ ] **Step 4: Commit**

```bash
git add web/src/components/PRList.tsx web/tests/components/PRList.test.tsx
git commit -m "feat(web): PRList component"
```

---

## Task 18: Web — `usePRDetails` hook

**Files:**
- Create: `web/src/hooks/usePRDetails.ts`, `web/tests/hooks/usePRDetails.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePRDetails } from '../../src/hooks/usePRDetails.js';

describe('usePRDetails', () => {
  it('returns loading then data on success', async () => {
    const { result } = renderHook(() => usePRDetails({ owner: 'a', repo: 'b', number: 1 }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.meta?.id).toBe('PR_abc');
    expect(result.current.diff).toContain('diff --git');
  });

  it('returns null result when id is null', () => {
    const { result } = renderHook(() => usePRDetails(null));
    expect(result.current.meta).toBeNull();
    expect(result.current.diff).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { useEffect, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';
import type { PullRequestMeta } from '../types.js';

interface Identity { owner: string; repo: string; number: number; }
interface Result {
  loading: boolean;
  meta: PullRequestMeta | null;
  diff: string | null;
  error: ApiCallError | null;
  reload: () => void;
}

export function usePRDetails(id: Identity | null): Result {
  const [meta, setMeta] = useState<PullRequestMeta | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) { setMeta(null); setDiff(null); setLoading(false); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.getPullRequest(id.owner, id.repo, id.number, { fresh: reloadKey > 0 }),
      api.getDiff(id.owner, id.repo, id.number, { fresh: reloadKey > 0 }),
    ])
      .then(([m, d]) => {
        if (cancelled) return;
        setMeta(m); setDiff(d);
      })
      .catch((e) => { if (!cancelled) setError(e as ApiCallError); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id?.owner, id?.repo, id?.number, reloadKey]);

  return { meta, diff, loading, error, reload: () => setReloadKey((k) => k + 1) };
}
```

- [ ] **Step 3: Run — verify pass**

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/usePRDetails.ts web/tests/hooks/usePRDetails.test.tsx
git commit -m "feat(web): usePRDetails hook"
```

---

## Task 19: Web — `useNextPRPrefetch` hook

**Files:**
- Create: `web/src/hooks/useNextPRPrefetch.ts`, `web/tests/hooks/useNextPRPrefetch.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { META_FIXTURE_2, DIFF_FIXTURE } from '../msw/handlers.js';
import { useNextPRPrefetch } from '../../src/hooks/useNextPRPrefetch.js';
import type { TrackedPR } from '../../src/types.js';

const PRS: TrackedPR[] = [
  { owner: 'a', repo: 'b', number: 1, title: 'one', authorLogin: 'x', status: 'untouched', addedAt: 1 },
  { owner: 'a', repo: 'b', number: 2, title: 'two', authorLogin: 'x', status: 'untouched', addedAt: 2 },
];

describe('useNextPRPrefetch', () => {
  it('fires meta + diff requests for the next untouched PR', async () => {
    const metaCalls: string[] = [];
    const diffCalls: string[] = [];
    server.use(
      http.get('/api/pulls/:owner/:repo/:number', ({ params }) => { metaCalls.push(String(params.number)); return HttpResponse.json(META_FIXTURE_2); }),
      http.get('/api/pulls/:owner/:repo/:number/diff', ({ params }) => { diffCalls.push(String(params.number)); return HttpResponse.text(DIFF_FIXTURE); }),
    );

    renderHook(() => useNextPRPrefetch({ current: { owner: 'a', repo: 'b', number: 1 }, prs: PRS }));

    await waitFor(() => {
      expect(metaCalls).toContain('2');
      expect(diffCalls).toContain('2');
    });
  });

  it('does nothing when there is no next untouched PR', async () => {
    const calls: string[] = [];
    server.use(http.get('/api/pulls/:owner/:repo/:number', ({ params }) => { calls.push(String(params.number)); return HttpResponse.json(META_FIXTURE_2); }));
    renderHook(() => useNextPRPrefetch({ current: { owner: 'a', repo: 'b', number: 2 }, prs: PRS }));
    await new Promise((r) => setTimeout(r, 25));
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { useEffect } from 'react';
import { api } from '../lib/api.js';
import type { TrackedPR } from '../types.js';

interface Identity { owner: string; repo: string; number: number; }
function same(a: Identity, b: Identity) { return a.owner === b.owner && a.repo === b.repo && a.number === b.number; }

interface Args {
  current: Identity | null;
  prs: TrackedPR[];
}

export function nextUntouchedAfter(current: Identity | null, prs: TrackedPR[]): Identity | null {
  if (!current) return null;
  const idx = prs.findIndex((p) => same(p, current));
  if (idx === -1) return null;
  for (let i = idx + 1; i < prs.length; i++) {
    if (prs[i].status === 'untouched') return { owner: prs[i].owner, repo: prs[i].repo, number: prs[i].number };
  }
  return null;
}

export function useNextPRPrefetch({ current, prs }: Args) {
  useEffect(() => {
    const next = nextUntouchedAfter(current, prs);
    if (!next) return;
    // best-effort; swallow errors
    Promise.allSettled([
      api.getPullRequest(next.owner, next.repo, next.number),
      api.getDiff(next.owner, next.repo, next.number),
    ]);
  }, [current?.owner, current?.repo, current?.number, prs]);
}
```

- [ ] **Step 3: Run — verify pass**

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/useNextPRPrefetch.ts web/tests/hooks/useNextPRPrefetch.test.tsx
git commit -m "feat(web): useNextPRPrefetch hook"
```

---

## Task 20: Web — `PRHeader` component

**Files:**
- Create: `web/src/components/PRHeader.tsx`

(Trivial render; no dedicated test — covered by flow test in Task 24.)

- [ ] **Step 1: Implement**

```tsx
import type { PullRequestMeta } from '../types.js';

export function PRHeader({ meta }: { meta: PullRequestMeta }) {
  const stateLabel = meta.merged ? 'Merged' : meta.state === 'OPEN' ? 'Open' : 'Closed';
  return (
    <header className="pr-header">
      <h2>{meta.title}</h2>
      <p className="pr-header-meta">
        <a href={meta.url} target="_blank" rel="noopener noreferrer">#{meta.number}</a>
        {' · '}
        {meta.authorLogin ?? 'unknown'}
        {' · '}
        <code>{meta.headRefName}</code> → <code>{meta.baseRefName}</code>
        {' · '}
        <span className={`pr-state pr-state-${stateLabel.toLowerCase()}`}>{stateLabel}</span>
      </p>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/PRHeader.tsx
git commit -m "feat(web): PRHeader component"
```

---

## Task 21: Web — `DiffViewer` component

**Files:**
- Create: `web/src/components/DiffViewer.tsx`

(Integration of `react-diff-view`; tested via the flow test in Task 24. Inline-comment + thread rendering live here.)

- [ ] **Step 1: Implement**

```tsx
import { useMemo, useState } from 'react';
import { Diff, Hunk, parseDiff, type ViewType, tokenize } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import Prism from 'prismjs';
import type { ReviewThread, StagedInlineComment } from '../types.js';

interface Props {
  diff: string;
  threads: ReviewThread[];
  stagedComments: StagedInlineComment[];
  onAddInlineComment: (c: StagedInlineComment) => void;
  onRemoveStagedComment: (idx: number) => void;
  onReplyToThread: (threadId: string, body: string) => void;
}

interface PerFileViewMode { [path: string]: ViewType; }

export function DiffViewer({ diff, threads, stagedComments, onAddInlineComment, onRemoveStagedComment, onReplyToThread }: Props) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  const [perFile, setPerFile] = useState<PerFileViewMode>({});
  const [activeLine, setActiveLine] = useState<{ path: string; line: number; side: 'LEFT' | 'RIGHT' } | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [replyState, setReplyState] = useState<{ threadId: string; body: string } | null>(null);

  if (files.length === 0) {
    return <p className="empty">No diff to show.</p>;
  }

  return (
    <div className="diff-viewer">
      {files.map((file) => {
        const path = (file.newPath ?? file.oldPath ?? '') as string;
        const view = perFile[path] ?? 'unified';
        const tokens = tokenize(file.hunks, { highlight: true, language: 'jsx', refractor: Prism } as any);
        const fileThreads = threads.filter((t) => t.path === path && t.line != null);
        const fileStaged = stagedComments
          .map((c, idx) => ({ c, idx }))
          .filter(({ c }) => c.path === path);

        return (
          <section key={path} className="diff-file">
            <header className="diff-file-header">
              <code>{path}</code>
              <button type="button" onClick={() => setPerFile((s) => ({ ...s, [path]: view === 'unified' ? 'split' : 'unified' }))}>
                {view === 'unified' ? 'Split view' : 'Unified view'}
              </button>
            </header>
            <Diff
              viewType={view}
              diffType={file.type}
              hunks={file.hunks}
              tokens={tokens}
              gutterEvents={{
                onClick: ({ change }: any) => {
                  if (!change || change.isNormal) return;
                  const line = change.newLineNumber ?? change.oldLineNumber ?? 0;
                  const side: 'LEFT' | 'RIGHT' = change.type === 'delete' ? 'LEFT' : 'RIGHT';
                  setActiveLine({ path, line, side });
                  setDraftBody('');
                },
              }}
            >
              {(hunks) => hunks.map((h) => <Hunk key={h.content} hunk={h} />)}
            </Diff>

            {fileThreads.map((t) => (
              <div key={t.id} className="thread" data-line={t.line}>
                <p className="thread-anchor">{path}:{t.line}</p>
                {t.comments.map((c) => (
                  <article key={c.id}>
                    <strong>{c.authorLogin ?? '?'}</strong>
                    <p>{c.body}</p>
                  </article>
                ))}
                <div className="thread-reply">
                  <textarea
                    placeholder="Reply..."
                    value={replyState?.threadId === t.id ? replyState.body : ''}
                    onChange={(e) => setReplyState({ threadId: t.id, body: e.target.value })}
                  />
                  <button
                    type="button"
                    disabled={!replyState || replyState.threadId !== t.id || replyState.body.trim() === ''}
                    onClick={() => {
                      if (!replyState) return;
                      onReplyToThread(replyState.threadId, replyState.body);
                      setReplyState(null);
                    }}
                  >Stage reply</button>
                </div>
              </div>
            ))}

            {fileStaged.map(({ c, idx }) => (
              <div key={idx} className="staged-comment">
                <p className="staged-anchor">{c.path}:{c.line} ({c.side})</p>
                <p>{c.body}</p>
                <button type="button" onClick={() => onRemoveStagedComment(idx)}>Remove</button>
              </div>
            ))}

            {activeLine && activeLine.path === path && (
              <div className="inline-editor" data-line={activeLine.line}>
                <p>{path}:{activeLine.line} ({activeLine.side})</p>
                <textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)} aria-label="Inline comment" />
                <button
                  type="button"
                  disabled={draftBody.trim() === ''}
                  onClick={() => {
                    onAddInlineComment({ path: activeLine.path, line: activeLine.line, side: activeLine.side, body: draftBody });
                    setActiveLine(null);
                    setDraftBody('');
                  }}
                >Stage comment</button>
                <button type="button" onClick={() => setActiveLine(null)}>Cancel</button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/DiffViewer.tsx
git commit -m "feat(web): DiffViewer with unified/split toggle and inline editor"
```

---

## Task 22: Web — `ReviewFooter` component

**Files:**
- Create: `web/src/components/ReviewFooter.tsx`, `web/tests/components/ReviewFooter.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewFooter } from '../../src/components/ReviewFooter.js';

describe('ReviewFooter', () => {
  it('updates summary via onSummaryChange', async () => {
    const onSummaryChange = vi.fn();
    render(<ReviewFooter summary="" onSummaryChange={onSummaryChange} onSubmit={() => {}} onNext={() => {}} canSubmit canNext />);
    await userEvent.type(screen.getByLabelText(/review summary/i), 'lgtm');
    expect(onSummaryChange).toHaveBeenCalled();
    expect((onSummaryChange.mock.calls.at(-1) as [string])[0]).toBe('lgtm');
  });

  it('calls onSubmit with APPROVE / REQUEST_CHANGES / COMMENT', async () => {
    const onSubmit = vi.fn();
    render(<ReviewFooter summary="ok" onSummaryChange={() => {}} onSubmit={onSubmit} onNext={() => {}} canSubmit canNext />);
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onSubmit).toHaveBeenLastCalledWith('APPROVE');
    await userEvent.click(screen.getByRole('button', { name: /request changes/i }));
    expect(onSubmit).toHaveBeenLastCalledWith('REQUEST_CHANGES');
    await userEvent.click(screen.getByRole('button', { name: /^comment$/i }));
    expect(onSubmit).toHaveBeenLastCalledWith('COMMENT');
  });

  it('disables submit buttons when canSubmit is false', () => {
    render(<ReviewFooter summary="" onSummaryChange={() => {}} onSubmit={() => {}} onNext={() => {}} canSubmit={false} canNext />);
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
  });

  it('calls onNext when clicking Next', async () => {
    const onNext = vi.fn();
    render(<ReviewFooter summary="" onSummaryChange={() => {}} onSubmit={() => {}} onNext={onNext} canSubmit canNext />);
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onNext).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
import type { ReviewEvent } from '../types.js';

interface Props {
  summary: string;
  onSummaryChange: (value: string) => void;
  onSubmit: (event: ReviewEvent) => void;
  onNext: () => void;
  canSubmit: boolean;
  canNext: boolean;
}

export function ReviewFooter({ summary, onSummaryChange, onSubmit, onNext, canSubmit, canNext }: Props) {
  return (
    <footer className="review-footer">
      <textarea
        aria-label="Review summary"
        placeholder="Leave a summary (optional)"
        value={summary}
        onChange={(e) => onSummaryChange(e.target.value)}
      />
      <div className="review-footer-actions">
        <button type="button" disabled={!canSubmit} onClick={() => onSubmit('APPROVE')}>Approve</button>
        <button type="button" disabled={!canSubmit} onClick={() => onSubmit('REQUEST_CHANGES')}>Request changes</button>
        <button type="button" disabled={!canSubmit} onClick={() => onSubmit('COMMENT')}>Comment</button>
        <button type="button" disabled={!canNext} onClick={onNext}>Next</button>
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Run — verify pass**

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ReviewFooter.tsx web/tests/components/ReviewFooter.test.tsx
git commit -m "feat(web): ReviewFooter component"
```

---

## Task 23: Web — `DiscardDraftsModal` component

**Files:**
- Create: `web/src/components/DiscardDraftsModal.tsx`, `web/tests/components/DiscardDraftsModal.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscardDraftsModal } from '../../src/components/DiscardDraftsModal.js';

describe('DiscardDraftsModal', () => {
  it('does not render when open is false', () => {
    render(<DiscardDraftsModal open={false} onDiscard={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText(/unsent comments/i)).not.toBeInTheDocument();
  });

  it('renders and wires Discard / Cancel', async () => {
    const onDiscard = vi.fn();
    const onCancel = vi.fn();
    render(<DiscardDraftsModal open onDiscard={onDiscard} onCancel={onCancel} />);
    expect(screen.getByText(/unsent comments/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(onDiscard).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
interface Props {
  open: boolean;
  onDiscard: () => void;
  onCancel: () => void;
}

export function DiscardDraftsModal({ open, onDiscard, onCancel }: Props) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>Discard unsent comments?</h3>
        <p>You have unsent comments on this PR. Moving on will discard them.</p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" onClick={onDiscard}>Discard</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run — verify pass**

- [ ] **Step 4: Commit**

```bash
git add web/src/components/DiscardDraftsModal.tsx web/tests/components/DiscardDraftsModal.test.tsx
git commit -m "feat(web): DiscardDraftsModal"
```

---

## Task 24: Web — `AuthRequiredBanner` + `ErrorToast`

**Files:**
- Create: `web/src/components/AuthRequiredBanner.tsx`, `web/src/components/ErrorToast.tsx`

(Trivial render; flow test exercises ErrorToast path.)

- [ ] **Step 1: Implement banner**

```tsx
export function AuthRequiredBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="auth-banner" role="status">
      <p>GitHub CLI is not authenticated. Run <code>gh auth login</code> and reload.</p>
      <button type="button" onClick={() => navigator.clipboard?.writeText('gh auth login')}>Copy command</button>
      <button type="button" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}
```

- [ ] **Step 2: Implement toast**

```tsx
interface Props { message: string; onDismiss: () => void; }
export function ErrorToast({ message, onDismiss }: Props) {
  return (
    <div className="error-toast" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onDismiss}>×</button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/AuthRequiredBanner.tsx web/src/components/ErrorToast.tsx
git commit -m "feat(web): auth banner + error toast"
```

---

## Task 25: Web — `ReviewDrawer` + `App` wiring + end-to-end flow test

**Files:**
- Modify: `web/src/App.tsx`
- Create: `web/src/components/ReviewDrawer.tsx`, `web/tests/flows/ReviewDrawer.flow.test.tsx`

This is the integration task — `ReviewDrawer` orchestrates `usePRDetails`, `useDrafts`, the components above, and the submit/next button flows. The flow test exercises a full happy path.

- [ ] **Step 1: Failing flow test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/App.js';

describe('ReviewDrawer flow', () => {
  it('adds a PR, opens the drawer, approves, advances to next, ends queue', async () => {
    localStorage.clear();
    render(<App />);

    // add two PRs
    const input = screen.getByPlaceholderText(/paste a github pr url/i);
    await userEvent.type(input, 'https://github.com/Gusto/zenpayroll/pull/1');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    await screen.findByText(/Test PR/i);

    await userEvent.type(input, 'https://github.com/Gusto/zenpayroll/pull/2');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    await screen.findByText(/Second PR/i);

    // open the first one
    await userEvent.click(screen.getByText(/Test PR/i));
    await screen.findByRole('button', { name: /approve/i });

    // approve
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));

    // drawer advances to PR #2
    await screen.findByText(/Second PR/i, { selector: '.pr-header h2' });

    // Next without drafts → status flips to reviewed, drawer closes (queue empty by filter)
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await screen.findByText(/no prs to review/i);
  });

  it('Next with staged drafts triggers discard modal; cancel preserves state', async () => {
    localStorage.clear();
    render(<App />);

    await userEvent.type(screen.getByPlaceholderText(/paste a github pr url/i), 'https://github.com/Gusto/zenpayroll/pull/1');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));
    await screen.findByText(/Test PR/i);
    await userEvent.click(screen.getByText(/Test PR/i));

    // type a summary so drafts.hasAny() is true
    await userEvent.type(screen.getByLabelText(/review summary/i), 'wip');

    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText(/discard unsent comments/i)).toBeInTheDocument();

    // cancel preserves state
    await userEvent.click(within(modal).getByRole('button', { name: /cancel/i }));
    expect((screen.getByLabelText(/review summary/i) as HTMLTextAreaElement).value).toBe('wip');
  });
});
```

- [ ] **Step 2: Implement `ReviewDrawer.tsx`**

```tsx
import { useState } from 'react';
import { PRHeader } from './PRHeader.js';
import { DiffViewer } from './DiffViewer.js';
import { ReviewFooter } from './ReviewFooter.js';
import { DiscardDraftsModal } from './DiscardDraftsModal.js';
import { ErrorToast } from './ErrorToast.js';
import { usePRDetails } from '../hooks/usePRDetails.js';
import { useNextPRPrefetch } from '../hooks/useNextPRPrefetch.js';
import { api } from '../lib/api.js';
import type { PRStatus, ReviewDrafts, ReviewEvent, StagedInlineComment, StagedThreadReply, TrackedPR } from '../types.js';

interface Identity { owner: string; repo: string; number: number; }

interface Props {
  current: Identity | null;
  prs: TrackedPR[];
  drafts: ReviewDrafts;
  hasDrafts: boolean;
  onSummaryChange: (id: Identity, value: string) => void;
  onAddInlineComment: (id: Identity, c: StagedInlineComment) => void;
  onRemoveInlineComment: (id: Identity, idx: number) => void;
  onAddReply: (id: Identity, r: StagedThreadReply) => void;
  onClearDrafts: (id: Identity) => void;
  onAdvance: (id: Identity, newStatus: PRStatus) => void;
  onClose: () => void;
}

export function ReviewDrawer(props: Props) {
  const { current, prs, drafts, hasDrafts, onSummaryChange, onAddInlineComment, onRemoveInlineComment, onAddReply, onClearDrafts, onAdvance, onClose } = props;
  const { meta, diff, loading, error } = usePRDetails(current);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [askingDiscard, setAskingDiscard] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useNextPRPrefetch({ current, prs });

  if (!current) return null;
  if (loading || !meta || diff == null) return <div className="drawer"><p>Loading...</p></div>;

  const canSubmit = meta.state === 'OPEN' && !submitting;
  const canNext = !submitting;

  const submitReview = async (event: ReviewEvent) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.submitReview(current.owner, current.repo, current.number, {
        event,
        body: drafts.summary || undefined,
        comments: drafts.inlineComments.length ? drafts.inlineComments : undefined,
      });
      for (const r of drafts.replies) {
        await api.replyToThread(current.owner, current.repo, current.number, r.threadId, r.body);
      }
      onClearDrafts(current);
      onAdvance(current, event === 'APPROVE' ? 'approved' : 'reviewed');
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const doNext = () => {
    if (hasDrafts) { setAskingDiscard(true); return; }
    onAdvance(current, 'reviewed');
  };

  return (
    <aside className="drawer" aria-label="Review drawer">
      <button type="button" className="drawer-close" onClick={onClose} aria-label="Close drawer">×</button>
      <PRHeader meta={meta} />
      <DiffViewer
        diff={diff}
        threads={meta.reviewThreads}
        stagedComments={drafts.inlineComments}
        onAddInlineComment={(c) => onAddInlineComment(current, c)}
        onRemoveStagedComment={(idx) => onRemoveInlineComment(current, idx)}
        onReplyToThread={(threadId, body) => onAddReply(current, { threadId, body })}
      />
      <ReviewFooter
        summary={drafts.summary}
        onSummaryChange={(v) => onSummaryChange(current, v)}
        onSubmit={submitReview}
        onNext={doNext}
        canSubmit={canSubmit}
        canNext={canNext}
      />
      {error && <ErrorToast message={error.message} onDismiss={() => {/* user can reload */}} />}
      {submitError && <ErrorToast message={submitError} onDismiss={() => setSubmitError(null)} />}
      <DiscardDraftsModal
        open={askingDiscard}
        onCancel={() => setAskingDiscard(false)}
        onDiscard={() => { setAskingDiscard(false); onClearDrafts(current); onAdvance(current, 'reviewed'); }}
      />
    </aside>
  );
}
```

- [ ] **Step 3: Rewrite `App.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { AddPRBar } from './components/AddPRBar.js';
import { PRList } from './components/PRList.js';
import { FilterToggle, type FilterMode } from './components/FilterToggle.js';
import { ReviewDrawer } from './components/ReviewDrawer.js';
import { AuthRequiredBanner } from './components/AuthRequiredBanner.js';
import { ErrorToast } from './components/ErrorToast.js';
import { useTrackedPRs } from './hooks/useTrackedPRs.js';
import { useDrafts } from './hooks/useDrafts.js';
import { nextUntouchedAfter } from './hooks/useNextPRPrefetch.js';
import { api, ApiCallError } from './lib/api.js';
import type { PRStatus } from './types.js';

interface Identity { owner: string; repo: string; number: number; }

export function App() {
  const { prs, add, setStatus } = useTrackedPRs();
  const drafts = useDrafts();
  const [mode, setMode] = useState<FilterMode>('untouched-only');
  const [current, setCurrent] = useState<Identity | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  const handleAdd = useCallback(async (parsed: Identity) => {
    setAddError(null);
    try {
      const meta = await api.getPullRequest(parsed.owner, parsed.repo, parsed.number);
      add({ owner: parsed.owner, repo: parsed.repo, number: parsed.number, title: meta.title, authorLogin: meta.authorLogin });
    } catch (e) {
      const err = e as ApiCallError;
      if (err.code === 'AUTH_REQUIRED') setAuthRequired(true);
      else setAddError(err.message);
    }
  }, [add]);

  const handleAdvance = useCallback((id: Identity, newStatus: PRStatus) => {
    setStatus(id, newStatus);
    // recompute next from the freshly mutated list — read prs after state update via effect below
    setCurrent(() => {
      // After setStatus, the next render gives us the new list; for the immediate advance we cheat by
      // looking at `prs` and projecting the new status onto the current id.
      const projected = prs.map((p) => (p.owner === id.owner && p.repo === id.repo && p.number === id.number ? { ...p, status: newStatus } : p));
      return nextUntouchedAfter(id, projected);
    });
  }, [prs, setStatus]);

  // sync drawer to filter — if mode hides current, close it
  useEffect(() => {
    if (!current) return;
    const cur = prs.find((p) => p.owner === current.owner && p.repo === current.repo && p.number === current.number);
    if (mode === 'untouched-only' && cur && cur.status !== 'untouched') {
      setCurrent(nextUntouchedAfter(current, prs));
    }
  }, [mode, prs, current]);

  const currentDrafts = current ? drafts.getDrafts(current) : { summary: '', inlineComments: [], replies: [] };
  const currentHasDrafts = current ? drafts.hasAny(current) : false;

  return (
    <main className="app">
      <header className="app-header">
        <h1>Connor Review</h1>
        <FilterToggle mode={mode} onChange={setMode} />
      </header>
      <AddPRBar onAdd={handleAdd} />
      {addError && <ErrorToast message={addError} onDismiss={() => setAddError(null)} />}
      {authRequired && <AuthRequiredBanner onDismiss={() => setAuthRequired(false)} />}
      <PRList prs={prs} mode={mode} onOpen={setCurrent} />
      {current && (
        <ReviewDrawer
          current={current}
          prs={prs}
          drafts={currentDrafts}
          hasDrafts={currentHasDrafts}
          onSummaryChange={(id, v) => drafts.setSummary(id, v)}
          onAddInlineComment={(id, c) => drafts.addInlineComment(id, c)}
          onRemoveInlineComment={(id, idx) => drafts.removeInlineComment(id, idx)}
          onAddReply={(id, r) => drafts.addReply(id, r)}
          onClearDrafts={(id) => drafts.clear(id)}
          onAdvance={handleAdvance}
          onClose={() => setCurrent(null)}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run — verify pass**

```bash
cd ~/workspace/connor-review/web
npm test
```

Expected: all tests pass (lib + hooks + components + flows).

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/components/ReviewDrawer.tsx web/tests/flows/ReviewDrawer.flow.test.tsx
git commit -m "feat(web): ReviewDrawer + App wiring + flow test"
```

---

## Task 26: Style polish + smoke run

**Files:**
- Modify: `web/src/styles/app.css`

- [ ] **Step 1: Replace `web/src/styles/app.css`**

```css
:root {
  color-scheme: light dark;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --fg: #0f172a;
  --bg: #ffffff;
  --muted: #475569;
  --border: #e2e8f0;
  --accent: #2563eb;
  --danger: #b91c1c;
  --ok: #15803d;
}
@media (prefers-color-scheme: dark) {
  :root { --fg: #f1f5f9; --bg: #0f172a; --muted: #94a3b8; --border: #1e293b; }
}
body { margin: 0; color: var(--fg); background: var(--bg); }
.app { max-width: 1100px; margin: 0 auto; padding: 16px; }
.app-header { display: flex; justify-content: space-between; align-items: center; }
.add-pr-bar { display: flex; gap: 8px; margin: 12px 0; }
.add-pr-bar input { flex: 1; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: inherit; }
.add-pr-bar button, .filter-toggle, .drawer button { padding: 6px 12px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
.add-pr-bar .error { color: var(--danger); width: 100%; }
.pr-list { list-style: none; padding: 0; }
.pr-row { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; padding: 12px; border-bottom: 1px solid var(--border); cursor: pointer; }
.pr-row:hover { background: rgba(37, 99, 235, 0.06); }
.pr-title { font-weight: 600; }
.pr-meta { color: var(--muted); }
.status-badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); }
.status-approved { color: var(--ok); border-color: var(--ok); }
.status-reviewed { color: var(--accent); border-color: var(--accent); }
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: 70vw; min-width: 720px; background: var(--bg); border-left: 1px solid var(--border); box-shadow: -8px 0 32px rgba(0,0,0,0.18); overflow: auto; padding: 16px 24px; }
.drawer-close { position: absolute; top: 12px; right: 16px; font-size: 1.4rem; background: transparent; border: none; cursor: pointer; }
.pr-header h2 { margin-bottom: 4px; }
.pr-header-meta { color: var(--muted); font-size: 0.9rem; }
.diff-viewer .diff-file { border: 1px solid var(--border); border-radius: 8px; margin: 16px 0; overflow: hidden; }
.diff-file-header { display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(148, 163, 184, 0.12); }
.thread, .staged-comment, .inline-editor { border-top: 1px dashed var(--border); padding: 8px 12px; background: rgba(37, 99, 235, 0.04); }
.review-footer { position: sticky; bottom: 0; background: var(--bg); border-top: 1px solid var(--border); padding-top: 12px; }
.review-footer textarea { width: 100%; min-height: 80px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: inherit; }
.review-footer-actions { display: flex; gap: 8px; margin-top: 8px; }
.modal-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: center; justify-content: center; }
.modal { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; min-width: 320px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.error-toast { position: fixed; bottom: 12px; right: 12px; background: var(--danger); color: white; padding: 8px 12px; border-radius: 6px; }
.auth-banner { background: rgba(239, 68, 68, 0.12); border: 1px solid var(--danger); color: var(--danger); padding: 8px 12px; border-radius: 6px; margin: 8px 0; }
.empty { color: var(--muted); padding: 16px 0; }
```

- [ ] **Step 2: Run dev server, manual smoke**

```bash
cd ~/workspace/connor-review
npm run dev
```

In a browser at http://localhost:5173:
- Paste a real PR URL → it appears in the list with `Untouched` badge.
- Click it → drawer opens; PR header, diff, threads, summary box, action buttons visible.
- Type in summary, click Approve → drawer advances to next untouched PR (or shows empty state if last).
- Try `Next` with no drafts → status flips to `Reviewed`, advance.
- Type a draft summary, click `Next` → confirmation modal; cancel preserves; discard advances.
- Toggle filter → reviewed/approved rows hide/show.

- [ ] **Step 3: Commit**

```bash
git add web/src/styles/app.css
git commit -m "feat(web): style polish for drawer, list, footer"
```

---

## Self-Review

**Spec coverage check:**
- Section 3 (Stack): Vite+React+TS (Task 8), Fastify+TS (Task 2), gh CLI shellout (Task 3), localStorage (Task 12), LRU cache (Task 4). ✓
- Section 4 (Components — frontend): App (Task 25), AddPRBar (Task 15), PRList (Task 17), FilterToggle (Task 16), ReviewDrawer (Task 25), PRHeader (Task 20), DiffViewer (Task 21), ReviewFooter (Task 22), useTrackedPRs (Task 12), usePRDetails (Task 18), useNextPRPrefetch (Task 19), parsePRUrl (Task 9). ✓ Plus useDrafts (Task 13), DiscardDraftsModal (Task 23) for the staged-draft handling.
- Section 4 (Components — backend): index (Task 2), routes/pulls (Task 7), ghExec (Task 3), lruCache (Task 4). ✓ Plus parseRouteParams (Task 5), GraphQL queries (Task 6).
- Section 5 (Data flow): adding (Task 25 flow + Task 7 routes), opening (Task 18 + Task 21), reviewing/Approve/RC/Comment/Next + staged-draft persistence + discard modal (Task 25). ✓
- Section 6 (Error handling): Server error mapping (Task 7), AuthRequiredBanner (Tasks 24, 25). ErrorToast (Tasks 24, 25). ✓ Closed/merged PR disabling via `meta.state === 'OPEN'` in Task 25. ✓
- Section 7 (Testing): Server tests Task 3, 4, 5, 7. Web tests Tasks 9, 12, 13, 15, 16, 17, 18, 19, 22, 23, 25. msw infrastructure Task 14. ✓

**Placeholder scan:** No "TBD", "TODO", or "implement appropriate X" in any step. Every code step has full source. Commands have expected output.

**Type consistency:** Backend `PullRequestMeta` shape (Task 7) matches frontend type (Task 10) — same field names. `ReviewEvent` enum identical across both. `StagedInlineComment` shape consistent across types (Task 10), api (Task 11), and the route body in pull tests (Task 7). `nextUntouchedAfter` exported from `useNextPRPrefetch.ts` (Task 19) and imported in `App.tsx` (Task 25) — consistent name.

**Scope:** Single coherent feature. One implementation pass.
