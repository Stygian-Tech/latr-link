#!/usr/bin/env python3
"""Verify the built app contains native icon layers and iOS 18 fallbacks."""
import json
import plistlib
import subprocess
import sys
from pathlib import Path

app = Path(sys.argv[1])
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
print("Apple icon: light/dark/mono layers and iPhone/iPad legacy appearances verified.")
