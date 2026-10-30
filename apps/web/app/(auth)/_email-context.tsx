// What: React context that persists the entered email across auth screens
// Why: Sign-in ↔ sign-up ↔ forgot-password navigation should preserve what the
//      user typed so re-entry friction stays low. URL params would leak the
//      email into history + referer; component state would reset on each
//      page navigation. A layout-scoped context survives intra-flow nav and
//      drops on full reload (acceptable per chapter 1l scope item 2).
// Does NOT: Persist across reloads, broadcast to non-(auth) routes, or
//           validate the email — pages own validation at submit time.

'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

interface AuthEmailContextValue {
  email: string;
  setEmail: (email: string) => void;
}

const AuthEmailContext = createContext<AuthEmailContextValue | null>(null);

/**
 * Provider for the (auth)-scoped email context. Mounted by the layout so
 * every page in the group shares the same `{ email, setEmail }` pair. */
export function AuthEmailProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState('');
  return (
    <AuthEmailContext.Provider value={{ email, setEmail }}>
      {children}
    </AuthEmailContext.Provider>
  );
}

/**
 * Read + write the entered email from any (auth) page. Throws if called
 * outside the provider so a missing layout wrapper fails loudly in dev.
 */
export function useAuthEmail(): AuthEmailContextValue {
  const ctx = useContext(AuthEmailContext);
  if (!ctx) {
    throw new Error(
      'useAuthEmail must be used within AuthEmailProvider — check that the page lives under app/(auth)/.'
    );
  }
  return ctx;
}
