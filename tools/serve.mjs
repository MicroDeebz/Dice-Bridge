/**
 * Zero-dependency static server for the companion extension.
 *
 * Owlbear Rodeo fetches the companion's manifest cross-origin, so this serves
 * `Access-Control-Allow-Origin: *` and disables caching.
 *
 * Usage: node tools/serve.mjs [port]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("dist/companion");
const port = Number(process.argv[2] || process.env.PORT || 8788);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";

  const file = path.join(root, pathname.replace(/^[/\\]+/, ""));
  if (!file.startsWith(root)) {
    response.writeHead(403, { "content-type": "text/plain" }).end("Forbidden");
    return;
  }

  try {
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Companion served from ${root}`);
  console.log(`  manifest: http://localhost:${port}/manifest.json`);
  console.log(`  popover:  http://localhost:${port}/`);
  console.log("Add the manifest URL in Owlbear Rodeo → Extensions, and paste the origin into Dice Bridge settings.");
});
