import AppKit
import Foundation

let workspace = NSWorkspace.shared
let fileManager = FileManager.default

func uniqueExistingDirectories(_ urls: [URL]) -> [URL] {
    var seen = Set<String>()
    var result: [URL] = []

    for url in urls {
        var isDirectory: ObjCBool = false
        let path = url.path
        guard fileManager.fileExists(atPath: path, isDirectory: &isDirectory),
              isDirectory.boolValue,
              !seen.contains(path) else {
            continue
        }
        seen.insert(path)
        result.append(url)
    }

    return result
}

let appDirs = uniqueExistingDirectories(
    fileManager.urls(for: .applicationDirectory, in: .allDomainsMask)
        + fileManager.urls(for: .coreServiceDirectory, in: .allDomainsMask)
)

// Apple apps that ARE useful to show
let includedAppleApps: Set<String> = [
    "com.apple.finder", "com.apple.Safari", "com.apple.mail", "com.apple.Notes",
    "com.apple.iChat", "com.apple.FaceTime", "com.apple.Photos", "com.apple.iMovie",
    "com.apple.garageband", "com.apple.Keynote", "com.apple.Numbers", "com.apple.Pages",
    "com.apple.TextEdit", "com.apple.Preview", "com.apple.console", "com.apple.ActivityMonitor",
    "com.apple.DiskUtility", "com.apple.Terminal", "com.apple.ScriptEditor",
    "com.apple.systempreferences", "com.apple.Calendar", "com.apple.Reminders",
    "com.apple.Maps", "com.apple.Music", "com.apple.Podcasts", "com.apple.tv",
    "com.apple.ArchiveUtility", "com.apple.QuickTimePlayerX", "com.apple.Image_Capture",
    "com.apple.Chess", "com.apple.stickies", "com.apple.Dictionary",
    "com.apple.AppStore", "com.apple.Grapher", "com.apple.MiniPlayer",
    "com.apple.ScreenCapture", "com.apple.weather", "com.apple.freeform",
    "com.apple.LaunchPad", "com.apple.MissionControl", "com.apple.Spotlight",
]

var allApps: [String: [String: Any]] = [:]

// Get running apps first
let runningApps = workspace.runningApplications.filter { app in
    guard app.bundleIdentifier != nil else { return false }
    if app.activationPolicy == .accessory || app.activationPolicy == .prohibited { return false }
    return true
}

for app in runningApps {
    guard let bundleId = app.bundleIdentifier, !bundleId.isEmpty else { continue }
    if bundleId.hasPrefix("com.apple.") && !includedAppleApps.contains(bundleId) {
        guard let name = app.localizedName, !name.isEmpty, name != bundleId else { continue }
    }
    
    let appName = app.localizedName ?? bundleId.components(separatedBy: ".").last ?? bundleId
    allApps[bundleId] = [
        "bundleIdentifier": bundleId,
        "appName": appName,
        "isRunning": true,
        "bundlePath": app.bundleURL?.path ?? "",
        "usageFrequency": "frequently"
    ]
}

func appBundles(in directory: URL, depth: Int = 0) -> [URL] {
    guard let contents = try? fileManager.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.isDirectoryKey],
        options: [.skipsHiddenFiles]
    ) else {
        return []
    }

    var bundles: [URL] = []
    for url in contents {
        if url.pathExtension == "app" {
            bundles.append(url)
            continue
        }

        if depth == 0,
           (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
            bundles.append(contentsOf: appBundles(in: url, depth: depth + 1))
        }
    }
    return bundles
}

// Add installed apps from standard macOS application directories.
for dir in appDirs {
    for appUrl in appBundles(in: dir) {
        let path = appUrl.path
        let bundle = Bundle(path: path)
        let bundleId = bundle?.bundleIdentifier ?? ""
        
        guard !bundleId.isEmpty else { continue }
        if allApps[bundleId] != nil { continue }
        if bundleId.hasPrefix("com.apple.") && !includedAppleApps.contains(bundleId) { continue }
        
        let appName = bundle?.object(forInfoDictionaryKey: "CFBundleName") as? String
            ?? bundle?.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            ?? appUrl.deletingPathExtension().lastPathComponent
        
        allApps[bundleId] = [
            "bundleIdentifier": bundleId,
            "appName": appName,
            "isRunning": false,
            "bundlePath": path,
            "usageFrequency": "installed"
        ]
    }
}

// Sort: running first, then by name
let sorted = allApps.values.sorted { (a, b) -> Bool in
    let aRunning = a["isRunning"] as? Bool ?? false
    let bRunning = b["isRunning"] as? Bool ?? false
    if aRunning != bRunning { return aRunning }
    return (a["appName"] as? String ?? "") < (b["appName"] as? String ?? "")
}

let runningCount = sorted.filter { ($0["isRunning"] as? Bool ?? false) == true }.count
let output: [String: Any] = ["apps": sorted, "totalRunning": runningCount, "totalInstalled": sorted.count]
let jsonData = try! JSONSerialization.data(withJSONObject: output)
print(String(data: jsonData, encoding: .utf8)!)
