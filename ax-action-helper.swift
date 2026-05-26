// ax-action-helper.swift
// Local Computer Use accessibility tree and actions backed by macOS AX/CGEvent.
// Usage: ax-action-helper '<json-payload>'

import AppKit
import ApplicationServices
import Foundation

func writeJson(_ object: [String: Any]) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [])
    print(String(data: data, encoding: .utf8)!)
    exit(0)
}

func fail(_ message: String, _ extra: [String: Any] = [:]) -> Never {
    var output: [String: Any] = ["ok": false, "error": message]
    for (key, value) in extra {
        output[key] = value
    }
    writeJson(output)
}

guard CommandLine.arguments.count >= 2,
      let payloadData = CommandLine.arguments[1].data(using: .utf8),
      let payload = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any] else {
    fail("Usage: ax-action-helper '<json-payload>'")
}

let command = payload["command"] as? String ?? ""
let appIdentifier = payload["app"] as? String ?? ""

if command.isEmpty {
    fail("Missing command")
}
if appIdentifier.isEmpty {
    fail("Missing app")
}

if !AXIsProcessTrusted() {
    fail("Accessibility permission not granted. Grant access in System Settings > Privacy & Security > Accessibility for ax-action-helper.")
}

func doubleValue(_ key: String) -> Double? {
    if let value = payload[key] as? Double { return value }
    if let value = payload[key] as? Int { return Double(value) }
    if let value = payload[key] as? NSNumber { return value.doubleValue }
    if let value = payload[key] as? String { return Double(value) }
    return nil
}

func intValue(_ key: String) -> Int? {
    if let value = payload[key] as? Int { return value }
    if let value = payload[key] as? Double { return Int(value) }
    if let value = payload[key] as? NSNumber { return value.intValue }
    if let value = payload[key] as? String { return Int(value) }
    return nil
}

func runProcess(_ executable: String, _ arguments: [String]) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    try? process.run()
    process.waitUntilExit()
}

func matches(_ app: NSRunningApplication, _ identifier: String) -> Bool {
    let lowered = identifier.lowercased()
    if app.bundleIdentifier == identifier { return true }
    if app.bundleURL?.path == identifier { return true }
    if app.localizedName?.lowercased() == lowered { return true }
    if let last = app.bundleIdentifier?.components(separatedBy: ".").last?.lowercased(), last == lowered {
        return true
    }
    return false
}

func findRunningApp(_ identifier: String) -> NSRunningApplication? {
    NSWorkspace.shared.runningApplications.first { matches($0, identifier) }
}

func launchApp(_ identifier: String) -> NSRunningApplication? {
    if identifier.hasPrefix("/") {
        runProcess("/usr/bin/open", [identifier])
    } else if identifier.contains(".") {
        runProcess("/usr/bin/open", ["-b", identifier])
    } else {
        runProcess("/usr/bin/open", ["-a", identifier])
    }

    for _ in 0..<40 {
        if let app = findRunningApp(identifier) {
            return app
        }
        usleep(250_000)
    }
    return nil
}

guard let targetApp = findRunningApp(appIdentifier) ?? launchApp(appIdentifier) else {
    fail("Could not resolve or launch app: \(appIdentifier)")
}

if #available(macOS 14.0, *) {
    targetApp.activate()
} else {
    _ = targetApp.activate(options: [.activateIgnoringOtherApps])
}
usleep(200_000)

let appElement = AXUIElementCreateApplication(targetApp.processIdentifier)

func getWindow() -> AXUIElement? {
    var mainRef: AnyObject?
    if AXUIElementCopyAttributeValue(appElement, kAXMainWindowAttribute as CFString, &mainRef) == .success,
       let mainRef {
        return (mainRef as! AXUIElement)
    }

    var focusedRef: AnyObject?
    if AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &focusedRef) == .success,
       let focusedRef {
        return (focusedRef as! AXUIElement)
    }

    return nil
}

func isHidden(_ element: AXUIElement) -> Bool {
    var hiddenRef: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXHiddenAttribute as CFString, &hiddenRef) == .success,
       hiddenRef as? Bool == true {
        return true
    }
    return false
}

func children(of element: AXUIElement) -> [AXUIElement] {
    var childrenRef: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef) == .success,
       let childArray = childrenRef as? [AXUIElement] {
        return childArray
    }
    return []
}

func findElement(in root: AXUIElement, targetIndex: Int, maxDepth: Int = 6) -> AXUIElement? {
    var currentIndex = 0

    func visit(_ element: AXUIElement, _ depth: Int) -> AXUIElement? {
        if depth > maxDepth || isHidden(element) {
            return nil
        }

        let thisIndex = currentIndex
        currentIndex += 1
        if thisIndex == targetIndex {
            return element
        }

        for child in children(of: element) {
            if let found = visit(child, depth + 1) {
                return found
            }
        }
        return nil
    }

    return visit(root, 0)
}

func pointAndSize(of element: AXUIElement) -> (CGPoint, CGSize)? {
    var positionRef: AnyObject?
    var sizeRef: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionRef) == .success,
          AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success,
          let positionRef,
          let sizeRef else {
        return nil
    }

    var point = CGPoint()
    var size = CGSize()
    AXValueGetValue(positionRef as! AXValue, .cgPoint, &point)
    AXValueGetValue(sizeRef as! AXValue, .cgSize, &size)
    return (point, size)
}

func windowOriginAndScale() -> (CGPoint, CGFloat)? {
    guard let window = getWindow(), let (origin, size) = pointAndSize(of: window) else {
        return nil
    }

    let center = CGPoint(x: origin.x + size.width / 2, y: origin.y + size.height / 2)
    let screen = NSScreen.screens.first { screen in
        screen.frame.contains(center)
    } ?? NSScreen.main
    return (origin, screen?.backingScaleFactor ?? 1.0)
}

func mouseButton(_ name: String?) -> CGMouseButton {
    switch (name ?? "left").lowercased() {
    case "right": return .right
    case "middle": return .center
    default: return .left
    }
}

func mouseTypes(for button: CGMouseButton) -> (CGEventType, CGEventType) {
    switch button {
    case .right:
        return (.rightMouseDown, .rightMouseUp)
    case .center:
        return (.otherMouseDown, .otherMouseUp)
    default:
        return (.leftMouseDown, .leftMouseUp)
    }
}

func click(at point: CGPoint, buttonName: String?, count: Int) {
    let button = mouseButton(buttonName)
    let (downType, upType) = mouseTypes(for: button)
    let source = CGEventSource(stateID: .hidSystemState)
    let clickCount = max(1, count)

    for clickNumber in 1...clickCount {
        let down = CGEvent(mouseEventSource: source, mouseType: downType, mouseCursorPosition: point, mouseButton: button)
        down?.setIntegerValueField(.mouseEventClickState, value: Int64(clickNumber))
        down?.post(tap: .cghidEventTap)

        let up = CGEvent(mouseEventSource: source, mouseType: upType, mouseCursorPosition: point, mouseButton: button)
        up?.setIntegerValueField(.mouseEventClickState, value: Int64(clickNumber))
        up?.post(tap: .cghidEventTap)
        usleep(60_000)
    }
}

func scroll(at point: CGPoint, direction: String, pages: Double) {
    let amount = Int32(max(0.05, pages) * 300.0)
    let dx: Int32
    let dy: Int32
    switch direction.lowercased() {
    case "left":
        dx = amount
        dy = 0
    case "right":
        dx = -amount
        dy = 0
    case "up":
        dx = 0
        dy = -amount
    default:
        dx = 0
        dy = amount
    }

    CGWarpMouseCursorPosition(point)
    let source = CGEventSource(stateID: .hidSystemState)
    let event = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)
    event?.post(tap: .cghidEventTap)
}

func drag(from: CGPoint, to: CGPoint) {
    let source = CGEventSource(stateID: .hidSystemState)
    let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left)
    down?.post(tap: .cghidEventTap)

    let steps = 12
    for step in 1...steps {
        let t = CGFloat(step) / CGFloat(steps)
        let point = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
        let move = CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: point, mouseButton: .left)
        move?.post(tap: .cghidEventTap)
        usleep(12_000)
    }

    let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left)
    up?.post(tap: .cghidEventTap)
}

func typeText(_ text: String) {
    let source = CGEventSource(stateID: .hidSystemState)
    for scalar in text.unicodeScalars {
        var value = UniChar(scalar.value)
        let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
        down?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &value)
        down?.post(tap: .cghidEventTap)

        let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        up?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &value)
        up?.post(tap: .cghidEventTap)
        usleep(10_000)
    }
}

let keyCodes: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7,
    "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15,
    "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22,
    "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
    "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "return": 36,
    "enter": 36, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42,
    ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "tab": 48, "space": 49,
    "`": 50, "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
    "up": 126, "down": 125, "left": 123, "right": 124, "home": 115,
    "end": 119, "pageup": 116, "pagedown": 121, "f1": 122, "f2": 120,
    "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100,
    "f9": 101, "f10": 109, "f11": 103, "f12": 111
]

func pressKey(_ keySpec: String) {
    let parts = keySpec.split(separator: "+").map { String($0).lowercased() }
    guard let main = parts.last else {
        fail("Missing key")
    }

    var flags = CGEventFlags()
    for modifier in parts.dropLast() {
        switch modifier {
        case "cmd", "command", "super", "meta":
            flags.insert(.maskCommand)
        case "ctrl", "control":
            flags.insert(.maskControl)
        case "shift":
            flags.insert(.maskShift)
        case "alt", "opt", "option":
            flags.insert(.maskAlternate)
        default:
            break
        }
    }

    guard let keyCode = keyCodes[main] else {
        if main.count == 1, flags.isEmpty {
            typeText(main)
            return
        }
        fail("Unsupported key: \(keySpec)")
    }

    let source = CGEventSource(stateID: .hidSystemState)
    let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true)
    down?.flags = flags
    down?.post(tap: .cghidEventTap)

    let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false)
    up?.flags = flags
    up?.post(tap: .cghidEventTap)
}

func targetElement() -> AXUIElement {
    guard let elementIndexString = payload["element_index"] as? String,
          let elementIndex = Int(elementIndexString) else {
        fail("Missing or invalid element_index")
    }
    guard let window = getWindow() else {
        fail("No window found for app: \(appIdentifier)")
    }
    guard let element = findElement(in: window, targetIndex: elementIndex) else {
        fail("Element index not found: \(elementIndexString)")
    }
    return element
}

func center(of element: AXUIElement) -> CGPoint {
    guard let (point, size) = pointAndSize(of: element), size.width > 0, size.height > 0 else {
        fail("Element has no actionable bounds")
    }
    return CGPoint(x: point.x + size.width / 2, y: point.y + size.height / 2)
}

func screenshotPoint(x: Double, y: Double) -> CGPoint {
    guard let (origin, scale) = windowOriginAndScale() else {
        fail("No window bounds available for screenshot coordinate translation")
    }
    return CGPoint(x: origin.x + CGFloat(x) / scale, y: origin.y + CGFloat(y) / scale)
}

func stringValue(of element: AXUIElement) -> String {
    var valueRef: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &valueRef) == .success,
       let value = valueRef as? String {
        return value
    }

    var titleRef: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &titleRef) == .success,
       let title = titleRef as? String {
        return title
    }

    return ""
}

func setSelectedRange(element: AXUIElement, location: Int, length: Int) {
    var range = CFRange(location: location, length: length)
    guard let axRange = AXValueCreate(.cfRange, &range) else {
        fail("Could not create AX selected text range")
    }
    let err = AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, axRange)
    if err != .success {
        fail("Could not set selected text range", ["axError": err.rawValue])
    }
}

func axAttribute(_ element: AXUIElement, _ attribute: String) -> AnyObject? {
    var value: AnyObject?
    if AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success {
        return value
    }
    return nil
}

func role(of element: AXUIElement) -> String {
    axAttribute(element, kAXRoleAttribute) as? String ?? "unknown"
}

func extractNode(element: AXUIElement, depth: Int, maxDepth: Int) -> [String: Any]? {
    if depth > maxDepth || isHidden(element) {
        return nil
    }

    let roleString = role(of: element)
    var node: [String: Any] = ["role": roleString]

    if let title = axAttribute(element, kAXTitleAttribute) as? String, !title.isEmpty {
        node["title"] = title
    }

    if let value = axAttribute(element, kAXValueAttribute) {
        if let string = value as? String {
            node["value"] = string
        } else if let number = value as? NSNumber {
            node["value"] = number
        }
    }

    if let description = axAttribute(element, kAXDescriptionAttribute) as? String, !description.isEmpty {
        node["description"] = description
    }

    if ["AXButton", "AXTextField", "AXTextArea", "AXCheckBox", "AXRadioButton",
        "AXPopUpButton", "AXSlider", "AXStaticText", "AXLink", "AXMenuButton",
        "AXTabGroup", "AXTable", "AXOutline", "AXRow", "AXCell"].contains(roleString),
       let (point, size) = pointAndSize(of: element) {
        node["x"] = point.x
        node["y"] = point.y
        if size.width > 0, size.height > 0 {
            node["width"] = size.width
            node["height"] = size.height
        }
    }

    if let enabled = axAttribute(element, kAXEnabledAttribute) as? Bool {
        node["enabled"] = enabled
    }

    if let focused = axAttribute(element, kAXFocusedAttribute) as? Bool, focused {
        node["focused"] = true
    }

    let childNodes = children(of: element).compactMap { child in
        extractNode(element: child, depth: depth + 1, maxDepth: maxDepth)
    }
    if !childNodes.isEmpty {
        node["children"] = childNodes
    }

    return node
}

func emitTree() -> Never {
    guard let window = getWindow() else {
        writeJson(["ok": false, "error": "No window found", "bundleId": targetApp.bundleIdentifier ?? appIdentifier, "pid": targetApp.processIdentifier])
    }

    var output: [String: Any] = [
        "ok": true,
        "pid": targetApp.processIdentifier,
        "bundleId": targetApp.bundleIdentifier ?? appIdentifier
    ]

    if let (point, size) = pointAndSize(of: window) {
        output["x"] = point.x
        output["y"] = point.y
        output["width"] = size.width
        output["height"] = size.height
    }

    if let title = axAttribute(window, kAXTitleAttribute) as? String {
        output["title"] = title
    }

    output["tree"] = extractNode(element: window, depth: 0, maxDepth: intValue("depth") ?? 6) ?? [:]
    writeJson(output)
}

switch command {
case "tree":
    emitTree()

case "clickPoint":
    guard let x = doubleValue("x"),
          let y = doubleValue("y") else {
        fail("Missing x/y")
    }
    click(
        at: screenshotPoint(x: x, y: y),
        buttonName: payload["mouse_button"] as? String,
        count: intValue("click_count") ?? 1
    )

case "clickElement":
    let element = targetElement()
    click(
        at: center(of: element),
        buttonName: payload["mouse_button"] as? String,
        count: intValue("click_count") ?? 1
    )

case "scrollElement":
    let element = targetElement()
    scroll(
        at: center(of: element),
        direction: payload["direction"] as? String ?? "down",
        pages: doubleValue("pages") ?? 1.0
    )

case "drag":
    guard let fromX = doubleValue("from_x"),
          let fromY = doubleValue("from_y"),
          let toX = doubleValue("to_x"),
          let toY = doubleValue("to_y") else {
        fail("Missing drag coordinates")
    }
    drag(from: screenshotPoint(x: fromX, y: fromY), to: screenshotPoint(x: toX, y: toY))

case "typeText":
    typeText(payload["text"] as? String ?? "")

case "pressKey":
    pressKey(payload["key"] as? String ?? "")

case "setValue":
    let element = targetElement()
    let value = payload["value"] as? String ?? ""
    let err = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
    if err != .success {
        fail("Could not set AX value", ["axError": err.rawValue])
    }

case "performAction":
    let element = targetElement()
    let action = payload["action"] as? String ?? ""
    if action.isEmpty {
        fail("Missing action")
    }
    let err = AXUIElementPerformAction(element, action as CFString)
    if err != .success {
        var actionsRef: CFArray?
        var available: [String] = []
        if AXUIElementCopyActionNames(element, &actionsRef) == .success,
           let actions = actionsRef as? [String] {
            available = actions
        }
        fail("Could not perform AX action", ["axError": err.rawValue, "availableActions": available])
    }

case "selectText":
    let element = targetElement()
    let target = payload["text"] as? String ?? ""
    if target.isEmpty {
        fail("Missing text")
    }

    let value = stringValue(of: element) as NSString
    let prefix = payload["prefix"] as? String
    let suffix = payload["suffix"] as? String
    var searchRange = NSRange(location: 0, length: value.length)
    var selectedRange: NSRange?

    while searchRange.location < value.length {
        let range = value.range(of: target, options: [], range: searchRange)
        if range.location == NSNotFound {
            break
        }

        let before = value.substring(to: range.location)
        let afterLocation = range.location + range.length
        let after = afterLocation <= value.length ? value.substring(from: afterLocation) : ""
        let prefixMatches = prefix == nil || before.hasSuffix(prefix!)
        let suffixMatches = suffix == nil || after.hasPrefix(suffix!)

        if prefixMatches && suffixMatches {
            selectedRange = range
            break
        }

        let nextLocation = range.location + max(1, range.length)
        searchRange = NSRange(location: nextLocation, length: value.length - nextLocation)
    }

    guard let range = selectedRange else {
        fail("Target text not found")
    }

    switch payload["selection"] as? String ?? "text" {
    case "cursor_before":
        setSelectedRange(element: element, location: range.location, length: 0)
    case "cursor_after":
        setSelectedRange(element: element, location: range.location + range.length, length: 0)
    default:
        setSelectedRange(element: element, location: range.location, length: range.length)
    }

default:
    fail("Unknown command: \(command)")
}

writeJson(["ok": true, "command": command])
