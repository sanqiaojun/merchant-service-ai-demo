// Agent 编排：意图理解 → 业务上下文 → 回答边界路由 → 工具/知识 → 回答生成 → 输出守卫。
// 三个版本共用同一套工具和模板，只有策略层不同，便于做对照评测。
import { USERS, MERCHANTS } from './data.js';
import { createToolbox, searchKnowledge } from './tools.js';
import { TEMPLATES } from './respond.js';
import { rulesNLU } from './nlu_rules.js';
import { llmNLU, llmRewrite } from './llm.js';
import { guardCheck, inputGuard } from './guard.js';

const T = TEMPLATES;

export const VERSIONS = {
  V0: '基线：身份未进入调用，查不到回退知识库，高风险一律转人工',
  V1: '+ 身份上下文：登录态写入会话，查询自动带商户身份',
  V2: '+ 回答边界：输入守卫、风险 × 证据路由、四类退出路径、输出守卫',
};

const TOOL = { txn_status: 'query_transactions', refund_status: 'query_refunds', fee_rate: 'query_fee_rate',
  account_status: 'query_account_status', withdrawal_status: 'query_withdrawals' };
const SYS = { txn_status: '交易系统', refund_status: '退款系统', fee_rate: '商户配置系统',
  account_status: '账户风控系统', withdrawal_status: '资金系统' };
const HIGH = new Set(['account_status', 'withdrawal_status']);
const KB_HINT = { txn_status: null, refund_status: '退款多久退回', fee_rate: '手续费怎么收' };

function hintMerchant(user, hint) {
  if (!hint) return null;
  return user.merchants.find(id => (MERCHANTS[id].alias || []).some(a => hint.includes(a) || a.includes(hint))) || null;
}

function factDraft(intent, mid, out, slots) {
  if (intent === 'txn_status') return T.txn(mid, out.records, slots.date);
  if (intent === 'refund_status') return T.refund(mid, out.records, slots.date);
  if (intent === 'fee_rate') return T.fee(mid, out);
  if (intent === 'account_status') return T.account(mid, out);
  return T.withdrawal(mid, out.records);
}

function fallbackDraft(intent) {
  if (intent === 'txn_status' || !KB_HINT[intent]) return T.knowledgeFallback();
  return T.knowledge(searchKnowledge(KB_HINT[intent])[0]);
}

// ---- 策略层 ----
function policyV0(nlu, user, tb) {
  const { intent, queryType: qt, slots } = nlu;
  if (qt === 'human') return { rule: '要求人工', path: 'handoff', draft: T.handoff('request') };
  if (qt === 'knowledge' || intent === 'knowledge') return { rule: '知识类', path: 'knowledge', draft: T.knowledge(tb.call('search_knowledge', { query: nlu.text }).hits[0]) };
  if (qt === 'judgment' || HIGH.has(intent)) return { rule: '高风险一律转人工', path: 'handoff', draft: T.handoff('risk') };
  const out = tb.call(TOOL[intent], { date: slots.date, amount: slots.amount }); // 缺陷：没有携带商户身份
  return { rule: '工具报错 MISSING_MERCHANT_ID → 回退知识库', path: 'knowledge_fallback', draft: fallbackDraft(intent) };
}

function policyV1(nlu, user, tb) {
  const { intent, queryType: qt, slots } = nlu;
  if (qt === 'human') return { rule: '要求人工', path: 'handoff', draft: T.handoff('request') };
  if (qt === 'knowledge' || intent === 'knowledge') return { rule: '知识类', path: 'knowledge', draft: T.knowledge(tb.call('search_knowledge', { query: nlu.text }).hits[0]) };
  if (qt === 'judgment' || HIGH.has(intent)) return { rule: '高风险一律转人工', path: 'handoff', draft: T.handoff('risk') };
  // 修复：从会话上下文取商户身份。但未校验会话有效性；多商户时默认取第一个；
  // 用户点名的商户直接放进参数，没有校验归属（越权风险）。
  const mid = slots.merchant_ref || hintMerchant(user, slots.merchant_hint) || user.merchants[0];
  const out = tb.call(TOOL[intent], { merchant_id: mid, date: slots.date, amount: slots.amount });
  if (out.error) return { rule: '工具报错 → 回退知识库', path: 'knowledge_fallback', draft: fallbackDraft(intent), merchant: mid };
  return { rule: '携带身份查询成功', path: 'fact', draft: factDraft(intent, mid, out, slots), merchant: mid };
}

function policyV2(nlu, user, tb) {
  const { intent, queryType: qt, slots } = nlu;
  const ig = inputGuard(nlu.text, user, slots);
  if (ig.block) return { rule: `#0 输入守卫：${ig.reason}`, path: 'refuse', draft: T.refuse() };
  if (qt === 'human') return { rule: '#1 投诉或要求人工', path: 'handoff', draft: T.handoff('request') };
  if (qt === 'knowledge' || intent === 'knowledge') return { rule: '#2 知识类问题', path: 'knowledge', draft: T.knowledge(tb.call('search_knowledge', { query: nlu.text }).hits[0]) };
  if (user.session === 'none') return { rule: '#3 事实类 + 未登录', path: 'login', draft: T.login() };
  if (user.session === 'expired') return { rule: '#4 事实类 + 登录失效', path: 'reauth', draft: T.reauth() };
  let mid = hintMerchant(user, slots.merchant_hint);
  if (!mid && user.merchants.length > 1) return { rule: '#5 多商户且未指明', path: 'clarify', draft: T.clarify(user.merchants) };
  mid = mid || user.merchants[0];

  const tool = qt === 'judgment' ? (intent === 'withdrawal_status' ? 'query_withdrawals' : 'query_account_status') : TOOL[intent];
  const out = tb.call(tool, { merchant_id: mid, date: HIGH.has(intent) ? undefined : slots.date, amount: HIGH.has(intent) ? undefined : slots.amount });
  if (out.error) return { rule: '#6 工具超时或异常', path: 'degrade', draft: T.degrade(SYS[intent] || '业务系统'), merchant: mid };
  if (out.conflict) return { rule: '#7 系统状态冲突', path: 'handoff', draft: T.handoff('conflict'), merchant: mid };

  if (qt === 'judgment') {
    if (tool === 'query_withdrawals') {
      if (out.records.some(w => w.displayable === false)) return { rule: '#8 判断类 + 无展示权限', path: 'handoff', draft: T.handoff('hidden'), merchant: mid };
      if (out.records.some(w => w.status === 'risk_review')) return { rule: '#8 判断类请求', path: 'judgment', draft: T.judgmentWithdrawal(mid), merchant: mid };
      return { rule: '#8 判断类请求', path: 'judgment', draft: T.judgmentNormal(mid), merchant: mid };
    }
    if (out.status === 'frozen' && !out.displayable) return { rule: '#8 判断类 + 无展示权限', path: 'handoff', draft: T.handoff('hidden'), merchant: mid };
    return { rule: '#8 判断类请求', path: 'judgment', draft: out.status === 'frozen' ? T.judgmentFrozen(mid, out) : T.judgmentNormal(mid), merchant: mid };
  }
  if (HIGH.has(intent)) {
    const hidden = intent === 'account_status' ? (out.status === 'frozen' && !out.displayable) : out.records.some(w => w.displayable === false);
    if (hidden) return { rule: '#10 高风险 + 字段不允许展示', path: 'handoff', draft: T.handoff('hidden'), merchant: mid };
    return { rule: '#9 高风险 + 证据充分 + 允许展示', path: 'bounded', draft: factDraft(intent, mid, out, slots), merchant: mid };
  }
  return { rule: '#11 低/中风险 + 证据充分', path: 'fact', draft: factDraft(intent, mid, out, slots), merchant: mid };
}

const POLICY = { V0: policyV0, V1: policyV1, V2: policyV2 };

// ---- 主流程 ----
export async function runAgent({ version = 'V2', userId, text, faults = {}, llm = null, nluCache = null }) {
  const t0 = Date.now();
  const user = USERS[userId];
  let nlu = nluCache?.get(text);
  if (!nlu) {
    nlu = llm ? await llmNLU(llm, text, rulesNLU) : rulesNLU(text);
    nluCache?.set(text, nlu);
  }
  nlu = { ...nlu, text };
  const tb = createToolbox(faults);
  const plan = POLICY[version](nlu, user, tb);

  let reply = plan.draft.text, guard = null;
  if (llm) {
    try { reply = await llmRewrite(llm, plan.draft.text); } catch (e) { reply = plan.draft.text; }
  }
  if (version === 'V2') {
    guard = guardCheck(reply, plan.draft.keep);
    if (!guard.ok) reply = plan.draft.text; // 守卫拦截：回退到模板回复，并记为 Bad Case
  }
  return {
    version, userId, text, faults,
    nlu: { intent: nlu.intent, queryType: nlu.queryType, slots: nlu.slots, source: nlu.source },
    context: { user: user.name, session: user.session, merchants: user.merchants, resolved: plan.merchant || null },
    rule: plan.rule, path: plan.path, toolCalls: tb.audit, draft: plan.draft.text, reply, guard,
    ms: Date.now() - t0,
  };
}
