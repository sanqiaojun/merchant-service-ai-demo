// 把 core/ 下的 ES 模块打包进单文件网页 dist/index.html（零依赖）。
// 用法：node scripts/build_web.mjs [reports/<mode>.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const ORDER = ['data', 'tools', 'guard', 'nlu_rules', 'llm', 'respond', 'agent'];
const engine = ORDER.map(f => readFileSync(new URL(`core/${f}.js`, root), 'utf8')
  .replace(/^import .*;$/gm, '')
  .replace(/^export (const|function|async function) /gm, '$1 ')).join('\n');
const bundle = `(() => {\n${engine}\nwindow.PD = { runAgent, USERS, VERSIONS, MERCHANTS };\n})();`;

const reportPath = process.argv[2] || 'reports/rules.json';
const full = JSON.parse(readFileSync(new URL(reportPath, root), 'utf8'));
const slim = (t, s) => ({ path: t.path, reply: t.reply, success: s.success, failures: s.failures, violations: s.violations });
const compact = {
  mode: full.mode, trials: full.trials || 1, generatedAt: full.generatedAt,
  versions: Object.fromEntries(Object.entries(full.versions).map(([v, d]) => [v, { desc: d.desc, metrics: d.metrics }])),
  cases: full.versions.V0.cases.map((c, i) => ({ id: c.id, category: c.category, user: c.user, text: c.text, faults: c.faults, expect: c.expect.path, trialsPassed: full.versions.V2.cases[i].trialsPassed,
    ...Object.fromEntries(Object.keys(full.versions).map(v => [v, slim(full.versions[v].cases[i].trace, full.versions[v].cases[i].score)])) })),
};

const html = readFileSync(new URL('web/template.html', root), 'utf8')
  .replace('/*__ENGINE__*/', () => bundle)
  .replace('/*__REPORT__*/null', () => JSON.stringify(compact).replace(/</g, '\\u003c'));
mkdirSync(new URL('dist/', root), { recursive: true });
writeFileSync(new URL('dist/index.html', root), html);
console.log(`dist/index.html ${(html.length / 1024).toFixed(0)} KB（报告：${reportPath}）`);
