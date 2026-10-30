// What: Proof-of-concept Button using theme tokens via Tailwind classes
// Why: Validates workspace linking and token-driven theming
// Does NOT: Cover all button variants — feature components are built during /build

import type { ButtonHTMLAttributes } from 'react';

/** A basic button styled with theme tokens. */
export function Button({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`min-h-[44px] rounded-default bg-primary px-md py-sm font-body text-[15px] font-medium text-white transition-colors duration-[var(--duration-short)] hover:bg-primary-pressed active:bg-primary-pressed disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
