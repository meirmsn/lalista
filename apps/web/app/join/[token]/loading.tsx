// What: Tier C loading skeleton for /join/[token].
// Why: The route does a session check + RPC roundtrip; without a loading
//      skeleton the user sees a blank frame on tap-through. Tier C
//      framework (CLAUDE.md § Latency feedback tiers).
// Does NOT: Render anything else — the actual states ship after page.tsx
//           resolves.

import { LoadingArea } from '@lalista/ui';

/** Tier C placeholder — paints the page chrome + a pulsing block. */
export default function JoinLoading() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-md p-xl min-h-screen">
      <LoadingArea
        label="Loading invite"
        className="h-[120px] w-full max-w-[24rem]"
      />
    </main>
  );
}
