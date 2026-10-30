import SwiftUI

// MARK: — Disambiguation Bottom Sheet
// Shown when add-item Edge Function returns needs_followup: true.
// Handles store choice, item type, brand confirm, quantity.

struct DisambiguationSheet: View {
    let response: AddItemResponse
    let utterance: String
    @ObservedObject var viewModel: ListViewModel
    let onDismiss: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selectedOptionId: UUID?
    @State private var isConfirming = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.backgroundSurface.ignoresSafeArea()

                VStack(alignment: .leading, spacing: 20) {
                    // Title
                    Text(response.followup_question ?? "")
                        .font(.plusJakarta_headingMD())
                        .foregroundColor(.textPrimary)
                        .padding(.top, 8)

                    Divider().background(Color.borderDefault)

                    // Radio button options
                    if let options = response.followup_options {
                        ScrollView {
                            VStack(spacing: 0) {
                                ForEach(options) { option in
                                    RadioRow(
                                        label: option.label,
                                        isSelected: selectedOptionId == option.id
                                    ) {
                                        selectedOptionId = option.id
                                    }
                                    Divider().background(Color.borderDefault)
                                }
                            }
                        }
                    }

                    Spacer()

                    // Actions
                    HStack {
                        Button(NSLocalizedString("disambig.cancel", comment: "")) {
                            viewModel.pendingAddResponse = nil
                            dismiss()
                        }
                        .font(.plusJakarta_body())
                        .foregroundColor(.textSecondary)

                        Spacer()

                        Button {
                            Task { await confirm() }
                        } label: {
                            HStack(spacing: 6) {
                                if isConfirming {
                                    ProgressView().tint(.white).scaleEffect(0.8)
                                }
                                Text(NSLocalizedString("disambig.confirm", comment: ""))
                                    .font(.plusJakarta_body())
                            }
                            .foregroundColor(.white)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background(selectedOptionId == nil ? Color.textTertiary : Color.accentPrimary)
                            .clipShape(Capsule())
                        }
                        .disabled(selectedOptionId == nil || isConfirming)
                    }
                }
                .padding(24)
            }
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
    }

    private func confirm() async {
        guard let selectedId = selectedOptionId else { return }
        isConfirming = true
        defer { isConfirming = false }

        switch response.followup_type {
        case .store:
            await viewModel.confirmAdd(utterance: utterance, storeId: selectedId, brand: nil, candidateItemId: response.canonical_item?.id)
        case .brand:
            let brandLabel = response.followup_options?.first(where: { $0.id == selectedId })?.label
            await viewModel.confirmAdd(utterance: utterance, storeId: UUID(), brand: brandLabel)
        case .item:
            // User picked the correct item — re-submit with that candidate
            await viewModel.addItemWithCandidate(utterance: utterance, candidateItemId: selectedId)
        default:
            break
        }

        viewModel.pendingAddResponse = nil
        dismiss()
        onDismiss()
    }
}

// MARK: — Radio row with terracotta checkmark
private struct RadioRow: View {
    let label: String
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                // Radio indicator
                ZStack {
                    Circle()
                        .strokeBorder(isSelected ? Color.accentPrimary : Color.borderDefault, lineWidth: 2)
                        .frame(width: 22, height: 22)
                    if isSelected {
                        Circle()
                            .fill(Color.accentPrimary)
                            .frame(width: 12, height: 12)
                    }
                }
                .animation(.spring(dampingFraction: 0.7), value: isSelected)

                Text(label)
                    .font(.plusJakarta_body())
                    .foregroundColor(.textPrimary)

                Spacer()
            }
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? [.isSelected, .isButton] : .isButton)
    }
}
