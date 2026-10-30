// What: Snapshot + a11y tests for RoleBadge
// Why: D20 — the pill is a primitive in the design system, so we pin its
//      classlist + aria attributes here. Variant tests ensure OWNER vs
//      MEMBER both render and that ARIA name reflects the current role.
// Does NOT: Test i18n (no localization yet) or interactive states (none).

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RoleBadge } from './RoleBadge';

describe('RoleBadge', () => {
  it('renders OWNER variant with caption-cap classlist + aria-label', () => {
    const html = renderToStaticMarkup(<RoleBadge role="owner" />);
    expect(html).toContain('>OWNER</span>');
    expect(html).toContain('aria-label="Role: OWNER"');
    expect(html).toContain('uppercase');
    expect(html).toContain('tracking-[0.08em]');
    expect(html).toContain('text-text-secondary');
    expect(html).toContain('role="status"');
  });

  it('renders MEMBER variant', () => {
    const html = renderToStaticMarkup(<RoleBadge role="member" />);
    expect(html).toContain('>MEMBER</span>');
    expect(html).toContain('aria-label="Role: MEMBER"');
  });

  it('forwards className alongside the base classes', () => {
    const html = renderToStaticMarkup(
      <RoleBadge role="member" className="ml-auto" />
    );
    expect(html).toContain('ml-auto');
    expect(html).toContain('uppercase');
  });

  it('forwards arbitrary span props (data-* etc.) for testing hooks', () => {
    const html = renderToStaticMarkup(
      <RoleBadge role="owner" data-testid="role-pill" />
    );
    expect(html).toContain('data-testid="role-pill"');
  });

  it('renders inside a .dark wrapper without changes (theme inherited via tokens)', () => {
    const html = renderToStaticMarkup(
      <div className="dark">
        <RoleBadge role="owner" />
      </div>
    );
    expect(html).toContain('class="dark"');
    expect(html).toContain('bg-surface-2');
  });
});
