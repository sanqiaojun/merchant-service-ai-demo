// 大模型接入（OpenAI 兼容接口：通义千问 DashScope compatible-mode、DeepSeek 等）。
// 大模型只做两件事：理解商户诉求（输出与规则版相同的结构）、把模板答复改写得更自然。
// 商户身份、权限、金额、状态都不经过大模型决定。
import { parseSlots } from './understand.js';

const TASK_SET = ['knowledge', 'fact', 'diagnosis', 'guide', 'execute', 'dispute', 'human', 'confirm', 'select', 'other'];
const DOMAIN_SET = ['txn', 'settle', 'account', 'card', 'info', 'general'];

export function llmConfig({ baseUrl, apiKey, model }) { return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model }; }

async function chat(llm, messages, { json = false, temperature = 0.2 } = {}) {
  const body = { model: llm.model, messages, temperature };
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetch(`${llm.baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  llm.usage = (llm.usage || 0) + (j.usage?.total_tokens || 0);
  return j.choices[0].message.content.trim();
}

const UNDERSTAND_PROMPT = `你是支付机构商户服务助手的"诉求理解"模块。只判断商户想得到什么结果，不回答问题。
输出 JSON：{"task":..., "domain":..., "aspect":..., "reason":"一句话依据"}
task 取值：
- knowledge 想了解一般规则或概念（"是什么意思"）
- fact 想知道自己账户/交易/结算的当前事实（查交易、钱到没到、是不是冻结、为什么冻结、什么时候解冻）
- diagnosis 想知道一个结果为什么是这样（到账金额为什么少了）
- guide 想知道某件事怎么办理
- execute 要求助手直接替他办（"帮我换卡""帮我解冻""把电话改成…"）
- dispute 要求赔偿、追责、认定责任
- human 明确要求人工客服
- confirm 对上一轮待确认操作表示确认
- select 在上一轮给出的选项里做选择（门店名、第几笔）
- other 以上都不是
domain 取值：txn 交易 / settle 结算到账 / account 账户状态（冻结）/ card 结算卡 / info 商户资料 / general
aspect：domain=txn 时取 summary（整体）或 detail（某一笔）；domain=account 且 task=fact 时取 status / reason / schedule；其他为 null。`;

export async function llmUnderstand(llm, text, fallback, history = []) {
  const slots = parseSlots(text.replace(/\s+/g, ''));
  try {
    const ctx = history.slice(-4).map(h => `${h.role === 'user' ? '商户' : '助手'}：${h.text}`).join('\n');
    const raw = await chat(llm, [{ role: 'system', content: UNDERSTAND_PROMPT }, { role: 'user', content: `${ctx ? '最近对话：\n' + ctx + '\n\n' : ''}本轮商户说：${text}` }], { json: true, temperature: 0 });
    const j = JSON.parse(raw.replace(/^```json|```$/g, ''));
    if (!TASK_SET.includes(j.task)) throw new Error('task 不在取值范围：' + j.task);
    const rules = fallback(text);
    return { task: j.task, domain: DOMAIN_SET.includes(j.domain) ? j.domain : 'general', aspect: j.aspect || null, slots, source: 'llm', reason: j.reason || '',
      agreeWithRules: rules.task === j.task && rules.domain === (DOMAIN_SET.includes(j.domain) ? j.domain : 'general') };
  } catch (e) {
    const r = fallback(text);
    return { ...r, source: 'rules（大模型失败回退）', error: String(e.message || e) };
  }
}

const POLISH_PROMPT = `你是支付机构的商户服务助手，负责把系统生成的答复改写得更自然、更像真人客服。
硬性要求：
1. 不增加任何事实、数字、时间、承诺或原因；原文没有的信息一个字也不要加。
2. 原文中的数字、金额、日期、状态名称、编号必须原样保留。
3. 原文中"不能""无法核实""暂未找到""不推测""以…为准"这类边界表述必须保留，不能弱化。
4. 不索要卡号、密码、验证码。
5. 口语、简洁、礼貌，长度与原文接近。只输出改写后的答复正文。`;

export async function llmPolish(llm, text) {
  return chat(llm, [{ role: 'system', content: POLISH_PROMPT }, { role: 'user', content: text }], { temperature: 0.5 });
}
