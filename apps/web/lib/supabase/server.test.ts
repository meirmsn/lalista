// What: Smoke test for the server Supabase client helper
// Why: Verifies we plumb Next's cookies() into @supabase/ssr's cookie adapter
//      — breakage here means RLS queries silently fall back to the anon role
// Does NOT: Hit the network or assert on Supabase behavior

import { afterEach, describe, expect, it, vi } from 'vitest';

type CreateServerClientArgs = [
  string,
  string,
  {
    cookies: {
      getAll: () => Array<{ name: string; value: string }>;
      setAll: (
        cookies: Array<{
          name: string;
          value: string;
          options?: Record<string, unknown>;
        }>
      ) => void;
    };
  },
];

const fakeCookieStore = {
  getAll: vi.fn(() => [{ name: 'sb-access-token', value: 'abc' }]),
  set: vi.fn(),
};

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => fakeCookieStore),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({ __kind: 'server-client' })),
}));

describe('lib/supabase/server', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    fakeCookieStore.getAll.mockReturnValue([
      { name: 'sb-access-token', value: 'abc' },
    ]);
  });

  it('calls createServerClient with env vars + a cookie adapter wired to next/headers', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-abc';

    const { createServerClient } = await import('@supabase/ssr');
    const { createClient } = await import('./server');

    const client = await createClient();

    expect(client).toEqual({ __kind: 'server-client' });
    expect(createServerClient).toHaveBeenCalledTimes(1);

    const [url, key, options] = vi.mocked(createServerClient).mock
      .calls[0] as CreateServerClientArgs;
    expect(url).toBe('https://project.supabase.co');
    expect(key).toBe('anon-key-abc');
    expect(options.cookies.getAll()).toEqual([
      { name: 'sb-access-token', value: 'abc' },
    ]);

    options.cookies.setAll([
      { name: 'sb-access-token', value: 'new', options: { path: '/' } },
    ]);
    expect(fakeCookieStore.set).toHaveBeenCalledWith('sb-access-token', 'new', {
      path: '/',
    });
  });

  it('trims whitespace from URL + ANON_KEY env vars (deploy env fat-finger defense)', async () => {
    // 2026-04-26 prod incident: the hosting env had a trailing newline in
    // NEXT_PUBLIC_SUPABASE_URL; SSR / threw 500 because fetch rejected the
    // malformed URL. Defense: trim at every read site. See server.ts comment.
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co\n';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '  anon-key-abc\t';

    const { createServerClient } = await import('@supabase/ssr');
    const { createClient } = await import('./server');

    await createClient();

    const [url, key] = vi.mocked(createServerClient).mock
      .calls[0] as CreateServerClientArgs;
    expect(url).toBe('https://project.supabase.co');
    expect(key).toBe('anon-key-abc');
  });

  it('swallows errors from cookieStore.set inside a Server Component', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-abc';
    fakeCookieStore.set.mockImplementationOnce(() => {
      throw new Error('Cookies can only be modified in a Server Action');
    });

    const { createServerClient } = await import('@supabase/ssr');
    const { createClient } = await import('./server');

    await createClient();

    const [, , options] = vi.mocked(createServerClient).mock
      .calls[0] as CreateServerClientArgs;
    expect(() =>
      options.cookies.setAll([{ name: 'sb-refresh-token', value: 'r' }])
    ).not.toThrow();
  });
});
