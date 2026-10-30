// What: Unit tests for auth wrappers
// Why: Confirm they forward args and normalize return shapes
// Does NOT: Start a real auth session — integration tests in PR 4

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  signInWithPassword,
  signUpWithPassword,
  signOut,
  getSession,
  getUser,
  onAuthStateChange,
} from './auth';

describe('signInWithPassword', () => {
  it('calls client.auth.signInWithPassword with email and password', async () => {
    const client = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: null,
        }),
      },
    };

    await signInWithPassword(client as never, 'a@b.com', 'pass');

    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pass',
    });
  });
});

describe('signUpWithPassword', () => {
  it('calls client.auth.signUp with email and password (no displayName)', async () => {
    const client = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: null,
        }),
      },
    };

    await signUpWithPassword(client as never, 'a@b.com', 'pass');

    expect(client.auth.signUp).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pass',
    });
  });

  it('threads displayName through options.data.display_name (trimmed)', async () => {
    const client = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: null,
        }),
      },
    };

    await signUpWithPassword(client as never, 'a@b.com', 'pass', '  Meir  ');

    expect(client.auth.signUp).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pass',
      options: { data: { display_name: 'Meir' } },
    });
  });

  it('omits options.data when displayName is an empty string (trigger fallback owns default)', async () => {
    const client = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: null,
        }),
      },
    };

    await signUpWithPassword(client as never, 'a@b.com', 'pass', '   ');

    expect(client.auth.signUp).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pass',
    });
  });

  // ------------------------------------------------------------------
  // T10: 5th-positional inviteToken extension (D4)
  // ------------------------------------------------------------------
  describe('inviteToken (5th positional arg, D4)', () => {
    const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

    beforeEach(() => {
      process.env.NEXT_PUBLIC_SITE_URL = 'https://lalista.store';
    });
    afterEach(() => {
      if (originalSiteUrl === undefined)
        delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
    });

    /**
     *
     */
    function clientFactory() {
      return {
        auth: {
          signUp: vi.fn().mockResolvedValue({
            data: { user: null, session: null },
            error: null,
          }),
        },
      };
    }

    it('does NOT set emailRedirectTo when inviteToken is absent (preserves zero existing callers)', async () => {
      const client = clientFactory();
      await signUpWithPassword(client as never, 'a@b.com', 'pass', 'Meir');
      expect(client.auth.signUp).toHaveBeenCalledWith({
        email: 'a@b.com',
        password: 'pass',
        options: { data: { display_name: 'Meir' } },
      });
    });

    it('sets options.emailRedirectTo to ${siteUrl}/auth/callback?invite=<encoded-token> when inviteToken is set', async () => {
      const client = clientFactory();
      await signUpWithPassword(
        client as never,
        'a@b.com',
        'pass',
        undefined,
        'tok-123'
      );
      expect(client.auth.signUp).toHaveBeenCalledWith({
        email: 'a@b.com',
        password: 'pass',
        options: {
          emailRedirectTo: 'https://lalista.store/auth/callback?invite=tok-123',
        },
      });
    });

    it('merges display_name + emailRedirectTo into one options object when both are set', async () => {
      const client = clientFactory();
      await signUpWithPassword(
        client as never,
        'a@b.com',
        'pass',
        '  Meir  ',
        'tok-merge'
      );
      expect(client.auth.signUp).toHaveBeenCalledWith({
        email: 'a@b.com',
        password: 'pass',
        options: {
          data: { display_name: 'Meir' },
          emailRedirectTo:
            'https://lalista.store/auth/callback?invite=tok-merge',
        },
      });
    });

    it('falls back to window.location.origin when NEXT_PUBLIC_SITE_URL is unset and window is available', async () => {
      delete process.env.NEXT_PUBLIC_SITE_URL;
      // Stub window — core's vitest config is node-env by default.
      const originalWindow = (globalThis as { window?: unknown }).window;
      (globalThis as { window?: unknown }).window = {
        location: { origin: 'http://example.invalid' },
      };
      try {
        const client = clientFactory();
        await signUpWithPassword(
          client as never,
          'a@b.com',
          'pass',
          undefined,
          'tok-fall'
        );
        const call = client.auth.signUp.mock.calls[0]?.[0] as {
          options?: { emailRedirectTo?: string };
        };
        expect(call.options?.emailRedirectTo).toBe(
          'http://example.invalid/auth/callback?invite=tok-fall'
        );
      } finally {
        if (originalWindow === undefined) {
          delete (globalThis as { window?: unknown }).window;
        } else {
          (globalThis as { window?: unknown }).window = originalWindow;
        }
      }
    });

    it('encodes the invite token in the URL', async () => {
      const client = clientFactory();
      await signUpWithPassword(
        client as never,
        'a@b.com',
        'pass',
        undefined,
        'with/slash+plus='
      );
      const call = client.auth.signUp.mock.calls[0]?.[0] as {
        options?: { emailRedirectTo?: string };
      };
      expect(call.options?.emailRedirectTo).toBe(
        'https://lalista.store/auth/callback?invite=with%2Fslash%2Bplus%3D'
      );
    });
  });
});

describe('signOut', () => {
  it('throws when signOut errors', async () => {
    const client = {
      auth: {
        signOut: vi.fn().mockResolvedValue({ error: { message: 'nope' } }),
      },
    };

    await expect(signOut(client as never)).rejects.toMatchObject({
      message: 'nope',
    });
  });

  it('resolves when signOut succeeds', async () => {
    const client = {
      auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
    };

    await expect(signOut(client as never)).resolves.toBeUndefined();
  });
});

describe('getSession', () => {
  it('returns the current session', async () => {
    const session = { access_token: 'abc' };
    const client = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session } }) },
    };

    const result = await getSession(client as never);

    expect(result).toBe(session);
  });

  it('returns null when there is no session', async () => {
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      },
    };

    expect(await getSession(client as never)).toBeNull();
  });
});

describe('getUser', () => {
  it('returns the current user', async () => {
    const user = { id: 'u1' };
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    };

    expect(await getUser(client as never)).toBe(user);
  });
});

describe('onAuthStateChange', () => {
  it('returns the inner subscription for caller cleanup', () => {
    const subscription = { unsubscribe: vi.fn() };
    const client = {
      auth: {
        onAuthStateChange: vi.fn().mockReturnValue({
          data: { subscription },
        }),
      },
    };

    const cb = vi.fn();
    const result = onAuthStateChange(client as never, cb);

    expect(client.auth.onAuthStateChange).toHaveBeenCalledWith(cb);
    expect(result).toBe(subscription);
  });
});
