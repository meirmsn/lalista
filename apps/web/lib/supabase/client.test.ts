// What: Smoke test for the browser Supabase client helper
// Why: Guarantees we pass the NEXT_PUBLIC env vars through to @supabase/ssr's
//      createBrowserClient — regressions here break sign-in silently
// Does NOT: Hit the network or assert on Supabase behavior

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn(() => ({ __kind: 'browser-client' })),
}));

describe('lib/supabase/client', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('calls createBrowserClient with the NEXT_PUBLIC env vars', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-abc';

    const { createBrowserClient } = await import('@supabase/ssr');
    const { createClient } = await import('./client');

    const client = createClient();

    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'anon-key-abc'
    );
    expect(client).toEqual({ __kind: 'browser-client' });
  });

  it('trims whitespace from URL + ANON_KEY env vars (deploy env fat-finger defense)', async () => {
    // 2026-04-26 prod incident: trailing newline in NEXT_PUBLIC_SUPABASE_URL
    // surfaced as `%0A` in CSP header + broke SSR fetch. Defense: trim at
    // every read site. See server.ts comment for the full incident note.
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co\n';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '  anon-key-abc\t';

    const { createBrowserClient } = await import('@supabase/ssr');
    const { createClient } = await import('./client');

    createClient();

    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'anon-key-abc'
    );
  });
});
