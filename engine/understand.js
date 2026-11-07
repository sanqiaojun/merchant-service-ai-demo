// 诉求理解：判断"商户想得到什么结果"。规则版用于离线演示与对照；大模型版见 llm.js，输出同一结构。
import { YESTERDAY, TODAY, MERCHANTS } from './data.js';

export const TASKS = {
  knowledge: '① 知识解释', fact: '② 事实查询', diagnosis: '③ 诊断解释', guide: '④ 办理引导',
  execute: '⑤ 受控执行', dispute: '⑥ 争议裁定', human: '要求人工', confirm: '确认操作', select: '选择对象', other: '其他',
};

export function parseSlots(t) {
  const s = {};
  if (/前天/.test(t)) s.date = '2026-11-04';
  else if (/昨天|昨日/.test(t)) s.date = YESTERDAY;
  else if (/今天|刚才/.test(t)) s.date = TODAY;
  const no = t.match(/\d{12,15}/); if (no) s.merchantNo = no[0];
  const phone = t.match(/1[3-9]\d{9}/); if (phone) { s.field = '联系电话'; s.value = phone[0]; }
  const rest = t.replace(/\d{12,15}/g, '').replace(/1[3-9]\d{9}/g, '').replace(/T\+1/g, '');
  const amt = rest.match(/(\d+(?:\.\d+)?)\s*(元|块)?/);
  if (amt && parseFloat(amt[1]) >= 10) s.amount = parseFloat(amt[1]);
  for (const m of Object.values(MERCHANTS)) if (m.alias && t.includes(m.alias)) s.store = m.alias;
  return s;
}

export function rulesUnderstand(text) {
  const t = text.replace(/\s+/g, '');
  const slots = parseSlots(t);
  const r = (task, domain, aspect) => ({ task, domain, aspect: aspect || null, slots, source: 'rules' });
  if (/^(确认|确认修改|是的|对)$/.test(t)) return r('confirm', 'info');
  if (/^(人民路|滨江|大学城)(店)?$/.test(t) || /^第[一二12]笔/.test(t)) return r('select', 'txn');
  if (/人工|客服/.test(t)) return r('human', 'general');
  if (/赔|损失|责任/.test(t)) return r('dispute', /冻结/.test(t) ? 'account' : 'settle');
  if (/解冻/.test(t) && /帮我|现在就|马上/.test(t)) return r('execute', 'account', 'unfreeze');
  if (/结算卡/.test(t) && /帮我|现在就|给我/.test(t) && !/怎么|如何/.test(t)) return r('execute', 'card');
  if (/改成|改为|修改/.test(t) && slots.field) return r('execute', 'info');
  if (/怎么|如何/.test(t) && /更换|换|办理|申请/.test(t)) return r('guide', /结算卡/.test(t) ? 'card' : 'general');
  if (/少了|差额|为什么.*少/.test(t)) return r('diagnosis', 'settle');
  if (/是什么意思|什么是|什么叫/.test(t)) return r('knowledge', /冻结/.test(t) ? 'account' : 'settle');
  if (/冻结|解冻/.test(t)) {
    if (/什么时候|多久/.test(t)) return r('fact', 'account', 'schedule');
    if (/为什么|原因/.test(t)) return r('fact', 'account', 'reason');
    return r('fact', 'account', 'status');
  }
  if (/到账|到了|钱/.test(t)) return r('fact', 'settle');
  if (/交易|流水|收款|那笔/.test(t)) return r('fact', 'txn', /那笔|这笔/.test(t) || slots.amount ? 'detail' : 'summary');
  return r('other', 'general');
}
