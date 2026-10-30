import SwiftUI
import SwiftData

@main
struct lalistaApp: App {
    @StateObject private var authService = AuthService.shared
    @StateObject private var listViewModel = ListViewModel()

    init() {
        FontLoader.registerFonts()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(authService)
                .environmentObject(listViewModel)
                .modelContainer(LocalCacheManager.shared.container)
                .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
                    listViewModel.handleForeground()
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var authService: AuthService

    var body: some View {
        if authService.currentUser != nil {
            ListView()
        } else {
            SignInView()
        }
    }
}
