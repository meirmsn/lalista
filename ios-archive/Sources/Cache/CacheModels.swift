import Foundation
import SwiftData

// MARK: — SwiftData models for App Group shared cache
// Stored in group.com.lalista.shared container.
// Accessible from both the main app and the App Intent extension.

@Model
final class CachedItem {
    @Attribute(.unique) var id: UUID
    var name_canonical: String
    /// Learned Spanglish/variant utterances that resolve to this item.
    /// Sources: (1) static seed at first launch, (2) write-back after successful NLP normalization.
    var name_variants: [String]
    var updated_at: Date

    init(id: UUID, name_canonical: String, name_variants: [String] = [], updated_at: Date = .now) {
        self.id = id
        self.name_canonical = name_canonical
        self.name_variants = name_variants
        self.updated_at = updated_at
    }

    /// Returns true if this item's canonical name or any variant matches the query
    /// using a simple trigram-inspired substring + word-boundary approach.
    func matches(_ query: String) -> Bool {
        let q = query.lowercased().trimmingCharacters(in: .whitespaces)
        if name_canonical.lowercased().contains(q) { return true }
        return name_variants.contains { $0.lowercased() == q }
    }
}

@Model
final class CachedPurchaseHistory {
    @Attribute(.unique) var item_id: UUID
    var store_id: UUID
    var count: Int
    var last_bought_at: Date

    init(item_id: UUID, store_id: UUID, count: Int, last_bought_at: Date) {
        self.item_id = item_id
        self.store_id = store_id
        self.count = count
        self.last_bought_at = last_bought_at
    }
}

// MARK: — Spanglish seed variants
// Loaded into CachedItem.name_variants at first app launch.
// ~50 common pairs covering the most frequent Spanglish grocery terms.
enum SpanglishSeed {
    static let pairs: [(canonical: String, variants: [String])] = [
        ("milk",               ["leche"]),
        ("cheese",             ["queso"]),
        ("shredded cheese",    ["queso rallado", "queso desmenuzado"]),
        ("eggs",               ["huevos"]),
        ("bread",              ["pan"]),
        ("butter",             ["mantequilla"]),
        ("rice",               ["arroz"]),
        ("beans",              ["frijoles", "frijol"]),
        ("chicken",            ["pollo"]),
        ("beef",               ["carne", "carne de res"]),
        ("pork",               ["cerdo", "puerco"]),
        ("ground beef",        ["carne molida"]),
        ("tomato",             ["tomate", "jitomate"]),
        ("onion",              ["cebolla"]),
        ("garlic",             ["ajo"]),
        ("avocado",            ["aguacate", "palta"]),
        ("lemon",              ["limón", "limon"]),
        ("orange",             ["naranja"]),
        ("banana",             ["platano", "plátano"]),
        ("strawberry",         ["fresa", "fresas"]),
        ("apple",              ["manzana"]),
        ("grapes",             ["uvas"]),
        ("watermelon",         ["sandía", "sandia"]),
        ("mango",              ["mango"]),
        ("pineapple",          ["piña", "pina"]),
        ("corn",               ["maíz", "maiz", "elote"]),
        ("potato",             ["papa", "patata"]),
        ("sweet potato",       ["camote", "batata"]),
        ("carrot",             ["zanahoria"]),
        ("cucumber",           ["pepino"]),
        ("lettuce",            ["lechuga"]),
        ("spinach",            ["espinaca"]),
        ("broccoli",           ["brócoli", "brocoli"]),
        ("pepper",             ["pimiento", "chile"]),
        ("jalapeño",           ["jalapeño", "chile jalapeño"]),
        ("cilantro",           ["cilantro"]),
        ("tortillas",          ["tortillas"]),
        ("salsa",              ["salsa"]),
        ("sour cream",         ["crema", "crema agria"]),
        ("cream cheese",       ["queso crema"]),
        ("yogurt",             ["yogur", "yogurt"]),
        ("juice",              ["jugo"]),
        ("water",              ["agua"]),
        ("coffee",             ["café", "cafe"]),
        ("sugar",              ["azúcar", "azucar"]),
        ("salt",               ["sal"]),
        ("oil",                ["aceite"]),
        ("flour",              ["harina"]),
        ("pasta",              ["pasta", "fideos"]),
        ("cereal",             ["cereal"]),
    ]
}
