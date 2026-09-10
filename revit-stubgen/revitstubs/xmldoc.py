"""Parse compiler-generated XML documentation files (RevitAPI.xml, RevitAPIUI.xml, ...)
into per-member docs keyed by the standard doc-comment id (T:, M:, P:, F:, E:).
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

_WS = re.compile(r"[ \t\r\f\v]+")
_BLANKS = re.compile(r"\n{3,}")


@dataclass
class MemberDoc:
    summary: str = ""
    remarks: str = ""
    returns: str = ""
    value: str = ""
    params: Dict[str, str] = field(default_factory=dict)
    typeparams: Dict[str, str] = field(default_factory=dict)
    exceptions: List[Tuple[str, str]] = field(default_factory=list)
    extras: List[Tuple[str, str]] = field(default_factory=list)  # e.g. ("since", "2019")

    def is_empty(self) -> bool:
        return not (self.summary or self.remarks or self.returns or self.params or self.exceptions or self.extras)


def _cref_short(cref: str) -> str:
    kind, _, body = cref.partition(":")
    if not body:
        kind, body = "", cref
    body = body.split("(", 1)[0]
    parts = body.split(".")
    n = 2 if kind in ("M", "P", "F", "E") and len(parts) >= 2 else 1
    return ".".join(S_strip(x) for x in parts[-n:])


def S_strip(name: str) -> str:
    return name.split("`", 1)[0]


def _inline(el: ET.Element) -> str:
    """Flatten an element's mixed content to plain text."""
    out: List[str] = [el.text or ""]
    for child in el:
        tag = child.tag.lower()
        if tag == "para":
            out.append("\n\n" + _inline(child).strip() + "\n\n")
        elif tag in ("see", "seealso"):
            cref = child.get("cref") or child.get("langword") or child.get("href") or ""
            inner = _inline(child).strip()
            out.append(inner or _cref_short(cref))
        elif tag in ("paramref", "typeparamref"):
            out.append(child.get("name", ""))
        elif tag in ("c",):
            out.append("`" + _inline(child).strip() + "`")
        elif tag == "code":
            out.append("\n\n```\n" + (child.text or "").strip("\n") + "\n```\n\n")
        elif tag == "list":
            for item in child.iter("item"):
                out.append("\n- " + _inline(item).strip())
            out.append("\n")
        elif tag in ("term", "description"):
            out.append(_inline(child).strip() + " ")
        else:
            out.append(_inline(child))
        out.append(child.tail or "")
    return "".join(out)


def _clean(text: str) -> str:
    lines = [_WS.sub(" ", ln).strip() for ln in text.split("\n")]
    text = "\n".join(lines).strip()
    return _BLANKS.sub("\n\n", text)


class XmlDocs:
    def __init__(self):
        self.members: Dict[str, MemberDoc] = {}
        self._by_prefix: Dict[str, List[str]] = defaultdict(list)

    @classmethod
    def load(cls, *paths) -> "XmlDocs":
        docs = cls()
        for p in paths:
            if p and Path(p).exists():
                docs._parse(Path(p))
        return docs

    def _parse(self, path: Path) -> None:
        for _, el in ET.iterparse(str(path), events=("end",)):
            if el.tag != "member":
                continue
            name = el.get("name", "")
            if name:
                self.members[name] = self._member(el)
                self._by_prefix[name.split("(", 1)[0].split("``", 1)[0]].append(name)
            el.clear()

    @staticmethod
    def _member(el: ET.Element) -> MemberDoc:
        d = MemberDoc()
        for child in el:
            tag = child.tag.lower()
            if tag == "summary":
                d.summary = _clean(_inline(child))
            elif tag == "remarks":
                d.remarks = _clean(_inline(child))
            elif tag == "returns":
                d.returns = _clean(_inline(child))
            elif tag == "value":
                d.value = _clean(_inline(child))
            elif tag == "param":
                d.params[child.get("name", "")] = _clean(_inline(child))
            elif tag == "typeparam":
                d.typeparams[child.get("name", "")] = _clean(_inline(child))
            elif tag == "exception":
                d.exceptions.append((_cref_short(child.get("cref", "")), _clean(_inline(child))))
            elif tag in ("example",):
                d.extras.append(("Example", _clean(_inline(child))))
            elif tag in ("since", "revit_since"):
                d.extras.append(("Since", _clean(_inline(child))))
            elif tag not in ("inheritdoc", "seealso", "overloads", "filterpriority", "permission"):
                txt = _clean(_inline(child))
                if txt:
                    d.extras.append((tag.capitalize(), txt))
        return d

    def get(self, docid: str, param_count: Optional[int] = None) -> Optional[MemberDoc]:
        """Exact match first; then fall back to a same-named overload."""
        d = self.members.get(docid)
        if d is not None:
            return d
        prefix = docid.split("(", 1)[0].split("``", 1)[0]
        cands = self._by_prefix.get(prefix)
        if not cands:
            return None
        if param_count is not None:
            for c in cands:
                n = c.count(",") + 1 if "(" in c else 0
                if n == param_count:
                    return self.members[c]
        return self.members[cands[0]]


def render_docstring(doc: Optional[MemberDoc], indent: str, params: Optional[List[str]] = None) -> List[str]:
    """Render a MemberDoc as lines of a Python docstring (Google style)."""
    if doc is None or doc.is_empty():
        return []
    parts: List[str] = []
    if doc.summary:
        parts.append(doc.summary)
    if doc.remarks:
        parts.append("Remarks:\n" + _indent_block(doc.remarks, "    "))
    if params:
        lines = []
        for p in params:
            desc = doc.params.get(p)
            if desc:
                lines.append(f"    {p}: {_indent_cont(desc, '        ')}")
        if lines:
            parts.append("Args:\n" + "\n".join(lines))
    if doc.returns:
        parts.append("Returns:\n" + _indent_block(doc.returns, "    "))
    elif doc.value:
        parts.append("Value:\n" + _indent_block(doc.value, "    "))
    if doc.exceptions:
        parts.append("Raises:\n" + "\n".join(f"    {n}: {_indent_cont(t, '        ')}" for n, t in doc.exceptions))
    for title, txt in doc.extras:
        parts.append(f"{title}:\n" + _indent_block(txt, "    "))
    text = "\n\n".join(parts).replace("\\", "\\\\").replace('"""', '\\"\\"\\"')
    lines = text.split("\n")
    if len(lines) == 1:
        return [f'{indent}"""{lines[0]}"""']
    out = [f'{indent}"""{lines[0]}']
    out += [(indent + ln) if ln else "" for ln in lines[1:]]
    out.append(f'{indent}"""')
    return out


def _indent_block(text: str, pad: str) -> str:
    return "\n".join((pad + ln) if ln else "" for ln in text.split("\n"))


def _indent_cont(text: str, pad: str) -> str:
    lines = text.split("\n")
    return lines[0] + "".join("\n" + (pad + ln if ln else "") for ln in lines[1:])
