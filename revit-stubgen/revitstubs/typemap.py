"""Render model types as Python annotation expressions.

Everything outside the current module is referenced fully-qualified
(``Autodesk.Revit.DB.Element``) and the owning namespace module is recorded so
the emitter can add the ``import`` line. This sidesteps every shadowing problem
(a nested class named ``Color`` inside a class whose method takes a ``Color``...).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

from . import signatures as S
from .signatures import Type

PRIM_PY = {
    S.ET_VOID: "None", S.ET_BOOLEAN: "bool", S.ET_CHAR: "str",
    S.ET_I1: "int", S.ET_U1: "int", S.ET_I2: "int", S.ET_U2: "int", S.ET_I4: "int", S.ET_U4: "int",
    S.ET_I8: "int", S.ET_U8: "int", S.ET_I: "int", S.ET_U: "int",
    S.ET_R4: "float", S.ET_R8: "float", S.ET_STRING: "str", S.ET_OBJECT: "typing.Any",
    S.ET_TYPEDBYREF: "typing.Any",
}

# Always mapped to Python builtins regardless of whether System stubs are generated.
BUILTIN_NAMED = {
    "System.Object": "typing.Any", "System.Void": "None", "System.String": "str", "System.Boolean": "bool",
    "System.Char": "str", "System.SByte": "int", "System.Byte": "int", "System.Int16": "int", "System.UInt16": "int",
    "System.Int32": "int", "System.UInt32": "int", "System.Int64": "int", "System.UInt64": "int",
    "System.IntPtr": "int", "System.UIntPtr": "int", "System.Single": "float", "System.Double": "float",
    "System.Decimal": "float", "System.Type": "type", "System.Exception": "Exception",
}

# Pythonic view of the BCL collection surface ("python" collections mode).
PY_GENERICS = {
    "System.Collections.Generic.IList`1": "typing.List[{0}]",
    "System.Collections.Generic.List`1": "typing.List[{0}]",
    "System.Collections.Generic.IReadOnlyList`1": "typing.List[{0}]",
    "System.Collections.ObjectModel.Collection`1": "typing.List[{0}]",
    "System.Collections.ObjectModel.ReadOnlyCollection`1": "typing.List[{0}]",
    "System.Collections.Generic.ICollection`1": "typing.Collection[{0}]",
    "System.Collections.Generic.IReadOnlyCollection`1": "typing.Collection[{0}]",
    "System.Collections.Generic.IEnumerable`1": "typing.Iterable[{0}]",
    "System.Collections.Generic.IEnumerator`1": "typing.Iterator[{0}]",
    "System.Collections.Generic.IDictionary`2": "typing.Dict[{0}, {1}]",
    "System.Collections.Generic.Dictionary`2": "typing.Dict[{0}, {1}]",
    "System.Collections.Generic.IReadOnlyDictionary`2": "typing.Dict[{0}, {1}]",
    "System.Collections.Generic.SortedDictionary`2": "typing.Dict[{0}, {1}]",
    "System.Collections.Generic.ISet`1": "typing.Set[{0}]",
    "System.Collections.Generic.HashSet`1": "typing.Set[{0}]",
    "System.Collections.Generic.SortedSet`1": "typing.Set[{0}]",
    "System.Collections.Generic.KeyValuePair`2": "typing.Tuple[{0}, {1}]",
    "System.Nullable`1": "typing.Optional[{0}]",
    "System.Predicate`1": "typing.Callable[[{0}], bool]",
    "System.Comparison`1": "typing.Callable[[{0}, {0}], int]",
    "System.Func`1": "typing.Callable[[], {0}]",
    "System.Func`2": "typing.Callable[[{0}], {1}]",
    "System.Func`3": "typing.Callable[[{0}, {1}], {2}]",
    "System.Func`4": "typing.Callable[[{0}, {1}, {2}], {3}]",
    "System.Func`5": "typing.Callable[[{0}, {1}, {2}, {3}], {4}]",
    "System.Action`1": "typing.Callable[[{0}], None]",
    "System.Action`2": "typing.Callable[[{0}, {1}], None]",
    "System.Action`3": "typing.Callable[[{0}, {1}, {2}], None]",
    "System.Action`4": "typing.Callable[[{0}, {1}, {2}, {3}], None]",
    "System.Tuple`1": "typing.Tuple[{0}]", "System.Tuple`2": "typing.Tuple[{0}, {1}]",
    "System.Tuple`3": "typing.Tuple[{0}, {1}, {2}]", "System.Tuple`4": "typing.Tuple[{0}, {1}, {2}, {3}]",
    "System.ValueTuple`1": "typing.Tuple[{0}]", "System.ValueTuple`2": "typing.Tuple[{0}, {1}]",
    "System.ValueTuple`3": "typing.Tuple[{0}, {1}, {2}]", "System.ValueTuple`4": "typing.Tuple[{0}, {1}, {2}, {3}]",
    "System.EventHandler`1": "typing.Callable[[typing.Any, {0}], None]",
}
PY_NAMED = {
    "System.Collections.IEnumerable": "typing.Iterable[typing.Any]",
    "System.Collections.IEnumerator": "typing.Iterator[typing.Any]",
    "System.Collections.IList": "typing.List[typing.Any]",
    "System.Collections.ICollection": "typing.Collection[typing.Any]",
    "System.Collections.IDictionary": "typing.Dict[typing.Any, typing.Any]",
    "System.Array": "typing.Sequence[typing.Any]",
    "System.Action": "typing.Callable[[], None]",
    "System.EventHandler": "typing.Callable[[typing.Any, typing.Any], None]",
    "System.Delegate": "typing.Callable[..., typing.Any]",
    "System.MulticastDelegate": "typing.Callable[..., typing.Any]",
}
# Nullable stays Optional even in "dotnet" mode: pythonnet/IronPython unwrap it.
DOTNET_GENERICS = {"System.Nullable`1": "typing.Optional[{0}]"}


@dataclass
class ModuleState:
    """Per-output-module bookkeeping collected while rendering."""
    imports: Set[str] = field(default_factory=set)
    typevars: Set[str] = field(default_factory=set)


@dataclass
class Ctx:
    state: ModuleState
    type_gps: List[Optional[str]] = field(default_factory=list)
    method_gps: List[str] = field(default_factory=list)


class TypeRenderer:
    def __init__(self, known: Dict[str, str], collections: str = "python", own_arity=None):
        """`known` maps Python-qualified type name -> namespace module that defines it.
        `own_arity(pyname)` returns how many generic params a known type declares itself
        (excluding those inherited from an enclosing type), or None if unknown."""
        self.known = known
        self.collections = collections
        self.own_arity = own_arity or (lambda py: None)

    def _known(self, named: S.Named, ctx: Ctx) -> Optional[str]:
        py = named.pyname
        mod = self.known.get(py)
        if mod is None:
            return None
        ctx.state.imports.add(mod)
        return py

    def render(self, t: Type, ctx: Ctx) -> str:
        if isinstance(t, S.Prim):
            return PRIM_PY.get(t.code, "typing.Any")
        if isinstance(t, S.Named):
            full = t.fullname
            if full in BUILTIN_NAMED:
                return BUILTIN_NAMED[full]
            if self.collections == "python" and full in PY_NAMED:
                return PY_NAMED[full]
            if t.arity:  # open generic used bare (rare) -> the class itself
                return self._known(t, ctx) or "typing.Any"
            return self._known(t, ctx) or "typing.Any"
        if isinstance(t, S.GenericInst):
            full = t.base.fullname
            args = [self.render(a, ctx) for a in t.args]
            table = PY_GENERICS if self.collections == "python" else DOTNET_GENERICS
            if full in table:
                try:
                    return table[full].format(*args)
                except IndexError:
                    pass
            if full.startswith("System.Func`") and self.collections == "python":
                return f"typing.Callable[[{', '.join(args[:-1])}], {args[-1]}]"
            if full.startswith("System.Action`") and self.collections == "python":
                return f"typing.Callable[[{', '.join(args)}], None]"
            base = self._known(t.base, ctx)
            if base is None:
                return "typing.Any"
            own = self.own_arity(base)
            if own is not None:
                args = args[len(args) - own:] if own else []
            return f"{base}[{', '.join(args)}]" if args else base
        if isinstance(t, (S.SZArray, S.MDArray)):
            return f"typing.List[{self.render(t.elem, ctx)}]"
        if isinstance(t, S.ByRef):
            return self.render(t.inner, ctx)
        if isinstance(t, S.Ptr):
            return "typing.Any"
        if isinstance(t, S.Var):
            names = ctx.method_gps if t.is_method else ctx.type_gps
            if t.index < len(names) and names[t.index]:
                ctx.state.typevars.add(names[t.index])
                return names[t.index]
            return "typing.Any"
        return "typing.Any"
