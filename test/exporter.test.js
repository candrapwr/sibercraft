import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildStandaloneHtml } from "../src/exporter.js";

test("export standalone menyatukan CSS, JavaScript, dan gambar lokal", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sibercraft-export-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), '<link rel="stylesheet" href="styles.css"><img src="assets/pixel.png"><script src="app.js"></script>');
  await writeFile(join(root, "styles.css"), 'body{background:url("assets/pixel.png")}');
  await writeFile(join(root, "app.js"), 'document.body.dataset.ready="yes";');
  await writeFile(join(root, "assets/pixel.png"), Buffer.from([137, 80, 78, 71]));

  const html = await buildStandaloneHtml(root);
  assert.match(html, /<style data-sibercraft-source="styles\.css">/);
  assert.match(html, /<script data-sibercraft-source="app\.js">/);
  assert.doesNotMatch(html, /(?:href|src)="(?:styles\.css|app\.js|assets\/pixel\.png)"/);
  assert.equal((html.match(/data:image\/png;base64,/g) || []).length, 2);
});
