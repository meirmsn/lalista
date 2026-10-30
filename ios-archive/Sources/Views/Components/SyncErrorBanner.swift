import SwiftUI

// MARK: — Sync Error Banner
// Amber warning bar at top of list when offline.
// Invisible = perfect (no indicator when online). Shown only on disconnect.
// Tapping retries WebSocket connection.

struct SyncErrorBanner: View {
    let onRetry: () -> Void

    var body: some View {
        Button(action: onRetry) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 13))
                    .foregroundColor(.warningColor)

                Text(NSLocalizedString("list.sync_error", comment: ""))
                    .font(.plusJakarta_caption())
                    .foregroundColor(.warningColor)

                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color.warningBg)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(NSLocalizedString("list.sync_error", comment: ""))
        .accessibilityHint("Double-tap to retry connection")
    }
}

#Preview {
    SyncErrorBanner { }
}
