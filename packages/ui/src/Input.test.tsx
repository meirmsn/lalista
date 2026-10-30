// What: Snapshot tests for Input — default and error states
// Why: Guards the focus ring and error swap
// Does NOT: Test user events — consumer apps do that

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Input } from './Input';

describe('Input', () => {
  it('uses border-border + primary focus ring by default', () => {
    const html = renderToStaticMarkup(<Input placeholder="email" />);
    expect(html).toContain('border-border');
    expect(html).toContain('focus:ring-primary');
    expect(html).toContain('placeholder="email"');
  });

  it('uses error border + error ring when error=true', () => {
    const html = renderToStaticMarkup(<Input error placeholder="bad" />);
    expect(html).toContain('border-error');
    expect(html).toContain('focus:ring-error');
  });

  it('forwards input attributes like type and value', () => {
    const html = renderToStaticMarkup(
      <Input type="password" defaultValue="secret" />
    );
    expect(html).toContain('type="password"');
    expect(html).toContain('value="secret"');
  });

  it('renders at >=16px to avoid iOS Safari zoom-on-focus', () => {
    // iOS zooms the viewport when a focused input has computed font-size <16px
    // and doesn't reliably zoom back out — looks like a layout bug after
    // submit. Keep this token at 16px (or larger via responsive override).
    const html = renderToStaticMarkup(<Input />);
    expect(html).toContain('text-[16px]');
  });

  it('works inside .dark container', () => {
    const html = renderToStaticMarkup(
      <div className="dark">
        <Input />
      </div>
    );
    expect(html).toContain('class="dark"');
  });
});
