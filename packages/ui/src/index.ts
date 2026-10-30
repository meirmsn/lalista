// What: Barrel export for @lalista/ui
// Why: Single entry point for all UI package exports
// Does NOT: Contain logic — re-exports only

export { Button } from './Button';
export { useSubmitFeedback } from './useSubmitFeedback';
export type {
  UseSubmitFeedbackOptions,
  UseSubmitFeedbackResult,
} from './useSubmitFeedback';
export { SubmitButton } from './SubmitButton';
export type { SubmitButtonProps } from './SubmitButton';
export { LoadingArea } from './LoadingArea';
export type { LoadingAreaProps } from './LoadingArea';
export { useOptimisticMutation } from './useOptimisticMutation';
export type {
  BannerState,
  OptimisticFailureMode,
  OptimisticMutationConfig,
  OptimisticMutationResult,
} from './useOptimisticMutation';
export { Text } from './Text';
export type { TextProps } from './Text';
export { Card } from './Card';
export type { CardProps } from './Card';
export { Input } from './Input';
export type { InputProps } from './Input';
export { Divider } from './Divider';
export type { DividerProps } from './Divider';
export { RoleBadge } from './RoleBadge';
export type { RoleBadgeProps } from './RoleBadge';
export { StorePicker } from './StorePicker';
export type {
  StorePickerProps,
  StorePickerMode,
  PickerStore,
} from './StorePicker';
export * from './tokens';
