// 用真实大模型把 36 个场景完整跑一遍并录制，供网页回放。每个场景跑 RUNS 次，统计 pass^k。
//   通义千问：set DASHSCOPE_API_KEY=...   （默认模型 qwen-plus）
//   DeepSeek：set DEEPSEEK_API_KEY=...    （默认模型 deepseek-chat）
//   可选：LLM_MODEL=qwen-max  RUNS=3  ONLY=2b,3e
import { writeFileSync, mkdirSync } from 'node:fs';
import { SCENARIOS } from '../engine/scenarios.js';
import { runCell } from '../engine/runner.js';
import { llmConfig } from '../engine/llm.js';

const env = process.env;
let llm;
if (env.DASHSCOPE_API_KEY) llm = llmConfig({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: env.DASHSCOPE_API_KEY, model: env.LLM_MODEL || 'qwen-plus' });
else if (env.DEEPSEEK_API_KEY) llm = llmConfig({ baseUrl: 'https://api.deepseek.com/v1', apiKey: env.DEEPSEEK_API_KEY, model: env.LLM_MODEL || 'deepseek-chat' });
else if (env.LLM_API_KEY && env.LLM_BASE_URL) llm = llmConfig({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL });
else { console.error('没有找到 API Key。请先设置 DASHSCOPE_API_KEY 或 DEEPSEEK_API_KEY。'); process.exit(1); }

const RUNS = Math.max(1, +(env.RUNS || 3));
const only = env.ONLY ? env.ONLY.split(',') : null;
const cells = SCENARIOS.filter(c => !only || only.includes(c.id));
console.log(`模型 ${llm.model}，${cells.length} 个场景 × ${RUNS} 次\n`);

const out = { meta: { mode: 'llm', model: llm.model, recordedAt: new Date().toISOString(), runs: RUNS }, cells: {} };
let allPass = 0;
for (const c of cells) {
  const runs = [];
  for (let k = 0; k < RUNS; k++) {
    try { runs.push(await runCell(c, { llm })); }
    catch (e) { runs.push({ id: c.id, turns: [], checks: [`运行失败：${e.message}`] }); }
  }
  const passes = runs.map(r => r.checks.length === 0);
  const passAll = passes.every(Boolean); if (passAll) allPass++;
  const best = runs[0]; // 回放第一次运行的原样结果，不挑最好的一次
  out.cells[c.id] = { turns: best.turns, checks: runs[0].checks, passes, failures: runs.map(r => r.checks) };
  console.log(`${passAll ? '✓' : '✗'} ${c.id} ${c.title}  ${passes.map(p => p ? '●' : '○').join('')}${passAll ? '' : '\n   ' + runs.flatMap(r => r.checks).join('\n   ')}`);
}
out.meta.passK = allPass; out.meta.total = cells.length; out.meta.tokens = llm.usage || 0;
mkdirSync('recordings', { recursive: true });
const file = `recordings/llm-${llm.model}.json`;
writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`\npass^${RUNS}：${allPass}/${cells.length}    用量约 ${out.meta.tokens} tokens\n已保存 ${file}，运行 node scripts/build.mjs 生成网页。`);
