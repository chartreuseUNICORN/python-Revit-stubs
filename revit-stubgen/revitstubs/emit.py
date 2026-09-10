"""Emit one ``.pyi`` package per CLR namespace from the metadata model."""
from __future__ import annotations

import keyword
import re
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Set

from . import __version__
from . import signatures as S
from .metadata import AssemblyInfo, MethodInfo, ParamInfo, TypeInfo
from .typemap import Ctx, ModuleState, TypeRenderer
from .xmldoc import XmlDocs, render_docstring

OPERATORS = {
    "op_Equality": "__eq__", "op_Inequality": "__ne__", "op_Addition": "__add__",
    "op_Subtraction": "__sub__", "op_Multiply": "__mul__", "op_Division": "__truediv__",
    "op_Modulus": "__mod__", "op_UnaryNegation": "__neg__", "op_UnaryPlus": "__pos__",
    "op_LessThan": "__lt__", "op_GreaterThan": "__gt__", "op_LessThanOrEqual": "__le__",
    "op_GreaterThanOrEqual": "__ge__", "op_BitwiseAnd": "__and__", "op_BitwiseOr": "__or__",
    "op_ExclusiveOr": "__xor__", "op_OnesComplement": "__invert__", "op_LeftShift": "__lshift__",
    "op_RightShift": "__rshift__",
}
REFLECTED = {"__add__": "__radd__", "__sub__": "__rsub__", "__mul__": "__rmul__", "__truediv__": "__rtruediv__",
             "__mod__": "__rmod__", "__and__": "__rand__", "__or__": "__ror__", "__xor__": "__rxor__"}
SPECIAL_BASES = {"System.Object", "System.ValueType", "System.Enum", "System.MulticastDelegate", "System.Delegate"}

SUPPORT_MODULE = '''"""Helpers used by generated Revit stubs (events, delegates)."""
import typing

H = typing.TypeVar("H")


class Event(typing.Generic[H]):
    """A .NET event. Subscribe with ``obj.SomeEvent += handler`` and unsubscribe with ``-=``."""

    def __iadd__(self, handler: H) -> Event[H]: ...
    def __isub__(self, handler: H) -> Event[H]: ...
'''

CLR_MODULE = '''"""Stub for the ``clr`` module exposed by IronPython / pythonnet inside Revit."""
import typing

T = typing.TypeVar("T")


def AddReference(*names: str) -> None:
    """Load an assembly by simple name (e.g. ``clr.AddReference("RevitAPI")``)."""

def AddReferenceByName(*names: str) -> None: ...
def AddReferenceByPartialName(*names: str) -> None: ...
def AddReferenceToFile(*files: str) -> None: ...
def AddReferenceToFileAndPath(*files: str) -> None: ...
def LoadAssemblyByName(name: str) -> typing.Any: ...
def LoadAssemblyByPartialName(name: str) -> typing.Any: ...
def LoadAssemblyFromFile(file: str) -> typing.Any: ...
def LoadAssemblyFromFileWithPath(file: str) -> typing.Any: ...
def ImportExtensions(namespace: typing.Any) -> None: ...
def GetClrType(t: typing.Any) -> typing.Any: ...
def GetPythonType(t: typing.Any) -> type: ...
def Convert(obj: typing.Any, to_type: typing.Any) -> typing.Any: ...
def Use(name: str) -> typing.Any: ...
def Dir(obj: typing.Any) -> typing.List[str]: ...
def setPreload(value: bool) -> None: ...
def getPreload() -> bool: ...


class Reference(typing.Generic[T]):
    """``clr.Reference[T]`` -- a strong box for passing ``ref``/``out`` arguments."""
    Value: T
    def __init__(self, value: T = ...) -> None: ...


StrongBox = Reference
'''


def _normalize_optional(params: List[ParamInfo]) -> List[ParamInfo]:
    """Python needs defaults to be trailing: a param is optional only if everything after it is too."""
    out: List[ParamInfo] = []
    trailing = True
    for p in reversed(params):
        trailing = trailing and (p.is_optional or p.is_params)
        out.append(p if (p.is_optional == trailing or p.is_params) else ParamInfo(p.name, p.type, p.is_out, p.is_ref, trailing, p.is_params))
    return out[::-1]


def _uses_typevar(ann: str, ctx: Ctx) -> bool:
    tokens = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", ann))
    return any(tv in tokens for tv in ctx.type_gps if tv)


def py_ident(name: str) -> str:
    name = S.strip_arity(name)
    if keyword.iskeyword(name) or name in ("None", "True", "False"):
        return name + "_"
    return name


class StubGenerator:
    def __init__(self, assemblies: List[AssemblyInfo], docs: XmlDocs, out_dir: Path,
                 collections: str = "python", tag: str = ""):
        self.assemblies = assemblies
        self.docs = docs
        self.out = Path(out_dir)
        self.tag = tag
        self.by_ns: Dict[str, List[TypeInfo]] = defaultdict(list)
        self.known: Dict[str, str] = {}      # pyname -> namespace module
        self.types: Dict[str, TypeInfo] = {}  # pyname -> TypeInfo
        for asm in assemblies:
            for t in asm.types:
                self.by_ns[t.named.namespace].append(t)
            for t in asm.walk():
                py = t.named.pyname
                if py in self.types and self.types[py].named.arity > t.named.arity:
                    continue  # Tuple`1 .. Tuple`8 collapse to one Python name; keep the widest
                self.types[py] = t
                self.known[py] = t.named.namespace or "_global"
        # Collapse same-python-name duplicates within a namespace (generic arities).
        for ns, lst in self.by_ns.items():
            seen: Dict[str, TypeInfo] = {}
            for t in lst:
                seen[t.named.pyname] = self.types.get(t.named.pyname, t)
            self.by_ns[ns] = sorted(seen.values(), key=lambda t: t.named.pyname)
        self.renderer = TypeRenderer(self.known, collections, self._own_arity)
        self.packages: Set[str] = set()
        for ns in self.by_ns:
            parts = ns.split(".")
            for i in range(1, len(parts) + 1):
                self.packages.add(".".join(parts[:i]))

    @staticmethod
    def _is_self_type(pt: S.Type, t: TypeInfo) -> bool:
        named = pt.base if isinstance(pt, S.GenericInst) else pt
        return isinstance(named, S.Named) and named.pyname == t.named.pyname

    def _own_arity(self, pyname: str) -> Optional[int]:
        t = self.types.get(pyname)
        return None if t is None else len(t.generic_params) - t.outer_generic_count

    def own_generic_params(self, t: TypeInfo) -> List[str]:
        return t.generic_params[t.outer_generic_count:]

    # ---------------------------------------------------------------------
    def generate(self) -> List[Path]:
        written: List[Path] = []
        for pkg in sorted(self.packages):
            written.append(self._write_module(pkg, self.by_ns.get(pkg, [])))
        for name, text in (("_dotnet.pyi", SUPPORT_MODULE), ("clr.pyi", CLR_MODULE)):
            p = self.out / name
            p.write_text(text, encoding="utf-8")
            written.append(p)
        return written

    def _children(self, pkg: str) -> List[str]:
        prefix = pkg + "."
        return sorted({p[len(prefix):].split(".", 1)[0] for p in self.packages if p.startswith(prefix)})

    def _write_module(self, ns: str, types: List[TypeInfo]) -> Path:
        state = ModuleState()
        body: List[str] = []
        for t in types:
            body.extend(self._emit_type(t, "", state, []))
            body.append("")
        children = self._children(ns)
        head = [f'"""Namespace ``{ns}`` -- generated by revit-stubgen {__version__}'
                + (f" ({self.tag})" if self.tag else "") + '. Do not edit."""',
                "import builtins", "import enum", "import typing", "import typing_extensions", "import _dotnet"]
        state.imports.discard(ns)
        head += [f"import {m}" for m in sorted(state.imports)]
        if state.imports or types:
            head.append(f"import {ns}")  # self-import: everything is referenced fully-qualified
        head += [f"from . import {c} as {c}" for c in children]
        head.append("")
        head += [f'{tv} = typing.TypeVar("{tv}")' for tv in sorted(state.typevars)]
        names = [py_ident(t.named.names[-1]) for t in types] + children
        head.append("__all__ = [" + ", ".join(f'"{n}"' for n in names) + "]")
        head.append("")
        path = self.out.joinpath(*ns.split(".")) / "__init__.pyi"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(head + body).rstrip() + "\n", encoding="utf-8")
        return path

    # ---------------------------------------------------------------------
    def _ancestors(self, t: S.Type, seen: Set[str]) -> None:
        """Collect python names of every base/interface reachable from `t` (known types only)."""
        named = t.base if isinstance(t, S.GenericInst) else t
        if not isinstance(named, S.Named):
            return
        info = self.types.get(named.pyname)
        if info is None or named.pyname in seen:
            return
        seen.add(named.pyname)
        if info.base is not None:
            self._ancestors(info.base, seen)
        for i in info.interfaces:
            self._ancestors(i, seen)

    def _bases(self, t: TypeInfo, ctx: Ctx) -> List[str]:
        if t.kind == "enum":
            return ["enum.IntFlag" if t.is_flags else "enum.IntEnum"]
        if t.named.fullname == "System.Exception":
            return ["builtins.Exception"]
        bases: List[str] = []
        redundant: Set[str] = set()
        if t.base is not None:
            base_named = t.base.base if isinstance(t.base, S.GenericInst) else t.base
            if isinstance(base_named, S.Named) and base_named.fullname not in SPECIAL_BASES:
                r = self.renderer.render(t.base, ctx)
                if r == "typing.Any" and base_named.names[-1].endswith("Exception"):
                    r = "Exception"
                if base_named.pyname == t.named.pyname:  # generic arities collapsed onto one Python name
                    r = "typing.Any"
                if r != "typing.Any":
                    bases.append(r)
                    self._ancestors(t.base, redundant)
        ifaces = []
        for i in t.interfaces:
            named = i.base if isinstance(i, S.GenericInst) else i
            if not isinstance(named, S.Named) or named.pyname not in self.types:
                continue
            ifaces.append((named.pyname, i))
        for py, _ in ifaces:
            others: Set[str] = set()
            for py2, i2 in ifaces:
                if py2 != py:
                    self._ancestors(i2, others)
            if py in others:
                redundant.add(py)
        for py, i in ifaces:
            if py in redundant or py == t.named.pyname:
                continue
            r = self.renderer.render(i, ctx)
            if r != "typing.Any" and r not in bases:
                bases.append(r)
        own = self.own_generic_params(t)
        if own:
            ctx.state.typevars.update(own)
            bases.append("typing.Generic[" + ", ".join(own) + "]")
        return bases

    def _emit_type(self, t: TypeInfo, indent: str, state: ModuleState, outer_gps: List[str]) -> List[str]:
        name = py_ident(t.named.names[-1])
        # Params inherited from an enclosing generic type have no meaning inside a nested class body.
        ctx = Ctx(state, type_gps=[None] * t.outer_generic_count + self.own_generic_params(t))
        doc = self.docs.get(t.docid)
        if t.kind == "delegate":
            return self._emit_delegate(t, name, indent, ctx, doc)
        bases = self._bases(t, ctx)
        lines = [f"{indent}class {name}" + (f"({', '.join(bases)})" if bases else "") + ":"]
        inner = indent + "    "
        body: List[str] = render_docstring(doc, inner)
        if t.obsolete:
            lines.insert(0, f'{indent}@typing_extensions.deprecated({t.obsolete!r})')
        if t.kind == "enum":
            for f in t.fields:
                if not f.is_literal:
                    continue
                val = repr(f.value) if isinstance(f.value, (int, float)) and not isinstance(f.value, bool) else "..."
                body.append(f"{inner}{py_ident(f.name)} = {val}")
                body.extend(render_docstring(self.docs.get(f.docid), inner))
        else:
            body.extend(self._emit_fields(t, inner, ctx))
            body.extend(self._emit_properties(t, inner, ctx))
            body.extend(self._emit_events(t, inner, ctx))
            methods = self._emit_methods(t, inner, ctx)
            declared = set(re.findall(r"^\s*def (\w+)\(", "\n".join(methods), re.M))
            body.extend(methods)
            body.extend(self._emit_dunders(t, inner, ctx, declared))
            for n in sorted(t.nested, key=lambda x: x.named.names[-1]):
                body.extend(self._emit_type(n, inner, state, ctx.type_gps))
        if not body:
            body = [f"{inner}..."]
        return lines + body

    def _emit_delegate(self, t: TypeInfo, name: str, indent: str, ctx: Ctx, doc) -> List[str]:
        if t.delegate_sig is None:
            sig = "typing.Callable[..., typing.Any]"
        else:
            args = [self.renderer.render(p.type, ctx) for p in t.delegate_params]
            sig = f"typing.Callable[[{', '.join(args)}], {self.renderer.render(t.delegate_sig.ret, ctx)}]"
        ctx.state.typevars.update(t.generic_params)
        gps = self.own_generic_params(t)
        if gps and indent:  # generic delegate nested in a generic class: alias can't rebind the outer TypeVar
            sig = "typing.Callable[..., typing.Any]"
        lines = [f"{indent}{name} = {sig}"]
        lines.extend(render_docstring(doc, indent))
        return lines

    # ---------------------------------------------------------------------
    def _emit_fields(self, t: TypeInfo, inner: str, ctx: Ctx) -> List[str]:
        out: List[str] = []
        for f in sorted(t.fields, key=lambda f: f.name):
            ann = self.renderer.render(f.type, ctx)
            if f.is_static and not _uses_typevar(ann, ctx):
                ann = f"typing.ClassVar[{ann}]"
            out.append(f"{inner}{py_ident(f.name)}: {ann}")
            out.extend(render_docstring(self.docs.get(f.docid), inner))
        return out

    def _emit_properties(self, t: TypeInfo, inner: str, ctx: Ctx) -> List[str]:
        out: List[str] = []
        getters: List[List[str]] = []
        setters: List[List[str]] = []
        for p in sorted(t.properties, key=lambda p: p.name):
            ann = self.renderer.render(p.type, ctx)
            doc = render_docstring(self.docs.get(p.docid), inner + "    ")
            if p.index_params:
                if len(p.index_params) == 1:
                    key = self.renderer.render(p.index_params[0].type, ctx)
                else:
                    key = "typing.Tuple[" + ", ".join(self.renderer.render(x.type, ctx) for x in p.index_params) + "]"
                if p.has_get:
                    getters.append([f"{inner}def __getitem__(self, key: {key}) -> {ann}:"] + (doc or [f"{inner}    ..."]))
                if p.has_set:
                    setters.append([f"{inner}def __setitem__(self, key: {key}, value: {ann}) -> None: ..."])
                continue
            name = py_ident(p.name)
            dep = [f'{inner}@typing_extensions.deprecated({p.obsolete!r})'] if p.obsolete else []
            if p.is_static or not p.has_get:
                cv = p.is_static and not _uses_typevar(ann, ctx)
                out.append(f"{inner}{name}: " + (f"typing.ClassVar[{ann}]" if cv else ann))
                out.extend(render_docstring(self.docs.get(p.docid), inner))
                continue
            out.append(f"{inner}@builtins.property")
            out.extend(dep)
            out.append(f"{inner}def {name}(self) -> {ann}:")
            out.extend(doc or [f"{inner}    ..."])
            if p.has_set:
                out.append(f"{inner}@{name}.setter")
                out.append(f"{inner}def {name}(self, value: {ann}) -> None: ...")
        for group in (getters, setters):
            for lines in group:
                if len(group) > 1:
                    out.append(f"{inner}@typing.overload")
                out.extend(lines)
        return out

    def _emit_events(self, t: TypeInfo, inner: str, ctx: Ctx) -> List[str]:
        out: List[str] = []
        for e in sorted(t.events, key=lambda e: e.name):
            handler = self.renderer.render(e.type, ctx)
            if handler == "typing.Any":
                handler = "typing.Callable[..., typing.Any]"
            ann = f"_dotnet.Event[{handler}]"
            if e.is_static and not _uses_typevar(ann, ctx):
                ann = f"typing.ClassVar[{ann}]"
            out.append(f"{inner}{py_ident(e.name)}: {ann}")
            out.extend(render_docstring(self.docs.get(e.docid), inner))
        return out

    def _param_str(self, p: ParamInfo, ctx: Ctx) -> str:
        name = py_ident(p.name)
        if name == "self":
            name = "self_"
        ann = self.renderer.render(p.type, ctx)
        if p.is_params:
            if ann.startswith("typing.List[") and ann.endswith("]"):
                ann = ann[len("typing.List["):-1]
            return f"*{name}: {ann}"
        return f"{name}: {ann}" + (" = ..." if p.is_optional else "")

    def _return_str(self, m: MethodInfo, ctx: Ctx) -> str:
        ret = self.renderer.render(m.ret, ctx)
        outs = [self.renderer.render(p.type, ctx) for p in m.params if p.is_out or p.is_ref]
        if not outs:
            return ret
        parts = ([ret] if ret != "None" else []) + outs
        return parts[0] if len(parts) == 1 else "typing.Tuple[" + ", ".join(parts) + "]"

    def _emit_methods(self, t: TypeInfo, inner: str, ctx: Ctx) -> List[str]:
        groups: Dict[str, List[MethodInfo]] = defaultdict(list)
        for m in t.methods:
            if m.is_ctor:
                if t.kind != "interface":
                    groups["__init__"].append(m)
            elif m.name.startswith("op_"):
                if m.name in OPERATORS:
                    groups[OPERATORS[m.name]].append(m)
            elif m.name in ("__new__", "__init__", "__class__", "__del__"):
                continue  # C# methods with these names (IronPython internals) would break Python semantics
            else:
                groups[py_ident(m.name)].append(m)
        out: List[str] = []
        for name in sorted(groups):
            rendered: Dict[str, List[List[str]]] = defaultdict(list)
            seen: Set[str] = set()
            members = groups[name]
            # Python can't overload a static and an instance method under one name: keep the larger set.
            statics = [m for m in members if m.is_static]
            if statics and len(statics) < len(members):
                members = statics if len(statics) > len(members) - len(statics) else [m for m in members if not m.is_static]
            # Non-generic overloads first so a generic twin with identical params doesn't shadow it.
            members = sorted(members, key=lambda m: (len(m.generic_params), len(m.params)))
            for m in members:
                mctx = Ctx(ctx.state, ctx.type_gps, m.generic_params)
                ctx.state.typevars.update(m.generic_params)
                is_op = name.startswith("__") and name != "__init__"
                params = [p for p in m.params if not p.is_out]
                params = _normalize_optional(params)
                op_name = name
                if is_op:  # operators are static in .NET: drop the operand that is `self`
                    if len(params) == 2 and not self._is_self_type(params[0].type, t) and self._is_self_type(params[1].type, t) \
                            and name in REFLECTED:
                        op_name = REFLECTED[name]      # e.g. op_Multiply(double, XYZ) -> XYZ.__rmul__(self, float)
                        params = params[:1]
                    else:
                        params = params[1:]
                    if name in ("__eq__", "__ne__") and params:
                        params[0] = ParamInfo(params[0].name, S.Prim(S.ET_OBJECT))
                args = ["self"] if (not m.is_static or is_op) else []
                args += [self._param_str(p, mctx) for p in params]
                ret = "None" if m.is_ctor else self._return_str(m, mctx)
                if is_op and name in ("__eq__", "__ne__"):
                    ret = "bool"
                sig = f"({', '.join(args)}) -> {ret}"
                key = op_name + ", ".join(a.split(":", 1)[-1] for a in args)  # dedupe on parameter types only
                if key in seen:
                    continue
                seen.add(key)
                lines: List[str] = []
                if m.obsolete:
                    lines.append(f'{inner}@typing_extensions.deprecated({m.obsolete!r})')
                if m.is_static and not is_op:
                    lines.append(f"{inner}@builtins.staticmethod")
                lines.append(f"{inner}def {op_name}{sig}:")
                doc = render_docstring(self.docs.get(m.docid, len(m.params)), inner + "    ", [p.name for p in m.params])
                lines.extend(doc or [f"{inner}    ..."])
                rendered[op_name].append(lines)
            for group in rendered.values():
                for lines in group:
                    if len(group) > 1:
                        out.append(f"{inner}@typing.overload")
                    out.extend(lines)
        return out

    def _emit_dunders(self, t: TypeInfo, inner: str, ctx: Ctx, declared: Set[str]) -> List[str]:
        out: List[str] = []
        iter_elem: Optional[str] = None
        disposable = sized = False
        for i in t.interfaces:
            if isinstance(i, S.GenericInst):
                full = i.base.fullname
                if full == "System.Collections.Generic.IEnumerable`1" and i.args:
                    iter_elem = self.renderer.render(i.args[0], ctx)
                elif full in ("System.Collections.Generic.ICollection`1", "System.Collections.Generic.IReadOnlyCollection`1"):
                    sized = True
            elif isinstance(i, S.Named):
                if i.fullname == "System.Collections.IEnumerable" and iter_elem is None:
                    iter_elem = "typing.Any"
                elif i.fullname == "System.IDisposable":
                    disposable = True
                elif i.fullname == "System.Collections.ICollection":
                    sized = True
        if iter_elem is not None and "__iter__" not in declared:
            out.append(f"{inner}def __iter__(self) -> typing.Iterator[{iter_elem}]: ...")
        if sized and "__len__" not in declared:
            out.append(f"{inner}def __len__(self) -> int: ...")
        if disposable and "__enter__" not in declared:
            out.append(f"{inner}def __enter__(self) -> typing_extensions.Self: ...")
        if disposable and "__exit__" not in declared:
            out.append(f"{inner}def __exit__(self, *args: typing.Any) -> None: ...")
        return out
