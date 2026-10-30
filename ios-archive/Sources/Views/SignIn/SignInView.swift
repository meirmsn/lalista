import SwiftUI
import AuthenticationServices

// MARK: — Sign-In Screen
// First launch: warm cream bg, Fraunces wordmark, one-tap Apple sign-in.
// No tutorial, no carousel. Product earns its explanation by working.

// Simulator-only email/password sign-in is compiled out entirely on device.
// No flags, no setup — just works in the simulator.

struct SignInView: View {
    @EnvironmentObject private var authService: AuthService

    var body: some View {
        ZStack {
            Color.backgroundPrimary
                .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()
                    .frame(height: 120)

                // Wordmark — Fraunces display (56px)
                Text("lalista")
                    .font(.fraunces_display())
                    .foregroundColor(.textPrimary)
                    .accessibilityAddTraits(.isHeader)

                Spacer()
                    .frame(height: 16)

                // Tagline
                Text(NSLocalizedString("signin.tagline", comment: ""))
                    .font(.plusJakarta_bodyLG())
                    .foregroundColor(.textSecondary)
                    .multilineTextAlignment(.center)

                Spacer()

                // Sample items — signals grocery use case without explaining it.
                // Fraunces italic per DESIGN.md "onboarding moments".
                // "aguacates" is crossed out: one item already grabbed, feels lived-in.
                VStack(spacing: 12) {
                    Text("leche")
                    Text("huevos")
                    Text("aguacates")
                        .overlay(
                            Rectangle()
                                .frame(height: 2.5)
                                .foregroundColor(.accentPrimary.opacity(0.7))
                                .scaleEffect(x: 1.15)
                                .rotationEffect(.degrees(-3))
                                .offset(y: 6)
                        )
                }
                .font(.fraunces_displayItalic())
                .foregroundColor(.textTertiary)

                Spacer()

                // Sign in with Apple — native button, ASAuthorizationAppleIDButton
                SignInWithAppleButton(
                    .signIn,
                    onRequest: { _ in },
                    onCompletion: { _ in }
                )
                .frame(height: 50)
                .padding(.horizontal, 40)
                // We override onCompletion with our own handler below
                .overlay(
                    Button(action: {
                        Task { await authService.signInWithApple() }
                    }) {
                        Color.clear
                    }
                )
                .accessibilityLabel("Sign in with Apple")

                if let error = authService.error {
                    Text(error)
                        .font(.plusJakarta_caption())
                        .foregroundColor(.errorColor)
                        .padding(.top, 12)
                        .padding(.horizontal, 40)
                        .multilineTextAlignment(.center)
                }

                if authService.isLoading {
                    ProgressView()
                        .padding(.top, 16)
                        .tint(.accentPrimary)
                }

                #if targetEnvironment(simulator)
                DebugEmailSignInView()
                    .padding(.top, 24)
                    .padding(.horizontal, 40)
                #endif

                Spacer()
                    .frame(height: 64)
            }
        }
    }
}

// MARK: — Debug email/password section

private struct DebugEmailSignInView: View {
    @EnvironmentObject private var authService: AuthService
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: 12) {
            Text("DEV ONLY")
                .font(.plusJakarta_caption())
                .fontWeight(.semibold)
                .foregroundColor(.textTertiary)
                .kerning(1.2)

            TextField("email", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .autocapitalization(.none)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.backgroundSurface)
                .cornerRadius(10)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.borderDefault, lineWidth: 1))
                .font(.plusJakarta_body())

            SecureField("password", text: $password)
                .textContentType(.password)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.backgroundSurface)
                .cornerRadius(10)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.borderDefault, lineWidth: 1))
                .font(.plusJakarta_body())

            HStack(spacing: 12) {
                Button("Sign In") {
                    Task { await authService.signInWithEmail(email: email, password: password) }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(Color.accentPrimary)
                .foregroundColor(.white)
                .cornerRadius(10)
                .font(.plusJakarta_body())

                Button("Sign Up") {
                    Task { await authService.signUpWithEmail(email: email, password: password) }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(Color.backgroundSurface2)
                .foregroundColor(.textPrimary)
                .cornerRadius(10)
                .font(.plusJakarta_body())
            }
        }
    }
}

#Preview {
    SignInView()
        .environmentObject(AuthService.shared)
}
