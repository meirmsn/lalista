import SwiftUI

// MARK: — List Row View
// 3-level hierarchy per DESIGN.md:
//   1. Item name (body 15px/500, text-primary) — primary visual hit
//   2. Brand + quantity (caption 13px/400, text-secondary)
//   3. Added by (caption 13px/400, #7A6A56) — household context
//
// Swipe actions:
//   right: mark as bought (success green, spring animation)
//   left: remove from list (error red, trash icon)

struct ListRowView: View {
    let entry: DisplayEntry
    @ObservedObject var viewModel: ListViewModel

    @State private var isBoughtAnimating = false
    @State private var isStrikethrough = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // 1. Item name
            Text(entry.itemName)
                .font(.plusJakarta_body())
                .foregroundColor(.textPrimary)
                .strikethrough(isStrikethrough, color: .textSecondary)
                .animation(.easeOut(duration: 0.15), value: isStrikethrough)

            // 2. Brand + quantity
            HStack(spacing: 4) {
                if let brand = entry.brand, !brand.isEmpty {
                    Text(brand)
                        .font(.plusJakarta_caption())
                        .foregroundColor(.textSecondary)
                    Text("·")
                        .font(.plusJakarta_caption())
                        .foregroundColor(.textTertiary)
                }
                Text(entry.quantityLabel)
                    .font(.plusJakarta_caption())
                    .foregroundColor(.textSecondary)
                    .tabularNumerics()
            }

            // 3. Added by — text-secondary (#7A6A56) for WCAG AA at 13px
            Text(String(format: NSLocalizedString("row.added_by", comment: ""), entry.addedByName))
                .font(.plusJakarta_caption())
                .foregroundColor(.textSecondary)
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(.isButton)
        .accessibilityActions {
            Button(NSLocalizedString("row.action.mark_bought", comment: "")) {
                Task { await markAsBought() }
            }
            Button(NSLocalizedString("row.action.delete", comment: "")) {
                Task { await viewModel.deleteEntry(entryId: entry.id) }
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button {
                Task { await markAsBought() }
            } label: {
                Label(NSLocalizedString("row.action.mark_bought", comment: ""), systemImage: "checkmark.circle.fill")
            }
            .tint(.successColor)
        }
        .swipeActions(edge: .leading, allowsFullSwipe: false) {
            Button(role: .destructive) {
                Task { await viewModel.deleteEntry(entryId: entry.id) }
            } label: {
                Label(NSLocalizedString("row.action.delete", comment: ""), systemImage: "trash")
            }
            .tint(.errorColor)
        }
    }

    // MARK: — Mark as bought with spring animation
    private func markAsBought() async {
        // Spring checkmark bounce then crossstrike — DESIGN.md motion spec
        withAnimation(.spring(dampingFraction: 0.7, blendDuration: 0.15)) {
            isBoughtAnimating = true
        }
        withAnimation(.easeOut(duration: 0.15).delay(0.1)) {
            isStrikethrough = true
        }
        // Wait for animation to complete before removing row
        try? await Task.sleep(nanoseconds: 280_000_000) // 280ms
        await viewModel.markAsBought(entryId: entry.id)
    }

    // MARK: — VoiceOver label: "{item}, {brand}, {store}, added by {name}"
    private var accessibilityLabel: String {
        var parts = [entry.itemName]
        if let brand = entry.brand, !brand.isEmpty { parts.append(brand) }
        parts.append(entry.storeName)
        parts.append("added by \(entry.addedByName)")
        return parts.joined(separator: ", ")
    }
}

// MARK: — Row separator (1px, borderDefault)
struct RowSeparator: View {
    var body: some View {
        Divider()
            .background(Color.borderDefault)
    }
}
