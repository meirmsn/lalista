import SwiftUI

// MARK: — Design System Color Tokens
// All colors sourced from DESIGN.md. Never hardcode hex values in views.
// Use SwiftUI Environment colorScheme via named Color assets (Assets.xcassets).

extension Color {
    // Backgrounds
    static let backgroundPrimary   = Color("backgroundPrimary")   // light #FDFAF6 / dark #1A1208
    static let backgroundSurface   = Color("backgroundSurface")   // light #FFFFFF  / dark #2A2018
    static let backgroundSurface2  = Color("backgroundSurface2")  // light #F5F0E8  / dark #38301F
    static let backgroundElevated  = Color("backgroundElevated")  // light #FFFFFF  / dark #38301F

    // Text
    static let textPrimary     = Color("textPrimary")     // light #1A1208 / dark #F5EFE6
    static let textSecondary   = Color("textSecondary")   // light #7A6A56 / dark #A8998A
    static let textTertiary    = Color("textTertiary")    // light #A8998A / dark #6A5C4E

    // Accent
    static let accentPrimary     = Color("accentPrimary")     // #D4603A (same both modes)
    static let accentPrimaryDark = Color("accentPrimaryDark") // #A8471E
    static let accentPrimarySoft = Color("accentPrimarySoft") // light #FBE8E0 / dark #3A2018

    // Border
    static let borderDefault = Color("borderDefault") // light #E8E0D4 / dark #3A3020

    // Semantic
    static let successColor   = Color("successColor")   // light #5A8A5E / dark #4A7A4E
    static let successBg      = Color("successBg")      // light #EBF4EC / dark #1A2A1C
    static let warningColor   = Color("warningColor")   // light #E8A228 / dark #D09020
    static let warningBg      = Color("warningBg")      // light #FDF4E3 / dark #2A2010
    static let errorColor     = Color("errorColor")     // light #C0392B / dark #A02018
    static let errorBg        = Color("errorBg")        // light #FAEAE8 / dark #2A1816
    static let infoColor      = Color("infoColor")      // light #3B82B4 / dark #2A70A0
    static let infoBg         = Color("infoBg")         // light #EBF3FA / dark #18202A
}

// MARK: — UIColor equivalents for UIKit interop (e.g. UITableView separators)
extension UIColor {
    static let borderDefault    = UIColor(named: "borderDefault")!
    static let backgroundPrimary = UIColor(named: "backgroundPrimary")!
    static let textPrimary       = UIColor(named: "textPrimary")!
    static let textSecondary     = UIColor(named: "textSecondary")!
}
