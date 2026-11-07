// 业务工具层（MCP 风格）。商户身份由服务端从会话注入，模型看不到也改不了 merchant_id。
// 每次调用返回四种情况之一：ok（结果明确）/ empty（无匹配）/ multiple（不唯一）/ error（失败、超时、无权限）。
import { MERCHANTS, TXNS, SUMMARY, SETTLEMENT_VARIANTS, SETTLE_BASE, BREAKDOWN_VARIANTS, ACCOUNT_STATUS, KNOWLEDGE, YESTERDAY } from './data.js';

export const TOOL_DEFS = [
  { name: 'get_txn_summary', title: '交易汇总', perm: 'txn_summary', description: '查询当前商户某日的交易金额、手续费、退款金额与笔数', input: { date: 'string' } },
  { name: 'list_txns', title: '交易明细', perm: 'txn_detail', description: '按日期与金额查询当前商户的交易记录', input: { date: 'string', amount: 'number?' } },
  { name: 'get_settlement', title: '结算与到账', perm: 'settle', description: '查询当前商户某日交易对应的结算批次状态', input: { date: 'string' } },
  { name: 'get_settlement_breakdown', title: '到账差额构成', perm: 'settle', description: '查询交易金额与实际到账之间的差额构成（系统计算）', input: { date: 'string' } },
  { name: 'get_account_status', title: '账户状态', perm: 'account', description: '查询当前商户账户状态、可展示的原因、所需操作与已有安排', input: {} },
  { name: 'update_merchant_info', title: '修改商户信息（受控）', perm: 'info_edit', description: '经商户确认后提交联系电话等低风险资料变更', input: { field: 'string', value: 'string' } },
  { name: 'get_change_status', title: '变更执行状态', perm: 'info_edit', description: '查询资料变更申请的执行状态', input: { field: 'string' } },
  { name: 'search_knowledge', title: '知识检索', perm: null, description: '检索已发布的规则知识（不含任何商户个人数据）', input: { query: 'string' } },
];

export function createToolbox({ account, variant = {} }) {
  const audit = [];
  let changeSubmitted = false;

  function call(name, args = {}, { merchantId = null, identitySource = '认证登录态' } = {}) {
    const def = TOOL_DEFS.find(t => t.name === name);
    const entry = { tool: name, title: def.title, args: { ...args }, merchant: merchantId ? MERCHANTS[merchantId].name : null, identitySource: merchantId ? identitySource : null };
    audit.push(entry);
    const done = (status, data, error) => { entry.status = status; if (error) entry.error = error; return { status, data, error }; };

    if (def.perm) {
      if (!merchantId) return done('error', null, '缺少商户身份参数');
      if (!account.merchants.includes(merchantId)) return done('error', null, '无权访问该商户');
      if (!account.perms[def.perm]) return done('error', null, '账号无此项查询权限');
    }
    if (variant.timeout === name) return done('error', null, '业务系统超时');

    switch (name) {
      case 'get_txn_summary': {
        if (variant.txnEmpty) return done('empty', null);
        return done('ok', { date: args.date, merchant: MERCHANTS[merchantId].name, ...SUMMARY[merchantId] });
      }
      case 'list_txns': {
        let rows = (TXNS[merchantId] || []).filter(() => args.date === YESTERDAY);
        if (args.amount != null) rows = rows.filter(r => Math.abs(r.amount - args.amount) < 0.01);
        if (!rows.length) return done('empty', null);
        if (rows.length > 1 && args.amount != null) return done('multiple', rows);
        return done('ok', rows);
      }
      case 'get_settlement': {
        const v = SETTLEMENT_VARIANTS[variant.settle || 'processing'];
        if (v.status === 'conflict') return done('ok', { ...SETTLE_BASE, ...v, conflict: true });
        return done('ok', { ...SETTLE_BASE, ...v });
      }
      case 'get_settlement_breakdown':
        return done('ok', { date: args.date, ...BREAKDOWN_VARIANTS[variant.breakdown || 'full'] });
      case 'get_account_status': {
        const s = { ...ACCOUNT_STATUS[merchantId] };
        if (variant.reasonHidden) s.reasonDisplayable = false;
        return done('ok', s);
      }
      case 'update_merchant_info': {
        if (variant.submitTimeout) { changeSubmitted = true; return done('error', null, '提交超时，结果未返回'); }
        changeSubmitted = true;
        return done('ok', { field: args.field, value: args.value, requestId: 'CHG-20261106-0017', state: '审核中' });
      }
      case 'get_change_status':
        return changeSubmitted ? done('ok', { requestId: 'CHG-20261106-0017', state: '审核中' }) : done('empty', null);
      case 'search_knowledge': {
        const hits = KNOWLEDGE.filter(k => k.status === '已发布' && k.keys.some(key => args.query.includes(key)));
        const active = variant.kbConflict ? hits : hits.filter(k => !k.legacy);
        if (!active.length) return done('empty', null);
        const conflict = active.length > 1 && active.some(k => k.legacy);
        return done(conflict ? 'multiple' : 'ok', active);
      }
    }
  }
  return { call, audit };
}
