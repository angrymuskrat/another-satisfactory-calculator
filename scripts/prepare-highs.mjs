// Adapt highs-js 1.15.2's text extraction, preserving full-precision primal values.
// Upstream uses writeSolutionPretty, which rounds columns to six significant digits.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const entry = require.resolve('highs');
let source = await readFile(entry, 'utf8');
const replaceOnce = (from, to) => {
  if (!source.includes(from) || source.indexOf(from) !== source.lastIndexOf(from)) throw new Error('HiGHS adapter mismatch; inspect the new dependency before updating.');
  source = source.replace(from, to);
};
replaceOnce('"Highs_writeSolutionPretty","number",["number","string"]', '"Highs_writeSolution","number",["number","string"]');
replaceOnce('const output=parseResult(solution.split(/\\r?\\n/),status)', 'const output=parseRawResult(solution.split(/\\r?\\n/),status)');
const parser = `
function parseRawResult(lines,status) {
  const result={Status:status,Columns:{},Rows:[],ObjectiveValue:NaN};
  if(lines[4]!=="Feasible") return result;
  const objective=lines.find(line=>line.startsWith("Objective "));
  if(objective) result.ObjectiveValue=Number(objective.slice(10));
  let start=lines.findIndex(line=>line.startsWith("# Columns "));
  if(start<0) throw new Error("Missing HiGHS raw columns");
  const count=Number(lines[start].split(" ")[2]);
  for(let index=0;index<count;index++) {
    const [name,raw]=lines[start+1+index].trim().split(/\\s+/);
    const value=Number(raw);
    if(!Number.isFinite(value)) throw new Error("Invalid HiGHS primal value");
    result.Columns[name]={Name:name,Index:index,Primal:value,Type:"Continuous"};
  }
  start+=count+1;
  const rowCount=Number(lines[start].split(" ")[2]);
  for(let index=0;index<rowCount;index++) {
    const [name,raw]=lines[start+1+index].trim().split(/\\s+/);
    result.Rows.push({Name:name,Index:index,Primal:Number(raw)});
  }
  return result;
}
`;
source = '// Generated from highs-js 1.15.2 (MIT). Modified solution extraction; see scripts/prepare-highs.mjs.\n' + parser + source;
const output = resolve('packages/solver/vendor');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'highs.cjs'), source);
const cjsTail = 'if(typeof exports==="object"&&typeof module==="object"){module.exports=Module;module.exports.default=Module}else if(typeof define==="function"&&define["amd"])define([],()=>Module);';
if (!source.includes(cjsTail)) throw new Error('HiGHS export adapter mismatch');
const web = source.replace(cjsTail, 'export default Module;').replace('var ENVIRONMENT_IS_NODE=globalThis.process?.versions?.node&&globalThis.process?.type!="renderer";', 'var ENVIRONMENT_IS_NODE=false;');
await writeFile(resolve(output, 'highs.mjs'), web);
await copyFile(resolve(dirname(entry), 'highs.wasm'), resolve(output, 'highs.wasm'));
await mkdir('apps/web/public/solver', { recursive: true });
await copyFile(resolve(dirname(entry), 'highs.wasm'), resolve('apps/web/public/solver/highs.wasm'));
console.log('HiGHS adapter: full precision node/browser modules + local WASM prepared.');
