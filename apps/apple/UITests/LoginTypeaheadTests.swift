import XCTest

final class LoginTypeaheadTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor
    func testSelectSuggestedAccountPopulatesHandleWithoutStartingLogin() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-signed-out", "--ui-test-typeahead"]
        app.launch()
        let field = app.textFields["AT Protocol handle"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("@alice")
        let suggestion = app.buttons["login-suggestion.did:plc:typeaheadalice"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Alice Example"].exists)
        suggestion.tap()
        XCTAssertEqual(field.value as? String, "alice.example")
        XCTAssertFalse(suggestion.exists)
        XCTAssertTrue(app.buttons["Sign in"].isEnabled)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Selected login suggestion"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    @MainActor
    func testChangingToDIDRemovesAccountSuggestions() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-signed-out", "--ui-test-typeahead"]
        app.launch()
        let field = app.textFields["AT Protocol handle"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("alice")
        let suggestion = app.buttons["login-suggestion.did:plc:typeaheadalice"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 5))
        field.typeText(":plc")
        XCTAssertTrue(suggestion.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Sign in"].isEnabled)
    }

    @MainActor
    func testSwipeActionsExposeArchiveAndDestructiveDelete() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-library"]
        app.launch()
        let row = app.staticTexts["Build with SwiftUI"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.swipeLeft()
        XCTAssertTrue(app.buttons["Archive"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Delete"].exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Archive and destructive delete swipe actions"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
    @MainActor
    func testLeadingSwipeExposesTaggedAction() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-test-library"]
        app.launch()
        let row = app.staticTexts["Build with SwiftUI"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.swipeRight()
        XCTAssertTrue(app.buttons["bookmark-tags-action"].waitForExistence(timeout: 5))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Tag swipe action"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

}
