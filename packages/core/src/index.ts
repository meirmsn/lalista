// What: Barrel export for @lalista/core
// Why: Single entry point for the core package
// Does NOT: Contain logic — re-exports only

export { createClient, assertNotProdUrlInTestEnv } from './supabase';
export type { CoreConfig } from './supabase';
export type { Database } from './supabase.types';

export * from './models';
export * from './errors';
export {
  AddItemResponseSchema,
  DisambiguationCandidateSchema,
} from './schemas/addItem';

export * from './api/auth';
export * from './api/households';
export * from './api/items';
export * from './api/profiles';
export * from './api/stores';
export * from './api/addItem';
export * from './api/realtime';
export * from './api/inviteErrors';
export * from './api/storeErrors';
export * from './api/invitations';
export * from './api/members';
export * from './api/audit';
