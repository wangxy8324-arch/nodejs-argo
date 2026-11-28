// Build script: assembles the build output the deploy ships.
// dist/ must contain everything the app reads at run time:
// the server entry and the static page it serves.
import fs from "node:fs";
import path from "node:path";

const dist = path.resolve("dist");
fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(path.resolve("index.js"), path.join(dist, "index.js"));
fs.copyFileSync(path.resolve("index.html"), path.join(dist, "index.html"));
console.log("Built dist/ (index.js, index.html)");
