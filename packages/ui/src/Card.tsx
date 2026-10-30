// What: Surface container styled with the default radius and border tokens
// Why: Most UI lives on cards (list rows, sheets, item detail); shared shell
// Does NOT: Control layout inside the card — caller's responsibility

import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** Surface card using surface + border + default radius tokens. */
export function Card({ className = '', children, ...rest }: CardProps) {
  return (
    <div
      className={`rounded-default border border-border bg-surface p-md ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
