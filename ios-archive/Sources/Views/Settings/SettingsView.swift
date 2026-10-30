import SwiftUI

// MARK: — Settings View
// Stores, household members, account.

struct SettingsView: View {
    @StateObject private var viewModel = SettingsViewModel()
    @EnvironmentObject private var authService: AuthService
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.backgroundPrimary.ignoresSafeArea()

                if viewModel.isLoading {
                    SkeletonSettingsView()
                        .transition(.opacity)
                } else {
                    settingsContent
                }
            }
            .navigationTitle(NSLocalizedString("settings.title", comment: ""))
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(NSLocalizedString("nav.back", comment: ""), action: { dismiss() })
                        .foregroundColor(.accentPrimary)
                }
            }
            .task { await viewModel.load() }
            .overlay(alignment: .top) {
                if let error = viewModel.error {
                    VStack {
                        HStack {
                            Text(error).font(.plusJakarta_caption()).foregroundColor(.errorColor)
                            Spacer()
                            Button("Retry") { Task { await viewModel.load() } }
                                .font(.plusJakarta_caption())
                                .foregroundColor(.accentPrimary)
                        }
                        .padding()
                        .background(Color.errorBg)
                    }
                }
            }
        }
    }

    // MARK: — Main content
    private var settingsContent: some View {
        List {
            // STORES section
            Section {
                ForEach(viewModel.stores) { store in
                    HStack {
                        Text(store.name)
                            .font(.plusJakarta_body())
                            .foregroundColor(.textPrimary)
                        Spacer()
                        if store.online_cart_supported {
                            Image(systemName: "checkmark")
                                .foregroundColor(.accentPrimary)
                                .font(.system(size: 14, weight: .semibold))
                        }
                    }
                    .listRowBackground(Color.backgroundSurface)
                }
                Button {
                    // TODO: Add store sheet (v1)
                } label: {
                    Text(NSLocalizedString("settings.add_store", comment: ""))
                        .font(.plusJakarta_body())
                        .foregroundColor(.accentPrimary)
                }
                .listRowBackground(Color.backgroundSurface)
            } header: {
                sectionHeader(NSLocalizedString("settings.stores_section", comment: ""))
            }

            // HOUSEHOLD section
            Section {
                ForEach(viewModel.members, id: \.user_id) { member in
                    HStack {
                        let isYou = member.user_id == viewModel.currentUserId
                        Text(memberDisplayName(member) + (isYou ? NSLocalizedString("settings.role.you_suffix", comment: "") : ""))
                            .font(.plusJakarta_body())
                            .foregroundColor(.textPrimary)
                        Spacer()
                        Text(member.role == .owner
                             ? NSLocalizedString("settings.role.owner", comment: "")
                             : NSLocalizedString("settings.role.member", comment: ""))
                            .font(.plusJakarta_caption())
                            .foregroundColor(.textTertiary)
                    }
                    .listRowBackground(Color.backgroundSurface)
                }
                Button {
                    if let link = viewModel.inviteLink() {
                        let activity = UIActivityViewController(
                            activityItems: [link],
                            applicationActivities: nil
                        )
                        UIApplication.shared.connectedScenes
                            .compactMap { $0 as? UIWindowScene }
                            .flatMap { $0.windows }
                            .first { $0.isKeyWindow }?
                            .rootViewController?
                            .present(activity, animated: true)
                    }
                } label: {
                    Text(NSLocalizedString("settings.invite_member", comment: ""))
                        .font(.plusJakarta_body())
                        .foregroundColor(.accentPrimary)
                }
                .listRowBackground(Color.backgroundSurface)
            } header: {
                sectionHeader(NSLocalizedString("settings.household_section", comment: ""))
            }

            // ACCOUNT section
            Section {
                Button(role: .destructive) {
                    Task { await authService.signOut() }
                } label: {
                    Text(NSLocalizedString("settings.sign_out", comment: ""))
                        .font(.plusJakarta_body())
                        .foregroundColor(.errorColor)
                }
                .listRowBackground(Color.backgroundSurface)
            } header: {
                sectionHeader(NSLocalizedString("settings.account_section", comment: ""))
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.backgroundPrimary)
    }

    private func sectionHeader(_ text: String) -> some View {
        Text(text)
            .font(.plusJakarta_micro())
            .foregroundColor(.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    private func memberDisplayName(_ member: HouseholdMember) -> String {
        member.display_name ?? String(member.user_id.uuidString.prefix(8))
    }
}

// MARK: — Skeleton for settings loading
private struct SkeletonSettingsView: View {
    var body: some View {
        List {
            Section {
                ForEach(0..<3) { _ in
                    HStack {
                        SkeletonBars(width: 100)
                        Spacer()
                        SkeletonBars(width: 20)
                    }
                    .listRowBackground(Color.backgroundSurface)
                }
            } header: {
                SkeletonBars(width: 60)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.backgroundPrimary)
    }
}

private struct SkeletonBars: View {
    let width: CGFloat
    @State private var opacity: Double = 0.4
    var body: some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(Color.borderDefault)
            .frame(width: width, height: 15)
            .opacity(opacity)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                    opacity = 0.8
                }
            }
    }
}

#Preview {
    SettingsView()
        .environmentObject(AuthService.shared)
}
