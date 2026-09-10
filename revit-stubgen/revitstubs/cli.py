"""revitstubs command line.

    revitstubs list
    revitstubs generate 2024 2025 [--out revit-stubs] [--vscode .]
    revitstubs generate --dll path/to/RevitAPI.dll --dll path/to/RevitAPIUI.dll --tag 2025 --out revit-stubs
    revitstubs vscode 2025 [--out revit-stubs] [--workspace .]
"""
from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path
from typing import List, Optional

from . import __version__
from .discover import (DEFAULT_ASSEMBLIES, OPTIONAL_ASSEMBLIES, core_assemblies, find_install,
                       list_installs, resolve_assemblies, xml_for)
from .emit import StubGenerator
from .metadata import AssemblyInfo, load_assembly
from .vscode import configure
from .xmldoc import XmlDocs


def _log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def build(dlls: List[Path], out_dir: Path, tag: str, xmls: Optional[List[Path]] = None,
          collections: str = "python", clean: bool = True) -> Path:
    """Generate a stub tree from explicit assembly paths. Returns the stub root."""
    out_dir = Path(out_dir)
    if clean and out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    assemblies: List[AssemblyInfo] = []
    xml_paths: List[Path] = list(xmls or [])
    for dll in dlls:
        _log(f"  reading {dll.name} ...")
        try:
            asm = load_assembly(dll)
        except Exception as e:
            _log(f"    ! skipped ({e})")
            continue
        assemblies.append(asm)
        x = xml_for(dll)
        if x and x not in xml_paths:
            xml_paths.append(x)
    if not assemblies:
        raise SystemExit("no assemblies could be read")
    if xml_paths:
        _log("  parsing docs: " + ", ".join(p.name for p in xml_paths))
    docs = XmlDocs.load(*xml_paths)
    gen = StubGenerator(assemblies, docs, out_dir, collections=collections, tag=tag)
    files = gen.generate()
    n_types = sum(1 for a in assemblies for _ in a.walk())
    _log(f"  wrote {len(files)} stub files covering {n_types} types in {time.time() - t0:.1f}s -> {out_dir}")
    return out_dir


def cmd_list(args) -> int:
    installs = list_installs(Path(args.revit_root) if args.revit_root else None)
    if not installs:
        _log("No Revit installs found (set --revit-root or REVIT_ROOT).")
        return 1
    for i in installs:
        extra = [n for n in OPTIONAL_ASSEMBLIES if (i.root / n).exists()]
        print(f"Revit {i.year}  {i.root}  (.NET {'8' if i.dotnet_core else 'Framework'})"
              + (f"  optional: {', '.join(extra)}" if extra else ""))
    return 0


def cmd_generate(args) -> int:
    out_root = Path(args.out)
    generated: List[Path] = []
    if args.dll:
        tag = args.tag or "custom"
        dlls = [Path(d) for d in args.dll]
        missing = [d for d in dlls if not d.exists()]
        if missing:
            raise SystemExit("missing: " + ", ".join(map(str, missing)))
        generated.append(build(dlls, out_root / tag, tag, [Path(x) for x in args.xml or []],
                               collections=args.collections))
    else:
        if not args.years:
            raise SystemExit("give one or more Revit years, or --dll paths")
        for year in args.years:
            inst = find_install(year, Path(args.revit_root) if args.revit_root else None)
            if inst is None:
                _log(f"Revit {year}: not found under {args.revit_root or 'default root'}; skipping")
                continue
            names = list(args.assemblies or DEFAULT_ASSEMBLIES)
            if args.all_assemblies:
                names += OPTIONAL_ASSEMBLIES
            dlls = resolve_assemblies(inst, names)
            if not args.no_clr:
                core = core_assemblies(inst)
                if core:
                    dlls += core
                else:
                    _log(f"  (no BCL assemblies found for Revit {year}; System.* types will be Any)")
            _log(f"Revit {year}:")
            generated.append(build(dlls, out_root / str(year), str(year), collections=args.collections))
    if not generated:
        return 1
    if args.vscode is not None:
        target = generated[-1] if args.vscode_year is None else out_root / str(args.vscode_year)
        path = configure(Path(args.vscode), target)
        _log(f"VS Code configured: {path} -> stubPath {target}")
    return 0


def cmd_vscode(args) -> int:
    target = Path(args.out) / str(args.year)
    if not target.exists():
        raise SystemExit(f"{target} does not exist; run `revitstubs generate {args.year}` first")
    path = configure(Path(args.workspace), target)
    print(f"configured {path}")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="revitstubs", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", action="version", version=__version__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("list", help="show detected Revit installs")
    p.add_argument("--revit-root", help=r"folder containing 'Revit 20XX' dirs (default C:\Program Files\Autodesk)")
    p.set_defaults(fn=cmd_list)

    p = sub.add_parser("generate", help="generate stubs for one or more Revit years (or explicit DLLs)")
    p.add_argument("years", nargs="*", type=int, help="Revit release years, e.g. 2024 2025")
    p.add_argument("--out", default="revit-stubs", help="output root; stubs go in <out>/<year>/ (default: revit-stubs)")
    p.add_argument("--revit-root", help="folder containing 'Revit 20XX' dirs")
    p.add_argument("--assemblies", nargs="+", metavar="DLL", help=f"assembly names inside the install (default: {' '.join(DEFAULT_ASSEMBLIES)})")
    p.add_argument("--all-assemblies", action="store_true", help=f"also include {' '.join(OPTIONAL_ASSEMBLIES)} when present")
    p.add_argument("--no-clr", action="store_true", help="don't generate System.* stubs from the .NET BCL")
    p.add_argument("--collections", choices=["python", "dotnet"], default="python",
                   help="render IList<T>/IDictionary<K,V>/... as typing.List/Dict (python, default) or as the .NET classes (dotnet)")
    p.add_argument("--dll", action="append", help="explicit assembly path (repeatable); bypasses install discovery")
    p.add_argument("--xml", action="append", help="explicit XML doc path (repeatable); defaults to <dll>.xml next to each --dll")
    p.add_argument("--tag", help="output subfolder name when using --dll (default: custom)")
    p.add_argument("--vscode", nargs="?", const=".", metavar="WORKSPACE", help="also write .vscode/settings.json for WORKSPACE (default: cwd)")
    p.add_argument("--vscode-year", type=int, help="which generated year to point VS Code at (default: last one)")
    p.set_defaults(fn=cmd_generate)

    p = sub.add_parser("vscode", help="point a VS Code workspace at an already generated year")
    p.add_argument("year", type=int)
    p.add_argument("--out", default="revit-stubs")
    p.add_argument("--workspace", default=".")
    p.set_defaults(fn=cmd_vscode)

    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
