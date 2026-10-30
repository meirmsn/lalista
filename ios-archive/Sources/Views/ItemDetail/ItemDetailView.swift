import SwiftUI

// MARK: — Item Detail View (read-only)
// Shows item metadata + purchase history.
// Read-only in v0: voice re-add with correction is the edit model.

struct ItemDetailView: View {
    let entry: DisplayEntry
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var authService: AuthService

    @State private var purchaseHistory: [PurchaseHistory] = []
    @State private var isLoadingHistory = false
    @State private var historyError: String?

    private let service = ListService()

    var body: some View {
        NavigationStack {
            ZStack {
                Color.backgroundPrimary.ignoresSafeArea()

                List {
                    // Item info section
                    Section {
                        detailRow(label: NSLocalizedString("detail.store", comment: ""),
                                  value: entry.storeName)
                        if let brand = entry.brand, !brand.isEmpty {
                            detailRow(label: NSLocalizedString("detail.brand", comment: ""),
                                      value: brand)
                        }
                        detailRow(label: NSLocalizedString("detail.quantity", comment: ""),
                                  value: entry.quantityLabel)
                        detailRow(label: NSLocalizedString("detail.added_by", comment: ""),
                                  value: entry.addedByName)
                        detailRow(label: NSLocalizedString("detail.added_at", comment: ""),
                                  value: entry.addedAt.formatted(.relative(presentation: .named)))
                    }
                    .listRowBackground(Color.backgroundSurface)

                    // Purchase history section
                    Section {
                        if isLoadingHistory {
                            HStack {
                                Spacer()
                                ProgressView().tint(.accentPrimary)
                                Spacer()
                            }
                            .listRowBackground(Color.backgroundSurface)
                        } else if let error = historyError {
                            Text(error)
                                .font(.plusJakarta_caption())
                                .foregroundColor(.errorColor)
                                .listRowBackground(Color.backgroundSurface)
                        } else if purchaseHistory.isEmpty {
                            Text("No purchase history yet.")
                                .font(.plusJakarta_caption())
                                .foregroundColor(.textTertiary)
                                .listRowBackground(Color.backgroundSurface)
                        } else {
                            ForEach(purchaseHistory) { purchase in
                                historyRow(purchase)
                            }
                        }
                    } header: {
                        Text(NSLocalizedString("detail.history_section", comment: ""))
                            .font(.plusJakarta_micro())
                            .foregroundColor(.textSecondary)
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(Color.backgroundPrimary)
            }
            .navigationTitle(entry.itemName)
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(NSLocalizedString("nav.back", comment: ""), action: { dismiss() })
                        .foregroundColor(.accentPrimary)
                }
            }
            .task { await loadHistory() }
        }
    }

    // MARK: — Detail row
    private func detailRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.plusJakarta_body())
                .foregroundColor(.textSecondary)
            Spacer()
            Text(value)
                .font(.plusJakarta_body())
                .foregroundColor(.textPrimary)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 4)
    }

    // MARK: — History row
    private func historyRow(_ purchase: PurchaseHistory) -> some View {
        HStack {
            Text(purchase.bought_at.formatted(.dateTime.month().day()))
                .font(.plusJakarta_caption())
                .foregroundColor(.textSecondary)
                .frame(width: 50, alignment: .leading)
                .tabularNumerics()

            Text(purchase.store?.name ?? "Unknown")
                .font(.plusJakarta_caption())
                .foregroundColor(.textPrimary)

            Spacer()

            if let brand = purchase.brand, !brand.isEmpty {
                Text(brand)
                    .font(.plusJakarta_caption())
                    .foregroundColor(.textSecondary)
            } else {
                Text("(generic)")
                    .font(.plusJakarta_caption())
                    .foregroundColor(.textTertiary)
            }
        }
        .padding(.vertical, 2)
        .listRowBackground(Color.backgroundSurface)
    }

    // MARK: — Load history
    private func loadHistory() async {
        guard let householdId = authService.currentHouseholdId else { return }
        isLoadingHistory = true
        defer { isLoadingHistory = false }
        do {
            purchaseHistory = try await service.fetchPurchaseHistory(
                itemId: entry.id,
                householdId: householdId
            )
        } catch {
            historyError = "Couldn't load history."
        }
    }
}
