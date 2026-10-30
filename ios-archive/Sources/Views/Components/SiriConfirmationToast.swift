import SwiftUI

// MARK: — Siri Confirmation Toast
// Slides in from bottom on app foreground after voice add.
// 3s auto-dismiss. Does not block the list. Spring from bottom.
// Background: surface #FFFFFF, border: borderDefault, radius: 12px.

struct SiriConfirmationToast: View {
    let item: ToastItem
    let onDismiss: () -> Void

    @State private var timer: Timer?

    var body: some View {
        HStack(spacing: 12) {
            // Success icon — terracotta
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 20))
                .foregroundColor(.accentPrimary)

            VStack(alignment: .leading, spacing: 2) {
                Text("Added \(item.itemName)")
                    .font(.plusJakarta_body())
                    .foregroundColor(.textPrimary)
                Text("→ \(item.storeName)")
                    .font(.plusJakarta_caption())
                    .foregroundColor(.textSecondary)
            }

            Spacer()

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 12))
                    .foregroundColor(.textTertiary)
            }
            .accessibilityLabel("Dismiss")
        }
        .padding(16)
        .background(Color.backgroundSurface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.borderDefault, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.08), radius: 8, x: 0, y: 4)
        .onAppear {
            // Announce via accessibility even when toast is on screen
            UIAccessibility.post(
                notification: .announcement,
                argument: "Added \(item.itemName) to \(item.storeName)"
            )
            // Auto-dismiss after 3 seconds
            timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: false) { _ in
                onDismiss()
            }
        }
        .onDisappear {
            timer?.invalidate()
        }
    }
}
