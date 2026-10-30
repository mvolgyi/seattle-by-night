#!/usr/bin/env node
/**
 * Fija `version` y `download` en module.json a partir del tag de git.
 *
 *   node tools/release.mjs v0.2.0
 *
 * `manifest` queda apuntando a releases/latest/download/module.json (así el
 * auto-update de Foundry siempre ve la última), y `download` al zip del tag.
 */
import fs from "node:fs";
import path from "node:path";
import { RAIZ } from "./util.mjs";

const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+/.test(tag ?? "")) {
  console.error("Uso: node tools/release.mjs v<major>.<minor>.<patch>");
  process.exit(1);
}
const version = tag.slice(1);
const ruta = path.join(RAIZ, "module.json");
const manifest = JSON.parse(fs.readFileSync(ruta, "utf8"));
manifest.version = version;
manifest.download = `https://github.com/mvolgyi/seattle-by-night/releases/download/${tag}/module.zip`;
fs.writeFileSync(ruta, JSON.stringify(manifest, null, 2) + "\n");

const pkgRuta = path.join(RAIZ, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgRuta, "utf8"));
pkg.version = version;
fs.writeFileSync(pkgRuta, JSON.stringify(pkg, null, 2) + "\n");

console.log(`module.json → ${version} (${manifest.download})`);
