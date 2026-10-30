// What: Text input with focus ring and error state
// Why: Sign-in, household name, add-item text all need a consistent input
// Does NOT: Control label/placeholder copy or wrap a form — caller owns structure

import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

/** Base text input; pass `error` to switch to the error border + ring. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = '', error = false, ...props },
  ref
) {
  const borderClass = error
    ? 'border-error focus:ring-error'
    : 'border-border focus:ring-primary';
  return (
    <input
      ref={ref}
      className={`rounded-sm border bg-surface px-md py-sm font-body text-[16px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 ${borderClass} ${className}`}
      {...props}
    />
  );
});
