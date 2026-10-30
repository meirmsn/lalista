// What: Typed Text component rendering the semantic type scale from DESIGN.md
// Why: Centralizes the scale so screens pick a variant name rather than px values
// Does NOT: Handle truncation, rich-text, or inline styles — callers add className

import type { HTMLAttributes, ReactNode } from 'react';

type Variant =
  | 'display'
  | 'display-italic'
  | 'heading-lg'
  | 'heading-md'
  | 'body-lg'
  | 'body'
  | 'caption'
  | 'micro';

const variantClass: Record<Variant, string> = {
  display: 'font-display text-[56px] font-normal leading-[1.1]',
  'display-italic': 'font-display italic text-[36px] font-light leading-[1.2]',
  'heading-lg': 'font-body text-[28px] font-semibold leading-[1.2]',
  'heading-md': 'font-body text-[22px] font-semibold leading-[1.3]',
  'body-lg': 'font-body text-[17px] font-normal leading-[1.5]',
  body: 'font-body text-[15px] font-normal leading-[1.5]',
  caption: 'font-body text-[13px] font-normal leading-[1.4]',
  micro: 'font-body text-[11px] font-semibold uppercase leading-[1.3]',
};

export interface TextProps extends HTMLAttributes<HTMLElement> {
  variant?: Variant;
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'label' | 'div';
  children: ReactNode;
}

/** Render text at a semantic variant. Defaults to `body` + `<span>`. */
export function Text({
  variant = 'body',
  as: As = 'span',
  className = '',
  children,
  ...rest
}: TextProps) {
  return (
    <As className={`${variantClass[variant]} ${className}`} {...rest}>
      {children}
    </As>
  );
}
