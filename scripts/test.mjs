// 规则模式全量回归：36 个场景必须全部通过。
import { SCENARIOS } from '../engine/scenarios.js';
import { runCell } from '../engine/runner.js';
let pass = 0;
for (const c of SCENARIOS) {
  const r = await runCell(c);
  if (r.checks.length) { console.log(`✗ ${c.id} ${c.title}\n   ${r.checks.join('\n   ')}`); }
  else { pass++; console.log(`✓ ${c.id} ${c.title}  →  ${r.turns.map(t => t.trace.outcome).join(' / ')}`); }
}
console.log(`\n${pass}/${SCENARIOS.length} 通过`);
process.exit(pass === SCENARIOS.length ? 0 : 1);
