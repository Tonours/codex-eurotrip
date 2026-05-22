// input-helper.swift
// Simulates mouse clicks and keyboard input via CGEvent.
// Needs Accessibility permission granted in System Settings.
// Usage:
//   input-helper click <x> <y>
//   input-helper double-click <x> <y>
//   input-helper type <text>
//   input-helper key <keycode> [--shift] [--cmd] [--opt] [--ctrl]
//   input-helper scroll <x> <y> <dx> <dy>
//   input-helper drag <from_x> <from_y> <to_x> <to_y>

import Cocoa
import ApplicationServices
import Foundation

// Check Accessibility permission first
if !AXIsProcessTrusted() {
    fputs("ERROR: Accessibility permission not granted. Grant it in System Settings > Privacy & Security > Accessibility for this binary.\n", stderr)
    exit(1)
}

let args = CommandLine.arguments
guard args.count > 1 else {
    fputs("Usage: input-helper <command> [args...]\n", stderr)
    fputs("Commands: click, double-click, type, key, scroll, drag\n", stderr)
    exit(1)
}

func click(at point: CGPoint, clickCount: Int = 1) {
    let source = CGEventSource(stateID: .hidSystemState)
    
    let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
    down?.setIntegerValueField(.mouseEventClickState, value: Int64(clickCount))
    down?.post(tap: .cghidEventTap)
    
    let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
    up?.setIntegerValueField(.mouseEventClickState, value: Int64(clickCount))
    up?.post(tap: .cghidEventTap)
}

func doubleClick(at point: CGPoint) {
    click(at: point, clickCount: 1)
    usleep(50000) // 50ms between clicks
    click(at: point, clickCount: 2)
}

func typeText(_ text: String) {
    let source = CGEventSource(stateID: .hidSystemState)
    for char in text {
        var uniChar = char.utf16.first!
        let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
        keyDown?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &uniChar)
        keyDown?.post(tap: .cghidEventTap)
        
        let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        keyUp?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &uniChar)
        keyUp?.post(tap: .cghidEventTap)
        
        usleep(10000) // 10ms between keystrokes
    }
}

func pressKey(keycode: Int, modifiers: [String]) {
    let source = CGEventSource(stateID: .hidSystemState)
    
    // Map modifier names to flags
    var flags = CGEventFlags()
    if modifiers.contains("--shift") { flags.insert(.maskShift) }
    if modifiers.contains("--cmd") { flags.insert(.maskCommand) }
    if modifiers.contains("--opt") { flags.insert(.maskAlternate) }
    if modifiers.contains("--ctrl") { flags.insert(.maskControl) }
    
    let keyDown = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(keycode), keyDown: true)
    if !flags.isEmpty { keyDown?.flags = flags }
    keyDown?.post(tap: .cghidEventTap)
    
    let keyUp = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(keycode), keyDown: false)
    if !flags.isEmpty { keyUp?.flags = flags }
    keyUp?.post(tap: .cghidEventTap)
}

func scroll(at point: CGPoint, dx: Int32, dy: Int32) {
    let source = CGEventSource(stateID: .hidSystemState)
    let scroll = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)
    scroll?.post(tap: .cghidEventTap)
}

func drag(from: CGPoint, to: CGPoint) {
    let source = CGEventSource(stateID: .hidSystemState)
    
    let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left)
    down?.post(tap: .cghidEventTap)
    
    // Animate drag in steps
    let steps = 10
    for i in 1...steps {
        let t = CGFloat(i) / CGFloat(steps)
        let x = from.x + (to.x - from.x) * t
        let y = from.y + (to.y - from.y) * t
        let drag = CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)
        drag?.post(tap: .cghidEventTap)
        usleep(10000)
    }
    
    let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left)
    up?.post(tap: .cghidEventTap)
}

let command = args[1]

switch command {
case "click":
    guard args.count >= 4 else { fputs("Usage: input-helper click <x> <y>\n", stderr); exit(1) }
    let x = CGFloat(Double(args[2])!)
    let y = CGFloat(Double(args[3])!)
    click(at: CGPoint(x: x, y: y))
    
case "double-click":
    guard args.count >= 4 else { fputs("Usage: input-helper double-click <x> <y>\n", stderr); exit(1) }
    let x = CGFloat(Double(args[2])!)
    let y = CGFloat(Double(args[3])!)
    doubleClick(at: CGPoint(x: x, y: y))
    
case "type":
    guard args.count >= 3 else { fputs("Usage: input-helper type <text>\n", stderr); exit(1) }
    let text = args[2]
    typeText(text)
    
case "key":
    guard args.count >= 3 else { fputs("Usage: input-helper key <keycode> [--shift] [--cmd] [--opt] [--ctrl]\n", stderr); exit(1) }
    let keycode = Int(args[2])!
    let modifiers = Array(args.dropFirst(3))
    pressKey(keycode: keycode, modifiers: modifiers)
    
case "scroll":
    guard args.count >= 6 else { fputs("Usage: input-helper scroll <x> <y> <dx> <dy>\n", stderr); exit(1) }
    let x = CGFloat(Double(args[2])!)
    let y = CGFloat(Double(args[3])!)
    let dx = Int32(args[4])!
    let dy = Int32(args[5])!
    scroll(at: CGPoint(x: x, y: y), dx: dx, dy: dy)
    
case "drag":
    guard args.count >= 6 else { fputs("Usage: input-helper drag <from_x> <from_y> <to_x> <to_y>\n", stderr); exit(1) }
    let fx = CGFloat(Double(args[2])!)
    let fy = CGFloat(Double(args[3])!)
    let tx = CGFloat(Double(args[4])!)
    let ty = CGFloat(Double(args[5])!)
    drag(from: CGPoint(x: fx, y: fy), to: CGPoint(x: tx, y: ty))
    
default:
    fputs("Unknown command: \(command)\n", stderr)
    exit(1)
}
