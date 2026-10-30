// What: Snapshot test for Divider
// Why: Guards the border-border token class
// Does NOT: Test vertical orientation — not supported in v0

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Divider } from './Divider';

describe('Divider', () => {
  it('renders a styled <hr> with border-border', () => {
    const html = renderToStaticMarkup(<Divider />);
    expect(html).toContain('<hr');
    expect(html).toContain('border-border');
    expect(html).toContain('aria-hidden="true"');
  });

  it('merges className from caller', () => {
    const html = renderToStaticMarkup(<Divider className="my-lg" />);
    expect(html).toContain('my-lg');
  });

  it('works inside .dark container', () => {
    const html = renderToStaticMarkup(
      <div className="dark">
        <Divider />
      </div>
    );
    expect(html).toContain('class="dark"');
  });
});
