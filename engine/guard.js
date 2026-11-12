// 答复守卫：大模型改写后的文字必须通过检查，否则退回模板原文。
// 规则：关键事实原样保留；不得出现原文没有的数字；不得做承诺；不得索要敏感信息。
import { altsOf, hasPhrase } from './phrases.js';
const PROMISE = /(保证|一定会|肯定能|肯定会|马上到账|今天之内一定|绝对)/;
const SENSITIVE_ASK = /(发|告诉|提供|输入)(一下)?(我)?(你的)?(完整)?(卡号|密码|验证码|身份证号)/;
// 数字按数值比较："11-04" 改写成 "11月4日" 不算新数字
const nums = s => (s.match(/\d+(?:[.,]\d+)*/g) || []).map(x => x.replace(/,/g, '').replace(/^0+(?=\d)/, ''));

export function guard(text, keep = [], original = null) {
  const reasons = [];
  // keep 的每一项是必须保留的事实或边界；写成数组表示同义说法任选其一（如 不能 / 无法）
  for (const k of keep) {
    if (!k) continue;
    if (!hasPhrase(text, k)) reasons.push(`缺少关键内容「${altsOf(k)[0]}」`);
  }
  if (PROMISE.test(text) && !(original && PROMISE.test(original))) reasons.push('出现承诺性表述');
  if (SENSITIVE_ASK.test(text.replace(/不要[^。，]*?(卡号|密码|验证码)/g, ''))) reasons.push('索要敏感信息');
  if (original) {
    const allowed = new Set(nums(original));
    const extra = nums(text).filter(n => !allowed.has(n));
    if (extra.length) reasons.push(`出现原文没有的数字：${[...new Set(extra)].join('、')}`);
    if (text.length > original.length * 1.6 + 20) reasons.push('改写过长');
  }
  return { ok: reasons.length === 0, reasons };
}
