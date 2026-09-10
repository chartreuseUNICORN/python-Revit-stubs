"""Read a .NET assembly's metadata tables with dnfile and build a language-neutral
model (types, methods, properties, fields, events, enums) of its *public* surface.

Works for both .NET Framework (Revit <= 2024) and .NET 8 (Revit >= 2025)
assemblies because it never loads them into a runtime.
"""
from __future__ import annotations

import struct
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import dnfile

from . import signatures as S
from .signatures import Named, SigDecoder, Type

# ---- flag bits (CorHdr.h) ------------------------------------------------------
TD_VISIBILITY_MASK, TD_PUBLIC, TD_NESTED_PUBLIC, TD_INTERFACE = 0x7, 0x1, 0x2, 0x20
MD_ACCESS_MASK, MD_PUBLIC, MD_STATIC, MD_SPECIALNAME = 0x7, 0x6, 0x10, 0x800
FD_ACCESS_MASK, FD_PUBLIC, FD_STATIC, FD_LITERAL = 0x7, 0x6, 0x10, 0x40
PD_IN, PD_OUT, PD_OPTIONAL, PD_HASDEFAULT = 0x1, 0x2, 0x10, 0x1000
MS_SETTER, MS_GETTER, MS_ADDON = 0x1, 0x2, 0x8


# ---- model ----------------------------------------------------------------------
@dataclass
class ParamInfo:
    name: str
    type: Type
    is_out: bool = False      # `out` -> removed from args, added to return tuple
    is_ref: bool = False      # `ref` -> stays in args, also added to return tuple
    is_optional: bool = False
    is_params: bool = False   # params T[] -> *name


@dataclass
class MethodInfo:
    name: str
    params: List[ParamInfo]
    ret: Type
    is_static: bool = False
    is_ctor: bool = False
    generic_params: List[str] = field(default_factory=list)
    obsolete: Optional[str] = None
    docid: str = ""


@dataclass
class PropertyInfo:
    name: str
    type: Type
    has_get: bool
    has_set: bool
    is_static: bool
    index_params: List[ParamInfo] = field(default_factory=list)
    obsolete: Optional[str] = None
    docid: str = ""


@dataclass
class FieldInfo:
    name: str
    type: Type
    is_static: bool
    is_literal: bool
    value: object = None
    docid: str = ""


@dataclass
class EventInfo:
    name: str
    type: Type
    is_static: bool
    docid: str = ""


@dataclass
class TypeInfo:
    named: Named
    kind: str                      # class | interface | struct | enum | delegate
    base: Optional[Type]
    interfaces: List[Type]
    generic_params: List[str]
    methods: List[MethodInfo] = field(default_factory=list)
    properties: List[PropertyInfo] = field(default_factory=list)
    fields: List[FieldInfo] = field(default_factory=list)
    events: List[EventInfo] = field(default_factory=list)
    nested: List["TypeInfo"] = field(default_factory=list)
    outer_generic_count: int = 0   # CLR nested types repeat the enclosing type's generic params first
    is_flags: bool = False
    is_abstract: bool = False
    obsolete: Optional[str] = None
    delegate_sig: Optional[S.MethodSig] = None
    delegate_params: List[ParamInfo] = field(default_factory=list)

    @property
    def docid(self) -> str:
        return "T:" + self.named.fullname


@dataclass
class AssemblyInfo:
    name: str
    path: Path
    types: List[TypeInfo]  # top-level public types only; nested live in TypeInfo.nested

    def walk(self):
        stack = list(self.types)
        while stack:
            t = stack.pop()
            yield t
            stack.extend(t.nested)


# ---- helpers ----------------------------------------------------------------------
def _s(x) -> str:
    if x is None:
        return ""
    v = getattr(x, "value", x)
    if isinstance(v, bytes):
        v = v.decode("utf-8", "replace")
    return str(v)


def _b(x) -> bytes:
    if x is None:
        return b""
    v = getattr(x, "value", x)
    return bytes(v)


def _rows(table) -> list:
    return list(table.rows) if table is not None else []


def _tname(idx) -> str:
    """Name of the metadata table an MDTableIndex points into ('TypeDef', 'TypeRef', ...)."""
    return type(idx.table).__name__ if idx is not None and idx.table is not None else ""


def _row(idx):
    return idx.row if idx is not None else None


# ---- loader --------------------------------------------------------------------------
class AssemblyLoader:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.pe = dnfile.dnPE(str(path))
        if self.pe.net is None or self.pe.net.mdtables is None:
            raise ValueError(f"{path} is not a .NET assembly")
        md = self.md = self.pe.net.mdtables
        self.name = _s(md.Assembly.rows[0].Name) if md.Assembly and md.Assembly.rows else self.path.stem
        self.typedefs = _rows(md.TypeDef)

        # nesting
        self.enclosing: Dict[int, int] = {}
        self.nested_of: Dict[int, List[int]] = defaultdict(list)
        for r in _rows(md.NestedClass):
            self.enclosing[r.NestedClass.row_index] = r.EnclosingClass.row_index
            self.nested_of[r.EnclosingClass.row_index].append(r.NestedClass.row_index)

        # generic params: ('TypeDef'|'MethodDef', idx) -> [names]
        self.generic_params: Dict[Tuple[str, int], List[str]] = defaultdict(list)
        gps = sorted(_rows(md.GenericParam), key=lambda r: r.struct.Number)
        for r in gps:
            self.generic_params[(_tname(r.Owner), r.Owner.row_index)].append(_s(r.Name))

        # method semantics: ('Property'|'Event', idx) -> [(sem, method_idx)]
        self.semantics: Dict[Tuple[str, int], List[Tuple[int, int]]] = defaultdict(list)
        for r in _rows(md.MethodSemantics):
            self.semantics[(_tname(r.Association), r.Association.row_index)].append(
                (r.struct.Semantics, r.Method.row_index))

        self.interfaces: Dict[int, list] = defaultdict(list)
        for r in _rows(md.InterfaceImpl):
            self.interfaces[r.Class.row_index].append(r.Interface)

        self.props: Dict[int, list] = {}
        for r in _rows(md.PropertyMap):
            self.props[r.Parent.row_index] = list(r.PropertyList)
        self.events: Dict[int, list] = {}
        for r in _rows(md.EventMap):
            self.events[r.Parent.row_index] = list(r.EventList)

        # constants: ('Field'|'Param'|'Property', idx) -> (elem type, blob)
        self.constants: Dict[Tuple[str, int], Tuple[int, bytes]] = {}
        for r in _rows(md.Constant):
            self.constants[(_tname(r.Parent), r.Parent.row_index)] = (r.struct.Type, _b(r.Value))

        # method -> owning typedef
        self.method_owner: Dict[int, int] = {}
        self.method_index: Dict[int, object] = {}
        for i, td in enumerate(self.typedefs, 1):
            for mi in td.MethodList:
                self.method_owner[mi.row_index] = i
                self.method_index[mi.row_index] = mi.row

        self._named_cache: Dict[Tuple[str, int], Named] = {}
        self.decoder = SigDecoder(self._resolve)

        # custom attributes: (table, idx) -> [(attr type name, blob)]
        self.attrs: Dict[Tuple[str, int], List[Tuple[str, bytes]]] = defaultdict(list)
        for r in _rows(md.CustomAttribute):
            try:
                self.attrs[(_tname(r.Parent), r.Parent.row_index)].append((self._attr_name(r), _b(r.Value)))
            except Exception:
                pass

    # -- naming --------------------------------------------------------------------
    def named_for_typedef(self, idx: int) -> Named:
        key = ("TypeDef", idx)
        if key not in self._named_cache:
            row = self.typedefs[idx - 1]
            name = _s(row.TypeName)
            if idx in self.enclosing:
                outer = self.named_for_typedef(self.enclosing[idx])
                self._named_cache[key] = Named(outer.namespace, outer.names + (name,), self.name)
            else:
                self._named_cache[key] = Named(_s(row.TypeNamespace), (name,), self.name)
        return self._named_cache[key]

    def named_for_typeref(self, idx: int) -> Named:
        key = ("TypeRef", idx)
        if key not in self._named_cache:
            row = self.md.TypeRef.rows[idx - 1]
            name = _s(row.TypeName)
            scope = row.ResolutionScope
            scope_t = _tname(scope)
            if scope_t == "TypeRef":
                outer = self.named_for_typeref(scope.row_index)
                self._named_cache[key] = Named(outer.namespace, outer.names + (name,), outer.assembly)
            else:
                asm = _s(_row(scope).Name) if scope_t in ("AssemblyRef", "ModuleRef") and _row(scope) is not None else self.name
                self._named_cache[key] = Named(_s(row.TypeNamespace), (name,), asm)
        return self._named_cache[key]

    def _resolve(self, tag: int, idx: int) -> Type:
        if idx == 0:
            return S.Unknown("null token")
        if tag == 0:
            return self.named_for_typedef(idx)
        if tag == 1:
            return self.named_for_typeref(idx)
        if tag == 2:
            return self.decoder.typespec(_b(self.md.TypeSpec.rows[idx - 1].Signature))
        return S.Unknown(f"tag {tag}")

    def resolve_index(self, idx) -> Optional[Type]:
        if idx is None or not idx.row_index:
            return None
        t = _tname(idx)
        tag = {"TypeDef": 0, "TypeRef": 1, "TypeSpec": 2}.get(t)
        return self._resolve(tag, idx.row_index) if tag is not None else None

    # -- custom attributes ---------------------------------------------------------
    def _attr_name(self, ca_row) -> str:
        ctor = ca_row.Type
        kind = _tname(ctor)
        if kind == "MethodDef":
            owner = self.method_owner.get(ctor.row_index)
            return self.named_for_typedef(owner).fullname if owner else ""
        if kind == "MemberRef":
            cls = ctor.row.Class
            t = self.resolve_index(cls)
            return t.fullname if isinstance(t, Named) else ""
        return ""

    def _attrs(self, table: str, idx: int) -> List[Tuple[str, bytes]]:
        return self.attrs.get((table, idx), [])

    def _has_attr(self, table: str, idx: int, suffix: str) -> bool:
        return any(n.endswith(suffix) for n, _ in self._attrs(table, idx))

    def _obsolete(self, table: str, idx: int) -> Optional[str]:
        for n, blob in self._attrs(table, idx):
            if n.endswith("ObsoleteAttribute"):
                return _attr_first_string(blob) or "Obsolete"
        return None

    # -- constants -----------------------------------------------------------------
    def _const(self, table: str, idx: int):
        c = self.constants.get((table, idx))
        return _decode_constant(*c) if c else None

    # -- building --------------------------------------------------------------------
    def load(self) -> AssemblyInfo:
        types = []
        for i, row in enumerate(self.typedefs, 1):
            if i in self.enclosing:
                continue
            if row.struct.Flags & TD_VISIBILITY_MASK != TD_PUBLIC:
                continue
            t = self._build_type(i)
            if t is not None:
                types.append(t)
        return AssemblyInfo(self.name, self.path, types)

    def _build_type(self, idx: int, outer_generic_count: int = 0) -> Optional[TypeInfo]:
        row = self.typedefs[idx - 1]
        flags = row.struct.Flags
        named = self.named_for_typedef(idx)
        if named.names[-1].startswith("<") or named.names[-1] == "<Module>":
            return None
        base = self.resolve_index(row.Extends)
        base_full = base.fullname if isinstance(base, Named) else ""
        if flags & TD_INTERFACE:
            kind = "interface"
        elif base_full == "System.Enum":
            kind = "enum"
        elif base_full == "System.ValueType":
            kind = "struct"
        elif base_full in ("System.MulticastDelegate", "System.Delegate"):
            kind = "delegate"
        else:
            kind = "class"
        info = TypeInfo(
            named=named, kind=kind,
            base=base if kind == "class" else None,
            interfaces=[t for t in (self.resolve_index(i) for i in self.interfaces.get(idx, [])) if t is not None],
            generic_params=list(self.generic_params.get(("TypeDef", idx), [])),
            outer_generic_count=outer_generic_count,
            is_flags=self._has_attr("TypeDef", idx, "FlagsAttribute"),
            is_abstract=bool(flags & 0x80),
            obsolete=self._obsolete("TypeDef", idx),
        )
        self._fill_fields(info, row)
        if kind != "enum":
            self._fill_methods(info, row)
            self._fill_properties(info, idx)
            self._fill_events(info, idx)
        if kind == "delegate":
            for m in info.methods:
                if m.name == "Invoke":
                    info.delegate_params = m.params
                    info.delegate_sig = S.MethodSig(True, 0, m.ret, [p.type for p in m.params])
            info.methods = []
        for n in self.nested_of.get(idx, []):
            nrow = self.typedefs[n - 1]
            if nrow.struct.Flags & TD_VISIBILITY_MASK == TD_NESTED_PUBLIC:
                nt = self._build_type(n, len(info.generic_params))
                if nt is not None:
                    info.nested.append(nt)
        return info

    def _params_for(self, mi_row, method_idx: int, sig: S.MethodSig) -> List[ParamInfo]:
        by_seq = {}
        for pi in mi_row.ParamList:
            p = pi.row
            if p.struct.Sequence >= 1:
                by_seq[p.struct.Sequence] = (p, pi.row_index)
        params: List[ParamInfo] = []
        for n, t in enumerate(sig.params, 1):
            prow, pidx = by_seq.get(n, (None, None))
            pflags = prow.struct.Flags if prow is not None else 0
            name = _s(prow.Name) if prow is not None else ""
            if not name:
                name = f"arg{n}"
            byref = isinstance(t, S.ByRef)
            is_out = byref and bool(pflags & PD_OUT) and not (pflags & PD_IN)
            params.append(ParamInfo(
                name=name, type=S.unwrap_byref(t) if byref else t,
                is_out=is_out, is_ref=byref and not is_out,
                is_optional=bool(pflags & (PD_OPTIONAL | PD_HASDEFAULT)),
                is_params=bool(pidx and self._has_attr("Param", pidx, "ParamArrayAttribute")),
            ))
        return params

    def _fill_methods(self, info: TypeInfo, row) -> None:
        for mi in row.MethodList:
            m = mi.row
            mflags = m.struct.Flags
            if mflags & MD_ACCESS_MASK != MD_PUBLIC:
                continue
            name = _s(m.Name)
            if name == ".cctor" or name.startswith("<") or "." in name.strip("."):
                continue
            is_ctor = name == ".ctor"
            if mflags & MD_SPECIALNAME and not is_ctor and not name.startswith("op_"):
                continue  # get_/set_/add_/remove_ accessors
            try:
                sig = self.decoder.method(_b(m.Signature))
            except Exception:
                continue
            gps = list(self.generic_params.get(("MethodDef", mi.row_index), []))
            params = self._params_for(m, mi.row_index, sig)
            docid = "M:" + info.named.fullname + "." + ("#ctor" if is_ctor else name)
            if gps:
                docid += f"``{len(gps)}"
            if sig.params:
                docid += "(" + ",".join(S.docid_type(t) for t in sig.params) + ")"
            if name in ("op_Implicit", "op_Explicit"):
                docid += "~" + S.docid_type(sig.ret)
            info.methods.append(MethodInfo(
                name=name, params=params, ret=sig.ret, is_static=bool(mflags & MD_STATIC),
                is_ctor=is_ctor, generic_params=gps,
                obsolete=self._obsolete("MethodDef", mi.row_index), docid=docid,
            ))

    def _fill_properties(self, info: TypeInfo, idx: int) -> None:
        for pi in self.props.get(idx, []):
            p = pi.row
            name = _s(p.Name)
            try:
                ret, ptypes = self.decoder.property(_b(p.Type))
            except Exception:
                continue
            has_get = has_set = is_static = False
            getter = None
            for sem, midx in self.semantics.get(("Property", pi.row_index), []):
                m = self.method_index.get(midx)
                if m is None or m.struct.Flags & MD_ACCESS_MASK != MD_PUBLIC:
                    continue
                if sem & MS_GETTER:
                    has_get, getter = True, m
                if sem & MS_SETTER:
                    has_set = True
                is_static = bool(m.struct.Flags & MD_STATIC)
            if not (has_get or has_set):
                continue
            index_params: List[ParamInfo] = []
            if ptypes:
                names = []
                if getter is not None:
                    names = [_s(x.row.Name) for x in getter.ParamList if x.row.struct.Sequence >= 1]
                for n, t in enumerate(ptypes):
                    index_params.append(ParamInfo(names[n] if n < len(names) else f"index{n}", S.unwrap_byref(t)))
            docid = "P:" + info.named.fullname + "." + name
            if ptypes:
                docid += "(" + ",".join(S.docid_type(t) for t in ptypes) + ")"
            info.properties.append(PropertyInfo(
                name=name, type=S.unwrap_byref(ret), has_get=has_get, has_set=has_set,
                is_static=is_static, index_params=index_params,
                obsolete=self._obsolete("Property", pi.row_index), docid=docid,
            ))

    def _fill_events(self, info: TypeInfo, idx: int) -> None:
        for ei in self.events.get(idx, []):
            e = ei.row
            name = _s(e.Name)
            is_static = False
            public = False
            for sem, midx in self.semantics.get(("Event", ei.row_index), []):
                m = self.method_index.get(midx)
                if m is not None and m.struct.Flags & MD_ACCESS_MASK == MD_PUBLIC and sem & MS_ADDON:
                    public = True
                    is_static = bool(m.struct.Flags & MD_STATIC)
            if not public:
                continue
            t = self.resolve_index(e.EventType) or S.Unknown("event type")
            info.events.append(EventInfo(name, t, is_static, docid="E:" + info.named.fullname + "." + name))

    def _fill_fields(self, info: TypeInfo, row) -> None:
        for fi in row.FieldList:
            f = fi.row
            fflags = f.struct.Flags
            if fflags & FD_ACCESS_MASK != FD_PUBLIC:
                continue
            name = _s(f.Name)
            if name.startswith("<") or name == "value__":
                continue
            try:
                t = self.decoder.field(_b(f.Signature))
            except Exception:
                continue
            literal = bool(fflags & FD_LITERAL)
            info.fields.append(FieldInfo(
                name=name, type=t, is_static=bool(fflags & FD_STATIC), is_literal=literal,
                value=self._const("Field", fi.row_index) if literal else None,
                docid="F:" + info.named.fullname + "." + name,
            ))


# ---- blob helpers ---------------------------------------------------------------------
def _decode_constant(et: int, blob: bytes):
    try:
        if et == S.ET_BOOLEAN:
            return bool(blob[0])
        if et == S.ET_CHAR:
            return blob[:2].decode("utf-16-le")
        if et in (S.ET_I1, S.ET_U1, S.ET_I2, S.ET_U2, S.ET_I4, S.ET_U4, S.ET_I8, S.ET_U8):
            fmt = {S.ET_I1: "<b", S.ET_U1: "<B", S.ET_I2: "<h", S.ET_U2: "<H",
                   S.ET_I4: "<i", S.ET_U4: "<I", S.ET_I8: "<q", S.ET_U8: "<Q"}[et]
            return struct.unpack(fmt, blob[: struct.calcsize(fmt)])[0]
        if et == S.ET_R4:
            return struct.unpack("<f", blob[:4])[0]
        if et == S.ET_R8:
            return struct.unpack("<d", blob[:8])[0]
        if et == S.ET_STRING:
            return blob.decode("utf-16-le")
    except Exception:
        return None
    return None


def _attr_first_string(blob: bytes) -> Optional[str]:
    """First fixed string argument of a custom attribute blob (e.g. Obsolete message)."""
    try:
        r = S._Reader(blob)
        if r.byte() != 0x01 or r.byte() != 0x00:
            return None
        if r.eof():
            return None
        if r.peek() == 0xFF:
            return None
        n = r.uint()
        return blob[r.pos: r.pos + n].decode("utf-8", "replace")
    except Exception:
        return None


def load_assembly(path) -> AssemblyInfo:
    return AssemblyLoader(Path(path)).load()
