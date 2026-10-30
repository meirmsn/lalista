// What: Inline error renderer shared across auth screens — same DOM shape and
//       class for client-side validation errors and server-side errors so the
//       transition between them never visually flashes.
// Why: Mixing an inline <p role="alert"> for client errors and a different
//      shape for server errors causes a jarring re-flow when the user
//      submits an invalid form. One component, one look, one DOM location.
// Does NOT: Translate raw Supabase errors — caller pipes through
//           friendlyAuthError() before passing here. Renders nothing when
//           error is null (cheaper than empty DOM).

import { Text } from '@lalista/ui';

interface AuthErrorDisplayProps {
  /** The error message to render. null → renders nothing. */
  error: string | null;
}

/** Inline auth error — text-error caption with role="alert". */
export function AuthErrorDisplay({ error }: AuthErrorDisplayProps) {
  if (!error) return null;
  return (
    <Text as="p" variant="caption" className="text-error" role="alert">
      {error}
    </Text>
  );
}
