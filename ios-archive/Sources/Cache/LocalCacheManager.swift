import Foundation
import SwiftData

// MARK: — LocalCacheManager
// Manages the SwiftData store in the App Group shared container.
// Used by both the main app (for cache population) and the App Intent extension (for fast path).

final class LocalCacheManager {
    static let shared = LocalCacheManager()

    let container: ModelContainer

    private init() {
        let schema = Schema([CachedItem.self, CachedPurchaseHistory.self])
        let config = ModelConfiguration(
            schema: schema,
            url: LocalCacheManager.storeURL,
            cloudKitDatabase: .none
        )
        do {
            container = try ModelContainer(for: schema, configurations: [config])
        } catch {
            fatalError("Failed to initialize LocalCacheManager: \(error)")
        }
    }

    /// URL for the SwiftData store.
    /// Uses the App Group shared container when available; falls back to Application Support
    /// when the entitlement is absent (personal team / Simulator). See TODOS.md for pre-launch steps.
    static var storeURL: URL {
        if let groupURL = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: "group.com.lalista.shared") {
            return groupURL.appendingPathComponent("LocalCache.store")
        }
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return appSupport.appendingPathComponent("LocalCache.store")
    }

    // MARK: — Fast-path trigram match
    // Matches query against CachedItem.name_canonical and name_variants.
    // Returns (item, confidence) or nil if no match.
    @MainActor
    func findItem(for query: String, threshold: Double) -> (item: CachedItem, confidence: Double)? {
        let context = container.mainContext
        let normalized = query.lowercased().trimmingCharacters(in: .whitespaces)

        let descriptor = FetchDescriptor<CachedItem>()
        guard let items = try? context.fetch(descriptor) else { return nil }

        var best: (item: CachedItem, score: Double)?
        for item in items {
            let score = trigramSimilarity(normalized, item.name_canonical.lowercased())
            if score > (best?.score ?? 0) {
                best = (item, score)
            }
            // Also check variants
            for variant in item.name_variants {
                let variantScore = trigramSimilarity(normalized, variant.lowercased())
                if variantScore > (best?.score ?? 0) {
                    best = (item, variantScore)
                }
            }
        }

        guard let result = best, result.score >= threshold else { return nil }
        return (result.item, result.score)
    }

    // MARK: — Cache refresh
    @MainActor
    func refreshItems(from remoteItems: [(id: UUID, name: String, variants: [String])]) {
        let context = container.mainContext
        let descriptor = FetchDescriptor<CachedItem>()
        let existing = (try? context.fetch(descriptor)) ?? []
        let existingByID = Dictionary(uniqueKeysWithValues: existing.map { ($0.id, $0) })

        let remoteIDs = Set(remoteItems.map { $0.id })

        for remote in remoteItems {
            if let cached = existingByID[remote.id] {
                cached.name_canonical = remote.name
                cached.updated_at = .now
                // Preserve learned variants; merge server-provided ones
                let merged = Set(cached.name_variants + remote.variants)
                cached.name_variants = Array(merged)
            } else {
                let new = CachedItem(id: remote.id, name_canonical: remote.name, name_variants: remote.variants)
                context.insert(new)
            }
        }

        // Remove orphaned items (deleted from DB)
        for cached in existing where !remoteIDs.contains(cached.id) {
            context.delete(cached)
        }

        try? context.save()
    }

    // MARK: — Write-back a learned NLP variant
    @MainActor
    func writeBackVariant(_ utterance: String, for itemID: UUID) {
        let context = container.mainContext
        let descriptor = FetchDescriptor<CachedItem>(
            predicate: #Predicate { $0.id == itemID }
        )
        guard let item = try? context.fetch(descriptor).first else {
            // Item not in cache yet — acceptable, it'll appear on next refresh
            return
        }
        let normalized = utterance.lowercased().trimmingCharacters(in: .whitespaces)
        guard !item.name_variants.contains(normalized) else { return }
        item.name_variants.append(normalized)
        do {
            try context.save()
        } catch {
            print("[LocalCacheManager] write-back failed for '\(utterance)': \(error)")
        }
    }

    // MARK: — Seed Spanglish variants (called once at first launch)
    @MainActor
    func seedSpanglishVariantsIfNeeded() {
        let context = container.mainContext
        let descriptor = FetchDescriptor<CachedItem>()
        guard let items = try? context.fetch(descriptor) else { return }

        let byCanonical = Dictionary(uniqueKeysWithValues: items.map {
            ($0.name_canonical.lowercased(), $0)
        })

        for seed in SpanglishSeed.pairs {
            guard let item = byCanonical[seed.canonical.lowercased()] else { continue }
            let newVariants = seed.variants.filter { !item.name_variants.contains($0) }
            item.name_variants.append(contentsOf: newVariants)
        }
        try? context.save()
    }

    // MARK: — TTL check
    @MainActor
    var cacheIsStale: Bool {
        // Check the most recently updated item
        let context = container.mainContext
        var descriptor = FetchDescriptor<CachedItem>(sortBy: [SortDescriptor(\.updated_at, order: .reverse)])
        descriptor.fetchLimit = 1
        guard let newest = try? context.fetch(descriptor).first else { return true }
        return Date.now.timeIntervalSince(newest.updated_at) > 86_400 // 24h TTL
    }
}

// MARK: — Simple trigram similarity
// Not as accurate as pg_trgm but good enough for the local fast path.
// Returns 0.0–1.0.
private func trigramSimilarity(_ a: String, _ b: String) -> Double {
    guard !a.isEmpty && !b.isEmpty else { return 0 }
    // Exact match
    if a == b { return 1.0 }
    // Prefix match shortcut
    if b.hasPrefix(a) || a.hasPrefix(b) {
        let shorter = min(a.count, b.count)
        let longer  = max(a.count, b.count)
        return Double(shorter) / Double(longer)
    }
    let trigramsA = trigrams(a)
    let trigramsB = trigrams(b)
    let intersection = trigramsA.intersection(trigramsB).count
    let union = trigramsA.union(trigramsB).count
    guard union > 0 else { return 0 }
    return Double(intersection) / Double(union)
}

private func trigrams(_ s: String) -> Set<String> {
    let padded = "  \(s)  "
    let chars = Array(padded)
    var result = Set<String>()
    for i in 0..<(chars.count - 2) {
        result.insert(String(chars[i..<i+3]))
    }
    return result
}
