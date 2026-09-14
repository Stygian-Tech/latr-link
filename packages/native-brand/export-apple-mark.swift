import CoreGraphics
import Foundation

// Icon Composer's appearance overrides replace SVG fills. Outline the stroke so
// dark mode colors the actual mark rather than closing and filling its center.
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let source = try String(contentsOf: root.appendingPathComponent("mark.svg"), encoding: .utf8)
let pathText = source.components(separatedBy: "d=\"")[1].components(separatedBy: "\"")[0]
let expression = try NSRegularExpression(pattern: "[MC]|-?[0-9]+(?:\\.[0-9]+)?")
let tokens = expression.matches(in: pathText, range: NSRange(pathText.startIndex..., in: pathText))
    .map { String(pathText[Range($0.range, in: pathText)!]) }
let path = CGMutablePath()
var index = 0
func point() -> CGPoint {
    defer { index += 2 }
    return CGPoint(x: Double(tokens[index])!, y: Double(tokens[index + 1])!)
}
while index < tokens.count {
    let command = tokens[index]
    index += 1
    switch command {
    case "M": path.move(to: point())
    case "C":
        let first = point(), second = point(), end = point()
        path.addCurve(to: end, control1: first, control2: second)
    default: fatalError("Unsupported SVG command: \(command)")
    }
}
let outline = path.copy(strokingWithWidth: 56, lineCap: .round, lineJoin: .round, miterLimit: 10)
var commands: [String] = []
outline.applyWithBlock { pointer in
    let element = pointer.pointee
    func coordinates(_ count: Int) -> String {
        (0..<count).map { "\(element.points[$0].x) \(element.points[$0].y)" }.joined(separator: " ")
    }
    switch element.type {
    case .moveToPoint: commands.append("M" + coordinates(1))
    case .addLineToPoint: commands.append("L" + coordinates(1))
    case .addQuadCurveToPoint: commands.append("Q" + coordinates(2))
    case .addCurveToPoint: commands.append("C" + coordinates(3))
    case .closeSubpath: commands.append("Z")
    @unknown default: fatalError("Unsupported Core Graphics path element")
    }
}
let svg = """
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <title>L@tr.link brand mark</title>
  <path d="\(commands.joined(separator: " "))" fill="#FFFFFF" />
</svg>

"""
let destination = root.appendingPathComponent("../../apps/apple/Resources/AppIcon.icon/Assets/mark.svg")
try svg.write(to: destination, atomically: true, encoding: .utf8)
