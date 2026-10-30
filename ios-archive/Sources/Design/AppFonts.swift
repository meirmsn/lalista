import SwiftUI

// MARK: — Design System Typography
// Fraunces: brand moments (wordmark, empty states)
// Plus Jakarta Sans: all functional UI
// Scale matches DESIGN.md exactly.

extension Font {
    // Fraunces — brand/display
    /// 56–72px, weight 400 — wordmark, hero moments (Fraunces 144pt optical size)
    static func fraunces_display() -> Font {
        .custom("Fraunces144pt-Regular", size: 56, relativeTo: .largeTitle)
    }
    /// 36–48px, weight 300 italic — empty states, onboarding (Fraunces 72pt optical size)
    static func fraunces_displayItalic() -> Font {
        .custom("Fraunces72pt-LightItalic", size: 40, relativeTo: .title)
    }

    // Plus Jakarta Sans — functional UI
    /// 28px, weight 600 — screen titles
    static func plusJakarta_headingLG() -> Font {
        .custom("PlusJakartaSans-SemiBold", size: 28, relativeTo: .title)
    }
    /// 22px, weight 600 — section headers
    static func plusJakarta_headingMD() -> Font {
        .custom("PlusJakartaSans-SemiBold", size: 22, relativeTo: .title2)
    }
    /// 17px, weight 400 — primary copy (iOS standard)
    static func plusJakarta_bodyLG() -> Font {
        .custom("PlusJakartaSans-Regular", size: 17, relativeTo: .body)
    }
    /// 15px, weight 400–500 — list item names
    static func plusJakarta_body() -> Font {
        .custom("PlusJakartaSans-Medium", size: 15, relativeTo: .body)
    }
    /// 13px, weight 400 — metadata, timestamps, brand
    static func plusJakarta_caption() -> Font {
        .custom("PlusJakartaSans-Regular", size: 13, relativeTo: .caption)
    }
    /// 11px, weight 600 — section label caps
    static func plusJakarta_micro() -> Font {
        .custom("PlusJakartaSans-SemiBold", size: 11, relativeTo: .caption2)
    }
}

// MARK: — View modifier for tabular numerics (quantities, counts)
struct TabularNumerics: ViewModifier {
    func body(content: Content) -> some View {
        content.monospacedDigit()
    }
}
extension View {
    func tabularNumerics() -> some View {
        modifier(TabularNumerics())
    }
}

// MARK: — Font registration helper
// Call once at app launch to register bundled font files.
enum FontLoader {
    static func registerFonts() {
        let fonts = [
            "Fraunces144pt-Regular",
            "Fraunces72pt-LightItalic",
            "PlusJakartaSans-Regular",
            "PlusJakartaSans-Medium",
            "PlusJakartaSans-SemiBold",
        ]
        for name in fonts {
            guard let url = Bundle.main.url(forResource: name, withExtension: "ttf"),
                  let provider = CGDataProvider(url: url as CFURL),
                  let font = CGFont(provider)
            else {
                // Font file missing — will fall back to SF Pro. Add font files to target.
                continue
            }
            CTFontManagerRegisterGraphicsFont(font, nil)
        }
    }
}
