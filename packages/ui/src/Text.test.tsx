// What: Snapshot tests for Text variants
// Why: Guards the semantic type scale from DESIGN.md
// Does NOT: Test font loading — that's handled by next/font in apps/web

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Text } from './Text';

describe('Text', () => {
  it('defaults to body + span', () => {
    const html = renderToStaticMarkup(<Text>say leche.</Text>);
    expect(html).toMatch(/^<span /);
    expect(html).toContain('font-body');
    expect(html).toContain('text-[15px]');
  });

  it('applies the display variant on an h1', () => {
    const html = renderToStaticMarkup(
      <Text variant="display" as="h1">
        lalista
      </Text>
    );
    expect(html).toMatch(/^<h1 /);
    expect(html).toContain('font-display');
    expect(html).toContain('text-[56px]');
  });

  it('applies micro uppercase for store labels', () => {
    const html = renderToStaticMarkup(<Text variant="micro">Whole Foods</Text>);
    expect(html).toContain('uppercase');
    expect(html).toContain('text-[11px]');
  });

  it('renders inside .dark container (markup parity)', () => {
    const html = renderToStaticMarkup(
      <div className="dark">
        <Text>dark mode</Text>
      </div>
    );
    expect(html).toContain('class="dark"');
    expect(html).toContain('dark mode');
  });
});
