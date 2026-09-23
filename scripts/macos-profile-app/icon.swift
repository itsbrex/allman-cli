import AppKit

// Original vector icon; no copied or modified browser artwork.
let destination = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = points * scale
        let image = NSImage(size: NSSize(width: pixels, height: pixels))
        image.lockFocus()
        let transform = NSAffineTransform()
        transform.scale(by: CGFloat(pixels) / 1024)
        transform.concat()
        let tile = NSBezierPath(roundedRect: NSRect(x: 72, y: 72, width: 880, height: 880), xRadius: 198, yRadius: 198)
        NSGradient(starting: NSColor(srgbRed: 0.58, green: 0.25, blue: 0.94, alpha: 1),
                   ending: NSColor(srgbRed: 0.22, green: 0.10, blue: 0.50, alpha: 1))!.draw(in: tile, angle: -70)
        NSColor.white.withAlphaComponent(0.16).setStroke()
        let orbit = NSBezierPath(ovalIn: NSRect(x: 148, y: 148, width: 728, height: 728))
        orbit.lineWidth = 28
        orbit.stroke()
        let text = "JP" as NSString
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 360, weight: .bold), .foregroundColor: NSColor.white]
        let size = text.size(withAttributes: attributes)
        text.draw(at: NSPoint(x: (1024 - size.width) / 2, y: (1024 - size.height) / 2 + 5), withAttributes: attributes)
        image.unlockFocus()
        let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
        let name = "icon_\(points)x\(points)\(scale == 2 ? "@2x" : "").png"
        try bitmap.representation(using: .png, properties: [:])!.write(to: destination.appendingPathComponent(name))
    }
}
