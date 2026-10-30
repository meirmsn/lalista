import AppIntents
import Foundation
import Supabase
import SwiftData

// MARK: — AddItemIntent
// Siri invocation: "Add [item] to lalista"
// Voice flow per design spec:
//   1. Local SwiftData cache fast path (offline-capable, trigram similarity)
//   2. Single add-item Edge Function call if cache miss / low confidence
//   3. Follow-up dialog if needs_followup (store, brand)
//   4. Write list_entries via Edge Function
//   5. Write-back NLP variant to local cache on success

struct AddItemIntent: AppIntent {
    static var title: LocalizedStringResource = "Add item to lalista"
    static var description = IntentDescription("Add a grocery item to your lalista.")

    // Siri's natural language parameter — extracted from "add [milk] to lalista"
    @Parameter(title: "Item", description: "What do you want to add?")
    var item: String

    // Optional follow-up parameter populated by Siri dialog
    @Parameter(title: "Store", description: "Which store?", optionsProvider: StoreOptionsProvider())
    var confirmedStore: StoreEntity?

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$item) to lalista")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let cacheManager = LocalCacheManager.shared
        let supabase = IntentSupabaseManager.shared.client

        // MARK: — Auth guard
        guard let session = try? await supabase.auth.session else {
            return .result(
                dialog: IntentDialog(
                    NSLocalizedString("siri.reconnect", comment: "")
                )
            )
        }
        let userId = session.user.id

        // Fetch household
        guard let householdId = await fetchHouseholdId(supabase: supabase, userId: userId) else {
            return .result(dialog: IntentDialog(NSLocalizedString("siri.error", comment: "")))
        }

        // Fetch thresholds
        let (itemThreshold, storeThreshold) = await fetchThresholds(supabase: supabase)

        let utterance = item.trimmingCharacters(in: .whitespaces)

        // MARK: — Fast path: local SwiftData cache trigram match
        var candidateItemId: UUID? = nil
        var fastPathConfidence: Double = 0

        if let cached = cacheManager.findItem(for: utterance, threshold: itemThreshold) {
            candidateItemId = cached.item.id
            fastPathConfidence = cached.confidence
        }

        // MARK: — Build add-item request
        var storeId: UUID? = confirmedStore.map { UUID(uuidString: $0.id) ?? UUID() }

        let request = AddItemRequest(
            utterance: utterance,
            household_id: householdId,
            candidate_item_id: candidateItemId,
            confirmed_store_id: storeId,
            confirmed_brand: nil
        )

        // MARK: — Single Edge Function call
        let response: AddItemResponse
        do {
            response = try await supabase.functions
                .invoke("add-item", options: .init(body: request))
        } catch {
            // Timeout or network error — inform user, never silent fail
            return .result(dialog: IntentDialog(NSLocalizedString("siri.error", comment: "")))
        }

        // MARK: — Handle needs_followup: ask store
        if response.needs_followup {
            if response.already_on_list == true,
               let storeName = response.store?.name,
               let itemName = response.canonical_item?.name {
                return .result(
                    dialog: IntentDialog(
                        String(format: NSLocalizedString("siri.already_on_list", comment: ""), storeName)
                    )
                )
            }

            if response.followup_type == .store {
                // Trigger Siri follow-up: "Which store?"
                // We request the confirmedStore parameter with the available options
                let storeOptions = response.followup_options ?? []
                throw $confirmedStore.requestValue(
                    IntentDialog(response.followup_question ?? "Which store?")
                )
            }

            // Other follow-up types: return a dialog
            return .result(
                dialog: IntentDialog(response.followup_question ?? NSLocalizedString("siri.error", comment: ""))
            )
        }

        guard let itemRef = response.canonical_item,
              let storeRef = response.store
        else {
            return .result(dialog: IntentDialog(NSLocalizedString("siri.error", comment: "")))
        }

        // MARK: — Write-back NLP variant to local cache (non-blocking, best-effort)
        if utterance.lowercased() != itemRef.name.lowercased() {
            do {
                try await Task {
                    await cacheManager.writeBackVariant(utterance, for: itemRef.id)
                }.value
            } catch {
                // write-back failure is acceptable — log and continue
                print("[AddItemIntent] Cache write-back failed: \(error)")
            }
        }

        // MARK: — Trigger incremental cache refresh in background
        Task.detached(priority: .background) {
            await cacheManager.refreshFromSupabase(supabase: IntentSupabaseManager.shared.client,
                                                    householdId: householdId)
        }

        // MARK: — Success response
        let successMessage = String(
            format: NSLocalizedString("siri.added", comment: ""),
            itemRef.name,
            storeRef.name
        )
        return .result(dialog: IntentDialog(successMessage))
    }

    // MARK: — Helpers

    private func fetchHouseholdId(supabase: SupabaseClient, userId: UUID) async -> UUID? {
        struct Row: Decodable { let household_id: UUID }
        let rows: [Row]? = try? await supabase
            .from("household_members")
            .select("household_id")
            .eq("user_id", value: userId.uuidString)
            .limit(1)
            .execute()
            .value
        return rows?.first?.household_id
    }

    private func fetchThresholds(supabase: SupabaseClient) async -> (item: Double, store: Double) {
        struct ConfigRow: Decodable { let key: String; let value: String }
        let rows: [ConfigRow]? = try? await supabase
            .from("config")
            .select("key, value")
            .execute()
            .value
        var item = 0.85, store = 0.70
        for row in rows ?? [] {
            switch row.key {
            case "item_match_threshold":    item  = Double(row.value) ?? item
            case "store_routing_threshold": store = Double(row.value) ?? store
            default: break
            }
        }
        return (item, store)
    }
}

// MARK: — StoreEntity (for Siri parameter options)
struct StoreEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Store"
    static var defaultQuery = StoreEntityQuery()

    var id: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
    var name: String
}

struct StoreEntityQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [StoreEntity] {
        let supabase = IntentSupabaseManager.shared.client
        let stores: [Store] = try await supabase
            .from("stores")
            .select()
            .in("id", values: identifiers)
            .execute()
            .value
        return stores.map { StoreEntity(id: $0.id.uuidString, name: $0.name) }
    }

    func suggestedEntities() async throws -> [StoreEntity] {
        let supabase = IntentSupabaseManager.shared.client
        let stores: [Store] = try await supabase
            .from("stores")
            .select()
            .order("name")
            .execute()
            .value
        return stores.map { StoreEntity(id: $0.id.uuidString, name: $0.name) }
    }
}

struct StoreOptionsProvider: DynamicOptionsProvider {
    func results() async throws -> [StoreEntity] {
        try await StoreEntityQuery().suggestedEntities()
    }
}

// MARK: — Supabase client for the extension (same App Group keychain as main app)
final class IntentSupabaseManager {
    static let shared = IntentSupabaseManager()

    let client: SupabaseClient

    private init() {
        guard
            let urlString = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String,
            let url = URL(string: urlString),
            let anonKey = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_ANON_KEY") as? String
        else {
            fatalError("SUPABASE_URL and SUPABASE_ANON_KEY missing from extension Info.plist")
        }
        client = SupabaseClient(
            supabaseURL: url,
            supabaseKey: anonKey,
            options: SupabaseClientOptions(
                auth: AuthClientOptions(
                    // Same App Group keychain as main app — enables silent token refresh
                    storageKey: "group.com.lalista.shared",
                    emitLocalSessionAsInitialSession: true
                )
            )
        )
    }
}

// MARK: — LocalCacheManager extension for intent-triggered refresh
extension LocalCacheManager {
    func refreshFromSupabase(supabase: SupabaseClient, householdId: UUID) async {
        guard let items: [Item] = try? await supabase
            .from("items")
            .select("id, name_canonical, category, created_at")
            .execute()
            .value
        else { return }

        await MainActor.run {
            refreshItems(from: items.map { (id: $0.id, name: $0.name_canonical, variants: []) })
        }
    }
}
