import Foundation

// MARK: — Supabase DTOs
// Codable structs matching the Supabase schema column names.

struct User: Codable, Identifiable {
    let id: UUID
    let email: String?
}

struct Household: Codable, Identifiable {
    let id: UUID
    let name: String
    let created_at: Date
}

struct HouseholdMember: Codable {
    let household_id: UUID
    let user_id: UUID
    let role: MemberRole
    let joined_at: Date

    // Display name is fetched separately from auth.users metadata
    var display_name: String?

    enum MemberRole: String, Codable {
        case owner, member
    }
}

struct Store: Codable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let online_cart_supported: Bool
}

struct Item: Codable, Identifiable {
    let id: UUID
    let name_canonical: String
    let category: String?
    let created_at: Date
}

struct ListEntry: Codable, Identifiable {
    let id: UUID
    let household_id: UUID
    let item_id: UUID
    let store_id: UUID
    let brand: String?
    let quantity: Int
    let unit: String?
    let status: String
    let added_by: UUID
    let added_at: Date

    // Joined fields (populated by custom select queries)
    var item: Item?
    var store: Store?
    var added_by_name: String?
}

struct PurchaseHistory: Codable, Identifiable {
    let id: UUID
    let household_id: UUID
    let item_id: UUID
    let store_id: UUID
    let brand: String?
    let bought_at: Date
    let added_by: UUID

    var store: Store?
}

struct BrandPreference: Codable, Identifiable {
    let id: UUID
    let household_id: UUID
    let item_id: UUID
    let store_id: UUID
    let preferred_brand: String
    let updated_at: Date
}

struct DisambiguationLog: Codable, Identifiable {
    let id: UUID
    let household_id: UUID
    let utterance: String
    let candidate_item_id: UUID?
    let chosen_item_id: UUID?
    let confidence_score: Double?
    let store_id: UUID?
    let decision_type: DecisionType
    let created_at: Date

    enum DecisionType: String, Codable {
        case silent_match, asked_item, asked_store, asked_brand, cold_start
    }
}

// MARK: — Edge Function request / response

struct AddItemRequest: Codable {
    let utterance: String
    let household_id: UUID
    let candidate_item_id: UUID?
    let confirmed_store_id: UUID?
    let confirmed_brand: String?
}

struct AddItemResponse: Codable {
    let entry_id: UUID?
    let canonical_item: ItemRef?
    let store: StoreRef?
    let brand: String?
    let needs_followup: Bool
    let followup_type: FollowupType?
    let followup_question: String?
    let followup_options: [FollowupOption]?
    let already_on_list: Bool?
    let error: String?

    struct ItemRef: Codable {
        let id: UUID
        let name: String
    }
    struct StoreRef: Codable {
        let id: UUID
        let name: String
    }
    enum FollowupType: String, Codable {
        case store, item, brand, quantity
    }
    struct FollowupOption: Codable, Identifiable {
        let id: UUID
        let label: String
    }
}

// MARK: — View model helpers

/// A list entry enriched with item/store names for display.
struct DisplayEntry: Identifiable {
    let id: UUID
    let itemName: String
    let brand: String?
    let quantity: Int
    let unit: String?
    let storeName: String
    let storeId: UUID
    let addedByName: String
    let addedAt: Date

    var quantityLabel: String {
        quantity == 1
            ? String(format: NSLocalizedString("row.unit_singular", comment: ""), quantity)
            : String(format: NSLocalizedString("row.unit_plural", comment: ""), quantity)
    }
}

extension DisplayEntry {
    init(from entry: ListEntry) {
        self.id = entry.id
        self.itemName = entry.item?.name_canonical ?? "Unknown item"
        self.brand = entry.brand
        self.quantity = entry.quantity
        self.unit = entry.unit
        self.storeName = entry.store?.name ?? "Unknown store"
        self.storeId = entry.store_id
        self.addedByName = entry.added_by_name ?? "someone"
        self.addedAt = entry.added_at
    }
}

/// Grouped list sections by store.
struct StoreSectionData: Identifiable {
    let id: UUID   // store id
    let storeName: String
    let entries: [DisplayEntry]
}
