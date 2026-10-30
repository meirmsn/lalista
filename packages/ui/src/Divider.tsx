// What: 1px horizontal divider using the border token
// Why: Consistent separator across list groups and section breaks
// Does NOT: Support vertical orientation (not needed in v0)

import type { HTMLAttributes } from 'react';

export type DividerProps = HTMLAttributes<HTMLHRElement>;

/** Horizontal hairline divider. */
export function Divider({ className = '', ...props }: DividerProps) {
  return (
    <hr
      className={`border-t border-border ${className}`}
      aria-hidden="true"
      {...props}
    />
  );
}
