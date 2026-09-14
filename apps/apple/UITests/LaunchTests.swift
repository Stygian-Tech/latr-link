import XCTest

final class LaunchTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    @MainActor
    func testSignedOutAppHasAccessibleLogin() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-signed-out"]
        app.launch()
        XCTAssertTrue(app.textFields["AT Protocol handle"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Sign in"].exists)
        XCTAssertFalse(app.buttons["Sign in"].isEnabled)
        capture(app, name: "Signed out")
    }

    @MainActor
    func testLibraryCanSaveThroughNativeQueueAndFilter() {
        let app = fixtureApp()
        XCTAssertTrue(app.staticTexts["Build with SwiftUI"].waitForExistence(timeout: 15))
        app.buttons["Save link"].tap()
        let field = app.textFields["Web link or AT URI"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("https://example.com/native-share-test")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Saved to L@tr.link."].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["https://example.com/native-share-test"].firstMatch.exists)
        app.buttons["Other"].tap()
        XCTAssertTrue(app.staticTexts["Build with SwiftUI"].exists)
        capture(app, name: "Library after native save")
    }

    @MainActor
    func testTabletAndPhoneSettingsAndFeedback() {
        let app = fixtureApp()
        XCTAssertTrue(app.staticTexts["Build with SwiftUI"].waitForExistence(timeout: 15))
        showSidebar(app)
        let settings = app.buttons["sidebar.Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        XCTAssertTrue(app.staticTexts["Theme"].waitForExistence(timeout: 5))
        capture(app, name: "Native settings")
        app.swipeUp()
        let feedback = app.buttons["Send feedback"]
        if !feedback.isHittable { app.swipeUp() }
        feedback.tap()
        XCTAssertTrue(app.textFields["Title"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Publish"].exists)
        XCTAssertFalse(app.buttons["Publish"].isEnabled)
        capture(app, name: "Native feedback")
    }

    @MainActor
    func testSafariShareRetainsSignedOutDraft() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.textFields["AT Protocol handle"].waitForExistence(timeout: 10))
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()
        let address = safari.textFields.matching(NSPredicate(format: "label == %@ OR identifier == %@ OR identifier == %@", "Address", "URL", "TabBarItemTitle")).firstMatch
        XCTAssertTrue(address.waitForExistence(timeout: 10))
        address.tap()
        safari.typeText("https://example.com/native-share-acceptance\n")
        let directShare = safari.buttons.matching(NSPredicate(format: "identifier == %@ OR label == %@", "ShareButton", "Share")).firstMatch
        if !directShare.waitForExistence(timeout: 3) {
            let menu = safari.buttons.matching(NSPredicate(format: "identifier == %@ OR label == %@", "MoreMenuButton", "Page Menu")).firstMatch
            XCTAssertTrue(menu.waitForExistence(timeout: 5))
            menu.tap()
        }
        XCTAssertTrue(directShare.waitForExistence(timeout: 5))
        directShare.tap()
        let extensionButton = safari.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR label == %@", "L@tr.link", "Save to L@tr.link")).firstMatch
        if !extensionButton.waitForExistence(timeout: 4) {
            let more = safari.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "More")).firstMatch
            if !more.isHittable { safari.collectionViews["activityCollectionView"].swipeLeft() }
            XCTAssertTrue(more.waitForExistence(timeout: 5), safari.debugDescription)
            more.tap()
        }
        XCTAssertTrue(extensionButton.waitForExistence(timeout: 10), safari.debugDescription)
        extensionButton.tap()
        let saveDraft = safari.buttons["Save draft"]
        XCTAssertTrue(saveDraft.waitForExistence(timeout: 10), safari.debugDescription)
        saveDraft.tap()
        let result = safari.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Draft retained.")).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 10), safari.debugDescription)
        capture(safari, name: "Safari share draft retained")
        safari.buttons["Done"].tap()
    }

    @MainActor private func fixtureApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-library"]
        app.launch()
        return app
    }

    @MainActor private func showSidebar(_ app: XCUIApplication) {
        if app.buttons["sidebar.Settings"].exists && app.buttons["sidebar.Settings"].isHittable { return }
        let back = app.navigationBars.buttons["L@tr.link"]
        if back.exists { back.tap(); return }
        let sidebar = app.buttons["Show Sidebar"]
        if sidebar.exists { sidebar.tap() }
    }

    @MainActor private func capture(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
