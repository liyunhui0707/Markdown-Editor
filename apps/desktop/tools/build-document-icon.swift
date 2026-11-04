import AppKit
// Reuse the approved workspace m/down-arrow mark; no external artwork.
let output = CommandLine.arguments[1]
let size = NSSize(width: 1024, height: 1024)
let image = NSImage(size: size)
image.lockFocus()
NSColor(calibratedRed: 0.96, green: 0.96, blue: 0.93, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 60, y: 60, width: 904, height: 904), xRadius: 200, yRadius: 200).fill()
NSColor(calibratedRed: 0.20, green: 0.38, blue: 0.32, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 180, y: 180, width: 664, height: 664), xRadius: 120, yRadius: 120).fill()
let text = "m↓" as NSString
let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 340, weight: .semibold), .foregroundColor: NSColor.white]
let bounds = text.size(withAttributes: attrs)
text.draw(at: NSPoint(x: (1024 - bounds.width) / 2, y: (1024 - bounds.height) / 2 + 10), withAttributes: attrs)
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output))
