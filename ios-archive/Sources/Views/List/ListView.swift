import SwiftUI

// MARK: — Main List View
// Grouped by store. FAB always visible. Real-time sync status.

struct ListView: View {
    @EnvironmentObject private var viewModel: ListViewModel
    @EnvironmentObject private var authService: AuthService
    @State private var showAddSheet = false
    @State private var showSettings = false
    @State private var selectedEntry: DisplayEntry?
    @State private var isRefreshing = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Color.backgroundPrimary.ignoresSafeArea()

            VStack(spacing: 0) {
                // Navigation header
                headerView

                // Sync error banner (shown when offline)
                if viewModel.syncStatus == .offline {
                    SyncErrorBanner {
                        viewModel.retrySync()
                    }
                }

                // Main content
                if viewModel.isLoading && viewModel.sections.isEmpty && !isRefreshing {
                    SkeletonListView()
                } else if viewModel.sections.isEmpty {
                    GeometryReader { geo in
                        ScrollView {
                            emptyStateView
                                .frame(maxWidth: .infinity)
                                .frame(minHeight: geo.size.height)
                        }
                        .refreshable {
                            isRefreshing = true
                            await viewModel.fetchList()
                            isRefreshing = false
                        }
                    }
                } else {
                    listContent
                }
            }

            // FAB — always visible, safe area inset
            fabButton

            // Siri confirmation toast
            if viewModel.showSiriToast, let toast = viewModel.toastItem {
                VStack {
                    Spacer()
                    SiriConfirmationToast(item: toast) {
                        viewModel.dismissToast()
                    }
                    .padding(.bottom, 96) // above FAB
                    .padding(.horizontal, 16)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .animation(.spring(dampingFraction: 0.7), value: viewModel.showSiriToast)
            }
        }
        .sheet(isPresented: $showAddSheet) {
            AddItemSheet(viewModel: viewModel)
        }
        .sheet(item: $selectedEntry) { entry in
            ItemDetailView(entry: entry)
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .task {
            await viewModel.fetchList()
            viewModel.subscribeRealtime()
        }
        .onDisappear {
            viewModel.unsubscribeRealtime()
        }
    }

    // MARK: — Header
    private var headerView: some View {
        HStack {
            Text("lalista")
                .font(.fraunces_display())
                .foregroundColor(.textPrimary)
                .accessibilityAddTraits(.isHeader)

            Spacer()

            // User avatar (initials)
            if let user = authService.currentUser {
                AvatarView(userId: user.id)
            }

            // Settings button
            Button {
                showSettings = true
            } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 20))
                    .foregroundColor(.textSecondary)
            }
            .accessibilityLabel(NSLocalizedString("nav.settings", comment: ""))
            .padding(.leading, 8)
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 8)
    }

    // MARK: — List content
    private var listContent: some View {
        List {
            ForEach(viewModel.sections) { section in
                Section {
                    ForEach(section.entries) { entry in
                        ListRowView(entry: entry, viewModel: viewModel)
                            .listRowBackground(Color.backgroundPrimary)
                            .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                            .onTapGesture { selectedEntry = entry }
                    }
                } header: {
                    StoreSectionHeaderView(storeName: section.storeName, count: section.entries.count)
                }
            }

            // Bottom spacer for FAB clearance
            Color.clear
                .frame(height: 80)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color.backgroundPrimary)
        .refreshable {
            isRefreshing = true
            await viewModel.fetchList()
            isRefreshing = false
        }
    }

    // MARK: — Empty state
    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Spacer()

            Text(NSLocalizedString("list.empty.tagline", comment: ""))
                .font(.fraunces_displayItalic())
                .foregroundColor(.textSecondary)
                .multilineTextAlignment(.center)

            Text(NSLocalizedString("list.empty.subtitle", comment: ""))
                .font(.plusJakarta_caption())
                .foregroundColor(.textTertiary)

            Spacer()
                .frame(height: 8)

            Text(NSLocalizedString("list.empty.siri_hint", comment: ""))
                .font(.plusJakarta_bodyLG())
                .foregroundColor(.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Spacer()
                .frame(height: 32)

            Button {
                showAddSheet = true
            } label: {
                Label(
                    NSLocalizedString("list.empty.cta", comment: ""),
                    systemImage: "plus"
                )
                .font(.plusJakarta_body())
                .foregroundColor(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 14)
                .background(Color.accentPrimary)
                .clipShape(Capsule())
            }
            .accessibilityLabel(NSLocalizedString("list.fab.accessibility", comment: ""))

            Spacer()
        }
        .padding(.horizontal, 16)
    }

    // MARK: — FAB (Floating Action Button)
    private var fabButton: some View {
        Button {
            showAddSheet = true
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "plus")
                    .font(.system(size: 15, weight: .semibold))
                Text(NSLocalizedString("list.fab.label", comment: ""))
                    .font(.plusJakarta_body())
            }
            .foregroundColor(.white)
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .background(Color.accentPrimary)
            .clipShape(Capsule())
            .shadow(color: .black.opacity(0.15), radius: 8, x: 0, y: 4)
        }
        .accessibilityLabel(NSLocalizedString("list.fab.accessibility", comment: ""))
        .padding(.trailing, 16)
        .padding(.bottom, 32)
        .buttonStyle(FABButtonStyle())
    }
}

// MARK: — FAB press style (pressed → accentPrimaryDark)
struct FABButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
    }
}

// MARK: — Avatar view
private struct AvatarView: View {
    let userId: UUID
    // In production, fetch display name from Supabase. Showing initial for now.
    var body: some View {
        Circle()
            .fill(Color.accentPrimarySoft)
            .frame(width: 32, height: 32)
            .overlay(
                Text(String(userId.uuidString.prefix(1)).uppercased())
                    .font(.plusJakarta_micro())
                    .foregroundColor(.accentPrimary)
            )
    }
}

#Preview {
    ListView()
        .environmentObject(ListViewModel())
        .environmentObject(AuthService.shared)
}
