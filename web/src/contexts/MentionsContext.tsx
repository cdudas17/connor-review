import { createContext, useContext, type ReactNode } from 'react';

/** GitHub logins that the @-mention autocomplete inside EmojiTextarea will
 * surface when the user types `@<partial>`. Empty array (default) disables
 * the feature — non-drawer textareas just continue to behave the way they
 * always have. */
const MentionsContext = createContext<string[]>([]);

export function MentionsProvider({ value, children }: { value: string[]; children: ReactNode }) {
  return <MentionsContext.Provider value={value}>{children}</MentionsContext.Provider>;
}

/** Hook used by EmojiTextarea — no-op when no provider is mounted above. */
export function useMentionCandidates(): string[] {
  return useContext(MentionsContext);
}
