import SwiftUI

// MARK: — Store Section Header
// Micro 11px ALL CAPS store name (text-secondary), caption count right-aligned (text-tertiary).
// 1px borderDefault separator above. Feels like a corkboard category label.

struct StoreSectionHeaderView: View {
    let storeName: String
    let count: Int

    var body: some View {
        VStack(spacing: 0) {
            Divider()
                .background(Color.borderDefault)
                .padding(.bottom, 8)

            HStack {
                Text(storeName.uppercased())
                    .font(.plusJakarta_micro())
                    .foregroundColor(.textSecondary)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityLabel(storeName) // don't read "ALL CAPS"

                Spacer()

                Text("\(count) \(count == 1 ? "item" : "items")")
                    .font(.plusJakarta_caption())
                    .foregroundColor(.textTertiary)
                    .tabularNumerics()
            }
        }
        .padding(.vertical, 4)
        .background(Color.backgroundPrimary)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
        .listRowBackground(Color.backgroundPrimary)
    }
}

#Preview {
    StoreSectionHeaderView(storeName: "Costco", count: 4)
        .background(Color.backgroundPrimary)
}
