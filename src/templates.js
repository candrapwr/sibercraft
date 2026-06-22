export function initialWorkspace(name, template = "blank") {
  const safeName = escapeHtml(name);
  if (template === "dashboard") return dashboardTemplate(safeName);

  return {
    "index.html": `<!doctype html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeName}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="starter">
    <span class="eyebrow">SIBERCRAFT</span>
    <h1>${safeName}</h1>
    <p>Mulai dari panel prompt untuk membuat antarmuka, chart, atau diagram.</p>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
    "styles.css": `:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #18201d; background: #f2f4ef; }
.starter { width: min(680px, calc(100% - 48px)); padding: 72px; text-align: center; border: 1px solid #d9ded7; border-radius: 28px; background: rgba(255,255,255,.75); box-shadow: 0 24px 70px rgba(30,40,34,.08); }
.eyebrow { color: #6c766f; font-size: 12px; font-weight: 700; letter-spacing: .16em; }
h1 { margin: 18px 0 12px; font-size: clamp(36px, 7vw, 72px); letter-spacing: -.055em; }
p { margin: 0; color: #657069; font-size: 17px; line-height: 1.7; }
`,
    "app.js": `console.log("Workspace siap");\n`,
  };
}

function dashboardTemplate(name) {
  return {
    "index.html": `<!doctype html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><link rel="stylesheet" href="styles.css"></head><body><aside><strong>${name}</strong><nav>Overview<br>Analytics<br>Reports</nav></aside><main><header><p>OVERVIEW</p><h1>Dashboard</h1></header><section class="cards"><article><span>Total revenue</span><b>Rp128,4 jt</b></article><article><span>Orders</span><b>1.842</b></article><article><span>Conversion</span><b>4,8%</b></article></section><section class="chart"><h2>Performance</h2><div class="bars"><i style="height:42%"></i><i style="height:65%"></i><i style="height:54%"></i><i style="height:82%"></i><i style="height:72%"></i><i style="height:94%"></i></div></section></main><script src="app.js"></script></body></html>`,
    "styles.css": `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;grid-template-columns:230px 1fr;background:#f5f6f2;color:#17201b;font-family:Inter,system-ui,sans-serif}aside{padding:32px;background:#18221c;color:white}nav{margin-top:56px;line-height:3;color:#aeb9b1}main{padding:42px}header p{font-size:11px;letter-spacing:.18em;color:#78827b}h1{margin:7px 0 32px;font-size:42px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.cards article,.chart{padding:24px;border:1px solid #dfe3dc;border-radius:18px;background:white}.cards span{display:block;color:#727d75;font-size:13px}.cards b{display:block;margin-top:16px;font-size:27px}.chart{margin-top:18px;height:360px}.bars{height:250px;display:flex;align-items:end;gap:20px;padding-top:20px}.bars i{flex:1;border-radius:8px 8px 2px 2px;background:#51a476}@media(max-width:700px){body{display:block}aside{display:none}main{padding:24px}.cards{grid-template-columns:1fr}.chart{height:300px}}`,
    "app.js": `console.log("Dashboard siap");\n`,
  };
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
