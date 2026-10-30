#!/usr/bin/env python3
"""
docx de Seattle by Night → Markdown crudo en cache/docx/NN.md

Es el primer paso de la fase 1: una extracción fiel y determinista (títulos,
párrafos, negritas, cursivas, listas y tablas en el orden del documento). Los
agentes `contenido` parten de este Markdown para escribir content/; nunca se
edita a mano y no se commitea (cache/ está en .gitignore).

Uso: python3 tools/importar-docx.py            # todos los docs
     python3 tools/importar-docx.py 05 14       # sólo esos números
"""
import html
import pathlib
import re
import sys
import zipfile

RAIZ = pathlib.Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "Seattle by Night - El Expediente Ward"
SALIDA = RAIZ / "cache" / "docx"

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def texto_run(r):
    """Texto de un <w:r>, con ** / * si es negrita o cursiva."""
    partes = []
    for nodo in r:
        if nodo.tag == W + "t":
            partes.append(nodo.text or "")
        elif nodo.tag == W + "tab":
            partes.append("\t")
        elif nodo.tag in (W + "br", W + "cr"):
            partes.append("\n")
    t = "".join(partes)
    if not t.strip():
        return t
    rpr = r.find(W + "rPr")
    negrita = cursiva = False
    if rpr is not None:
        b = rpr.find(W + "b")
        i = rpr.find(W + "i")
        negrita = b is not None and b.get(W + "val") not in ("0", "false")
        cursiva = i is not None and i.get(W + "val") not in ("0", "false")
    # Los espacios quedan afuera de las marcas: «** hola**» no es Markdown.
    m = re.match(r"^(\s*)(.*?)(\s*)$", t, re.S)
    ini, cuerpo, fin = m.groups()
    if negrita:
        cuerpo = f"**{cuerpo}**"
    if cursiva:
        cuerpo = f"*{cuerpo}*"
    return ini + cuerpo + fin


def texto_parrafo(p):
    out = []
    for nodo in p.iter():
        if nodo.tag == W + "r":
            out.append(texto_run(nodo))
    t = "".join(out)
    # Une marcas contiguas que Word parte en varios runs: «**a****b**» → «**ab**».
    t = t.replace("****", "").replace("**  **", " ")
    return t.strip()


def estilo(p):
    ppr = p.find(W + "pPr")
    if ppr is None:
        return "", False
    s = ppr.find(W + "pStyle")
    lista = ppr.find(W + "numPr") is not None
    return (s.get(W + "val") if s is not None else "").lower(), lista


def parrafo_md(p):
    t = texto_parrafo(p)
    if not t:
        return None
    s, lista = estilo(p)
    m = re.match(r"(?:heading|ttulo|titulo)(\d)", s)
    if m or s == "title":
        nivel = int(m.group(1)) if m else 1
        return "#" * nivel + " " + re.sub(r"^\*\*(.*)\*\*$", r"\1", t)
    if lista:
        return "- " + t
    return t


def lineas_celda(tc):
    """Líneas de una celda en orden, incluidas las tablas anidadas.

    Una tabla dentro de otra no se puede escribir como tabla Markdown dentro de
    una celda: cada fila anidada sale como una línea «a · b · c».
    """
    lineas = []
    for nodo in tc:
        if nodo.tag == W + "p":
            t = texto_parrafo(nodo)
            if t:
                lineas.append(t)
        elif nodo.tag == W + "tbl":
            for tr in nodo.findall(W + "tr"):
                celdas = [" / ".join(lineas_celda(c)) for c in tr.findall(W + "tc")]
                fila = " · ".join(c for c in celdas if c)
                if fila:
                    lineas.append(fila)
        elif nodo.tag == W + "sdt":
            contenido = nodo.find(W + "sdtContent")
            if contenido is not None:
                lineas.extend(lineas_celda(contenido))
    return lineas


def tabla_md(tbl):
    filas = []
    for tr in tbl.findall(W + "tr"):
        celdas = []
        for tc in tr.findall(W + "tc"):
            celdas.append("<br>".join(lineas_celda(tc)).replace("|", "\\|"))
        filas.append(celdas)
    if not filas:
        return ""
    ancho = max(len(f) for f in filas)
    filas = [f + [""] * (ancho - len(f)) for f in filas]
    lineas = ["| " + " | ".join(filas[0]) + " |", "|" + "---|" * ancho]
    lineas += ["| " + " | ".join(f) + " |" for f in filas[1:]]
    return "\n".join(lineas)


def convertir(docx):
    import xml.etree.ElementTree as ET
    raiz = ET.fromstring(zipfile.ZipFile(docx).read("word/document.xml"))
    cuerpo = raiz.find(W + "body")
    bloques = []
    for nodo in cuerpo:
        if nodo.tag == W + "p":
            md = parrafo_md(nodo)
        elif nodo.tag == W + "tbl":
            md = tabla_md(nodo)
        else:
            md = None
        if md:
            bloques.append(html.unescape(md))
    # Ítems de lista seguidos van pegados; el resto separado por línea en blanco.
    out = []
    for b in bloques:
        if out and b.startswith("- ") and out[-1].startswith("- "):
            out[-1] += "\n" + b
        else:
            out.append(b)
    return "\n\n".join(out) + "\n"


def main():
    pedidos = set(sys.argv[1:])
    SALIDA.mkdir(parents=True, exist_ok=True)
    for docx in sorted(ORIGEN.glob("*.docx")):
        m = re.search(r"— (\d\d) ·", docx.name)
        if not m:
            continue
        num = m.group(1)
        if pedidos and num not in pedidos:
            continue
        destino = SALIDA / f"{num}.md"
        destino.write_text(f"<!-- origen: {docx.name} -->\n\n" + convertir(docx), encoding="utf-8")
        print(f"{num}: {destino.relative_to(RAIZ)} ({destino.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
