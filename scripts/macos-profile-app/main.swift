import AppKit
import Foundation

struct Configuration: Codable {
    let name: String
    let profile: String
    let launcher: String
    let repository: String
    let runtimePath: String
    let logDirectory: String
    let companionEndpoint: String
    let companionProfileDirectory: String
    let browserApplication: String
    let sessionRegistry: String
}

struct VerifiedBrowser: Codable {
    let profile: String
    let pid: Int32
    let endpoint: String
    let started: Bool
    let shieldVerified: Bool
}

func launchEnvironment(_ inherited: [String: String], config: Configuration) -> [String: String] {
    var env = inherited.filter { !$0.key.hasPrefix("ALLMAN_") && !$0.key.hasPrefix("PLAYWRIGHT_") }
    env["PATH"] = config.runtimePath
    env["ALLMAN_PROFILE"] = config.profile
    env["ALLMAN_ACCOUNT"] = config.profile
    return env
}

func configuration() throws -> Configuration {
    guard let url = Bundle.main.url(forResource: "launcher", withExtension: "json") else {
        throw NSError(domain: "BrowserOSProfile", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Launcher configuration is missing."])
    }
    return try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: url))
}

func ensureCompanionBrowser(_ config: Configuration) throws {
    func run(_ executable: String, _ arguments: [String]) throws -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        return process.terminationStatus
    }
    func ready() throws -> Bool {
        try run("/usr/bin/curl", ["--silent", "--fail", "--max-time", "2",
                                  config.companionEndpoint + "/json/version"]) == 0
    }
    if try ready() { return }
    // Explicitly reopen the saved Brian profile; never borrow JP's CDP endpoint.
    let status = try run("/usr/bin/open", ["-n", "-g", "-a", config.browserApplication, "--args",
        "--user-data-dir=" + config.companionProfileDirectory,
        "--remote-debugging-port=9222", "--browseros-cdp-port=9222",
        "--restore-last-session", "chrome://version"])
    guard status == 0 else {
        throw NSError(domain: "BrowserOSProfile", code: Int(status),
                      userInfo: [NSLocalizedDescriptionKey: "Could not reopen Brian's saved browser for the account-switch guard."])
    }
    let deadline = Date().addingTimeInterval(45)
    while Date() < deadline {
        if try ready() { return }
        Thread.sleep(forTimeInterval: 0.5)
    }
    throw NSError(domain: "BrowserOSProfile", code: 3,
                  userInfo: [NSLocalizedDescriptionKey: "Brian's saved browser did not expose CDP. JP was not activated; reopen Brian's browser and retry."])
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var busy = false
    var config: Configuration?
    var activationObserver: NSObjectProtocol?

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            config = try configuration()
            let menu = NSMenu()
            let item = NSMenuItem()
            let appMenu = NSMenu()
            appMenu.addItem(withTitle: "Open JP Browser", action: #selector(openBrowser), keyEquivalent: "o").target = self
            appMenu.addItem(withTitle: "Show Launcher Log", action: #selector(showLog), keyEquivalent: "l").target = self
            appMenu.addItem(.separator())
            appMenu.addItem(withTitle: "Quit JP Launcher", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
            item.submenu = appMenu
            menu.addItem(item)
            NSApp.mainMenu = menu
            activationObserver = NSWorkspace.shared.notificationCenter.addObserver(
                forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
            ) { [weak self] notification in
                guard let self, !self.busy, let config = self.config,
                      let browser = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                      browser.bundleIdentifier == "com.allman.browser.jp.engine" else { return }
                let data = try? Data(contentsOf: URL(fileURLWithPath: config.sessionRegistry))
                let registry = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                if registry?["active"] as? String != config.profile { self.openBrowser() }
            }
            openBrowser()
        } catch { showFailure(error.localizedDescription) }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openBrowser()
        return false
    }

    @objc func showLog() {
        guard let config else { return }
        NSWorkspace.shared.open(URL(fileURLWithPath: config.logDirectory).appendingPathComponent("app-launch.log"))
    }

    @objc func openBrowser() {
        guard !busy, let config else { return }
        busy = true
        NSApp.dockTile.badgeLabel = "…"
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let directory = URL(fileURLWithPath: config.logDirectory)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                    attributes: [.posixPermissions: 0o700])
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
                process.arguments = [config.launcher, "--restore-session", "--json"]
                process.currentDirectoryURL = URL(fileURLWithPath: config.repository)
                process.environment = launchEnvironment(ProcessInfo.processInfo.environment, config: config)
                let pipe = Pipe()
                process.standardOutput = pipe
                process.standardError = pipe
                try process.run()
                let output = pipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                let log = directory.appendingPathComponent("app-launch.log")
                try output.write(to: log, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: log.path)
                guard process.terminationStatus == 0 else {
                    throw NSError(domain: "BrowserOSProfile", code: Int(process.terminationStatus),
                        userInfo: [NSLocalizedDescriptionKey: "JP browser verification failed. Open the launcher log for details. Your saved profile was preserved."])
                }
                let browser = try JSONDecoder().decode(VerifiedBrowser.self, from: output)
                guard browser.profile == config.profile, browser.shieldVerified, browser.pid > 0,
                      browser.endpoint == "http://127.0.0.1:9223" else {
                    throw NSError(domain: "BrowserOSProfile", code: 2,
                        userInfo: [NSLocalizedDescriptionKey: "Launcher returned an unverified browser identity."])
                }
                // Use the existing guarded switch; never change the registry directly.
                try ensureCompanionBrowser(config)
                let activation = Process()
                activation.executableURL = URL(fileURLWithPath: config.repository).appendingPathComponent("bin/allman")
                activation.arguments = ["session", "activate", config.profile]
                activation.currentDirectoryURL = URL(fileURLWithPath: config.repository)
                activation.environment = launchEnvironment(ProcessInfo.processInfo.environment, config: config)
                let activationPipe = Pipe()
                activation.standardOutput = activationPipe
                activation.standardError = activationPipe
                try activation.run()
                let activationOutput = activationPipe.fileHandleForReading.readDataToEndOfFile()
                activation.waitUntilExit()
                try (output + activationOutput).write(to: log, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: log.path)
                guard activation.terminationStatus == 0 else {
                    throw NSError(domain: "BrowserOSProfile", code: Int(activation.terminationStatus),
                        userInfo: [NSLocalizedDescriptionKey: "JP browser opened, but account activation failed. Keep both registered browsers open, then retry. Open the launcher log for details."])
                }
                DispatchQueue.main.async {
                    self.busy = false
                    NSApp.dockTile.badgeLabel = nil
                    guard let application = NSRunningApplication(processIdentifier: browser.pid),
                          ["com.allman.browser.jp.engine", "com.browseros.BrowserClaw"].contains(application.bundleIdentifier ?? "") else {
                        self.showFailure("Verified JP browser exited before it could be focused. Open the launcher again.")
                        return
                    }
                    if #available(macOS 14.0, *) { NSApp.yieldActivation(to: application) }
                    let focused = application.activate(options: [.activateAllWindows])
                    let receipt: [String: Any] = [
                        "verifiedAt": ISO8601DateFormatter().string(from: Date()),
                        "profile": browser.profile, "browserPID": browser.pid,
                        "endpoint": browser.endpoint, "started": browser.started,
                        "activatedProfile": config.profile,
                        "shieldVerified": browser.shieldVerified, "focusRequested": focused,
                        "launcherPID": ProcessInfo.processInfo.processIdentifier,
                        "bundleIdentifier": Bundle.main.bundleIdentifier ?? "",
                        "browserBundleIdentifier": application.bundleIdentifier ?? "",
                        "launcherAccessory": NSApp.activationPolicy() == .accessory,
                    ]
                    let receiptURL = directory.appendingPathComponent("app-launch.json")
                    do {
                        try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys])
                            .write(to: receiptURL, options: .atomic)
                        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: receiptURL.path)
                    } catch { self.showFailure("Browser verified, but launch receipt could not be saved: \(error.localizedDescription)") }
                }
            } catch {
                DispatchQueue.main.async {
                    // Keep focus notifications from retrying while the error dialog closes.
                    self.showFailure(error.localizedDescription)
                    self.busy = false
                }
            }
        }
    }

    func showFailure(_ message: String) {
        NSApp.dockTile.badgeLabel = "!"
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "BrowserOS JP could not finish opening"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Open Log")
        if alert.runModal() == .alertSecondButtonReturn { showLog() }
    }
}

if CommandLine.arguments.contains("--self-test") {
    let config = try configuration()
    let env = launchEnvironment(["ALLMAN_PROFILE": "brian", "ALLMAN_CDP_URL": "wrong",
                                 "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH": "wrong", "KEEP": "yes"], config: config)
    precondition(env["ALLMAN_PROFILE"] == config.profile)
    precondition(env["ALLMAN_ACCOUNT"] == config.profile)
    precondition(env["ALLMAN_CDP_URL"] == nil)
    precondition(env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"] == nil)
    precondition(env["KEEP"] == "yes" && env["PATH"] == config.runtimePath)
    precondition(FileManager.default.isReadableFile(atPath: config.launcher))
    print("PASS: bundle configuration, account isolation, runtime path and launcher availability")
} else {
    umask(0o077)
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    // The actual branded browser owns JP's Dock icon; this is a background launcher.
    app.setActivationPolicy(.accessory)
    app.run()
}
