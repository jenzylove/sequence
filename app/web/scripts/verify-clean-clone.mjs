// Builds the web app from a pristine clone of HEAD, in a temp directory, with
// no access to the working tree.
//
// This exists because a local build proves nothing about what was committed: an
// over-broad .gitignore rule ("lib/" rather than "/lib/") once excluded three
// real source modules, and every local build still passed because the files sat
// on disk. Only a clean checkout catches that class of mistake, which is exactly
// what a deployment does.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const work = mkdtempSync(join(tmpdir(), "sequence-clean-"));

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "pipe", encoding: "utf8", shell: process.platform === "win32" });

let failed = false;
const ok = (m, d = "") => console.log(`  PASS  ${m}${d ? ` — ${d}` : ""}`);
const bad = (m, d = "") => { console.error(`  FAIL  ${m}${d ? ` — ${d}` : ""}`); failed = true; };

try {
  const head = run("git", ["rev-parse", "--short", "HEAD"], repo).trim();
  // Clone the committed tree only. Anything uncommitted is invisible here.
  run("git", ["clone", "--quiet", "--no-hardlinks", repo, work], repo);
  run("git", ["checkout", "--quiet", head], work);
  ok("cloned HEAD into a clean tree", head);

  const web = join(work, "app", "web");

  // Every local import must exist in the clone, or the build will fail the way
  // the deployment did.
  const missing = run("node", ["-e", `
    const fs=require('fs'),path=require('path');
    const root=${JSON.stringify(web)};
    const out=[];
    const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){
      const p=path.join(d,e.name);
      if(e.isDirectory()){ if(!/node_modules|dist/.test(e.name)) walk(p); continue; }
      if(!/\\.(js|jsx|mjs)$/.test(e.name)) continue;
      const src=fs.readFileSync(p,'utf8');
      for(const m of src.matchAll(/from\\s+["'](\\.[^"']+)["']/g)){
        const t=path.resolve(path.dirname(p),m[1]);
        if(!fs.existsSync(t)) out.push(path.relative(root,p)+' -> '+m[1]);
      }
    }};
    walk(path.join(root,'src'));
    console.log(out.join('\\n'));
  `], repo).trim();
  missing ? bad("every local import resolves in the clone", missing.split("\n").slice(0, 5).join("; "))
          : ok("every local import resolves in the clone");

  run("npm", ["install", "--silent", "--no-audit", "--no-fund"], web);
  ok("dependencies install from the committed manifest");

  run("npm", ["run", "build"], web);
  const built = existsSync(join(web, "dist", "index.html"));
  built ? ok("production build succeeds from a clean checkout") : bad("production build produced no index.html");

  for (const asset of ["favicon.svg", "manifest.webmanifest", "og.svg"]) {
    existsSync(join(web, "dist", asset))
      ? ok(`static asset ${asset} is committed and emitted`)
      : bad(`static asset ${asset} is committed and emitted`);
  }
} catch (cause) {
  const detail = (cause.stderr || cause.stdout || cause.message || "").toString().trim().split("\n").slice(-6).join(" | ");
  bad("clean-clone build", detail);
} finally {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* temp dir */ }
}

console.log(failed ? "\nverify-clean-clone: FAILURES\n" : "\nverify-clean-clone: deployable from HEAD\n");
process.exit(failed ? 1 : 0);
