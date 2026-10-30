// What: OpenNext's Cloudflare adapter config (`pnpm build:worker` reads it)
// Why: no overrides — the app renders dynamically (no ISR, no `next/image`), so the
//   default in-memory cache is enough and no R2 bucket is needed
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig({});
