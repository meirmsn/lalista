// What: Snapshot tests for Card
// Why: Guards the surface/border/radius token classes
// Does NOT: Test interactivity — Card is presentational

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card } from './Card';

describe('Card', () => {
  it('renders with surface, border, and default radius', () => {
    const html = renderToStaticMarkup(<Card>Hello</Card>);
    expect(html).toContain('bg-surface');
    expect(html).toContain('border-border');
    expect(html).toContain('rounded-default');
    expect(html).toContain('Hello');
  });

  it('merges caller className after token classes', () => {
    const html = renderToStaticMarkup(<Card className="mt-lg">content</Card>);
    expect(html).toContain('mt-lg');
  });

  it('works inside .dark container', () => {
    const html = renderToStaticMarkup(
      <div className="dark">
        <Card>dark card</Card>
      </div>
    );
    expect(html).toContain('class="dark"');
    expect(html).toContain('dark card');
  });
});
