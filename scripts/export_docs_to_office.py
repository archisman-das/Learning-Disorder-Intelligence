from __future__ import annotations

import argparse
import datetime as dt
import re
import textwrap
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

import matplotlib

matplotlib.use("Agg")
from matplotlib import pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.font_manager import FontProperties


ROOT = Path(__file__).resolve().parents[1]
DOCS_ROOT = ROOT / "docs"
OUTPUT_ROOT = DOCS_ROOT / "formatted_documents"
PDF_ROOT = OUTPUT_ROOT / "pdf"
DOCX_ROOT = OUTPUT_ROOT / "docx"


@dataclass
class Block:
    kind: str
    text: str
    level: int = 0
    indent: int = 0


def discover_sources(docs_root: Path, output_root: Path) -> list[Path]:
    sources = [p for p in docs_root.rglob("*.md") if output_root not in p.parents]
    for extra in [ROOT / "README.md", ROOT / "RELEASE_NOTES.md"]:
        if extra.exists():
            sources.append(extra)
    return sorted({path.resolve() for path in sources})


def normalize_inline(text: str) -> str:
    text = text.replace("\u2019", "'")
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)
    text = re.sub(r"__([^_]+)__", r"\1", text)
    text = re.sub(r"_([^_]+)_", r"\1", text)
    return text


def parse_markdown(text: str) -> list[Block]:
    lines = text.splitlines()
    blocks: list[Block] = []
    i = 0
    in_code = False
    code_lines: list[str] = []
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()

        if stripped.startswith("```"):
            if in_code:
                blocks.append(Block("code", "\n".join(code_lines)))
                code_lines = []
                in_code = False
            else:
                in_code = True
            i += 1
            continue

        if in_code:
            code_lines.append(raw.rstrip("\n"))
            i += 1
            continue

        if not stripped:
            blocks.append(Block("blank", ""))
            i += 1
            continue

        if stripped.startswith("#"):
            level = len(stripped) - len(stripped.lstrip("#"))
            blocks.append(Block("heading", normalize_inline(stripped[level:].strip()), level=level))
            i += 1
            continue

        table_candidate = (
            "|" in stripped
            and i + 1 < len(lines)
            and re.match(r"^\s*\|?[\s:-]+\|[\s|:-]*$", lines[i + 1].strip()) is not None
        )
        if table_candidate:
            table_lines = [stripped]
            i += 2
            while i < len(lines) and "|" in lines[i]:
                table_lines.append(lines[i].strip())
                i += 1
            blocks.append(Block("table", "\n".join(table_lines)))
            continue

        bullet = re.match(r"^(\s*)([-*+])\s+(.*)$", raw)
        if bullet:
            indent = len(bullet.group(1)) // 2
            blocks.append(Block("bullet", normalize_inline(bullet.group(3).strip()), indent=indent))
            i += 1
            continue

        numbered = re.match(r"^(\s*)(\d+)\.\s+(.*)$", raw)
        if numbered:
            indent = len(numbered.group(1)) // 2
            blocks.append(Block("number", normalize_inline(numbered.group(3).strip()), indent=indent))
            i += 1
            continue

        if stripped.startswith(">"):
            blocks.append(Block("quote", normalize_inline(stripped.lstrip(">").strip())))
            i += 1
            continue

        paragraph_lines = [normalize_inline(stripped)]
        i += 1
        while i < len(lines):
            nxt = lines[i].strip()
            if not nxt:
                break
            if nxt.startswith("#") or nxt.startswith("```"):
                break
            if re.match(r"^(\s*)([-*+])\s+(.*)$", lines[i]) or re.match(r"^(\s*)(\d+)\.\s+(.*)$", lines[i]):
                break
            if nxt.startswith(">"):
                break
            paragraph_lines.append(normalize_inline(nxt))
            i += 1
        blocks.append(Block("paragraph", " ".join(paragraph_lines)))

    if in_code and code_lines:
        blocks.append(Block("code", "\n".join(code_lines)))
    return blocks


def expand_blocks_to_lines(blocks: list[Block]) -> list[dict[str, object]]:
    lines: list[dict[str, object]] = []
    for block in blocks:
        if block.kind == "blank":
            lines.append({"text": "", "kind": "blank", "size": 10, "bold": False, "mono": False, "indent": 0})
            continue
        if block.kind == "heading":
            size = {1: 22, 2: 18, 3: 15}.get(block.level, 13)
            lines.append({"text": block.text, "kind": "heading", "size": size, "bold": True, "mono": False, "indent": 0})
            continue
        if block.kind == "paragraph":
            lines.extend(_wrap_text(block.text, kind="paragraph", size=11, indent=0, mono=False))
            continue
        if block.kind == "quote":
            lines.extend(_wrap_text(f"> {block.text}", kind="quote", size=11, indent=1, mono=False))
            continue
        if block.kind == "bullet":
            prefix = "  " * block.indent + "- "
            lines.extend(_wrap_text(prefix + block.text, kind="bullet", size=11, indent=block.indent, mono=False))
            continue
        if block.kind == "number":
            prefix = "  " * block.indent + "1. "
            lines.extend(_wrap_text(prefix + block.text, kind="number", size=11, indent=block.indent, mono=False))
            continue
        if block.kind == "table":
            for row in block.text.splitlines():
                lines.extend(_wrap_text(row.replace("|", " | "), kind="table", size=10, indent=0, mono=True))
            continue
        if block.kind == "code":
            lines.append({"text": "", "kind": "blank", "size": 10, "bold": False, "mono": False, "indent": 0})
            for row in block.text.splitlines():
                lines.append({"text": row, "kind": "code", "size": 10, "bold": False, "mono": True, "indent": 0})
            lines.append({"text": "", "kind": "blank", "size": 10, "bold": False, "mono": False, "indent": 0})
            continue
    return lines


def _wrap_text(text: str, *, kind: str, size: int, indent: int, mono: bool) -> list[dict[str, object]]:
    width = 95 if mono else 100
    wrapped = textwrap.wrap(text, width=width, break_long_words=False, break_on_hyphens=False) or [""]
    return [
        {"text": line, "kind": kind, "size": size, "bold": False, "mono": mono, "indent": indent}
        for line in wrapped
    ]


def export_pdf(source: Path, target: Path, font: FontProperties) -> None:
    blocks = parse_markdown(source.read_text(encoding="utf-8").lstrip("\ufeff"))
    lines = expand_blocks_to_lines(blocks)
    target.parent.mkdir(parents=True, exist_ok=True)
    with PdfPages(target) as pdf:
        page_width, page_height = 8.27, 11.69
        top = 0.92
        bottom = 0.55
        left = 0.72
        right = 0.62
        usable_height = page_height - top - bottom
        fig = plt.figure(figsize=(page_width, page_height))
        fig.patch.set_facecolor("white")
        ax = fig.add_axes([0, 0, 1, 1])
        ax.set_axis_off()
        y = 1 - top / page_height

        def new_page() -> None:
            nonlocal fig, ax, y
            pdf.savefig(fig, bbox_inches="tight", pad_inches=0.08)
            plt.close(fig)
            fig = plt.figure(figsize=(page_width, page_height))
            fig.patch.set_facecolor("white")
            ax = fig.add_axes([0, 0, 1, 1])
            ax.set_axis_off()
            y = 1 - top / page_height

        for item in lines:
            text = str(item["text"])
            size = int(item["size"])
            kind = str(item["kind"])
            bold = bool(item["bold"])
            mono = bool(item["mono"])
            indent = int(item["indent"])
            if kind == "blank":
                y -= (size * 0.45) / (page_height * 72)
                if y < bottom / page_height:
                    new_page()
                continue
            line_height = size * (0.062 if mono else 0.068)
            if y - line_height / page_height < bottom / page_height:
                new_page()
            x = left / page_width + indent * 0.04
            ax.text(
                x,
                y,
                text,
                fontproperties=font if mono else font,
                fontsize=size,
                weight="bold" if bold else "normal",
                family="monospace" if mono else "sans-serif",
                va="top",
                ha="left",
                color="black",
            )
            y -= line_height / page_height

        pdf.savefig(fig, bbox_inches="tight", pad_inches=0.08)
        plt.close(fig)


def make_docx_xml(source: Path) -> tuple[str, str, str, str]:
    blocks = parse_markdown(source.read_text(encoding="utf-8").lstrip("\ufeff"))
    paragraphs: list[str] = []
    for block in blocks:
        if block.kind == "blank":
            paragraphs.append("<w:p/>")
            continue
        if block.kind == "heading":
            size = {1: "32", 2: "28", 3: "24"}.get(block.level, "22")
            paragraphs.append(
                f"<w:p><w:r><w:rPr><w:b/><w:sz w:val=\"{size}\"/></w:rPr><w:t xml:space=\"preserve\">{xml_escape(block.text)}</w:t></w:r></w:p>"
            )
            continue
        if block.kind in {"paragraph", "quote", "bullet", "number"}:
            prefix = ""
            if block.kind == "quote":
                prefix = "> "
            elif block.kind == "bullet":
                prefix = "- "
            elif block.kind == "number":
                prefix = "1. "
            text = xml_escape(prefix + block.text)
            paragraphs.append(
                f"<w:p><w:r><w:rPr><w:sz w:val=\"22\"/></w:rPr><w:t xml:space=\"preserve\">{text}</w:t></w:r></w:p>"
            )
            continue
        if block.kind == "table":
            for row in block.text.splitlines():
                text = xml_escape(row.replace("|", " | "))
                paragraphs.append(
                    f"<w:p><w:r><w:rPr><w:rFonts w:ascii=\"Courier New\" w:hAnsi=\"Courier New\"/><w:sz w:val=\"20\"/></w:rPr><w:t xml:space=\"preserve\">{text}</w:t></w:r></w:p>"
                )
            continue
        if block.kind == "code":
            paragraphs.append("<w:p/>")
            for row in block.text.splitlines():
                text = xml_escape(row)
                paragraphs.append(
                    f"<w:p><w:r><w:rPr><w:rFonts w:ascii=\"Courier New\" w:hAnsi=\"Courier New\"/><w:sz w:val=\"20\"/></w:rPr><w:t xml:space=\"preserve\">{text}</w:t></w:r></w:p>"
                )
            paragraphs.append("<w:p/>")
            continue

    document = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
 xmlns:v="urn:schemas-microsoft-com:vml"
 xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:w10="urn:schemas-microsoft-com:office:word"
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
 xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
 xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
 xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
 xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
 mc:Ignorable="w14 wp14">
  <w:body>
    {''.join(paragraphs)}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>
"""

    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
"""

    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="R1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""

    app = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Codex</Application>
</Properties>
"""

    timestamp = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    core = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>{xml_escape(source.stem)}</dc:title>
  <dc:creator>Codex</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{timestamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{timestamp}</dcterms:modified>
</cp:coreProperties>
"""

    return document, content_types, rels, app, core


def export_docx(source: Path, target: Path) -> None:
    document, content_types, rels, app, core = make_docx_xml(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("word/document.xml", document)
        zf.writestr("docProps/app.xml", app)
        zf.writestr("docProps/core.xml", core)


def main() -> int:
    parser = argparse.ArgumentParser(description="Export markdown docs to PDF and DOCX copies.")
    parser.add_argument("--source-root", type=Path, default=DOCS_ROOT, help="Root folder to scan for markdown docs.")
    parser.add_argument("--output-root", type=Path, default=OUTPUT_ROOT, help="Export root folder.")
    args = parser.parse_args()

    docs_root = args.source_root.resolve()
    output_root = args.output_root.resolve()
    pdf_root = output_root / "pdf"
    docx_root = output_root / "docx"

    sources = discover_sources(docs_root, output_root)
    if not sources:
        print("No markdown sources found.")
        return 0

    font_path = None
    for candidate in [
        Path(r"C:\Windows\Fonts\Nirmala.ttc"),
        Path(r"C:\Windows\Fonts\segoeui.ttf"),
        Path(r"C:\Windows\Fonts\arial.ttf"),
    ]:
        if candidate.exists():
            font_path = candidate
            break
    font = FontProperties(fname=str(font_path)) if font_path else FontProperties()

    written = 0
    for source in sources:
        relative = source.relative_to(docs_root) if docs_root in source.parents else source.name
        pdf_target = (pdf_root / relative).with_suffix(".pdf")
        docx_target = (docx_root / relative).with_suffix(".docx")
        export_pdf(source, pdf_target, font)
        export_docx(source, docx_target)
        written += 2
        print(f"Exported {source} -> {pdf_target} and {docx_target}")

    print(f"Done. Wrote {written} files under {output_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
