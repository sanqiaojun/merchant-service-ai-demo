// 大模型适配层：OpenAI 兼容接口（通义千问 DashScope 兼容模式、DeepSeek 等均可）。
// 大模型只做两件事：① 意图理解（输出 JSON）；④ 把结构化事实组织成自然语言。
import { TODAY } from './data.js';
import { parseSlots } from './nlu_rules.js';

export const PRESETS = {
  qwen: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  deepseek: { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
};

export function createLLM({ baseURL, apiKey, model, fetchImpl = globalThis.fetch }) {
  const usage = { calls: 0, promptTokens: 0, completionTokens: 0, ms: 0 };
  async function chat(messages, { json = false } = {}) {
    const t0 = Date.now();
    const body = { model, messages, temperature: 0 };
    if (json) body.response_format = { type: 'json_object' };
    const res = await fetchImpl(`${baseURL}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    usage.calls++; usage.ms += Date.now() - t0;
    usage.promptTokens += data.usage?.prompt_tokens || 0;
    usage.completionTokens += data.usage?.completion_tokens || 0;
    return data.choices[0].message.content;
  }
  return { chat, usage, model };
}

const NLU_PROMPT = `你是支付商户客服系统的意图理解模块。今天是 ${TODAY}。只输出 JSON，不要解释。
字段：
- intent：txn_status（交易/到账/结算/收款/流水）| refund_status（退款）| fee_rate（费率/手续费）| account_status（账户状态/冻结）| withdrawal_status（提现）| knowledge（与以上都无关的一般问题）| human（投诉或要求人工）
- queryType：
  - knowledge：问一般规则、流程、含义（如"提现一般多久到账""账户为什么会被冻结"），不涉及提问者自己的具体数据
  - fact：问提问者自己的当前状态或具体记录（如"我的账户为什么被冻结了""昨天那笔到账了吗"）
  - judgment：要求认定责任、判断对错、承诺未来结果（如"是不是认定我违规""肯定能解冻吗""是不是误判""会不会被罚"）
  - human：投诉或明确要求人工
- slots：date（YYYY-MM-DD，"昨天"=今天减 1 天，"前天"=减 2 天，"今天/刚才"=今天）、amount（数字）、merchant_hint（提到的门店名关键词，如"人民路""滨江""大学城"）。没有就省略。
示例：{"intent":"txn_status","queryType":"fact","slots":{"date":"2026-11-05","amount":1280}}`;

const VALID_INTENT = ['txn_status', 'refund_status', 'fee_rate', 'account_status', 'withdrawal_status', 'knowledge', 'human'];
const VALID_TYPE = ['knowledge', 'fact', 'judgment', 'human'];

export async function llmNLU(llm, text, fallback) {
  try {
    const raw = await llm.chat([{ role: 'system', content: NLU_PROMPT }, { role: 'user', content: text }], { json: true });
    const j = JSON.parse(raw.replace(/^```json|```$/g, '').trim());
    if (!VALID_INTENT.includes(j.intent) || !VALID_TYPE.includes(j.queryType)) throw new Error('schema');
    const slots = { ...(j.slots || {}) };
    // 门店关键词以确定性解析为准，避免模型编造门店
    const det = parseSlots(text.replace(/\s+/g, ''));
    for (const k of ['merchant_hint', 'merchant_ref', 'merchant_brand']) { if (det[k]) slots[k] = det[k]; else delete slots[k]; }
    if (slots.amount != null) slots.amount = Number(slots.amount);
    return { intent: j.intent, queryType: j.queryType, slots, source: 'llm' };
  } catch (e) {
    return { ...fallback(text), source: 'rules-fallback', error: String(e.message || e) };
  }
}

const GEN_PROMPT = `你是支付商户客服。把"回复草稿"改写成自然、简洁、礼貌的中文回复。
硬性要求：
1. 只能使用草稿里的事实，不得新增任何状态、原因、时间、金额或承诺。
2. 草稿中的门店名、金额、日期、状态词必须原样保留。
3. 不得说"已认定""肯定能""一定能""保证"等认定或承诺类表述。
4. 不超过 120 字。直接输出回复正文。`;

export async function llmRewrite(llm, draft) {
  return (await llm.chat([{ role: 'system', content: GEN_PROMPT }, { role: 'user', content: `回复草稿：${draft}` }])).trim();
}
