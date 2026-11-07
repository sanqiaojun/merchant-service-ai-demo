// 规则版意图理解：无 API Key 时的离线替代，同时作为大模型版的对照组。
// 输出与大模型版完全相同的结构：{ intent, queryType, slots }
import { TODAY, MERCHANTS } from './data.js';

const shift = (iso, d) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

const HUMAN = /人工|投诉|客服电话|服务太差/;
const JUDGMENT = /认定|是不是违规|违规了|误判|搞错|肯定能|一定能|保证|会不会被|要被罚|罚款|扣掉|以后会不会|有问题/;
const KNOWLEDGE_CUE = /一般|通常|是什么|什么意思|怎么算|怎么收|如何|怎么修改|怎么申请|哪些|为什么会|会顺延|有手续费吗|会退手续费吗/;
const FACT_CUE = /我的|我那|我这|我店|我昨天|我前天|我今天|我现在|这笔|那笔|昨天|前天|今天|刚才|刚刚|最近|\d+月\d+日|\d+(\.\d+)?\s*(元|块)|\d{2,}/;

function intentOf(t) {
  if (HUMAN.test(t)) return 'human';
  if (/账户|冻结|解冻|不能用/.test(t) && !/提现/.test(t)) return 'account_status';
  if (/提现/.test(t)) return 'withdrawal_status';
  if (/退款|退了|退回|退给/.test(t)) return 'refund_status';
  if (/费率|手续费/.test(t)) return 'fee_rate';
  if (/交易|到账|结算|收款|流水|订单|进来|钱/.test(t)) return 'txn_status';
  return 'knowledge';
}

export function parseSlots(t) {
  const slots = {};
  if (/前天/.test(t)) slots.date = shift(TODAY, -2);
  else if (/昨天/.test(t)) slots.date = shift(TODAY, -1);
  else if (/今天|刚才|刚刚/.test(t)) slots.date = TODAY;
  const md = t.match(/(\d{1,2})月(\d{1,2})日/);
  if (md) slots.date = `2026-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`;
  const noDate = t.replace(/\d{1,2}月\d{1,2}日/g, '').replace(/T\+\d/g, '');
  const amt = noDate.match(/(\d+(?:\.\d+)?)\s*(?:元|块)?/g)?.map(s => parseFloat(s)).filter(n => n >= 10 && n !== 2026);
  if (amt && amt.length) slots.amount = amt[0];
  for (const m of Object.values(MERCHANTS)) for (const a of (m.alias || [])) if (t.includes(a)) slots.merchant_hint = a;
  // 文本中点名的商户（门店名、商户全称或商户号）。是否有权查询，由策略层判断，不由模型判断。
  for (const m of Object.values(MERCHANTS)) {
    if (t.includes(m.id) || t.includes(m.name) || (m.alias || []).some(a => t.includes(a))) { slots.merchant_ref = m.id; break; }
  }
  if (!slots.merchant_ref) {
    const brand = Object.values(MERCHANTS).find(m => m.name.includes('·') && t.includes(m.name.split('·')[0]));
    if (brand) slots.merchant_brand = brand.name.split('·')[0];
  }
  return slots;
}

export function rulesNLU(text) {
  const t = text.replace(/\s+/g, '');
  const intent = intentOf(t);
  let queryType;
  if (intent === 'human') queryType = 'human';
  else if (JUDGMENT.test(t)) queryType = 'judgment';
  else if (intent === 'knowledge') queryType = 'knowledge';
  else if (FACT_CUE.test(t)) queryType = 'fact';
  else if (KNOWLEDGE_CUE.test(t)) queryType = 'knowledge';
  else queryType = 'fact';
  // 判断类请求（"是不是认定我违规"）没有提到具体业务时，默认针对账户状态
  const finalIntent = queryType === 'judgment' && intent === 'knowledge' ? 'account_status' : intent;
  return { intent: finalIntent, queryType, slots: parseSlots(t), source: 'rules' };
}
