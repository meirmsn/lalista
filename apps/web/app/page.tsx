// What: Root route — public landing for unauth, RSC redirect to /list for authed
// Why: D7 of `specs/core-flows/spec.md` — unauth visitors see a landing screen
//      (first-impression matters); authed users skip it server-side to avoid
//      a flash of marketing content before their list loads
// Does NOT: Query the database for household state; the /onboarding gate does
//           that when the user arrives there from /list if they have none

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PublicLanding } from '@/components/PublicLanding';

/** Root route — server component. If authed, redirect; else render landing. */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/list');
  }

  return <PublicLanding />;
}
