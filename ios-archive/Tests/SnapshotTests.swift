import XCTest
import SnapshotTesting
import SwiftUI
@testable import lalista

// MARK: — Snapshot Test Suite
// 15 test cases per test plan. Library: SnapshotTesting (Point-Free).
//
// First run: set isRecording = true to generate reference snapshots.
// Subsequent runs: set isRecording = false to compare against references.
//
// Run on a fixed device / simulator to avoid false diffs from screen size variation.
// Recommended: iPhone 15 Pro (393pt) simulator, iOS 17+.

final class SnapshotTests: XCTestCase {

    // Set to true for initial reference generation. Commit snapshots after recording.
    private let isRecording = false

    // MARK: — 1. List View — light mode, normal Dynamic Type, 3 items across 2 stores
    func test01_listView_light_normal() {
        let view = listViewWithData(colorScheme: .light, dynamicTypeSize: .medium)
        assertSnapshot(of: view, as: .image(on: .iPhone13Pro), record: isRecording)
    }

    // MARK: — 2. List View — dark mode, normal Dynamic Type
    func test02_listView_dark_normal() {
        let view = listViewWithData(colorScheme: .dark, dynamicTypeSize: .medium)
        assertSnapshot(of: view, as: .image(on: .iPhone13Pro), record: isRecording)
    }

    // MARK: — 3. List View — light mode, AX Large Dynamic Type
    func test03_listView_light_axLarge() {
        let view = listViewWithData(colorScheme: .light, dynamicTypeSize: .accessibility3)
        assertSnapshot(of: view, as: .image(on: .iPhone13Pro), record: isRecording)
    }

    // MARK: — 4. Empty state — light mode
    func test04_emptyState_light() {
        let view = emptyStateView(colorScheme: .light)
        assertSnapshot(of: view, as: .image(on: .iPhone13Pro), record: isRecording)
    }

    // MARK: — 5. Empty state — dark mode
    func test05_emptyState_dark() {
        let view = emptyStateView(colorScheme: .dark)
        assertSnapshot(of: view, as: .image(on: .iPhone13Pro), record: isRecording)
    }

    // MARK: — 6. Skeleton loading state
    func test06_skeleton_loading() {
        let view = SkeletonListView()
            .background(Color.backgroundPrimary)
            .frame(width: 393, height: 700)
            .environment(\.colorScheme, .light)
        assertSnapshot(of: view, as: .image, record: isRecording)
    }

    // MARK: — 7. Amber sync error banner — light mode
    func test07_syncErrorBanner_light() {
        let view = SyncErrorBanner { }
            .frame(width: 393)
            .environment(\.colorScheme, .light)
        assertSnapshot(of: view, as: .image, record: isRecording)
    }

    // MARK: — 8. Amber sync error banner — dark mode
    func test08_syncErrorBanner_dark() {
        let view = SyncErrorBanner { }
            .frame(width: 393)
            .environment(\.colorScheme, .dark)
        assertSnapshot(of: view, as: .image, record: isRecording)
    }

    // MARK: — 9. Disambiguation bottom sheet — store choice, light mode
    func test09_disambiguationSheet_light() {
        let response = makeDisambiguationResponse()
        let vm = ListViewModel()
        let view = DisambiguationSheet(
            response: response,
            utterance: "queso rallado",
            viewModel: vm,
            onDismiss: { }
        )
        .frame(width: 393, height: 500)
        .environment(\.colorScheme, .light)
        assertSnapshot(of: view, as: .image, record: isRecording)
    }

    // MARK: — 10. Disambiguation bottom sheet — dark mode
    func test10_disambiguationSheet_dark() {
        let response = makeDisambiguationResponse()
        let vm = ListViewModel()
        let view = DisambiguationSheet(
            response: response,
            utterance: "queso rallado",
            viewModel: vm,
            onDismiss: { }
        )
        .frame(width: 393, height: 500)
        .environment(\.colorScheme, .dark)
        assertSnapshot(of: view, as: .image, record: isRecording)
    }

    // MARK: — 11. Sign-In screen — light mode
    func test11_signIn_light() {
        let view = SignInView()
            .environmentObject(AuthService.shared)
            .environment(\.colorScheme, .light)
        assertSnapshot(of: view, as: .image(on: .iPhone13Pro), record: isRecording)
    }

    // MARK: — 12. Sign-In screen — dark mode
    func test12_signIn_dark() {
        let view = SignInView()
            .environmentObject(AuthService.shared)
            .environment(\.colorScheme, .dark)
        assertSnapshot(of: view, as: .image(on: .iPhone13Pro), record: isRecording)
    }

    // MARK: — 13. Item Detail — light mode
    func test13_itemDetail_light() {
        let entry = makeSampleEntry()
        let view = ItemDetailView(entry: entry)
            .environmentObject(AuthService.shared)
            .environment(\.colorScheme, .light)
        assertSnapshot(of: view, as: .image(on: .iPhone13Pro), record: isRecording)
    }

    // MARK: — 14. Settings — light mode
    func test14_settings_light() {
        let view = SettingsView()
            .environmentObject(AuthService.shared)
            .environment(\.colorScheme, .light)
        assertSnapshot(of: view, as: .image(on: .iPhone13Pro), record: isRecording)
    }

    // MARK: — 15. Siri confirmation toast — light mode
    func test15_siriToast_light() {
        let toast = ToastItem(itemName: "Shredded Mozzarella", storeName: "Costco")
        let view = SiriConfirmationToast(item: toast, onDismiss: { })
            .frame(width: 361)
            .environment(\.colorScheme, .light)
        assertSnapshot(of: view, as: .image, record: isRecording)
    }
}

// MARK: — Color asset audit
// Verifies all 14 named color tokens exist in Assets.xcassets.
// A missing named color renders as transparent — no error, no crash. This catches typos.
final class ColorAssetAuditTests: XCTestCase {
    func test_allColorTokensExist() {
        let required = [
            "backgroundPrimary", "backgroundSurface", "backgroundSurface2", "backgroundElevated",
            "textPrimary", "textSecondary", "textTertiary",
            "accentPrimary", "accentPrimaryDark", "accentPrimarySoft",
            "borderDefault",
            "successColor", "warningColor", "errorColor", "infoColor",
        ]
        for name in required {
            XCTAssertNotNil(
                UIColor(named: name, in: .main, compatibleWith: nil),
                "Missing color asset '\(name)' — will render transparent in the app. " +
                "Add it to Assets.xcassets with both light and dark appearances."
            )
        }
    }
}

// MARK: — Test fixtures

private func listViewWithData(
    colorScheme: ColorScheme,
    dynamicTypeSize: DynamicTypeSize
) -> some View {
    let vm = ListViewModel()
    vm.sections = sampleSections()

    return ListView()
        .environmentObject(vm)
        .environmentObject(AuthService.shared)
        .environment(\.colorScheme, colorScheme)
        .environment(\.dynamicTypeSize, dynamicTypeSize)
}

private func emptyStateView(colorScheme: ColorScheme) -> some View {
    let vm = ListViewModel()
    vm.sections = []

    return ListView()
        .environmentObject(vm)
        .environmentObject(AuthService.shared)
        .environment(\.colorScheme, colorScheme)
}

private func sampleSections() -> [StoreSectionData] {
    let costcoId = UUID()
    let walmartId = UUID()
    return [
        StoreSectionData(
            id: costcoId,
            storeName: "Costco",
            entries: [
                DisplayEntry(
                    id: UUID(), itemName: "Shredded Mozzarella",
                    brand: "Kirkland 3-pack", quantity: 1, unit: nil,
                    storeName: "Costco", storeId: costcoId,
                    addedByName: "Marco", addedAt: .now
                ),
                DisplayEntry(
                    id: UUID(), itemName: "Whole Milk",
                    brand: nil, quantity: 2, unit: nil,
                    storeName: "Costco", storeId: costcoId,
                    addedByName: "Ana", addedAt: .now
                ),
            ]
        ),
        StoreSectionData(
            id: walmartId,
            storeName: "Walmart",
            entries: [
                DisplayEntry(
                    id: UUID(), itemName: "Tide Pods",
                    brand: nil, quantity: 1, unit: nil,
                    storeName: "Walmart", storeId: walmartId,
                    addedByName: "Marco", addedAt: .now
                ),
            ]
        ),
    ]
}

private func makeSampleEntry() -> DisplayEntry {
    DisplayEntry(
        id: UUID(),
        itemName: "Shredded Mozzarella",
        brand: "Kirkland 3-pack",
        quantity: 1,
        unit: nil,
        storeName: "Costco",
        storeId: UUID(),
        addedByName: "Marco",
        addedAt: Date(timeIntervalSinceNow: -3600)
    )
}

private func makeDisambiguationResponse() -> AddItemResponse {
    AddItemResponse(
        entry_id: nil,
        canonical_item: AddItemResponse.ItemRef(id: UUID(), name: "Shredded Cheese"),
        store: nil,
        brand: nil,
        needs_followup: true,
        followup_type: .store,
        followup_question: "Which store?",
        followup_options: [
            AddItemResponse.FollowupOption(id: UUID(), label: "Costco"),
            AddItemResponse.FollowupOption(id: UUID(), label: "Walmart"),
            AddItemResponse.FollowupOption(id: UUID(), label: "Target"),
        ],
        already_on_list: nil,
        error: nil
    )
}
