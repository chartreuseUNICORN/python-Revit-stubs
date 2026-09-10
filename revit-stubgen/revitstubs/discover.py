"""Locate Revit installs, their API assemblies + XML docs, and the matching BCL assemblies."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

DEFAULT_ASSEMBLIES = ["RevitAPI.dll", "RevitAPIUI.dll"]
OPTIONAL_ASSEMBLIES = ["RevitAPIIFC.dll", "RevitAPIMacros.dll", "RevitAPIUIMacros.dll", "RevitAPISteel.dll"]


@dataclass
class RevitInstall:
    year: int
    root: Path
    assemblies: List[Path] = field(default_factory=list)

    @property
    def dotnet_core(self) -> bool:
        return self.year >= 2025  # Revit 2025 moved to .NET 8


def revit_root() -> Path:
    return Path(os.environ.get("REVIT_ROOT", r"C:\Program Files\Autodesk"))


def list_installs(root: Optional[Path] = None) -> List[RevitInstall]:
    root = root or revit_root()
    found = []
    if not root.exists():
        return found
    for d in sorted(root.iterdir()):
        m = re.fullmatch(r"Revit (\d{4})", d.name)
        if m and (d / "RevitAPI.dll").exists():
            found.append(RevitInstall(int(m.group(1)), d))
    return found


def find_install(year: int, root: Optional[Path] = None) -> Optional[RevitInstall]:
    root = root or revit_root()
    d = root / f"Revit {year}"
    if (d / "RevitAPI.dll").exists():
        return RevitInstall(year, d)
    return None


def resolve_assemblies(install: RevitInstall, names: Optional[List[str]] = None) -> List[Path]:
    names = names or DEFAULT_ASSEMBLIES
    out = []
    for n in names:
        p = Path(n) if os.path.isabs(n) else install.root / n
        if p.exists():
            out.append(p)
    return out


def xml_for(dll: Path) -> Optional[Path]:
    for cand in (dll.with_suffix(".xml"), dll.with_name(dll.stem + ".XML")):
        if cand.exists():
            return cand
    return None


def _latest(dirs: List[Path]) -> Optional[Path]:
    def key(p: Path):
        return tuple(int(x) if x.isdigit() else 0 for x in re.split(r"[.\-]", p.name)[:3])
    return max(dirs, key=key) if dirs else None


def core_assemblies(install: RevitInstall) -> List[Path]:
    """Base-class-library assemblies that define ``System.*`` for this Revit's runtime.

    Prefers reference packs (they ship XML docs), falls back to the runtime itself."""
    if install.dotnet_core:
        dotnet = Path(os.environ.get("DOTNET_ROOT", r"C:\Program Files\dotnet"))
        packs = dotnet / "packs" / "Microsoft.NETCore.App.Ref"
        ref = _latest([p for p in packs.glob("8.*")] if packs.exists() else [])
        if ref:
            refdir = _latest(list((ref / "ref").glob("net*")))
            if refdir:
                names = ["System.Runtime.dll", "System.Collections.dll", "System.Linq.dll", "System.ObjectModel.dll",
                         "System.Runtime.InteropServices.dll", "System.ComponentModel.dll", "System.Xml.ReaderWriter.dll"]
                return [refdir / n for n in names if (refdir / n).exists()]
        shared = dotnet / "shared" / "Microsoft.NETCore.App"
        rt = _latest([p for p in shared.glob("8.*")] if shared.exists() else [])
        if rt:
            names = ["System.Private.CoreLib.dll", "System.Collections.dll", "System.Linq.dll", "System.ObjectModel.dll"]
            return [rt / n for n in names if (rt / n).exists()]
        return []
    windir = Path(os.environ.get("WINDIR", r"C:\Windows"))
    refs = Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Reference Assemblies" / "Microsoft" / "Framework" / ".NETFramework"
    refdir = _latest([p for p in refs.glob("v4.*")] if refs.exists() else [])
    if refdir and (refdir / "mscorlib.dll").exists():
        return [refdir / n for n in ("mscorlib.dll", "System.dll", "System.Core.dll") if (refdir / n).exists()]
    fw = windir / "Microsoft.NET" / "Framework64" / "v4.0.30319"
    return [fw / n for n in ("mscorlib.dll", "System.dll", "System.Core.dll") if (fw / n).exists()]
