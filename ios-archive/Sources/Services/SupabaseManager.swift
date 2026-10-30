import Foundation
import Supabase

// MARK: — SupabaseManager
// Single shared SupabaseClient, configured with the App Group keychain so the
// App Intent extension can silently refresh tokens without launching the main app.
//
// Both targets (lalista + lalistaIntents) instantiate the client identically
// using this same configuration pattern.

final class SupabaseManager {
    static let shared = SupabaseManager()

    let client: SupabaseClient

    private init() {
        let rawURL = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String
        let rawKey = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_ANON_KEY") as? String
        print("[SupabaseManager] SUPABASE_URL = \(rawURL ?? "nil")")
        print("[SupabaseManager] SUPABASE_ANON_KEY present = \(rawKey != nil)")

        guard
            let urlString = rawURL,
            let url = URL(string: urlString),
            url.host != nil,
            let anonKey = rawKey
        else {
            fatalError(
                "SUPABASE_URL and SUPABASE_ANON_KEY must be set in Info.plist via Config.xcconfig. " +
                "SUPABASE_URL=\(rawURL ?? "nil"). " +
                "See README.md for setup instructions."
            )
        }

        client = SupabaseClient(
            supabaseURL: url,
            supabaseKey: anonKey,
            options: SupabaseClientOptions(
                auth: SupabaseClientOptions.AuthOptions(
                    // Shared keychain group → extension can silently refresh tokens.
                    // Without this, tokens expire after ~1h and Siri adds silently fail.
                    storageKey: "group.com.lalista.shared",
                    emitLocalSessionAsInitialSession: true
                )
            )
        )
    }
}

// Convenience accessor
extension SupabaseManager {
    var auth: AuthClient { client.auth }
    var realtime: RealtimeClientV2 { client.realtimeV2 }
    var functions: FunctionsClient { client.functions }
}
