import { useCallback, useEffect, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';

/**
 * Skills store — filesystem-backed reusable prompt templates. Fetched
 * from the server on mount, with a body cache per slug so a workflow
 * that references a skill by slug can pull the actual prompt text
 * synchronously once things are hydrated.
 *
 * Same pattern as useNoteProjects: initial list-fetch → eager body
 * pre-fetch → offline path falls back to whatever's cached.
 */

export interface Skill {
  slug: string;
  name: string;
}

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { skills: list } = await api.listSkills();
        if (cancelled) return;
        setSkills(list);
        setStatus('ok');
        // Eager-fetch every skill body so downstream consumers
        // (workflow runner, editor previews) can read them without
        // triggering their own fetch. Failures per-slug are swallowed.
        await Promise.all(list.map(async (s) => {
          try {
            const info = await api.getSkill(s.slug);
            if (cancelled) return;
            setBodies((cur) => ({ ...cur, [s.slug]: info.body }));
          } catch { /* per-slug best effort */ }
        }));
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const bodyFor = useCallback((slug: string): string | null => {
    return bodies[slug] ?? null;
  }, [bodies]);

  const createSkill = useCallback(async (name: string, body?: string): Promise<Skill | null> => {
    try {
      const s = await api.createSkill({ name: name.trim(), body: body ?? '' });
      setSkills((cur) => [s, ...cur.filter((x) => x.slug !== s.slug)]);
      setBodies((cur) => ({ ...cur, [s.slug]: body ?? '' }));
      return s;
    } catch { return null; }
  }, []);

  const updateSkillBody = useCallback(async (slug: string, body: string): Promise<boolean> => {
    try {
      await api.putSkillBody(slug, body);
      setBodies((cur) => ({ ...cur, [slug]: body }));
      return true;
    } catch { return false; }
  }, []);

  const renameSkill = useCallback(async (slug: string, name: string): Promise<boolean> => {
    try {
      await api.renameSkill(slug, name.trim());
      setSkills((cur) => cur.map((s) => s.slug === slug ? { ...s, name: name.trim() } : s));
      return true;
    } catch { return false; }
  }, []);

  const removeSkill = useCallback(async (slug: string): Promise<boolean> => {
    try {
      await api.deleteSkill(slug);
      setSkills((cur) => cur.filter((s) => s.slug !== slug));
      setBodies((cur) => { const { [slug]: _drop, ...rest } = cur; void _drop; return rest; });
      return true;
    } catch (e) {
      void (e as ApiCallError);
      return false;
    }
  }, []);

  return { skills, bodyFor, status, createSkill, updateSkillBody, renameSkill, removeSkill };
}
