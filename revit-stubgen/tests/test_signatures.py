from revitstubs import signatures as S


def _decoder():
    def resolve(tag, idx):
        return S.Named("Autodesk.Revit.DB", ("ElementId",) if idx == 1 else ("IList`1",))
    return S.SigDecoder(resolve)


def test_method_sig_with_generic_list_and_out_param():
    # HASTHIS, 2 params, returns bool, (IList<ElementId> ids, out double value)
    blob = bytes([0x20, 0x02, S.ET_BOOLEAN,
                  S.ET_GENERICINST, S.ET_CLASS, (2 << 2) | 0, 1, S.ET_CLASS, (1 << 2) | 0,
                  S.ET_BYREF, S.ET_R8])
    sig = _decoder().method(blob)
    assert sig.has_this and sig.generic_count == 0
    assert isinstance(sig.ret, S.Prim) and sig.ret.code == S.ET_BOOLEAN
    inst, byref = sig.params
    assert isinstance(inst, S.GenericInst) and inst.base.fullname == "Autodesk.Revit.DB.IList`1"
    assert isinstance(byref, S.ByRef) and byref.inner.code == S.ET_R8
    assert S.docid_type(inst) == "Autodesk.Revit.DB.IList{Autodesk.Revit.DB.ElementId}"
    assert S.docid_type(byref) == "System.Double@"


def test_arrays_and_vars():
    d = _decoder()
    t = d.typespec(bytes([S.ET_SZARRAY, S.ET_MVAR, 0]))
    assert isinstance(t, S.SZArray) and t.elem == S.Var(0, True)
    assert S.docid_type(t) == "``0[]"
    t = d.typespec(bytes([S.ET_ARRAY, S.ET_I4, 2, 0, 0]))
    assert isinstance(t, S.MDArray) and t.rank == 2
    assert S.docid_type(t) == "System.Int32[0:,0:]"


def test_compressed_ints():
    r = S._Reader(bytes([0x7F, 0x80, 0x80, 0xC0, 0x00, 0x40, 0x00]))
    assert r.uint() == 0x7F
    assert r.uint() == 0x80
    assert r.uint() == 0x4000


def test_named_pyname_strips_arity():
    n = S.Named("System.Collections.Generic", ("Dictionary`2", "Enumerator"))
    assert n.pyname == "System.Collections.Generic.Dictionary.Enumerator"
    assert n.arity == 2
