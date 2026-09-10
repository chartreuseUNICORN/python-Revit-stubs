from revitstubs.xmldoc import XmlDocs, render_docstring


def test_parse_and_overload_fallback(tmp_path):
    p = tmp_path / "X.xml"
    p.write_text("""<doc><members>
      <member name="M:Ns.T.Do(System.Int32)"><summary>One <see cref="T:Ns.Other"/>.</summary><param name="a">A.</param><returns>R.</returns></member>
      <member name="M:Ns.T.Do(System.Int32,System.String)"><summary>Two.</summary></member>
      <member name="P:Ns.T.Prop"><summary>Prop <c>x</c>.</summary><exception cref="T:System.ArgumentException">bad</exception></member>
    </members></doc>""")
    docs = XmlDocs.load(p)
    assert docs.get("M:Ns.T.Do(System.Int32)").summary == "One Other."
    assert docs.get("M:Ns.T.Do(System.Double,System.String)", 2).summary == "Two."   # overload fallback by arity
    assert docs.get("M:Ns.T.Nope") is None
    lines = render_docstring(docs.get("M:Ns.T.Do(System.Int32)"), "    ", ["a"])
    text = "\n".join(lines)
    assert "Args:" in text and "a: A." in text and "Returns:" in text
    lines = render_docstring(docs.get("P:Ns.T.Prop"), "")
    assert "Raises:" in "\n".join(lines) and "`x`" in lines[0]
