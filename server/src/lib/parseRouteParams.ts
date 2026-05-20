export class BadParamsError extends Error {
  override readonly name = 'BadParamsError';
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
