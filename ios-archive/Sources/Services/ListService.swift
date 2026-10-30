import Foundation
import Supabase

// MARK: — ListService
// Raw Supabase calls for list_entries. ViewModel uses this for clean separation.

struct ListService {
    private let supabase = SupabaseManager.shared.client

    // Fetch all pending entries for a household, joined with item + store names.
    func fetchEntries(householdId: UUID) async throws -> [ListEntry] {
        // Supabase select with foreign table joins
        let entries: [ListEntry] = try await supabase
            .from("list_entries")
            .select("""
                id, household_id, item_id, store_id, brand, quantity, unit, status, added_by, added_at,
                item:items(id, name_canonical, category, created_at),
                store:stores(id, name, online_cart_supported)
            """)
            .eq("household_id", value: householdId.uuidString)
            .eq("status", value: "pending")
            .order("added_at", ascending: false)
            .execute()
            .value
        return entries
    }

    // Insert a new list entry (optimistic — caller adds to UI first).
    func insertEntry(householdId: UUID, itemId: UUID, storeId: UUID,
                     brand: String?, quantity: Int, addedBy: UUID) async throws -> ListEntry {
        struct InsertPayload: Encodable {
            let household_id: String
            let item_id: String
            let store_id: String
            let brand: String?
            let quantity: Int
            let status: String
            let added_by: String
        }
        let payload = InsertPayload(
            household_id: householdId.uuidString,
            item_id: itemId.uuidString,
            store_id: storeId.uuidString,
            brand: brand,
            quantity: quantity,
            status: "pending",
            added_by: addedBy.uuidString
        )
        let entry: ListEntry = try await supabase
            .from("list_entries")
            .insert(payload)
            .select("""
                id, household_id, item_id, store_id, brand, quantity, unit, status, added_by, added_at,
                item:items(id, name_canonical, category, created_at),
                store:stores(id, name, online_cart_supported)
            """)
            .single()
            .execute()
            .value
        return entry
    }

    // Delete a list entry (any household member can remove).
    func deleteEntry(id: UUID) async throws {
        try await supabase
            .from("list_entries")
            .delete()
            .eq("id", value: id.uuidString)
            .execute()
    }

    // Mark item as bought — atomic RPC.
    func markBought(entryId: UUID) async throws {
        try await supabase
            .rpc("mark_item_bought", params: ["p_entry_id": entryId.uuidString])
            .execute()
    }

    // Call the add-item Edge Function.
    func callAddItem(request: AddItemRequest) async throws -> AddItemResponse {
        let session = try await supabase.auth.session
        let response: AddItemResponse = try await supabase.functions
            .invoke("add-item", options: .init(
                headers: ["Authorization": "Bearer \(session.accessToken)"],
                body: request
            ))
        return response
    }

    // Fetch purchase history for an item.
    func fetchPurchaseHistory(itemId: UUID, householdId: UUID, limit: Int = 10) async throws -> [PurchaseHistory] {
        let history: [PurchaseHistory] = try await supabase
            .from("purchase_history")
            .select("""
                id, household_id, item_id, store_id, brand, bought_at, added_by,
                store:stores(id, name, online_cart_supported)
            """)
            .eq("household_id", value: householdId.uuidString)
            .eq("item_id", value: itemId.uuidString)
            .order("bought_at", ascending: false)
            .limit(limit)
            .execute()
            .value
        return history
    }
}
