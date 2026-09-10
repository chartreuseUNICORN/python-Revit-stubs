# revit-stubgen

Real IntelliSense for Revit Python (IronPython / pythonnet) in VS Code.

`ironpython-stubs`-style packages give you class and member *names* and nothing else.
This tool reads the actual `RevitAPI.dll` / `RevitAPIUI.dll` metadata tables and the
`RevitAPI.xml` doc files that ship in every Revit install, and generates full
`.pyi` stubs per Revit year: **parameter names, parameter types, return types,
overloads, properties with setters, enums with values, events, generics, `out`
parameters, `Obsolete` markers, and the official docstrings** — then points
Pylance at them.

No CLR is loaded. The assemblies are parsed as plain files (via `dnfile`), so it
works for both .NET Framework Revit (≤ 2024) and .NET 8 Revit (≥ 2025), and even
on a Mac/Linux box if you copy the DLLs over.

```
Element.Name: str
Document.Delete(elementId: ElementId) -> Collection[ElementId]
Document.Delete(elementIds: Collection[ElementId]) -> Collection[ElementId]
FilteredElementCollector.__iter__() -> Iterator[Element]
XYZ.__add__(self, other: XYZ) -> XYZ
Transaction.__enter__ / __exit__            # `with Transaction(doc, "x") as t:`
Application.DocumentChanged: Event[Callable[[Any, DocumentChangedEventArgs], None]]
```

## Install

```bash
pip install .            # or: pipx install .
```

Python ≥ 3.9. The only dependency is `dnfile`.

## Usage

```bash
# what's installed?
revitstubs list

# generate stubs for one or more years into ./revit-stubs/<year>/ and
# write .vscode/settings.json in the current folder pointing at the last one
revitstubs generate 2024 2025 --vscode

# later, switch the workspace to another generated year
revitstubs vscode 2024

# include the optional assemblies (IFC, Macros, Steel) or your own DLLs
revitstubs generate 2025 --all-assemblies
revitstubs generate 2025 --assemblies RevitAPI.dll RevitAPIUI.dll "C:\path\to\RevitServices.dll"

# no Revit on this machine? point at copied DLLs (XML docs are picked up from next to them)
revitstubs generate --dll RevitAPI.dll --dll RevitAPIUI.dll --tag 2025 --out revit-stubs
```

Generation of `RevitAPI.dll` + `RevitAPIUI.dll` + the BCL takes on the order of
tens of seconds; the output is a plain folder you can commit or share.

### What `--vscode` writes

```jsonc
{
    "python.languageServer": "Pylance",
    "python.analysis.stubPath": "${workspaceFolder}/revit-stubs/2025",
    "python.analysis.typeCheckingMode": "basic",             // left alone if already set
    "python.analysis.useLibraryCodeForTypes": true,
    "python.analysis.diagnosticSeverityOverrides": {
        "reportMissingModuleSource": "none"                 // stubs have no runtime module behind them
    }
}
```

Existing settings (including `//` comments) are merged, not clobbered. Because
`stubPath` is a single folder, one workspace targets one Revit year at a time —
`revitstubs vscode <year>` flips it.

Then in your script:

```python
import clr
clr.AddReference("RevitAPI")
from Autodesk.Revit.DB import *          # __all__ is generated, so star-imports are clean
import Autodesk.Revit.DB as DB

doc: Document = __revit__.ActiveUIDocument.Document
walls = FilteredElementCollector(doc).OfClass(Wall).WhereElementIsNotElementType()
for w in walls:                          # w: Element
    if isinstance(w, Wall):              # narrows to Wall
        print(w.Width, w.Orientation.X)  # float, float
```

## What gets generated

```
revit-stubs/2025/
├── Autodesk/Revit/DB/__init__.pyi        one package per CLR namespace
├── Autodesk/Revit/DB/Structure/__init__.pyi
├── Autodesk/Revit/UI/...
├── System/...                            from the matching .NET BCL (see below)
├── clr.pyi                               `clr.AddReference` & friends
└── _dotnet.pyi                           `Event[H]` helper used for .NET events
```

| .NET                                  | Python stub                                                     |
| ------------------------------------- | --------------------------------------------------------------- |
| class / struct / interface            | `class`, with real base classes and implemented interfaces      |
| overloads                             | `@typing.overload`, non-generic first, `out` params removed     |
| `out` / `ref` parameters              | appended to the return value as a tuple (IronPython/pythonnet behaviour) |
| static methods / properties / fields  | `@staticmethod`, `ClassVar[...]`                                |
| properties                            | `@property` + `.setter`; indexers → `__getitem__/__setitem__`   |
| enums                                 | `enum.IntEnum` / `enum.IntFlag` (`[Flags]`) with real values    |
| events                                | `Name: _dotnet.Event[handler]` so `+=` / `-=` type-check        |
| delegates                             | `Callable[[...], R]` alias                                      |
| generics                              | `typing.Generic[T]`, TypeVars per module                        |
| `IEnumerable<T>` / `ICollection<T>` / `IDisposable` | `__iter__` / `__len__` / `__enter__`+`__exit__`   |
| operators (`op_Addition`, …)          | `__add__`, `__rmul__`, `__eq__`, …                              |
| `[Obsolete("...")]`                   | `@typing_extensions.deprecated("...")` (strike-through in VS Code) |
| XML docs                              | Google-style docstrings: summary, remarks, Args, Returns, Raises |
| Python keywords (`None`, `from`, …)   | trailing underscore (`ViewDetailLevel.None_`)                   |

### Collections: `--collections python` (default) vs `dotnet`

By default BCL collection interfaces are rendered as their Python equivalents:
`IList<T>` → `List[T]`, `IDictionary<K,V>` → `Dict[K,V]`, `ISet<T>` → `Set[T]`,
`IEnumerable<T>` → `Iterable[T]`, `KeyValuePair` → `Tuple`, `Nullable<T>` →
`Optional[T]`, `Func`/`Action` → `Callable`. That's how you *use* them from
Python (`len()`, indexing, `for`, passing a Python list). `--collections dotnet`
keeps the .NET classes instead, so `.Count`/`.Add`/`.ContainsKey` resolve; the
generated `System.*` stubs give those classes `__iter__`/`__len__`/`__getitem__`
too.

### `System.*` stubs

Types from the BCL (`System.Guid`, `System.DateTime`, `System.Windows.Media.Color`,
exceptions, …) are generated automatically from the runtime that Revit year uses:

* Revit ≤ 2024: .NET Framework reference assemblies (with XML docs) if the
  targeting pack is installed, otherwise `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\mscorlib.dll`.
* Revit ≥ 2025: the .NET 8 `Microsoft.NETCore.App.Ref` pack (with XML docs) if the
  SDK is installed, otherwise the shared runtime under `C:\Program Files\dotnet`.

Primitives always map to builtins (`str`, `int`, `float`, `bool`) and
`System.Exception` derives from Python's `Exception`, so `except` works.
Disable with `--no-clr` (unresolved types become `Any`).

## Notes and limitations

* The stubs describe the .NET surface. IronPython-only conveniences that aren't in
  the metadata (implicit conversions of Python lists to `IList<T>`, kwargs on
  .NET calls) are not modelled — pass what the signature says.
* Generic *method* type arguments (`doc.GetElement[Wall](...)`) can't be expressed;
  the TypeVar is left free.
* Pyright will report override/overlap diagnostics *inside* the stub files if you
  open them (C# `new`-hiding and generic overloads aren't valid Python subtyping).
  They don't affect your scripts.
* pyRevit's `from pyrevit import DB` re-export isn't covered; `import Autodesk.Revit.DB as DB` is.
* `revitstubs list` / `generate <year>` look under `C:\Program Files\Autodesk\Revit <year>`.
  Override with `--revit-root` or `REVIT_ROOT`.

## Development

```bash
pip install -e . pytest pythonnet   # pythonnet only supplies a sample assembly for the tests
pytest
```

The pipeline is `discover` → `metadata` (dnfile → model) → `signatures` (ECMA-335
blob decoding) → `xmldoc` → `typemap` + `emit` (`.pyi`) → `vscode`.
