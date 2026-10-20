import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
// The supplied formatter removes required separators from inline TS types.
// Use the installed compiler's syntax-aware printer for source formatting.
const args=process.argv.slice(2).filter(p=>p!=="--");
const targets=args.length?args:["src","vite.config.ts"];
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});
function format(target){
 const full=path.resolve(target);
 if(!full.startsWith(process.cwd()+path.sep))throw Error("Format paths must stay inside this project.");
 if(fs.statSync(full).isDirectory()){
  for(const name of fs.readdirSync(full))if(!["node_modules","dist",".git"].includes(name))format(path.join(full,name));
  return;
 }
 if(!/\.(?:ts|tsx|mjs|js)$/.test(full))return;
 const source=fs.readFileSync(full,"utf8");
 const file=ts.createSourceFile(full,source,ts.ScriptTarget.Latest,true,full.endsWith(".tsx")?ts.ScriptKind.TSX:full.endsWith(".ts")?ts.ScriptKind.TS:ts.ScriptKind.JS);
 if(file.parseDiagnostics.length)throw Error("Fix syntax errors before formatting "+target);
 fs.writeFileSync(full,printer.printFile(file));
}
for(const target of targets)format(target);
console.log("Source formatted with the TypeScript printer.");
