import Foundation
import Supabase

@MainActor
final class SettingsViewModel: ObservableObject {
    @Published var stores: [Store] = []
    @Published var members: [HouseholdMember] = []
    @Published var isLoading = false
    @Published var error: String?

    private let supabase = SupabaseManager.shared.client

    var currentUserId: UUID? { AuthService.shared.currentUser?.id }
    var householdId: UUID? { AuthService.shared.currentHouseholdId }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        error = nil
        do {
            async let storesTask: [Store] = supabase
                .from("stores")
                .select()
                .order("name")
                .execute()
                .value

            let membersTask: [HouseholdMember]
            if let hid = householdId {
                membersTask = try await supabase
                    .from("household_members")
                    .select("household_id, user_id, role, joined_at")
                    .eq("household_id", value: hid.uuidString)
                    .execute()
                    .value
            } else {
                membersTask = []
            }

            stores = try await storesTask
            members = membersTask
        } catch {
            self.error = error.localizedDescription
        }
    }

    // Generate household invite link (carries household_id as deep link)
    func inviteLink() -> URL? {
        guard let householdId else { return nil }
        // Deep link scheme: lalista://join?household=<id>
        // Handler in AppDelegate/Scene opens sign-in → auto-joins household
        return URL(string: "https://lalista.app/join?household=\(householdId.uuidString)")
    }
}
