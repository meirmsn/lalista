# lalista

Zero-friction grocery management for bilingual families. Voice-first, Spanglish-native, household multi-user. Built with Swift/SwiftUI + Supabase + Claude API.

## Getting Started

### Prerequisites

- Xcode 15+
- XcodeGen (`brew install xcodegen`)
- Supabase project (free tier works for v0)
- Anthropic API key (for the Edge Function)

### 1. Clone & generate Xcode project

```bash
cd ios
xcodegen generate
open lalista.xcodeproj
```

### 2. Configure secrets

Copy the example xcconfig and fill in your values:

```bash
cp Config.xcconfig.example Config.xcconfig
```

Edit `Config.xcconfig`:

```
SUPABASE_URL = https:/$()/your-project.supabase.co
SUPABASE_ANON_KEY = your-anon-key
```

> **Note**: Use `https:/$()/` instead of `https://` — xcconfig treats `//` as a comment.

Then in Xcode: Project → Info → Configurations → add `Config.xcconfig` to Debug and Release.

### 3. Set up Supabase

Run these from the **repo root** (where `supabase/` lives):

```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Link to your project
supabase link --project-ref your-project-ref

# Run migrations
supabase db push

# Deploy Edge Function
supabase functions deploy add-item --no-verify-jwt
```

Set the Edge Function secret:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

### 4. Configure Xcode signing

In `project.yml`, set `DEVELOPMENT_TEAM` to your Apple Developer Team ID. Then run `xcodegen generate` again.

### 5. App Group setup

The App Group `group.com.lalista.shared` must be registered in your Apple Developer account and added to both the main app and App Intent extension targets (already configured in entitlements files).

## Architecture

```
ios/
  Sources/            Swift/SwiftUI main app (target: lalista)
  Intents/            App Intent extension / Siri (target: lalistaIntents)
  Tests/              Snapshot + unit tests (target: lalistaTests)
supabase/
  migrations/         SQL schema + DB functions
  functions/add-item/ Deno Edge Function (NLP + routing + dedup)
```

See [DESIGN.md](../DESIGN.md) for the full design system.
See [.gstack/projects/](../.gstack/projects/) for the eng review + test plan.
