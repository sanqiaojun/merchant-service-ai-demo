// 评测：同一批场景，规则模式跑一遍作基线，再接入真实大模型每个场景跑 RUNS 次。
// 输出每次运行是否通过、失败归因、答复校验拦截情况，保存到 recordings/eval-<模型>.json。
//   通义千问：set DASHSCOPE_API_KEY=...   （默认模型 qwen-plus）
//   DeepSeek：set DEEPSEEK_API_KEY=...    （默认模型 deepseek-chat）
//   其他兼容接口：LLM_BASE_URL + LLM_API_KEY + LLM_MODEL
//   可选：RUNS=3  ONLY=2b,3e  CONCURRENCY=4
// API Key 只从环境变量读取，不会写入任何文件。
import { writeFileSync, mkdirSync } from 'node:fs';
import { SCENARIOS, QUESTIONS } from '../engine/scenarios.js';
import { runCell } from '../engine/runner.js';
import { llmConfig } from '../engine/llm.js';

const env = process.env;
let llm;
if (env.DASHSCOPE_API_KEY) llm = llmConfig({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: env.DASHSCOPE_API_KEY, model: env.LLM_MODEL || 'qwen-plus' });
else if (env.DEEPSEEK_API_KEY) llm = llmConfig({ baseUrl: 'https://api.deepseek.com/v1', apiKey: env.DEEPSEEK_API_KEY, model: env.LLM_MODEL || 'deepseek-chat' });
else if (env.LLM_API_KEY && env.LLM_BASE_URL) llm = llmConfig({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL });
else { console.error('没有找到 API Key。请先设置 DASHSCOPE_API_KEY 或 DEEPSEEK_API_KEY。'); process.exit(1); }

const RUNS = Math.max(1, +(env.RUNS || 3));
const CONC = Math.max(1, +(env.CONCURRENCY || 4));
const only = env.ONLY ? env.ONLY.split(',') : null;
const cells = SCENARIOS.filter(c => !only || only.includes(c.id));
const startedAt = new Date().toISOString();

// 1) 规则模式基线
let rulesPass = 0; const rulesFail = [];
for (const c of cells) { const r = await runCell(c); if (r.checks.length) rulesFail.push({ id: c.id, checks: r.checks }); else rulesPass++; }
console.log(`规则模式基线：${rulesPass}/${cells.length} 通过`);
console.log(`大模型 ${llm.model}：${cells.length} 个场景 × ${RUNS} 次，并发 ${CONC}\n`);

// 2) 大模型模式
const slim = t => ({
  input: t.input.text || `[${t.input.action}]`, task: t.trace.task, outcome: t.trace.outcome,
  source: t.trace.understand?.source || null, agree: t.trace.understand?.agreeWithRules ?? null,
  uTask: t.trace.understand?.task || null, normalized: t.trace.understand?.normalized || null, uError: t.trace.understand?.error || null,
  guardOk: t.trace.guard ? t.trace.guard.ok : null, guardReasons: t.trace.guard?.reasons || [],
  polished: !!t.reply?.polished, template: t.trace.template, polishedRaw: t.trace.polishedRaw, text: t.reply?.text || null,
});
// 失败归因：先看有没有调用失败，再看理解环节，再看改写环节
function causeOf(run) {
  if (!run.checks.length) return null;
  if (run.error || run.turns.some(t => t.uError || t.guardReasons.some(r => r.includes('调用失败')))) return '模型调用失败';
  // 模型的理解与规则不一致、且这次运行失败：答复内容不对多半是走错了流程，先归到理解环节
  if (run.turns.some(t => t.agree === false)) return '诉求理解偏差';
  const routeFail = run.checks.some(c => /出口|任务应为|应调用|不应调用|不应用知识库|卡片|交接原因|停止回复|失效归因/.test(c));
  if (run.checks.some(c => /答复缺少|答复不应出现/.test(c)) && run.turns.some(t => t.polished)) return '改写丢失或改动关键内容';
  return routeFail ? '诉求理解偏差' : '其他';
}

const jobs = []; for (const c of cells) for (let k = 0; k < RUNS; k++) jobs.push({ c, k });
const results = new Map(cells.map(c => [c.id, Array(RUNS)]));
let done = 0;
async function worker() {
  for (;;) {
    const j = jobs.shift(); if (!j) return;
    const t0 = Date.now(); let run;
    try { const r = await runCell(j.c, { llm }); run = { checks: r.checks, turns: r.turns.map(slim) }; }
    catch (e) { run = { checks: [`运行失败：${e.message}`], turns: [], error: String(e.message || e) }; }
    run.ms = Date.now() - t0; run.cause = causeOf(run);
    results.get(j.c.id)[j.k] = run; done++;
    process.stdout.write(`\r已完成 ${done}/${cells.length * RUNS}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log('\n');

// 3) 汇总
const out = { meta: { model: llm.model, runs: RUNS, startedAt, finishedAt: new Date().toISOString(), tokens: llm.usage || 0, mock: !!env.MOCK },
  rules: { pass: rulesPass, total: cells.length, failures: rulesFail }, cells: [] };
const S = { runTotal: 0, runPass: 0, passK: 0, causes: {}, byQ: {}, turns: 0, llmUnderstood: 0, disagree: 0, disagreeStillPass: 0,
  polishTried: 0, polishKept: 0, polishBlocked: 0, blockReasons: {} };
for (const c of cells) {
  const runs = results.get(c.id), passes = runs.map(r => r.checks.length === 0), allPass = passes.every(Boolean);
  out.cells.push({ id: c.id, q: c.q, title: c.title, point: c.point, passes, runs });
  const q = (S.byQ[c.q] ||= { cells: 0, passK: 0, runTotal: 0, runPass: 0 });
  q.cells++; if (allPass) { q.passK++; S.passK++; }
  for (const r of runs) {
    S.runTotal++; q.runTotal++; if (!r.checks.length) { S.runPass++; q.runPass++; } else S.causes[r.cause] = (S.causes[r.cause] || 0) + 1;
    for (const t of r.turns) {
      S.turns++;
      if (t.source === 'llm') { S.llmUnderstood++; if (t.agree === false) { S.disagree++; if (!r.checks.length) S.disagreeStillPass++; } }
      if (t.polishedRaw != null) {
        S.polishTried++;
        if (t.polished) S.polishKept++; else { S.polishBlocked++; for (const x of t.guardReasons) { const k = x.replace(/「.*?」|：.*$/g, ''); S.blockReasons[k] = (S.blockReasons[k] || 0) + 1; } }
      }
    }
  }
  console.log(`${allPass ? '✓' : '✗'} ${c.id} ${c.title}  ${passes.map(p => p ? '●' : '○').join('')}${allPass ? '' : '\n   ' + [...new Set(runs.flatMap(r => r.checks.map(x => `[${r.cause}] ${x}`)))].join('\n   ')}`);
}
out.summary = S; out.questions = QUESTIONS;
mkdirSync('recordings', { recursive: true });
const tag = env.TAG ? '-' + env.TAG.replace(/[^\w.-]/g, '_') : '';
out.meta.tag = env.TAG || null;
const file = `recordings/eval-${env.MOCK ? 'mock' : llm.model.replace(/[^\w.-]/g, '_')}${tag}.json`;
writeFileSync(file, JSON.stringify(out, null, 1));
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—';
console.log(`\n规则模式：${rulesPass}/${cells.length}`);
console.log(`大模型单次通过率：${S.runPass}/${S.runTotal}（${pct(S.runPass, S.runTotal)}）`);
console.log(`连续 ${RUNS} 次都通过的场景：${S.passK}/${cells.length}（${pct(S.passK, cells.length)}）`);
console.log(`失败归因：${Object.entries(S.causes).map(([k, v]) => `${k} ${v}`).join('，') || '无'}`);
console.log(`改写 ${S.polishTried} 次，采用 ${S.polishKept}，被答复校验拦下 ${S.polishBlocked}（${Object.entries(S.blockReasons).map(([k, v]) => `${k} ${v}`).join('，') || '无'}）`);
console.log(`用量约 ${out.meta.tokens} tokens\n已保存 ${file}`);
