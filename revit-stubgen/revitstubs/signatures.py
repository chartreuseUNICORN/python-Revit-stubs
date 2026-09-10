"""ECMA-335 (II.23.2) metadata signature decoding.

Turns the raw blobs stored in the MethodDef / Field / Property / TypeSpec tables
into a small, immutable type model that the rest of the generator consumes.
No CLR is needed: this is pure byte parsing.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List, Optional, Tuple, Union

# ---- ELEMENT_TYPE_* ---------------------------------------------------------
ET_END, ET_VOID, ET_BOOLEAN, ET_CHAR = 0x00, 0x01, 0x02, 0x03
ET_I1, ET_U1, ET_I2, ET_U2, ET_I4, ET_U4, ET_I8, ET_U8 = 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B
ET_R4, ET_R8, ET_STRING, ET_PTR, ET_BYREF = 0x0C, 0x0D, 0x0E, 0x0F, 0x10
ET_VALUETYPE, ET_CLASS, ET_VAR, ET_ARRAY, ET_GENERICINST = 0x11, 0x12, 0x13, 0x14, 0x15
ET_TYPEDBYREF, ET_I, ET_U, ET_FNPTR, ET_OBJECT, ET_SZARRAY, ET_MVAR = 0x16, 0x18, 0x19, 0x1B, 0x1C, 0x1D, 0x1E
ET_CMOD_REQD, ET_CMOD_OPT, ET_INTERNAL, ET_MODIFIER, ET_SENTINEL, ET_PINNED = 0x1F, 0x20, 0x21, 0x40, 0x41, 0x45

PRIM_FULLNAMES = {
    ET_VOID: "System.Void", ET_BOOLEAN: "System.Boolean", ET_CHAR: "System.Char",
    ET_I1: "System.SByte", ET_U1: "System.Byte", ET_I2: "System.Int16", ET_U2: "System.UInt16",
    ET_I4: "System.Int32", ET_U4: "System.UInt32", ET_I8: "System.Int64", ET_U8: "System.UInt64",
    ET_R4: "System.Single", ET_R8: "System.Double", ET_STRING: "System.String",
    ET_I: "System.IntPtr", ET_U: "System.UIntPtr", ET_OBJECT: "System.Object",
    ET_TYPEDBYREF: "System.TypedReference",
}


# ---- type model ---------------------------------------------------------------
@dataclass(frozen=True)
class Prim:
    code: int

    @property
    def fullname(self) -> str:
        return PRIM_FULLNAMES[self.code]


@dataclass(frozen=True)
class Named:
    """A TypeDef/TypeRef. `names` is the nesting chain (Outer, Inner); names keep
    their CLR arity suffix (``List`1``)."""
    namespace: str
    names: Tuple[str, ...]
    assembly: Optional[str] = None

    @property
    def fullname(self) -> str:  # CLR-style, used for lookups and XML doc ids
        return ".".join(x for x in (self.namespace, *self.names) if x)

    @property
    def pyname(self) -> str:  # arity stripped: what we emit in Python
        return ".".join(x for x in (self.namespace, *(strip_arity(n) for n in self.names)) if x)

    @property
    def arity(self) -> int:
        n = 0
        for part in self.names:
            if "`" in part:
                try:
                    n += int(part.rsplit("`", 1)[1])
                except ValueError:
                    pass
        return n


@dataclass(frozen=True)
class GenericInst:
    base: Named
    args: Tuple["Type", ...]


@dataclass(frozen=True)
class SZArray:
    elem: "Type"


@dataclass(frozen=True)
class MDArray:
    elem: "Type"
    rank: int


@dataclass(frozen=True)
class ByRef:
    inner: "Type"


@dataclass(frozen=True)
class Ptr:
    inner: "Type"


@dataclass(frozen=True)
class Var:
    index: int
    is_method: bool  # MVAR vs VAR


@dataclass(frozen=True)
class Unknown:
    note: str = ""


Type = Union[Prim, Named, GenericInst, SZArray, MDArray, ByRef, Ptr, Var, Unknown]


@dataclass
class MethodSig:
    has_this: bool
    generic_count: int
    ret: Type
    params: List[Type]


def strip_arity(name: str) -> str:
    return name.split("`", 1)[0] if "`" in name else name


def unwrap_byref(t: Type) -> Type:
    return t.inner if isinstance(t, ByRef) else t


# ---- reader -----------------------------------------------------------------
class _Reader:
    __slots__ = ("data", "pos")

    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def eof(self) -> bool:
        return self.pos >= len(self.data)

    def byte(self) -> int:
        b = self.data[self.pos]
        self.pos += 1
        return b

    def peek(self) -> int:
        return self.data[self.pos]

    def uint(self) -> int:
        b0 = self.byte()
        if b0 & 0x80 == 0:
            return b0
        if b0 & 0xC0 == 0x80:
            return ((b0 & 0x3F) << 8) | self.byte()
        if b0 & 0xE0 == 0xC0:
            return ((b0 & 0x1F) << 24) | (self.byte() << 16) | (self.byte() << 8) | self.byte()
        raise ValueError("bad compressed integer")

    def sint(self) -> int:
        # Same width rules; the sign bit is rotated into the LSB (II.23.2 ArrayShape lo-bounds).
        start = self.pos
        raw = self.uint()
        width = self.pos - start
        bits = {1: 7, 2: 14, 4: 29}[width]
        val = raw >> 1
        if raw & 1:
            val -= 1 << bits
        return val


# ---- decoder -----------------------------------------------------------------
ResolveFn = Callable[[int, int], Type]  # (TypeDefOrRef tag, 1-based row index) -> Type


class SigDecoder:
    def __init__(self, resolve: ResolveFn):
        self.resolve = resolve

    # TypeDefOrRef coded index: low 2 bits = tag (0 TypeDef, 1 TypeRef, 2 TypeSpec)
    def _typedeforref(self, r: _Reader) -> Type:
        coded = r.uint()
        tag, idx = coded & 3, coded >> 2
        try:
            return self.resolve(tag, idx)
        except Exception as e:  # pragma: no cover - defensive
            return Unknown(f"unresolved TypeDefOrRef tag={tag} idx={idx}: {e}")

    def _skip_custom_mods(self, r: _Reader) -> None:
        while not r.eof() and r.peek() in (ET_CMOD_REQD, ET_CMOD_OPT):
            r.byte()
            r.uint()

    def decode_type(self, r: _Reader) -> Type:
        self._skip_custom_mods(r)
        et = r.byte()
        if et in PRIM_FULLNAMES:
            return Prim(et)
        if et == ET_PTR:
            self._skip_custom_mods(r)
            if r.peek() == ET_VOID:
                r.byte()
                return Ptr(Prim(ET_VOID))
            return Ptr(self.decode_type(r))
        if et == ET_BYREF:
            return ByRef(self.decode_type(r))
        if et in (ET_VALUETYPE, ET_CLASS):
            return self._typedeforref(r)
        if et == ET_VAR:
            return Var(r.uint(), False)
        if et == ET_MVAR:
            return Var(r.uint(), True)
        if et == ET_SZARRAY:
            return SZArray(self.decode_type(r))
        if et == ET_ARRAY:
            elem = self.decode_type(r)
            rank = r.uint()
            for _ in range(r.uint()):
                r.uint()
            for _ in range(r.uint()):
                r.sint()
            return MDArray(elem, rank)
        if et == ET_GENERICINST:
            r.byte()  # CLASS / VALUETYPE
            base = self._typedeforref(r)
            n = r.uint()
            args = tuple(self.decode_type(r) for _ in range(n))
            if isinstance(base, Named):
                return GenericInst(base, args)
            return Unknown("generic instantiation of non-named type")
        if et == ET_FNPTR:
            self._method(r)  # consume
            return Unknown("function pointer")
        if et == ET_PINNED:
            return self.decode_type(r)
        if et == ET_SENTINEL:
            return self.decode_type(r)
        if et == ET_INTERNAL:
            r.pos += 8
            return Unknown("internal type")
        return Unknown(f"element type 0x{et:02x}")

    def _ret_or_param(self, r: _Reader) -> Type:
        self._skip_custom_mods(r)
        if r.peek() == ET_TYPEDBYREF:
            r.byte()
            return Prim(ET_TYPEDBYREF)
        if r.peek() == ET_VOID:
            r.byte()
            return Prim(ET_VOID)
        if r.peek() == ET_BYREF:
            r.byte()
            return ByRef(self.decode_type(r))
        return self.decode_type(r)

    def _method(self, r: _Reader) -> MethodSig:
        conv = r.byte()
        generic = r.uint() if conv & 0x10 else 0
        count = r.uint()
        ret = self._ret_or_param(r)
        params: List[Type] = []
        for _ in range(count):
            if not r.eof() and r.peek() == ET_SENTINEL:
                r.byte()
            params.append(self._ret_or_param(r))
        return MethodSig(bool(conv & 0x20), generic, ret, params)

    # public entry points --------------------------------------------------
    def method(self, blob: bytes) -> MethodSig:
        return self._method(_Reader(blob))

    def field(self, blob: bytes) -> Type:
        r = _Reader(blob)
        r.byte()  # 0x06 FIELD
        return self.decode_type(r)

    def property(self, blob: bytes) -> Tuple[Type, List[Type]]:
        r = _Reader(blob)
        r.byte()  # 0x08 | HASTHIS
        count = r.uint()
        ret = self._ret_or_param(r)
        params = [self._ret_or_param(r) for _ in range(count)]
        return ret, params

    def typespec(self, blob: bytes) -> Type:
        return self.decode_type(_Reader(blob))


# ---- XML documentation ids ------------------------------------------------------
def docid_type(t: Type, in_generic_args: bool = False) -> str:
    """Render a type the way the C# compiler does in XML doc member ids."""
    if isinstance(t, Prim):
        return t.fullname
    if isinstance(t, Named):
        return t.fullname
    if isinstance(t, GenericInst):
        base = ".".join(x for x in (t.base.namespace, *(strip_arity(n) for n in t.base.names)) if x)
        return base + "{" + ",".join(docid_type(a, True) for a in t.args) + "}"
    if isinstance(t, SZArray):
        return docid_type(t.elem) + "[]"
    if isinstance(t, MDArray):
        return docid_type(t.elem) + "[" + ",".join("0:" for _ in range(t.rank)) + "]"
    if isinstance(t, ByRef):
        return docid_type(t.inner) + "@"
    if isinstance(t, Ptr):
        return docid_type(t.inner) + "*"
    if isinstance(t, Var):
        return ("``" if t.is_method else "`") + str(t.index)
    return "?"
