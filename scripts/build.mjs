// 生成会话场景演示页 docs/index.html（单文件，无任何外部依赖）。
// 正常场景的 AI 回复现场由处理规则生成；反例使用 stories.js 里写好的错误回复。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { STORIES, GROUPS, OUTCOMES } from '../engine/stories.js';
import { newSession, runTurn } from '../engine/agent.js';
import { ACCOUNTS, MERCHANTS, BRAND, maskNo } from '../engine/data.js';

const CATS = [['人工服务', /人工|客服/], ['账户状态', /冻结|解冻/], ['规则咨询', /是什么意思|T\+1/], ['结算卡与资料', /结算卡|电话|改成/], ['到账结算', /到账|钱|少了|赔/], ['交易查询', /交易|笔/]];
const catOf = t => /^(第.笔|确认|取消|.{2,3}店)$/.test(t) ? '回复助手' : (CATS.find(([, re]) => re.test(t)) || ['回复助手'])[0];

const stories = [];
for (const st of STORIES) {
  const s = newSession(st.persona, st.variant);
  const turns = [];
  for (const t of st.turns) {
    if (t.scripted) { turns.push({ say: t.say, reply: t.scripted, explain: t.explain, bad: t.bad || null }); continue; }
    const r = await runTurn(s, t.action ? { action: t.action } : { text: t.say });
    const reply = r.reply ? { text: r.reply.text, card: r.reply.card || null, chips: r.reply.chips || [] } : null;
    turns.push({ say: t.say || null, action: t.action || null, reply, system: r.system, explain: t.explain, bad: t.bad || null, outcome: r.trace.outcome });
  }
  stories.push({ ...st, turns, variant: undefined });
}
// 问题库：所有场景里出现过的商户问题，按类别归档，供输入框下拉选择
const lib = {};
for (const st of stories) for (const t of st.turns) if (t.say) { const c = catOf(t.say); (lib[c] ||= new Set()).add(t.say); }
const library = Object.fromEntries([...CATS.map(c => c[0]), '回复助手'].filter(c => lib[c]).map(c => [c, [...lib[c]]]));
const accounts = Object.fromEntries(Object.values(ACCOUNTS).map(a => [a.id, { name: a.name, role: a.role, desc: a.desc, session: a.session, merchants: a.merchants.map(m => MERCHANTS[m].name) }]));
const data = { brand: BRAND, groups: GROUPS, outcomes: OUTCOMES, stories, accounts, library };
const html = readFileSync('web/index.html', 'utf8').replace('/*__DATA__*/null', JSON.stringify(data).replace(/</g, '\\u003c'));
mkdirSync('docs', { recursive: true });
writeFileSync('docs/index.html', html);
console.log(`${stories.length} 个会话场景，${stories.reduce((n, s) => n + s.turns.length, 0)} 轮；已生成 docs/index.html（${(html.length / 1024).toFixed(0)} KB）`);
