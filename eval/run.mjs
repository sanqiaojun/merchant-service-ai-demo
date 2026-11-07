#!/usr/bin/env node
// 用法：
//   node eval/run.mjs                      规则模式（离线、零依赖）
//   LLM_API_KEY=sk-... node eval/run.mjs --llm qwen      通义千问（DashScope 兼容模式）
//   LLM_API_KEY=sk-... node eval/run.mjs --llm deepseek  DeepSeek
//   可选：--model <名称>  --trials <k>（大模型模式默认 3，用于 pass^k）  LLM_BASE_URL=<OpenAI 兼容地址>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runAgent, VERSIONS } from '../core/agent.js';
import { createLLM, PRESETS } from '../core/llm.js';
import { scoreCase, aggregate } from './scorer.js';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const provider = opt('--llm');
const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url)));

let llm = null, mode = 'rules';
if (provider) {
  const preset = PRESETS[provider] || {};
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) { console.error('缺少环境变量 LLM_API_KEY'); process.exit(1); }
  llm = createLLM({ baseURL: process.env.LLM_BASE_URL || preset.baseURL, apiKey, model: opt('--model') || preset.model });
  mode = `llm-${provider}-${llm.model}`;
}

async function pool(items, size, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

const K = Number(opt('--trials') || (llm ? 3 : 1));
// 同一轮里同一句话，三个版本共用同一次意图理解，保证对照公平；不同轮之间重新调用，用于衡量稳定性（pass^k）
const nluCaches = Array.from({ length: K }, () => new Map());
const report = { mode, trials: K, generatedAt: new Date().toISOString(), versions: {}, note: '全部为 Demo 环境模拟数据' };
const avg = arr => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10;
for (const v of Object.keys(VERSIONS)) {
  const u0 = llm ? { ...llm.usage } : null;
  const runs = [];
  for (let k = 0; k < K; k++) {
    const traces = await pool(cases, llm ? 5 : 1, c => runAgent({ version: v, userId: c.user, text: c.text, faults: c.faults, llm, nluCache: nluCaches[k] }));
    runs.push({ traces, scores: cases.map((c, i) => scoreCase(c, traces[i])) });
    if (llm) process.stdout.write(`  ${v} 第 ${k + 1}/${K} 轮完成\n`);
  }
  const aggs = runs.map(r => aggregate(r.scores));
  const metrics = { ...aggs[0] };
  for (const key of ['successRate', 'truthRate', 'unnecessaryHandoffRate', 'violationRate', 'clarifyAccuracy']) metrics[key] = avg(aggs.map(a => a[key]));
  for (const cat of Object.keys(metrics.byCategory)) metrics.byCategory[cat] = { n: metrics.byCategory[cat].n, success: avg(aggs.map(a => a.byCategory[cat].success)) };
  metrics.passK = Math.round(cases.filter((c, i) => runs.every(r => r.scores[i].success)).length / cases.length * 1000) / 10;
  const traces = runs[0].traces, scores = runs[0].scores;
  if (llm) {
    const calls = llm.usage.calls - u0.calls;
    metrics.llm = { calls, avgMsPerCall: calls ? Math.round((llm.usage.ms - u0.ms) / calls) : 0,
      tokens: (llm.usage.promptTokens - u0.promptTokens) + (llm.usage.completionTokens - u0.completionTokens) };
  }
  report.versions[v] = { desc: VERSIONS[v], metrics,
    cases: cases.map((c, i) => ({ ...c, trace: traces[i], score: scores[i], trialsPassed: runs.filter(r => r.scores[i].success).length })) };
  const m = metrics;
  console.log(`${v}  成功率 ${m.successRate}%  pass^${K} ${m.passK}%  真值答复率 ${m.truthRate}%  不必要转人工 ${m.unnecessaryHandoffRate}%  越界率 ${m.violationRate}%  澄清准确率 ${m.clarifyAccuracy}%`);
}

mkdirSync(new URL('../reports/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../reports/${mode}.json`, import.meta.url), JSON.stringify(report, null, 1));

// Markdown 摘要
const V = Object.keys(report.versions), M = v => report.versions[v].metrics;
const row = (name, k) => `| ${name} | ${V.map(v => M(v)[k] + '%').join(' | ')} |`;
let md = `# 评测报告（${mode}）\n\n生成时间：${report.generatedAt}。全部为 Demo 环境模拟数据，${cases.length} 条用例，每条运行 ${K} 次。\n\n`;
md += `| 指标 | ${V.join(' | ')} |\n| --- | ${V.map(() => '---').join(' | ')} |\n`;
md += [row('任务成功率（pass^1）', 'successRate'), row(`稳定通过率（pass^${K}）`, 'passK'), row('真值答复率', 'truthRate'), row('不必要转人工率', 'unnecessaryHandoffRate'),
  row('越界率（目标 0）', 'violationRate'), row('澄清准确率', 'clarifyAccuracy')].join('\n') + '\n\n';
md += `## 分类成功率\n\n| 类别 | 条数 | ${V.join(' | ')} |\n| --- | --- | ${V.map(() => '---').join(' | ')} |\n`;
for (const cat of Object.keys(M('V2').byCategory)) md += `| ${cat} | ${M('V2').byCategory[cat].n} | ${V.map(v => M(v).byCategory[cat].success + '%').join(' | ')} |\n`;
md += `\n## V2 未通过用例\n\n`;
const bad = report.versions.V2.cases.filter(c => !c.score.success);
md += bad.length ? bad.map(c => `- **${c.id}** [${c.category}] ${c.text}\n  - ${c.score.failures.join('；')}\n  - 回复：${c.trace.reply.replace(/\n/g, ' ')}`).join('\n') : '无\n';
writeFileSync(new URL(`../reports/${mode}.md`, import.meta.url), md);
console.log(`\n报告已写入 reports/${mode}.json 与 reports/${mode}.md`);
