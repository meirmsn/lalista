import { describe, it, expect, vi, afterEach } from 'vitest';
import { createClient, assertNotProdUrlInTestEnv } from './supabase';
import type { CoreConfig } from './supabase';

describe('createClient', () => {
  it('returns a Supabase client with the given config', () => {
    const config: CoreConfig = {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'test-anon-key',
    };

    const client = createClient(config);

    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
    expect(typeof client.auth).toBe('object');
  });

  it('throws when test env tries to dial the production project', () => {
    // NODE_ENV is 'test' by vitest default — the guard fires on the prod URL.
    const config: CoreConfig = {
      supabaseUrl: 'https://nzfdfjctpotjyuxdfcpw.supabase.co',
      supabaseAnonKey: 'prod-anon-key',
    };

    expect(() => createClient(config)).toThrow(/production project/);
  });
});

describe('assertNotProdUrlInTestEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws in test env when URL points at the production project ref', () => {
    expect(() =>
      assertNotProdUrlInTestEnv('https://nzfdfjctpotjyuxdfcpw.supabase.co')
    ).toThrow(/NODE_ENV=test/);
  });

  it('no-ops in test env for non-production URLs (localhost, staging, fake)', () => {
    expect(() =>
      assertNotProdUrlInTestEnv('http://127.0.0.1:54321')
    ).not.toThrow();
    expect(() =>
      assertNotProdUrlInTestEnv('https://staging.supabase.co')
    ).not.toThrow();
    expect(() =>
      assertNotProdUrlInTestEnv('https://test.supabase.co')
    ).not.toThrow();
  });

  it('no-ops in production env even for the production URL', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() =>
      assertNotProdUrlInTestEnv('https://nzfdfjctpotjyuxdfcpw.supabase.co')
    ).not.toThrow();
  });

  it('no-ops in development env (preserves dev-against-prod workflow)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(() =>
      assertNotProdUrlInTestEnv('https://nzfdfjctpotjyuxdfcpw.supabase.co')
    ).not.toThrow();
  });
});
