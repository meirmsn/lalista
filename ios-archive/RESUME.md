# Resuming native iOS

<!-- Moved from TODOS.md (devshop v3 move, specs/devshop-v3.md): kept with the archived app it is about. "apple-sso" is now a roadmap question for the owner. -->

**What:** Consolidated knowledge we've already figured out about native iOS — preserved here so the discoveries aren't lost when `ios-archive/` revives.

**Why:** The Swift app is archived but not dead; we expect native dev to resume. Several concrete decisions and setup steps were made during the Swift era and during subsequent reviews. Losing this context would cost a few days of re-discovery when native work restarts.

---

**Apple infrastructure (shared with web `apple-sso`):**

- The paid Apple Developer Program enrollment ($99/yr) serves both web Sign in with Apple **and** native iOS signing — do not re-enroll. The Service ID and domain registration are done once for web; native iOS uses the same developer account for provisioning profiles, entitlements, and Sign in with Apple `ASAuthorizationAppleIDProvider`.
- `ios-archive/ios/Sources/` contains prior SIWA wiring using `ASAuthorizationAppleIDProvider`. Port after the web `apple-sso` (v1) lands so the Supabase Apple provider is already configured.

---

**App Groups entitlement:**

Register the `group.com.lalista.shared` App Group in the Apple Developer portal and enable it in both the `lalista` and `lalistaIntents` Xcode targets so the Intents extension shares the SwiftData cache with the main app.

**Why needed:** App Groups requires the paid Apple Developer account. With a personal team, `LocalCacheManager` falls back to the app's own Application Support directory — which works for the main app but means the Intents extension has its own isolated cache and can't see the main app's data.

**How (when resuming):**

1. In Apple Developer portal → Identifiers → register App Group `group.com.lalista.shared`
2. Enable App Groups on both `com.lalista.app` and `com.lalista.app.intents` App IDs
3. Set `DEVELOPMENT_TEAM = <your-team-id>` in `ios/Config.xcconfig`
4. Re-run `xcodegen generate` in `ios/`
5. In Xcode → `lalista` target → Signing & Capabilities → **+ Capability** → App Groups → add `group.com.lalista.shared`. Repeat for `lalistaIntents`
6. Xcode auto-generates updated provisioning profiles

The entitlements files (`ios/Sources/lalista.entitlements` and `ios/Intents/lalistaIntents.entitlements`) already declare the App Group. The fallback in `LocalCacheManager.storeURL` automatically stops being used once the entitlement is active — no code change needed.

---

**Animation performance baseline:**

Run Instruments (Core Animation) on the mark-as-bought spring animation on the oldest supported iOS device (iPhone SE 2nd gen or equivalent) with 15–20 items in the list.

**Why:** The mark-as-bought animation (spring damping 0.7, crossstrike + row removal) is on the critical path of the "magic moment" and runs hundreds of times. On older devices with complex list rendering it may drop below 60fps. If so, switch to ease-out before shipping native.

**How:**

1. Build the app with 20 items across 2 stores
2. Open Instruments → Core Animation instrument → profile on oldest supported device
3. Trigger mark-as-bought 10 times while profiling
4. If avg frame rate < 55fps: switch `withAnimation(.spring(dampingFraction: 0.7))` to `withAnimation(.easeOut(duration: 0.2))`
5. The crossstrike animation can always stay — simple opacity/strikethrough, not a spring

---

**Dark mode color asset audit (iOS-specific):**

After implementing `Assets.xcassets` color sets, write an XCTest that enumerates every color token defined in DESIGN.md and verifies each has a valid named entry with both light and dark appearances.

**Why:** SwiftUI renders missing named colors as transparent — no error, no warning, no crash. A typo in a color asset name creates invisible text or transparent backgrounds that are only caught visually.

**How:**

```swift
let requiredColors = [
  "backgroundPrimary", "backgroundSurface", "backgroundSurface2",
  "textPrimary", "textSecondary", "textTertiary",
  "accentPrimary", "accentPrimaryDark", "accentPrimarySoft",
  "borderDefault", "successColor", "warningColor", "errorColor", "infoColor"
]
for name in requiredColors {
  XCTAssertNotNil(UIColor(named: name),
    "Missing color asset: \(name) — will render transparent in app")
}
```

All SwiftUI views should use `Color("tokenName")` referencing DESIGN.md tokens. Run the test once after initial asset setup and any time DESIGN.md tokens change. ~20 minutes to write.

---

**VoiceOver audit (iOS-specific):**

Audit native flows with VoiceOver on a physical device (Settings → Accessibility → VoiceOver). Apple App Store review sometimes flags accessibility regressions, and a11y specs written in a plan don't catch implementation gaps — only a live screen reader test does.

1. Navigate through the list view — verify each row reads: `"{item name}, {brand}, {store}, added by {name}"`
2. Perform swipe-to-complete: verify `accessibilityCustomAction` "Mark as bought" is announced
3. Perform swipe-to-delete: verify `accessibilityCustomAction` "Remove from list" is announced
4. Tap FAB → verify bottom sheet is navigable (focus moves into sheet, dismiss works)
5. Add via Siri → verify `accessibilityAnnouncement` fires for toast even without visual focus
6. Navigate to Settings → verify section headers are announced as `.header` trait

a11y specs live under DESIGN.md § "Accessibility & Responsive Specs" in the Swift-era design doc (still in `ios-archive/`).

---

**Depends on:** Decision to resume native iOS development.
