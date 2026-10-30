import Intents

// NSExtensionPrincipalClass — required for the extension Info.plist.
// Siri routes App Intents through the AppIntents framework directly (iOS 16+),
// so this handler is a minimal shim for legacy intent routing only.
final class IntentHandler: INExtension {
    override func handler(for intent: INIntent) -> Any {
        return self
    }
}
