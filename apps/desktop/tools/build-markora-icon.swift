// Vector source: brand/markora.svg. AppKit rasterization, no downloaded artwork.
import AppKit
import Foundation

guard CommandLine.arguments.count == 2 else { fatalError("Supply a new .iconset output directory") }
let output=URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true)
guard !FileManager.default.fileExists(atPath:output.path) else { fatalError("Output exists; retained") }
try FileManager.default.createDirectory(at:output,withIntermediateDirectories:false)
func color(_ r:CGFloat,_ g:CGFloat,_ b:CGFloat)->NSColor { NSColor(srgbRed:r/255,green:g/255,blue:b/255,alpha:1) }
func draw() {
 color(79,107,87).setFill()
 NSBezierPath(roundedRect:NSRect(x:80,y:80,width:864,height:864),xRadius:196,yRadius:196).fill()
 let page=NSBezierPath();page.move(to:NSPoint(x:326,y:218));page.line(to:NSPoint(x:600,y:218));page.line(to:NSPoint(x:742,y:360));page.line(to:NSPoint(x:742,y:762))
 page.curve(to:NSPoint(x:698,y:806),controlPoint1:NSPoint(x:742,y:786),controlPoint2:NSPoint(x:722,y:806))
 page.line(to:NSPoint(x:326,y:806));page.curve(to:NSPoint(x:282,y:762),controlPoint1:NSPoint(x:302,y:806),controlPoint2:NSPoint(x:282,y:786))
 page.line(to:NSPoint(x:282,y:262));page.curve(to:NSPoint(x:326,y:218),controlPoint1:NSPoint(x:282,y:238),controlPoint2:NSPoint(x:302,y:218));page.close()
 color(251,250,245).setFill();page.fill()
 let fold=NSBezierPath();fold.move(to:NSPoint(x:600,y:218));fold.line(to:NSPoint(x:600,y:330));fold.curve(to:NSPoint(x:630,y:360),controlPoint1:NSPoint(x:600,y:347),controlPoint2:NSPoint(x:613,y:360));fold.line(to:NSPoint(x:742,y:360));fold.close();color(200,215,202).setFill();fold.fill()
 let mark=NSBezierPath();mark.move(to:NSPoint(x:370,y:658));mark.line(to:NSPoint(x:370,y:414));mark.line(to:NSPoint(x:512,y:560));mark.line(to:NSPoint(x:654,y:414));mark.line(to:NSPoint(x:654,y:658));mark.lineWidth=48;mark.lineCapStyle = .round;mark.lineJoinStyle = .round;color(79,107,87).setStroke();mark.stroke()
}
for size in [16,32,128,256,512] {
 for scale in [1,2] {
  let pixels=size*scale
  let rep=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:pixels,pixelsHigh:pixels,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
  NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:rep)
  let cg=NSGraphicsContext.current!.cgContext;cg.translateBy(x:0,y:CGFloat(pixels));cg.scaleBy(x:CGFloat(pixels)/1024,y:-CGFloat(pixels)/1024);draw();NSGraphicsContext.restoreGraphicsState()
  let name="icon_\(size)x\(size)"+(scale==2 ? "@2x" : "")+".png"
  try rep.representation(using:.png,properties:[:])!.write(to:output.appendingPathComponent(name),options:.withoutOverwriting)
 }
}
