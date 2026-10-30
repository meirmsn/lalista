// What: Tests for AuthErrorDisplay — null renders nothing, error renders an alert,
//       client + server errors share the same DOM shape.
// Why: The "no flash between client and server errors" promise is structural —
//      it's preserved iff both code paths render through the same component
//      with the same class.
// Does NOT: Snapshot the visual — just the DOM contract.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthErrorDisplay } from './AuthErrorDisplay';

describe('<AuthErrorDisplay>', () => {
  it('renders nothing when error is null', () => {
    const { container } = render(<AuthErrorDisplay error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders inside a role="alert" with text-error class', () => {
    render(<AuthErrorDisplay error="Boom" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/boom/i);
    expect(alert.className).toMatch(/text-error/);
  });

  it('client error and server error render identical DOM shape', () => {
    // Two renders, same component, different copy: same tag, same class,
    // same role. If a future "tweak for server-side errors" sneaks a
    // different shape in, this fails loudly.
    const { container: a } = render(
      <AuthErrorDisplay error="Enter a valid email address." />
    );
    const { container: b } = render(
      <AuthErrorDisplay error="Too many attempts. Please try again." />
    );
    const aNode = a.firstElementChild!;
    const bNode = b.firstElementChild!;
    expect(aNode.tagName).toBe(bNode.tagName);
    expect(aNode.getAttribute('role')).toBe(bNode.getAttribute('role'));
    expect(aNode.className).toBe(bNode.className);
  });
});
