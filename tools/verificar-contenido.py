#!/usr/bin/env python3
"""Verifica content/: JSON válido, @ID[X] declarados, @pista{P-xx} existentes."""
import json, re, sys, pathlib
raiz = pathlib.Path(sys.argv[1]) / "content"
ignorar = set(sys.argv[2:])
ids, errores = {}, []
def decl(i, donde): ids.setdefault(i, donde)
def recorrer(o, f):
    if isinstance(o, dict):
        if isinstance(o.get("id"), str): decl(o["id"], f)
        for v in o.values(): recorrer(v, f)
    elif isinstance(o, list):
        for v in o: recorrer(v, f)
pistas = set()
for f in sorted(raiz.rglob("*.json")):
    try:
        d = json.loads(f.read_text())
    except Exception as e:
        errores.append(f"JSON inválido {f}: {e}"); continue
    recorrer(d, f)
    if f.name == "combate.json" and isinstance(d, dict):
        for k in d: decl(k, f)
    if f.name == "pistas.json":
        pistas = {p["id"] for p in d["pistas"]}
mds = sorted(raiz.rglob("*.md"))
for f in mds:
    t = f.read_text()
    m = re.match(r"---\n(.*?)\n---", t, re.S)
    if m:
        mi = re.search(r"^id:\s*\"?([^\"\n]+)\"?\s*$", m.group(1), re.M)
        if mi: decl(mi.group(1).strip(), f)
    for a in re.findall(r"\{#([^}\s]+)\}", t): decl(a, f)
for f in mds:
    t = f.read_text()
    for n, linea in enumerate(t.split("\n"), 1):
        for r in re.findall(r"@ID\[([^\]|]+)(?:\|[^\]]*)?\]", linea):
            r = r.strip()
            if r not in ids and r not in ignorar:
                errores.append(f"@ID huérfano {r}  {f.relative_to(raiz)}:{n}")
        for p in re.findall(r"@pista\{([^}|]+)", linea):
            if p.strip() not in pistas:
                errores.append(f"@pista inexistente {p}  {f.relative_to(raiz)}:{n}")
for e in errores: print(e)
print(f"\n{len(ids)} ids declarados, {len(errores)} errores")

# Referencias internas de trackers.json y pistas.json
claves = ("escena", "escenas", "lugar", "pnj", "pj", "documento", "gancho", "desenlace", "pista", "pistas", "prueba", "lor", "otrasEscenas", "ayuda")
malas = []
def mirar(o, f):
    if isinstance(o, dict):
        for k, v in o.items():
            if k in claves:
                for x in (v if isinstance(v, list) else [v]):
                    if isinstance(x, str) and x not in ids and x not in ignorar and x[:1] in "APLDGFMCR":
                        malas.append(f"{f.name}: {k}={x}")
            mirar(v, f)
    elif isinstance(o, list):
        for v in o: mirar(v, f)
for n in ("trackers.json", "pistas.json"):
    f = raiz / n; mirar(json.loads(f.read_text()), f)
for m in sorted(set(malas)): print("ref interna huérfana:", m)
print(len(set(malas)), "refs internas huérfanas")
