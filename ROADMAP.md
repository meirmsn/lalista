# Roadmap

What the owner decided will happen, in their words. The table's order is the priority: the top
`Open` entry is next. What Claude noticed but nobody decided is in `FINDINGS.md`.

| ID  | Added      | What                                                       | Status |
| --- | ---------- | ---------------------------------------------------------- | ------ |
| R-1 | 2026-11-09 | Sign in with Apple                                         | Open   |
| R-2 | 2026-11-09 | Rename how an item shows in your list                      | Open   |
| R-3 | 2026-11-09 | A "pick your stores" step in onboarding                    | Open   |
| R-4 | 2026-11-09 | Invitees set their name before they reach the list         | Open   |
| R-5 | 2026-11-09 | Correct an item that was matched wrong, after it was added | Open   |

The five came from the v1-era `TODOS.md` (deleted in PR #15; its full text, with each item's
design notes, is in git history under the slugs named below). Asked 2026-11-09, in chat, which of
its product features go on the roadmap, the owner answered for all five:

```text
go to roadmap
```

## R-1: Sign in with Apple

Asked 2026-11-09, in chat: see the answer above.

### Claude's notes

`TODOS.md` slug `apple-sso`: replaces the commented stub in `apps/web/app/(auth)/sign-in/page.tsx`.
Needs a paid Apple Developer account, a Service ID, domain verification and the Supabase Apple
provider. Native iOS notes that share the same Apple set-up are in `ios-archive/RESUME.md`.

## R-2: Rename how an item shows in your list

Asked 2026-11-09, in chat: see the answer above.

### Claude's notes

`TODOS.md` slug `item-display-name-editing`: a per-entry display name, so the shared catalog name
(used for matching) stays unchanged for every household. Covers the README's "Items can't be edited
after adding".

## R-3: A "pick your stores" step in onboarding

Asked 2026-11-09, in chat: see the answer above.

### Claude's notes

`TODOS.md` slug `onboarding-pick-your-stores-step`: first-time users choose their My Stores before
landing on `/list`; invitees skip it, since their household's owner already chose.

## R-4: Invitees set their name before they reach the list

Asked 2026-11-09, in chat: see the answer above.

### Claude's notes

`TODOS.md` slug `join-redirect-to-onboarding-for-name-only-flow`: after accepting an invite at
`/join/[token]`, a name-only onboarding step, then the list.

## R-5: Correct an item that was matched wrong, after it was added

Asked 2026-11-09, in chat: see the answer above.

### Claude's notes

`TODOS.md` slug `wrong-item-correction-flow`: a "Wrong item?" action on a list row removes the
entry and reopens the add sheet with what was typed. Covers the README's "Items can't be edited
after adding" together with R-2.
