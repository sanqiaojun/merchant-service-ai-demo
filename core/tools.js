// 工具层：按 MCP 风格定义（name / description / inputSchema），返回结构化结果。
// faults 用于故障注入：{ timeout: '<tool name>' } 或 { conflict: '<tool name>' }。
import { MERCHANTS, TRANSACTIONS, REFUNDS, WITHDRAWALS, KNOWLEDGE } from './data.js';

export const TOOL_DEFS = [
  { name: 'query_transactions', description: '查询某商户的交易及结算状态', risk: 'medium',
    inputSchema: { type: 'object', required: ['merchant_id'], properties: {
      merchant_id: { type: 'string' }, date: { type: 'string' }, amount: { type: 'number' } } } },
  { name: 'query_refunds', description: '查询某商户的退款进度', risk: 'medium',
    inputSchema: { type: 'object', required: ['merchant_id'], properties: {
      merchant_id: { type: 'string' }, date: { type: 'string' }, amount: { type: 'number' } } } },
  { name: 'query_fee_rate', description: '查询某商户的签约费率', risk: 'low',
    inputSchema: { type: 'object', required: ['merchant_id'], properties: { merchant_id: { type: 'string' } } } },
  { name: 'query_account_status', description: '查询商户账户状态、冻结原因与所需操作（含展示权限）', risk: 'high',
    inputSchema: { type: 'object', required: ['merchant_id'], properties: { merchant_id: { type: 'string' } } } },
  { name: 'query_withdrawals', description: '查询商户提现记录与拦截状态（含展示权限）', risk: 'high',
    inputSchema: { type: 'object', required: ['merchant_id'], properties: { merchant_id: { type: 'string' } } } },
  { name: 'search_knowledge', description: '检索一般规则知识库（不含任何商户个人数据）', risk: 'low',
    inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } } },
];

const byFilter = (list, a) => list.filter(r => r.merchant === a.merchant_id
  && (!a.date || r.date === a.date) && (a.amount == null || Math.abs(r.amount - a.amount) < 0.01));

const IMPL = {
  query_transactions: a => ({ records: byFilter(TRANSACTIONS, a) }),
  query_refunds: a => ({ records: byFilter(REFUNDS, a) }),
  query_fee_rate: a => ({ feeRate: MERCHANTS[a.merchant_id].feeRate, settleCycle: MERCHANTS[a.merchant_id].settleCycle }),
  query_account_status: a => ({ ...MERCHANTS[a.merchant_id].account }),
  query_withdrawals: a => ({ records: WITHDRAWALS.filter(w => w.merchant === a.merchant_id) }),
  search_knowledge: a => ({ hits: searchKnowledge(a.query) }),
};

export function searchKnowledge(q) {
  const scored = KNOWLEDGE.map(k => ({ k, s: k.keys.filter(key => q.includes(key)).length }))
    .filter(x => x.s > 0).sort((x, y) => y.s - x.s);
  return scored.slice(0, 1).map(x => x.k);
}

// 冲突注入：模拟"两个系统返回的状态不一致"
function conflictOf(name, out) {
  if (name === 'query_transactions' && out.records.length) {
    return { ...out, conflict: true, systemB: { ...out.records[0], status: out.records[0].status === 'settled' ? 'processing' : 'settled' } };
  }
  if (name === 'query_account_status') return { ...out, conflict: true, systemB: { status: out.status === 'frozen' ? 'normal' : 'frozen' } };
  return { ...out, conflict: true };
}

export function createToolbox(faults = {}) {
  const audit = [];
  function call(name, args = {}) {
    const def = TOOL_DEFS.find(t => t.name === name);
    const entry = { tool: name, args: { ...args }, ok: true };
    audit.push(entry);
    for (const req of def.inputSchema.required) {
      if (args[req] == null || args[req] === '') { entry.ok = false; entry.error = `MISSING_${req.toUpperCase()}`; return { error: entry.error }; }
    }
    if (args.merchant_id && !MERCHANTS[args.merchant_id]) { entry.ok = false; entry.error = 'MERCHANT_NOT_FOUND'; return { error: entry.error }; }
    if (faults.timeout === name) { entry.ok = false; entry.error = 'TIMEOUT'; return { error: 'TIMEOUT' }; }
    let out = IMPL[name](args);
    if (faults.conflict === name) out = conflictOf(name, out);
    entry.result = out;
    return out;
  }
  return { call, audit };
}
