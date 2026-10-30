import SwiftUI

// MARK: — Add Item Sheet (FAB → bottom sheet)
// Autofocused text field. Same add-item Edge Function as Siri.
// If Edge Function returns needs_followup, shows DisambiguationSheet inline.

struct AddItemSheet: View {
    @ObservedObject var viewModel: ListViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var text = ""
    @State private var isAdding = false
    @FocusState private var textFieldFocused: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                Color.backgroundSurface.ignoresSafeArea()

                VStack(alignment: .leading, spacing: 24) {
                    // Title
                    Text(NSLocalizedString("add.title", comment: ""))
                        .font(.plusJakarta_headingMD())
                        .foregroundColor(.textPrimary)
                        .padding(.top, 8)

                    // Text field
                    TextField(NSLocalizedString("add.placeholder", comment: ""), text: $text)
                        .font(.plusJakarta_bodyLG())
                        .foregroundColor(.textPrimary)
                        .tint(.accentPrimary)
                        .focused($textFieldFocused)
                        .submitLabel(.done)
                        .onSubmit { guard !text.isEmpty else { return }; Task { await submit() } }
                        .padding(12)
                        .background(Color.backgroundSurface2)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(Color.borderDefault, lineWidth: 1)
                        )

                    Spacer()

                    // Actions
                    HStack {
                        Button(NSLocalizedString("add.cancel", comment: "")) {
                            dismiss()
                        }
                        .font(.plusJakarta_body())
                        .foregroundColor(.textSecondary)

                        Spacer()

                        Button {
                            Task { await submit() }
                        } label: {
                            HStack(spacing: 6) {
                                if isAdding {
                                    ProgressView()
                                        .tint(.white)
                                        .scaleEffect(0.8)
                                }
                                Text(NSLocalizedString("add.confirm", comment: ""))
                                    .font(.plusJakarta_body())
                            }
                            .foregroundColor(.white)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background(text.isEmpty ? Color.textTertiary : Color.accentPrimary)
                            .clipShape(Capsule())
                        }
                        .disabled(text.isEmpty || isAdding)
                        .animation(.easeInOut(duration: 0.1), value: text.isEmpty)
                    }
                }
                .padding(24)
            }
            .presentationDetents([.height(260)])
            .presentationDragIndicator(.visible)
            .onAppear { textFieldFocused = true }
            // If viewModel surfaced a needs_followup response, show disambiguation
            .sheet(item: $viewModel.pendingAddResponse) { response in
                DisambiguationSheet(
                    response: response,
                    utterance: viewModel.pendingUtterance ?? text,
                    viewModel: viewModel
                ) {
                    dismiss()
                }
            }
            // Error toast
            .overlay(alignment: .bottom) {
                if let error = viewModel.addError {
                    Text(error)
                        .font(.plusJakarta_caption())
                        .foregroundColor(.errorColor)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)
                }
            }
        }
    }

    private func submit() async {
        guard !text.isEmpty else { return }
        isAdding = true
        viewModel.addError = nil
        await viewModel.addItem(utterance: text)
        isAdding = false
        if viewModel.pendingAddResponse == nil && viewModel.addError == nil {
            dismiss()
        }
    }
}

// MARK: — Make AddItemResponse Identifiable for sheet(item:)
extension AddItemResponse: Identifiable {
    public var id: String { followup_question ?? UUID().uuidString }
}
