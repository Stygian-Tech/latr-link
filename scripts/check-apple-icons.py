#!/usr/bin/env python3
"""Verify the source and built app contain readable native icon appearances."""
import json
import plistlib
import subprocess
import sys
import xml.etree.ElementTree as ElementTree
from pathlib import Path

app = Path(sys.argv[1])
repo = Path(__file__).resolve().parent.parent
icon_source = json.loads(
    (repo / "apps/apple/Resources/AppIcon.icon/icon.json").read_text(encoding="utf-8")
)
mark = icon_source["groups"][0]["layers"][0]
assert mark["image-name"] == "l-mark-outlined.svg"
fills = {
    specialization.get("appearance", "default"): specialization["value"]
    for specialization in mark["fill-specializations"]
}
white = {"solid": "extended-gray:1.00000,1.00000"}
for appearance in ("default", "dark", "tinted"):
    assert fills.get(appearance) == white, (
        f"{appearance} L mark must use a solid white vector fill"
    )

mark_source = repo / "apps/apple/Resources/AppIcon.icon/Assets/l-mark-outlined.svg"
mark_path = ElementTree.parse(mark_source).getroot().find(
    "{http://www.w3.org/2000/svg}path"
)
assert mark_path is not None, "Outlined L vector must contain an SVG path"
assert mark_path.get("stroke") is None, "Icon Composer requires the L stroke converted to an outline"
assert mark_path.get("fill") == "#FFFFFF", "Outlined L vector must have a white source fill"
assert (mark_path.get("d") or "").rstrip().endswith("Z"), "Outlined L vector path must be closed"

with (app / "Info.plist").open("rb") as source:
    info = plistlib.load(source)
assert info["CFBundleIcons"]["CFBundlePrimaryIcon"]["CFBundleIconName"] == "AppIcon"
assert info["CFBundleIcons~ipad"]["CFBundlePrimaryIcon"]["CFBundleIconName"] == "AppIcon"
assets = json.loads(subprocess.check_output(["xcrun", "assetutil", "--info", str(app / "Assets.car")]))
icons = [asset for asset in assets if asset.get("Name") == "AppIcon"]
appearances = {"UIAppearanceLight", "UIAppearanceDark", "ISAppearanceTintable"}
stacks = {asset.get("Appearance") for asset in icons if asset.get("AssetType") == "IconImageStack"}
assert appearances <= stacks, f"Missing native layered icon appearances: {appearances - stacks}"
for idiom in ("phone", "pad"):
    fallbacks = {
        asset.get("Appearance", "UIAppearanceLight")
        for asset in icons
        if asset.get("AssetType") == "Icon Image" and asset.get("Idiom") == idiom
    }
    assert appearances <= fallbacks, f"Missing {idiom} iOS 18 fallbacks: {appearances - fallbacks}"
print("Apple icon: readable vector fills, dynamic layers, and iPhone/iPad fallbacks verified.")
