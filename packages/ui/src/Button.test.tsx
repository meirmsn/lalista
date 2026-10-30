// What: Snapshot tests for Button — light + dark
// Why: Prevent regressions in the token-driven class output
// Does NOT: Exercise click handlers (covered by consumer app tests)

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from './Button';

describe('Button', () => {
  it('renders its label with token-based styling (light)', () => {
    const html = renderToStaticMarkup(<Button>Get started</Button>);
    expect(html).toMatchInlineSnapshot(
      `"<button class="min-h-[44px] rounded-default bg-primary px-md py-sm font-body text-[15px] font-medium text-white transition-colors duration-[var(--duration-short)] hover:bg-primary-pressed active:bg-primary-pressed disabled:opacity-50 disabled:cursor-not-allowed ">Get started</button>"`
    );
  });

  it('renders inside a .dark wrapper (dark mode markup parity)', () => {
    const html = renderToStaticMarkup(
      <div className="dark">
        <Button>Get started</Button>
      </div>
    );
    expect(html).toContain('class="dark"');
    expect(html).toContain('bg-primary');
    expect(html).toContain('Get started');
  });

  it('forwards className and type', () => {
    const html = renderToStaticMarkup(
      <Button type="submit" className="w-full">
        Submit
      </Button>
    );
    expect(html).toContain('type="submit"');
    expect(html).toContain('w-full');
  });
});
