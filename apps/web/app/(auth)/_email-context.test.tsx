// What: Smoke tests for the (auth) email-context hook + provider
// Why: Provider mount-without-error guarantees pages can opt into shared
//      email state without crashing; the throw-when-unprovided contract
//      catches a mis-placed page outside the (auth) group early.
// Does NOT: Exercise the layout chrome — that's a visual concern.

import { describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthEmailProvider, useAuthEmail } from './_email-context';

/**
 *
 */
function Probe() {
  const { email, setEmail } = useAuthEmail();
  return (
    <div>
      <span data-testid="email">{email}</span>
      <button type="button" onClick={() => setEmail('alice@test.local')}>
        set
      </button>
    </div>
  );
}

describe('<AuthEmailProvider> + useAuthEmail()', () => {
  it('mounts without error and renders children', () => {
    render(
      <AuthEmailProvider>
        <Probe />
      </AuthEmailProvider>
    );
    expect(screen.getByTestId('email').textContent).toBe('');
  });

  it('setEmail updates the value visible to consumers', () => {
    render(
      <AuthEmailProvider>
        <Probe />
      </AuthEmailProvider>
    );
    act(() => {
      screen.getByRole('button', { name: /set/i }).click();
    });
    expect(screen.getByTestId('email').textContent).toBe('alice@test.local');
  });

  it('throws when used outside the provider', () => {
    // Suppress React's expected error log for this assertion.
    const original = console.error;
    console.error = () => {};
    expect(() => render(<Probe />)).toThrow(/useAuthEmail must be used/i);
    console.error = original;
  });
});
