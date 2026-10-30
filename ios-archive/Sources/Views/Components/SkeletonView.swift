import SwiftUI

// MARK: — Skeleton loading views
// Shown while list data is loading. Matches the real list row layout.

struct SkeletonListView: View {
    var body: some View {
        VStack(spacing: 0) {
            // Simulate 2 store sections with 2 rows each
            SkeletonSectionHeader()
            SkeletonRow()
            Divider().background(Color.borderDefault)
            SkeletonRow()
            Divider().background(Color.borderDefault)

            SkeletonSectionHeader()
                .padding(.top, 16)
            SkeletonRow()
            Divider().background(Color.borderDefault)
            SkeletonRow()

            Spacer()
        }
        .padding(.horizontal, 16)
        .background(Color.backgroundPrimary)
    }
}

private struct SkeletonSectionHeader: View {
    var body: some View {
        HStack {
            SkeletonBar(width: 60, height: 11)
            Spacer()
            SkeletonBar(width: 40, height: 11)
        }
        .padding(.vertical, 12)
    }
}

private struct SkeletonRow: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SkeletonBar(width: 160, height: 15)
            SkeletonBar(width: 100, height: 13)
            SkeletonBar(width: 80, height: 13)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 12)
    }
}

private struct SkeletonBar: View {
    let width: CGFloat
    let height: CGFloat

    @State private var opacity: Double = 0.4

    var body: some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(Color.borderDefault)
            .frame(width: width, height: height)
            .opacity(opacity)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                    opacity = 0.8
                }
            }
    }
}
