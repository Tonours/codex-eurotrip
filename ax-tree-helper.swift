// ax-tree-helper.swift
// Extract accessibility tree for a running app's front window.
// Needs Accessibility permission granted in System Settings.
// Usage: ax-tree-helper <bundle_id> [--depth N]
// Output: JSON with AX tree nodes

import Cocoa
import ApplicationServices

let args = CommandLine.arguments
guard args.count > 1 else {
    fputs("Usage: ax-tree-helper <bundle_id> [--depth N]\n", stderr)
    exit(1)
}

let bundleId = args[1]
let maxDepth = args.firstIndex(of: "--depth").flatMap { Int(args[$0 + 1]) } ?? 6

// Find the app
let runningApps = NSWorkspace.shared.runningApplications
guard let app = runningApps.first(where: { $0.bundleIdentifier == bundleId }) else {
    print("{\"error\": \"App not running\", \"bundleId\": \"\(bundleId)\"}")
    exit(0)
}

let pid = app.processIdentifier
let appElement = AXUIElementCreateApplication(pid)

// Get front window
var windowRef: AnyObject?
let windowErr = AXUIElementCopyAttributeValue(appElement, kAXMainWindowAttribute as CFString, &windowRef)

guard windowErr == .success, let window = windowRef else {
    // Try focused window
    var focusedRef: AnyObject?
    let focusedErr = AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focusedRef)
    
    guard focusedErr == .success else {
        print("{\"error\": \"No window found\", \"bundleId\": \"\(bundleId)\", \"pid\": \(pid)}")
        exit(0)
    }
    // Use focused element, but get its window
    var winRef: AnyObject?
    AXUIElementCopyAttributeValue(focusedRef as! AXUIElement, kAXWindowAttribute as CFString, &winRef)
    if let win = winRef {
        extractTree(element: win as! AXUIElement, depth: 0)
    } else {
        extractTree(element: focusedRef as! AXUIElement, depth: 0)
    }
    exit(0)
}

// Extract window bounds
var boundsRef: AnyObject?
let boundsErr = AXUIElementCopyAttributeValue(window as! AXUIElement, kAXPositionAttribute as CFString, &boundsRef)
var sizeRef: AnyObject?
let sizeErr = AXUIElementCopyAttributeValue(window as! AXUIElement, kAXSizeAttribute as CFString, &sizeRef)

var windowInfo: [String: Any] = ["pid": pid, "bundleId": bundleId]

if boundsErr == .success, let pos = boundsRef {
    var point = CGPoint()
    AXValueGetValue(pos as! AXValue, .cgPoint, &point)
    windowInfo["x"] = point.x
    windowInfo["y"] = point.y
}
if sizeErr == .success, let sz = sizeRef {
    var size = CGSize()
    AXValueGetValue(sz as! AXValue, .cgSize, &size)
    windowInfo["width"] = size.width
    windowInfo["height"] = size.height
}

// Get window title
var titleRef: AnyObject?
if AXUIElementCopyAttributeValue(window as! AXUIElement, kAXTitleAttribute as CFString, &titleRef) == .success {
    windowInfo["title"] = titleRef as? String ?? ""
}

// Extract AX tree
func extractNode(element: AXUIElement, depth: Int) -> [String: Any]? {
    if depth > maxDepth { return nil }
    
    var role: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
    let roleStr = role as? String ?? "unknown"
    
    // Skip invisible/empty elements
    var isHidden: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXHiddenAttribute as CFString, &isHidden)
    if isHidden as? Bool == true { return nil }
    
    var node: [String: Any] = ["role": roleStr]
    
    // Title
    var title: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &title) == .success,
       let t = title as? String, !t.isEmpty {
        node["title"] = t
    }
    
    // Value
    var value: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value) == .success {
        if let s = value as? String { node["value"] = s }
        else if let n = value as? NSNumber { node["value"] = n }
    }
    
    // Description
    var desc: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXDescriptionAttribute as CFString, &desc) == .success,
       let d = desc as? String, !d.isEmpty {
        node["description"] = d
    }
    
    // Position & Size (for interactive elements)
    if ["AXButton", "AXTextField", "AXTextArea", "AXCheckBox", "AXRadioButton",
        "AXPopUpButton", "AXSlider", "AXStaticText", "AXLink", "AXMenuButton",
        "AXTabGroup", "AXTable", "AXOutline", "AXRow", "AXCell"].contains(roleStr) {
        var pos: AnyObject?
        if AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &pos) == .success,
           let p = pos {
            var point = CGPoint()
            AXValueGetValue(p as! AXValue, .cgPoint, &point)
            node["x"] = point.x
            node["y"] = point.y
        }
        var sz: AnyObject?
        if AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sz) == .success,
           let s = sz {
            var size = CGSize()
            AXValueGetValue(s as! AXValue, .cgSize, &size)
            if size.width > 0, size.height > 0 {
                node["width"] = size.width
                node["height"] = size.height
            }
        }
    }
    
    // Enabled
    var enabled: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXEnabledAttribute as CFString, &enabled) == .success {
        node["enabled"] = enabled as? Bool ?? true
    }
    
    // Focused
    var focused: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXFocusedAttribute as CFString, &focused) == .success,
       focused as? Bool == true {
        node["focused"] = true
    }
    
    // Children
    var children: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success,
       let childArray = children as? [AXUIElement] {
        var childNodes: [[String: Any]] = []
        for child in childArray {
            if let childNode = extractNode(element: child, depth: depth + 1) {
                childNodes.append(childNode)
            }
        }
        if !childNodes.isEmpty {
            node["children"] = childNodes
        }
    }
    
    return node
}

func extractTree(element: AXUIElement, depth: Int) {
    let tree = extractNode(element: element, depth: depth)
    var output = windowInfo
    output["tree"] = tree ?? [:]
    let jsonData = try! JSONSerialization.data(withJSONObject: output)
    print(String(data: jsonData, encoding: .utf8)!)
}

extractTree(element: window as! AXUIElement, depth: 0)
