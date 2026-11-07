// 生成可部署的单文件网页 docs/legacy/agent-trace.html：规则模式现场跑一遍 + 读取 recordings/ 里的大模型录制。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { SCENARIOS, QUESTIONS } from '../engine/scenarios.js';
import { runCell } from '../engine/runner.js';
import { ACCOUNTS, MERCHANTS, KNOWLEDGE, BRAND, TODAY, maskNo } from '../engine/data.js';
import { TOOL_DEFS } from '../engine/tools.js';

const rules = { meta: { mode: 'rules', model: '规则模式', recordedAt: new Date().toISOString(), runs: 1 }, cells: {} };
let pass = 0;
for (const c of SCENARIOS) { const r = await runCell(c); rules.cells[c.id] = { turns: r.turns, checks: r.checks, passes: [r.checks.length === 0] }; if (!r.checks.length) pass++; }
rules.meta.passK = pass; rules.meta.total = SCENARIOS.length;

const recordings = { rules };
if (existsSync('recordings')) for (const f of readdirSync('recordings').filter(f => f.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(`recordings/${f}`, 'utf8')); recordings[f.replace('.json', '')] = j;
}
const accounts = Object.fromEntries(Object.values(ACCOUNTS).map(a => [a.id, { ...a, merchantNames: a.merchants.map(m => `${MERCHANTS[m].name}（${maskNo(MERCHANTS[m].no)}）`) }]));
const data = { brand: BRAND, today: TODAY, questions: QUESTIONS, scenarios: SCENARIOS, accounts, knowledge: KNOWLEDGE, tools: TOOL_DEFS, recordings, builtAt: new Date().toISOString() };
const html = readFileSync('web/legacy/agent-trace.html', 'utf8').replace('/*__DATA__*/null', JSON.stringify(data).replace(/</g, '\\u003c'));
mkdirSync('docs/legacy', { recursive: true });
writeFileSync('docs/legacy/agent-trace.html', html);
console.log(`规则模式 ${pass}/${SCENARIOS.length}；录制：${Object.keys(recordings).join('、')}；已生成 docs/legacy/agent-trace.html（${(html.length / 1024).toFixed(0)} KB）`);
