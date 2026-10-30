import Foundation
import Supabase

// MARK: — Sync status for UI feedback
enum SyncStatus {
    case online
    case offline
    case syncing
}

// MARK: — Toast data
struct ToastItem {
    let itemName: String
    let storeName: String
}

// MARK: — ListViewModel
@MainActor
final class ListViewModel: ObservableObject {
    @Published var sections: [StoreSectionData] = []
    @Published var isLoading = false
    @Published var syncStatus: SyncStatus = .online
    @Published var showSiriToast = false
    @Published var toastItem: ToastItem?
    @Published var addError: String?
    @Published var generalError: String?

    // Tracks entry IDs known at the time of the last foreground event
    // (used for Siri toast dedup logic)
    private var knownEntryIDsAtBackground: Set<UUID> = []
    private var allEntries: [ListEntry] = []

    private let service = ListService()
    private var realtimeChannel: RealtimeChannelV2?

    var householdId: UUID? {
        AuthService.shared.currentHouseholdId
    }
    var userId: UUID? {
        AuthService.shared.currentUser?.id
    }

    // MARK: — Initial load
    func fetchList() async {
        guard let householdId else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let entries = try await service.fetchEntries(householdId: householdId)
            apply(entries: entries)
        } catch {
            generalError = "Couldn't load list: \(error.localizedDescription)"
        }
    }

    // MARK: — Real-time subscription
    func subscribeRealtime() {
        guard let householdId else { return }
        let client = SupabaseManager.shared.client

        let channel = client.realtimeV2.channel("list_entries:\(householdId)")
        realtimeChannel = channel

        Task {
            do { try await channel.subscribeWithError() } catch {
                syncStatus = .offline
                return
            }
            syncStatus = .online

            // Listen for INSERT / UPDATE / DELETE on list_entries
            for await change in channel.postgresChange(
                AnyAction.self,
                schema: "public",
                table: "list_entries",
                filter: .eq("household_id", value: householdId.uuidString)
            ) {
                // On any change, re-fetch the full list snapshot.
                // Incremental diff would be more efficient, but snapshot-on-change
                // is simpler and avoids ordering/merge bugs with real-time events.
                do {
                    let entries = try await service.fetchEntries(householdId: householdId)
                    apply(entries: entries)
                } catch {
                    // Real-time reconnect — don't surface error for transient issues
                }
                _ = change // suppress unused warning
            }
        }

        // Handle connection drops
        Task {
            for await status in client.realtimeV2.statusChange {
                switch status {
                case .connected:
                    syncStatus = .online
                    // Reconnect → fetch full snapshot
                    if let entries = try? await service.fetchEntries(householdId: householdId) {
                        apply(entries: entries)
                    }
                case .disconnected:
                    syncStatus = .offline
                default:
                    break
                }
            }
        }
    }

    func unsubscribeRealtime() {
        Task {
            await realtimeChannel?.unsubscribe()
            realtimeChannel = nil
        }
    }

    func retrySync() {
        syncStatus = .syncing
        unsubscribeRealtime()
        subscribeRealtime()
    }

    // MARK: — Add item via FAB (typed text → Edge Function)
    func addItem(utterance: String) async {
        print("[addItem] called — householdId=\(householdId?.uuidString ?? "nil"), userId=\(userId?.uuidString ?? "nil")")
        guard let householdId, let userId else {
            print("[addItem] aborting — householdId or userId is nil")
            addError = NSLocalizedString("add.error", comment: "")
            return
        }
        addError = nil

        do {
            let request = AddItemRequest(
                utterance: utterance,
                household_id: householdId,
                candidate_item_id: nil,
                confirmed_store_id: nil,
                confirmed_brand: nil
            )
            print("[addItem] calling Edge Function...")
            let response = try await service.callAddItem(request: request)
            print("[addItem] response: needs_followup=\(response.needs_followup), entry_id=\(response.entry_id?.uuidString ?? "nil"), error=\(response.error ?? "none")")

            if response.needs_followup {
                // Caller (AddItemSheet) handles disambiguation — return response
                // via published property for the sheet to act on
                pendingAddResponse = response
                pendingUtterance = utterance
                return
            }

            guard let itemRef = response.canonical_item,
                  let storeRef = response.store,
                  let entryId = response.entry_id
            else {
                addError = NSLocalizedString("add.error", comment: "")
                return
            }

            // Optimistic local add — list_entries real-time will also arrive shortly
            let optimistic = makeOptimisticEntry(
                id: entryId, itemId: itemRef.id, itemName: itemRef.name,
                storeId: storeRef.id, storeName: storeRef.name,
                brand: response.brand, addedBy: userId
            )
            insertOptimistic(optimistic)

            // Write-back NLP variant to local cache if utterance differs from canonical
            if utterance.lowercased() != itemRef.name.lowercased() {
                LocalCacheManager.shared.writeBackVariant(utterance, for: itemRef.id)
            }
        } catch {
            if case let FunctionsError.httpError(code, data) = error {
                print("[addItem] HTTP \(code): \(String(data: data, encoding: .utf8) ?? "undecodable")")
            } else {
                print("[addItem] error: \(error)")
            }
            addError = NSLocalizedString("add.error", comment: "")
        }
    }

    // Exposed for DisambiguationSheet — re-submit with a confirmed candidate item
    func addItemWithCandidate(utterance: String, candidateItemId: UUID) async {
        guard let householdId, let userId else { return }
        addError = nil
        do {
            let request = AddItemRequest(
                utterance: utterance,
                household_id: householdId,
                candidate_item_id: candidateItemId,
                confirmed_store_id: nil,
                confirmed_brand: nil
            )
            let response = try await service.callAddItem(request: request)
            if response.needs_followup {
                pendingAddResponse = response
                pendingUtterance = utterance
                return
            }
            guard let itemRef = response.canonical_item,
                  let storeRef = response.store,
                  let entryId = response.entry_id
            else {
                addError = NSLocalizedString("add.error", comment: "")
                return
            }
            let optimistic = makeOptimisticEntry(
                id: entryId, itemId: itemRef.id, itemName: itemRef.name,
                storeId: storeRef.id, storeName: storeRef.name,
                brand: response.brand, addedBy: userId
            )
            insertOptimistic(optimistic)
        } catch {
            print("[addItemWithCandidate] error: \(error)")
            addError = NSLocalizedString("add.error", comment: "")
        }
    }

    // Exposed for DisambiguationSheet to call after user resolves follow-up
    func confirmAdd(utterance: String, storeId: UUID, brand: String?, candidateItemId: UUID? = nil) async {
        guard let householdId, let userId else { return }
        addError = nil

        do {
            let request = AddItemRequest(
                utterance: utterance,
                household_id: householdId,
                candidate_item_id: candidateItemId,
                confirmed_store_id: storeId,
                confirmed_brand: brand
            )
            let response = try await service.callAddItem(request: request)
            guard let itemRef = response.canonical_item,
                  let storeRef = response.store,
                  let entryId = response.entry_id
            else {
                addError = NSLocalizedString("add.error", comment: "")
                return
            }
            let optimistic = makeOptimisticEntry(
                id: entryId, itemId: itemRef.id, itemName: itemRef.name,
                storeId: storeRef.id, storeName: storeRef.name,
                brand: response.brand, addedBy: userId
            )
            insertOptimistic(optimistic)
        } catch {
            addError = NSLocalizedString("add.error", comment: "")
        }
    }

    // Published intermediate state for the disambiguation sheet
    @Published var pendingAddResponse: AddItemResponse?
    @Published var pendingUtterance: String?

    // MARK: — Mark as bought
    func markAsBought(entryId: UUID) async {
        // Optimistic: remove immediately
        let removed = removeOptimistic(entryId: entryId)
        do {
            try await service.markBought(entryId: entryId)
        } catch {
            // Rollback
            if let entry = removed { insertOptimistic(entry) }
            generalError = "Couldn't mark as bought. Please try again."
        }
    }

    // MARK: — Delete entry
    func deleteEntry(entryId: UUID) async {
        let removed = removeOptimistic(entryId: entryId)
        do {
            try await service.deleteEntry(id: entryId)
        } catch {
            if let entry = removed { insertOptimistic(entry) }
            generalError = "Couldn't remove item. Please try again."
        }
    }

    // MARK: — Siri toast dedup (called on app foreground)
    func handleForeground() {
        let newIDs = Set(allEntries.map { $0.id })
        let added = newIDs.subtracting(knownEntryIDsAtBackground)

        if added.count == 1, let newId = added.first,
           let entry = allEntries.first(where: { $0.id == newId }) {
            toastItem = ToastItem(
                itemName: entry.item?.name_canonical ?? "item",
                storeName: entry.store?.name ?? "store"
            )
            showSiriToast = true
        }
        // 2+ new items: skip toast, list update is sufficient
        knownEntryIDsAtBackground = newIDs
    }

    func dismissToast() {
        showSiriToast = false
        toastItem = nil
    }

    // MARK: — Private helpers

    private func apply(entries: [ListEntry]) {
        allEntries = entries
        knownEntryIDsAtBackground = Set(entries.map { $0.id })
        sections = groupByStore(entries)
    }

    private func groupByStore(_ entries: [ListEntry]) -> [StoreSectionData] {
        var byStore: [UUID: (name: String, entries: [DisplayEntry])] = [:]
        for entry in entries {
            let storeId = entry.store_id
            let storeName = entry.store?.name ?? "Unknown"
            let display = DisplayEntry(from: entry)
            if byStore[storeId] == nil {
                byStore[storeId] = (storeName, [])
            }
            byStore[storeId]!.entries.append(display)
        }
        return byStore
            .map { StoreSectionData(id: $0.key, storeName: $0.value.name, entries: $0.value.entries) }
            .sorted { $0.storeName < $1.storeName }
    }

    @discardableResult
    private func removeOptimistic(entryId: UUID) -> ListEntry? {
        guard let idx = allEntries.firstIndex(where: { $0.id == entryId }) else { return nil }
        let removed = allEntries.remove(at: idx)
        sections = groupByStore(allEntries)
        return removed
    }

    private func insertOptimistic(_ entry: ListEntry) {
        if !allEntries.contains(where: { $0.id == entry.id }) {
            allEntries.insert(entry, at: 0)
        }
        sections = groupByStore(allEntries)
    }

    private func makeOptimisticEntry(
        id: UUID, itemId: UUID, itemName: String,
        storeId: UUID, storeName: String,
        brand: String?, addedBy: UUID
    ) -> ListEntry {
        var entry = ListEntry(
            id: id,
            household_id: householdId ?? UUID(),
            item_id: itemId,
            store_id: storeId,
            brand: brand,
            quantity: 1,
            unit: nil,
            status: "pending",
            added_by: addedBy,
            added_at: .now
        )
        entry.item = Item(id: itemId, name_canonical: itemName, category: nil, created_at: .now)
        entry.store = Store(id: storeId, name: storeName, online_cart_supported: false)
        entry.added_by_name = AuthService.shared.currentUser.map { _ in "you" } ?? "you"
        return entry
    }
}
