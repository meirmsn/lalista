import Foundation
import Supabase
import AuthenticationServices

// MARK: — AuthService
// Handles Sign in with Apple via Supabase auth.
// On first sign-in: creates a household and adds the user as owner.

@MainActor
final class AuthService: NSObject, ObservableObject {
    static let shared = AuthService()

    @Published var currentUser: User?
    @Published var currentHouseholdId: UUID?
    @Published var isLoading = false
    @Published var error: String?

    private let supabase = SupabaseManager.shared.client

    private override init() {
        super.init()
        Task { await refreshSession() }
    }

    // MARK: — Session refresh (called at app launch)
    func refreshSession() async {
        do {
            let session = try await supabase.auth.session
            self.currentUser = User(id: session.user.id, email: session.user.email)
            await loadOrCreateHousehold()
        } catch {
            // No active session — show sign-in screen
            self.currentUser = nil
            self.currentHouseholdId = nil
        }
    }

    // MARK: — Sign in with Apple
    func signInWithApple() async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            let credential = try await performAppleSignIn()
            let session = try await supabase.auth.signInWithIdToken(
                credentials: .init(
                    provider: .apple,
                    idToken: credential.idToken,
                    nonce: credential.nonce
                )
            )
            self.currentUser = User(id: session.user.id, email: session.user.email)
            await loadOrCreateHousehold()
        } catch {
            let asError = error as? ASAuthorizationError
            if asError?.code == .canceled { return }
            self.error = error.localizedDescription
        }
    }

    #if targetEnvironment(simulator)
    // MARK: — Simulator: Email/password sign-in (compiled out on device)
    func signInWithEmail(email: String, password: String) async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let session = try await supabase.auth.signIn(email: email, password: password)
            self.currentUser = User(id: session.user.id, email: session.user.email)
            await loadOrCreateHousehold()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func signUpWithEmail(email: String, password: String) async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let response = try await supabase.auth.signUp(email: email, password: password)
            self.currentUser = User(id: response.user.id, email: response.user.email)
            await loadOrCreateHousehold()
        } catch {
            self.error = error.localizedDescription
        }
    }
    #endif

    // MARK: — Sign out
    func signOut() async {
        do {
            try await supabase.auth.signOut()
            currentUser = nil
            currentHouseholdId = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: — Household setup
    private func loadOrCreateHousehold() async {
        guard let userId = currentUser?.id else { return }
        let session = try? await supabase.auth.session
        print("[loadOrCreateHousehold] session=\(session?.accessToken.prefix(20) ?? "nil")")

        do {
            // Check for existing membership
            let members: [HouseholdMember] = try await supabase
                .from("household_members")
                .select("household_id, user_id, role, joined_at")
                .eq("user_id", value: userId.uuidString)
                .limit(1)
                .execute()
                .value

            if let member = members.first {
                self.currentHouseholdId = member.household_id
                return
            }

            // New user — create household automatically.
            // UUID is generated client-side to avoid a select-after-insert
            // round-trip that would fail RLS (no household_members row yet).
            let newId = UUID()
            try await supabase
                .from("households")
                .insert(["id": newId.uuidString, "name": "My Household"])
                .execute()

            // Add creator as owner
            try await supabase
                .from("household_members")
                .insert([
                    "household_id": newId.uuidString,
                    "user_id": userId.uuidString,
                    "role": "owner"
                ])
                .execute()

            self.currentHouseholdId = newId

            // Seed Spanglish variants after household is set up
            LocalCacheManager.shared.seedSpanglishVariantsIfNeeded()
        } catch {
            print("[loadOrCreateHousehold] error: \(error)")
            self.error = "Couldn't load household: \(error.localizedDescription)"
        }
    }
}

// MARK: — ASAuthorizationControllerDelegate bridge

private struct AppleCredential {
    let idToken: String
    let nonce: String
}

private extension AuthService {
    @MainActor
    func performAppleSignIn() async throws -> AppleCredential {
        try await withCheckedThrowingContinuation { continuation in
            let nonce = randomNonceString()
            let hashedNonce = sha256(nonce)

            let provider = ASAuthorizationAppleIDProvider()
            let request = provider.createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = hashedNonce

            let controller = ASAuthorizationController(authorizationRequests: [request])
            let delegate = AppleSignInDelegate(nonce: nonce, continuation: continuation)
            // Retain delegate for the duration of the authorization flow
            objc_setAssociatedObject(controller, "delegate", delegate, .OBJC_ASSOCIATION_RETAIN)
            controller.delegate = delegate
            controller.presentationContextProvider = ApplePresentationProvider.shared
            controller.performRequests()
        }
    }
}

private final class AppleSignInDelegate: NSObject, ASAuthorizationControllerDelegate {
    let nonce: String
    let continuation: CheckedContinuation<AppleCredential, Error>

    init(nonce: String, continuation: CheckedContinuation<AppleCredential, Error>) {
        self.nonce = nonce
        self.continuation = continuation
    }

    func authorizationController(controller: ASAuthorizationController,
                                  didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let idTokenData = appleIDCredential.identityToken,
              let idToken = String(data: idTokenData, encoding: .utf8)
        else {
            continuation.resume(throwing: AuthError.invalidCredential)
            return
        }
        continuation.resume(returning: AppleCredential(idToken: idToken, nonce: nonce))
    }

    func authorizationController(controller: ASAuthorizationController,
                                  didCompleteWithError error: Error) {
        continuation.resume(throwing: error)
    }
}

private final class ApplePresentationProvider: NSObject, ASAuthorizationControllerPresentationContextProviding {
    static let shared = ApplePresentationProvider()
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? UIWindow()
    }
}

enum AuthError: Error {
    case invalidCredential
}

// MARK: — Crypto helpers for Sign in with Apple nonce

import CryptoKit

private func randomNonceString(length: Int = 32) -> String {
    var randomBytes = [UInt8](repeating: 0, count: length)
    _ = SecRandomCopyBytes(kSecRandomDefault, length, &randomBytes)
    return randomBytes.map { String(format: "%02x", $0) }.joined()
}

private func sha256(_ input: String) -> String {
    let data = Data(input.utf8)
    let hashed = SHA256.hash(data: data)
    return hashed.compactMap { String(format: "%02x", $0) }.joined()
}
