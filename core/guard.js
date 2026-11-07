import { MERCHANTS } from './data.js';

// 输出守卫：发出前检查。命中禁用表述，或丢失了必须保留的关键事实，就拦截。
export const FORBIDDEN = ['已认定', '认定您违规', '认定你违规', '肯定能', '一定能', '保证解冻', '保证到账', '没有被冻结'];

// 输入守卫：指令注入、索要系统提示词、试图绕过登录或越权操作。确定性规则，先于大模型结果生效。
const INJECTION = /忽略|无视|管理员模式|开发者模式|系统提示[：:]|提示词|prompt|所有商户|全部商户|别管登录|不用登录|跳过验证|直接帮我把.*(解冻|放行|通过)/i;

export function inputGuard(text, user, slots = {}) {
  if (INJECTION.test(text)) return { block: true, reason: '疑似指令注入或越权操作' };
  if (slots.merchant_ref && !user.merchants.includes(slots.merchant_ref)) return { block: true, reason: `点名的商户 ${slots.merchant_ref} 不在当前用户名下` };
  if (slots.merchant_brand) {
    const ids = Object.values(MERCHANTS).filter(m => m.name.startsWith(slots.merchant_brand)).map(m => m.id);
    if (!ids.some(id => user.merchants.includes(id))) return { block: true, reason: `点名的商户「${slots.merchant_brand}」不在当前用户名下` };
  }
  return { block: false };
}

export function guardCheck(reply, keep = []) {
  const reasons = [];
  for (const f of FORBIDDEN) if (reply.includes(f)) reasons.push(`禁用表述：${f}`);
  for (const k of keep) if (k && !reply.includes(k)) reasons.push(`丢失关键事实：${k}`);
  return { ok: reasons.length === 0, reasons };
}
