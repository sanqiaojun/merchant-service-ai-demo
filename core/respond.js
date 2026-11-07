// 回复模板：由结构化事实生成草稿，并给出"必须保留"的关键事实词，供输出守卫校验。
import { MERCHANTS, STATUS_LABEL, KB_FALLBACK_TXN } from './data.js';

const money = n => `${n.toFixed(2)} 元`;
const shop = id => `【${MERCHANTS[id].name}】`;

function txnLine(r) {
  const label = STATUS_LABEL.txn[r.status];
  const tail = r.status === 'processing' ? `，预计 ${r.settleExpected} 结算到账`
    : r.status === 'settled' ? `，已于 ${r.settledAt} 结算到账`
    : r.status === 'failed' ? `（${r.failReason}）`
    : r.status === 'held' ? `（${r.holdReason}）` : '';
  return { text: `${r.date} ${money(r.amount)}：${label}${tail}`, keep: [label, r.amount.toFixed(2)] };
}

export const TEMPLATES = {
  txn(mid, recs, date) {
    if (!recs.length) return { text: `未查询到${shop(mid)}${date ? date + ' ' : ''}的交易记录。`, keep: ['未查询到'] };
    const lines = recs.map(txnLine);
    return { text: `查询到${shop(mid)}的交易：\n${lines.map(l => '· ' + l.text).join('\n')}`, keep: lines.flatMap(l => l.keep) };
  },
  refund(mid, recs, date) {
    if (!recs.length) return { text: `未查询到${shop(mid)}${date ? date + ' ' : ''}的退款记录。`, keep: ['未查询到'] };
    const lines = recs.map(r => {
      const label = STATUS_LABEL.refund[r.status];
      const tail = r.status === 'success' ? '，已原路退回，顾客一般 1-3 个工作日内收到' : '，正在处理中';
      return { text: `${r.date} ${money(r.amount)}：${label}${tail}`, keep: [label, r.amount.toFixed(2)] };
    });
    return { text: `查询到${shop(mid)}的退款：\n${lines.map(l => '· ' + l.text).join('\n')}`, keep: lines.flatMap(l => l.keep) };
  },
  fee(mid, out) {
    return { text: `查询到${shop(mid)}当前签约费率为 ${out.feeRate}，结算周期 ${out.settleCycle}。`, keep: [out.feeRate] };
  },
  account(mid, a) {
    if (a.status === 'normal') return { text: `查询到${shop(mid)}账户状态正常。`, keep: ['正常'] };
    return {
      text: `查询到${shop(mid)}账户当前处于冻结状态（自 ${a.since} 起），本次冻结与${a.reasonDisplay}有关，目前需要${a.requiredAction}后继续处理。请按页面提示提交材料；如果提交后状态长时间没有更新，可以联系人工客服核实。`,
      keep: ['冻结', a.since, a.reasonDisplay],
    };
  },
  withdrawal(mid, recs) {
    if (!recs.length) return { text: `未查询到${shop(mid)}的提现记录。`, keep: ['未查询到'] };
    const lines = recs.map(w => w.status === 'success'
      ? { text: `${w.date} ${money(w.amount)}：${STATUS_LABEL.withdrawal.success}（${w.arrivedAt}）`, keep: ['已到账', w.amount.toFixed(2)] }
      : { text: `${w.date} ${money(w.amount)}：${STATUS_LABEL.withdrawal.risk_review}，需要${w.requiredAction}，完成后系统会继续处理，最终结果以审核状态为准`, keep: ['风险审核中', w.amount.toFixed(2)] });
    return { text: `查询到${shop(mid)}的提现：\n${lines.map(l => '· ' + l.text).join('\n')}`, keep: lines.flatMap(l => l.keep) };
  },
  judgmentFrozen(mid, a) {
    return {
      text: `查询到${shop(mid)}账户当前因${a.reasonDisplay}处于冻结状态，但这并不等同于已经完成最终违规认定，后续结果以审核结论为准。我无法对审核结果或解冻时间做出承诺；如需进一步说明，可以为你转接人工客服。`,
      keep: ['审核结论为准', '无法'],
    };
  },
  judgmentNormal(mid) {
    return {
      text: `查询到${shop(mid)}账户当前状态正常。未来是否触发审核取决于后续经营情况，我无法做出预测或承诺；需要的话可以给你介绍常见的风险规则。`,
      keep: ['正常', '无法'],
    };
  },
  judgmentWithdrawal(mid) {
    return { text: `查询到${shop(mid)}有提现正在风险审核中，这并不等同于违规认定，最终结果以审核结论为准，我无法做出承诺。`, keep: ['审核结论为准', '无法'] };
  },
  knowledge(hit) {
    return hit ? { text: `一般规则：${hit.answer}`, keep: ['一般规则'] }
      : { text: '这个问题我暂时没有找到对应的规则说明，可以为你转接人工客服。', keep: [] };
  },
  knowledgeFallback() { return { text: KB_FALLBACK_TXN, keep: [] }; },
  clarify(ids) {
    return { text: `你名下有 ${ids.length} 个商户：${ids.map(i => MERCHANTS[i].name).join('、')}。请问要查询哪一个？`, keep: ids.map(i => MERCHANTS[i].name) };
  },
  reauth() { return { text: '你的登录状态已失效。为保护账户安全，请重新登录后再查询。', keep: ['重新登录'] }; },
  login() { return { text: '查询具体的交易、退款、账户信息需要先登录商户账号，登录后我可以直接帮你查。', keep: ['登录'] }; },
  degrade(sys) { return { text: `抱歉，${sys}暂时没有响应，我现在无法确认具体状态。你可以稍后再试，或者转人工客服处理。`, keep: ['暂时', '无法确认'] }; },
  refuse() { return { text: '抱歉，我只能查询你本人名下、且已登录验证的商户信息，也不能执行越权操作。如需帮助，可以转人工客服。', keep: ['只能查询'] }; },
  handoff(reason) {
    const why = { conflict: '系统中的状态记录不一致，为避免给你错误信息，', hidden: '这项信息需要人工核实，', request: '', risk: '这个问题涉及账户安全，' }[reason] || '';
    return { text: `${why}已为你转接人工客服，请稍候。`, keep: ['人工'] };
  },
};
