// 一轮对话的完整处理：理解诉求 → 前置检查 → 按需取证 → 答复前检查 → 出口 → 记录状态。
// 规则与权限是确定性代码；大模型只负责理解问法和组织语言，金额、状态、时间由系统字段填入卡片。
import { ACCOUNTS, MERCHANTS, maskNo, KNOWLEDGE, HANDOFF } from './data.js';
import { createToolbox } from './tools.js';
import { rulesUnderstand, TASKS } from './understand.js';
import { llmUnderstand, llmPolish } from './llm.js';
import { guard } from './guard.js';

const yuan = n => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PERM = { summary: 'txn_summary', detail: 'txn_detail', settle: 'settle', account: 'account' };
const PERM_LABEL = { txn_summary: '交易汇总', txn_detail: '交易明细', settle: '结算与到账', account: '账户状态' };

export function newSession(accountId, variant = {}) {
  return { account: ACCOUNTS[accountId], variant, toolbox: createToolbox({ account: ACCOUNTS[accountId], variant }),
    pending: null, lastMerchant: null, facts: [], handoff: null, aiStopped: false, demand: '处理中', history: [] };
}

// 每次工具查到结果，记一条可交接的事实，转人工时一起带上
function factOf(name, d) {
  switch (name) {
    case 'get_txn_summary': return `${d.date} 交易汇总：${d.count} 笔，交易金额 ${yuan(d.amount)} 元，退款 ${yuan(d.refund)} 元`;
    case 'list_txns': return `交易明细：${d.map(r => `${r.time} ${yuan(r.amount)} 元 ${r.status}`).join('；')}`;
    case 'get_settlement': return d.conflict ? `结算批次 ${d.date}：记录冲突（${d.a} / ${d.b}）` : `结算批次 ${d.date}：${d.label}，交易金额 ${yuan(d.txnAmount)} 元`;
    case 'get_settlement_breakdown': return `差额构成：${d.items.map(i => `${i.name} ${yuan(i.amount)} 元`).join('，')}`;
    case 'get_account_status': return d.status === 'frozen' ? `账户冻结中（自 ${d.since}），原因：${d.reason}` : '账户状态正常';
    case 'update_merchant_info': case 'get_change_status': return `资料变更 ${d.requestId}：${d.state}`;
    default: return null;
  }
}

function handoffSummary(s, reason, facts, open) {
  facts = [...new Set([...(s.facts || []), ...facts])];
  return { reason, demand: s.history.filter(h => h.role === 'user').map(h => h.text).slice(-3), facts, done: s.toolbox.audit.filter(a => a.status === 'ok').map(a => `${a.title}（${a.merchant || '知识库'}）`), open,
    merchant: s.lastMerchant ? MERCHANTS[s.lastMerchant].name : null, account: `${s.account.name}（${s.account.role}）` };
}

function requestHandoff(s, reason, facts, open, lead, must = []) {
  if (s.variant.agentsOnline === false) {
    s.demand = '待处理';
    return { text: `${lead ? lead + '\n' : ''}现在没有客服在线，转接没有成功。你的问题和对话已经保留，可以稍后再试，或在工作时间拨打服务热线。`, keep: ['没有成功', ...must],
      card: { type: 'notice', tone: 'warn', title: '转接未成功', lines: ['会话已保留', '未分配客服，未生成工单'] }, handoff: { status: '转接失败', summary: handoffSummary(s, reason, facts, open) } };
  }
  s.handoff = { status: '待接入', ticket: 'GD-20261106-0031', summary: handoffSummary(s, reason, facts, open) };
  s.demand = '人工处理中';
  return { text: `${lead ? lead + '\n' : ''}已为你转接人工客服，当前排队第 ${HANDOFF.queuePosition} 位。之前的对话和查到的信息会一起交给客服，不用再说一遍。`, keep: ['人工', ...must],
    card: { type: 'handoff', ticket: s.handoff.ticket, queue: HANDOFF.queuePosition }, handoff: s.handoff };
}

// ---------------- 主流程 ----------------
export async function runTurn(s, input, { llm = null } = {}) {
  const t0 = Date.now();
  const trace = { preChecks: [], answerChecks: [], toolsBefore: s.toolbox.audit.length };
  const pc = (name, result, note) => trace.preChecks.push({ name, result, note });
  const ac = (name, result, note) => trace.answerChecks.push({ name, result, note });

  // 动作类输入（按钮）
  if (input.action === 'agent_accept') {
    s.aiStopped = true; if (s.handoff) s.handoff.status = '已接入';
    return finish(s, trace, t0, { system: '人工客服 07 已接入，接下来由客服为你处理。', outcome: '人工已接入', evidence: '—', taskLabel: '人工接入' });
  }
  if (input.action === 'unresolved') {
    s.demand = '待处理';
    return finish(s, trace, t0, { taskLabel: '未解决反馈', outcome: '补问补查', evidence: '—',
      reply: { text: '抱歉没帮上。是哪一部分没解决？', keep: [], chips: ['数据和我看到的不一样', '还想问别的', '我要找人工'] } });
  }

  const text = input.text;
  s.history.push({ role: 'user', text });
  if (s.aiStopped) return finish(s, trace, t0, { taskLabel: '人工处理中', outcome: 'AI 已停止自动回复', evidence: '—', silent: true });

  let u = llm ? await llmUnderstand(llm, text, rulesUnderstand, s.history.slice(0, -1)) : rulesUnderstand(text);
  // 归一：模型把"为什么被冻结"判成诊断类也说得通，但诊断流程只处理到账差额。
  // 路由按（任务, 领域）组合决定，账户域的"为什么"一律走账户原因查询，不让错的流程去答对的问题。
  if (u.task === 'diagnosis' && u.domain === 'account') u = { ...u, task: 'fact', aspect: u.aspect || 'reason', normalized: '诊断类 + 账户域 → 账户原因查询' };
  trace.understand = u;
  let task = u.task;

  // 多轮：澄清、确认、选择后，回到最早受影响的决策点继续原问题
  if (s.pending?.kind === 'clarify' && (task === 'select' || u.slots.store)) {
    const id = s.account.merchants.find(m => MERCHANTS[m].alias === u.slots.store);
    if (id) { const orig = s.pending.u; s.pending = null; return route(s, { ...orig, slots: { ...orig.slots, resolvedMerchant: id } }, trace, t0, llm); }
  }
  if (s.pending?.kind === 'choose_txn' && task === 'select') {
    const idx = /2|二/.test(text) ? 1 : 0; const row = s.pending.rows[idx]; s.pending = null;
    ac('对象与问题一致', '通过', `商户选定第 ${idx + 1} 笔`);
    return finish(s, trace, t0, { taskLabel: TASKS.fact, outcome: '直答', evidence: '业务工具（沿用上一轮结果）',
      reply: { text: `这笔 ${yuan(row.amount)} 元的交易（${row.time}）状态是：${row.status}。`, keep: [yuan(row.amount), row.status], card: { type: 'txn', rows: [row], merchant: MERCHANTS[s.lastMerchant].name } } });
  }
  if (s.pending?.kind === 'confirm' && task === 'confirm') return execInfo(s, s.pending.change, trace, t0, llm, true);
  return route(s, u, trace, t0, llm);
}

async function route(s, u, trace, t0, llm) {
  const { task } = u;
  const pc = (n, r, note) => trace.preChecks.push({ name: n, result: r, note });
  const ac = (n, r, note) => trace.answerChecks.push({ name: n, result: r, note });
  const tb = s.toolbox, v = s.variant, acc = s.account;
  const out = (o) => finish(s, trace, t0, { taskLabel: TASKS[task] || task, ...o }, llm);

  pc('诉求是否明确', task === 'other' ? '不通过' : '通过', TASKS[task]);
  if (task === 'other') return out({ outcome: '补问补查', evidence: '—', reply: { text: '我没太听明白你想办什么，可以换个说法，或者从下面选一个。', keep: [], chips: ['帮我查一下昨天的交易', '昨天的钱为什么还没到账？', '我要找人工'] } });

  // 要求人工：直接给入口，不强迫先走完自动问答
  if (task === 'human') {
    pc('是否明确要求人工', '是', '直接进入人工');
    return out({ outcome: '交人工', evidence: '直接人工', reply: requestHandoff(s, '商户明确要求人工', [], ['商户要求人工处理']) });
  }

  // ① 知识解释：不需要身份，不对个案做承诺
  if (task === 'knowledge') {
    pc('身份与权限', '不适用', '通用规则不需要商户身份');
    const r = tb.call('search_knowledge', { query: s.history.at(-1).text });
    if (r.status === 'multiple') {
      ac('知识有效且口径一致', '不通过', `命中 ${r.data.length} 个版本：${r.data.map(k => k.version).join('、')}，说法冲突`);
      return out({ outcome: '交人工', evidence: '知识库', failureTag: '误答风险：知识冲突',
        reply: requestHandoff(s, '缺少业务依据：知识口径冲突', ['知识库存在两个版本的 T+1 说明'], ['确认现行口径并下线旧版'], '关于这个规则，系统里有两个版本的说法不一致，我先不给你确定结论，以免误导你。', ['不一致']) });
    }
    if (r.status !== 'ok') return out({ outcome: '交人工', evidence: '知识库', reply: requestHandoff(s, '缺少业务依据：没有对应知识', [], ['补充知识'], '这个问题我暂时没有找到已发布的规则说明。') });
    const k = r.data[0];
    ac('知识已发布且适用', '通过', `${k.title} ${k.version}`); ac('不对个案做承诺', '通过', '只讲一般规则');
    const tail = u.domain === 'account' ? '如果想查你自己的账户状态，可以直接问我。' : '如果想知道你某一笔什么时候到，我可以帮你查结算记录。';
    return out({ outcome: '直答', evidence: '知识库', reply: { text: `${k.answer}\n${tail}`, keep: k.must || [], card: { type: 'knowledge', title: k.title, version: k.version }, chips: u.domain === 'account' ? ['我的账户是不是冻结了？'] : ['那我昨天的钱今天能到吗'] } });
  }

  // ④ 办理引导 / ⑤ 受控执行中没有获准工具的部分
  if (task === 'guide' || (task === 'execute' && u.domain !== 'info')) {
    if (task === 'execute') pc('是否具备获准的执行能力', '不通过', u.domain === 'card' ? '没有对话内换卡工具' : '没有对话内解冻工具，需审核结论');
    if (u.domain === 'account') {
      return out({ outcome: '部分答复', evidence: '—', reply: { text: '解除冻结需要以审核结论为准，我不能在对话里直接解冻。你可以先按要求提交材料，或者转人工跟进进度。', keep: [['不能', '无法', '没法']], chips: ['去上传材料', '我要找人工'] } });
    }
    const r = tb.call('search_knowledge', { query: '结算卡' }); const k = r.data[0];
    ac('引导不等于已办理', '通过', '结果以正式办理页面为准');
    if (task === 'execute') return out({ outcome: '部分答复', evidence: '知识库', reply: { text: `换卡需要在正式办理页面完成，我不能在对话里替你更换。请在「${k.entry}」提交，完成人脸验证后等待审核。\n办理时不要在对话里发送完整卡号、密码或验证码。`, keep: [['不能', '无法', '没法'], '不要'], card: { type: 'guide', title: k.title, entry: k.entry }, chips: ['我要找人工'] } });
    return out({ outcome: '直答', evidence: '知识库', reply: { text: `${k.answer}\n办理时不要在对话里发送完整卡号、密码或验证码。`, keep: ['不要'], card: { type: 'guide', title: k.title, entry: k.entry } } });
  }

  // 以下都需要商户身份：②事实查询、③诊断解释、⑤修改商户信息、⑥争议
  // 服务商协助不等于商户授权
  if (acc.channel) {
    pc('身份与权限', '不通过', '服务商账号没有该商户的数据授权');
    return out({ outcome: '拒绝', evidence: '—', reply: { text: '你当前登录的是服务商账号，没有这家商户的数据授权。我可以说明规则和办理路径；具体数据需要商户本人或授权账号查询。', keep: ['授权'], chips: ['T+1 结算是什么意思？', '怎么更换结算卡？'] } });
  }
  // 输入安全：对话里报的商户号只是定位线索，不是授权
  let mid = u.slots.resolvedMerchant || null, identitySource = '认证登录态';
  if (u.slots.merchantNo) {
    const m = Object.values(MERCHANTS).find(x => x.no === u.slots.merchantNo);
    const ok = m && acc.merchants.includes(m.id);
    pc('对话中的商户号', ok ? '通过' : '不通过', ok ? '在当前账号授权范围内，仅作定位' : '不在当前账号授权范围内');
    if (!ok) return out({ outcome: '拒绝', evidence: '—', reply: { text: '我只能查询你当前账号授权范围内的商户。对话里提供的商户号只能用来定位，不能作为查询授权；转人工也不能绕过这个限制。', keep: ['授权范围'] } });
    mid = m.id; identitySource = '认证登录态（商户号仅作定位）';
  }
  if (acc.session !== 'valid') {
    pc('身份与会话', '不通过', '登录态已失效');
    return out({ outcome: '补问补查', evidence: '—', reply: { text: '你的登录状态已失效。为保护账户安全，请重新验证后再查，验证前我不会读取任何数据。', keep: ['重新验证'], chips: ['去验证'] } });
  }
  pc('身份与会话', '通过', `${acc.name}（${acc.role}）`);

  if (!mid && u.slots.store) mid = acc.merchants.find(x => MERCHANTS[x].alias === u.slots.store) || null;
  if (!mid && acc.merchants.length > 1) {
    pc('业务对象', '不通过', `账号授权 ${acc.merchants.length} 家门店，未指明`);
    s.pending = { kind: 'clarify', u };
    return out({ outcome: '补问补查', evidence: '—', reply: { text: `你的账号授权了 ${acc.merchants.length} 家门店，要查哪一家？`, keep: [], card: { type: 'choice', options: acc.merchants.map(x => MERCHANTS[x].name) }, chips: acc.merchants.map(x => MERCHANTS[x].alias + '店') } });
  }
  mid = mid || acc.merchants[0]; s.lastMerchant = mid;
  const M = MERCHANTS[mid];
  pc('业务对象', '通过', `${M.name}（${maskNo(M.no)}）`);

  if (task === 'dispute') {
    pc('是否需要裁定', '是', '责任与赔付需有权限的人工认定');
    const facts = [];
    return out({ outcome: '交人工', evidence: '直接人工',
      reply: requestHandoff(s, '需要有权限的处置：责任与赔付裁定', facts, ['商户主张损失赔付'], '赔付和责任需要由人工按正式流程认定，我不能给结论，也不能做承诺。我已经把查到的情况整理好，一起交给客服。') });
  }

  if (task === 'execute' && u.domain === 'info') {
    pc('账号权限', acc.perms.info_edit ? '通过' : '不通过', '修改商户信息');
    if (!acc.perms.info_edit) return out({ outcome: '拒绝', evidence: '—', reply: { text: '当前账号没有修改商户信息的权限，请用店主账号操作。', keep: ['权限'] } });
    pc('是否具备获准的执行能力', '通过', '联系电话修改：确认后提交，审核后生效');
    s.pending = { kind: 'confirm', change: { field: u.slots.field, value: u.slots.value, mid } };
    return out({ outcome: '待确认', evidence: '—', reply: { noPolish: true, text: `请确认：把${M.name}的联系电话改为 ${u.slots.value.slice(0, 3)}****${u.slots.value.slice(-4)}。确认后提交，审核通过才算修改成功。`, keep: ['确认'], card: { type: 'confirm', field: '联系电话', from: '138****0000', to: `${u.slots.value.slice(0, 3)}****${u.slots.value.slice(-4)}` }, chips: ['确认', '取消'] } });
  }

  // ②③ 查询与诊断
  const aspect = u.domain === 'txn' ? (u.aspect || 'summary') : u.domain;
  const perm = PERM[aspect === 'account' ? 'account' : aspect === 'settle' ? 'settle' : aspect];
  pc('账号权限', acc.perms[perm] ? '通过' : '不通过', PERM_LABEL[perm]);
  if (!acc.perms[perm]) return out({ outcome: '拒绝', evidence: '—', reply: { text: `当前账号（${acc.role}）没有查看${PERM_LABEL[perm]}的权限。请使用店主或财务账号，或联系店主为你开通。`, keep: ['权限'] } });
  const date = u.slots.date || '2026-11-05';

  // 模拟的失败模式：身份没有传到工具
  if (v.identityBug) {
    const r = tb.call(aspect === 'detail' ? 'list_txns' : 'get_txn_summary', { date }, { merchantId: null });
    ac('查询成功且事实充分', '未检查', '本场景模拟答复前检查缺失');
    return out({ outcome: '直答（错误）', evidence: '业务工具 → 回退知识库', failureTag: '链路问题：身份没有传到工具',
      reply: { text: '交易到账时间可能受到结算周期、银行处理时间等因素影响，请耐心等待。', keep: [] } });
  }

  const call = (name, args) => { const r = tb.call(name, args, { merchantId: mid, identitySource }); if (r.status === 'ok') { const f = factOf(name, r.data); if (f) s.facts.push(f); } return r; };
  const degrade = sys => out({ outcome: '部分答复', evidence: '业务工具',
    reply: { text: `这次查询没有完成（${sys}暂时没有响应），我现在无法核实具体状态。你可以稍后重试，或者转人工处理。`, keep: ['无法核实'], chips: ['重试', '我要找人工'] } });

  if (u.domain === 'txn') {
    if (aspect === 'detail') {
      const r = call('list_txns', { date, amount: u.slots.amount ?? null });
      if (r.status === 'error') return degrade('交易系统');
      if (r.status === 'empty') return out({ outcome: '部分答复', evidence: '业务工具', reply: { text: `按当前条件（${date}${u.slots.amount ? '，' + yuan(u.slots.amount) + ' 元' : ''}）暂未找到匹配的交易。可以核对一下日期和金额；暂未找到不代表没有发生过交易。`, keep: ['暂未找到'] } });
      if (r.status === 'multiple') {
        ac('结果唯一', '不通过', `匹配到 ${r.data.length} 笔`); s.pending = { kind: 'choose_txn', rows: r.data };
        return out({ outcome: '补问补查', evidence: '业务工具', reply: { text: `昨天有 ${r.data.length} 笔 ${yuan(u.slots.amount)} 元的交易，你问的是哪一笔？`, keep: [], card: { type: 'txn', rows: r.data, merchant: M.name, choose: true }, chips: ['第1笔', '第2笔'] } });
      }
      return out({ outcome: '直答', evidence: '业务工具', reply: { text: `查到${M.name}昨天的交易：`, keep: [], card: { type: 'txn', rows: r.data, merchant: M.name } } });
    }
    const r = call('get_txn_summary', { date });
    if (r.status === 'error') return degrade('交易系统');
    if (r.status === 'empty') return out({ outcome: '部分答复', evidence: '业务工具', reply: { text: `按当前条件（${M.name}，${date}）暂未找到交易记录。可以换个日期再查；暂未找到不代表没有发生过交易。`, keep: ['暂未找到'] } });
    ac('对象与问题一致', '通过', `${M.name} · ${date}`); ac('展示范围符合权限', '通过', '汇总字段');
    return out({ outcome: '直答', evidence: '业务工具', reply: { text: `查到${M.name}昨天（${date.slice(5)}）的交易汇总：`, keep: [], card: { type: 'summary', merchant: M.name, date, ...r.data } } });
  }

  if (u.domain === 'settle' && task === 'fact') {
    const r = call('get_settlement', { date });
    if (r.status === 'error') return degrade('结算系统');
    const d = r.data;
    if (d.conflict) {
      ac('多源信息口径一致', '不通过', `${d.a} / ${d.b}`);
      return out({ outcome: '交人工', evidence: '业务工具', reply: requestHandoff(s, '系统或证据异常：状态记录冲突', [`结算批次 ${date}：两处记录分别为「${d.a}」「${d.b}」`], ['核实实际出款状态'], '系统里这笔的状态记录不一致，一处显示已出款，一处显示处理中。为避免给你错误信息，我先不下结论。') });
    }
    ac('对象与问题一致', '通过', `${M.name} · ${date} 结算批次`);
    if (d.status === 'processing') { ac('结论不越过依据', '通过', '不承诺具体到账时刻');
      return out({ outcome: '直答', evidence: '业务工具 + 知识库', reply: { text: `${M.name} ${date.slice(5)} 的交易（${yuan(d.txnAmount)} 元）目前在结算处理中：清算已完成，等待出款。这笔没有失败。具体到账时间以结算记录为准，我没法给你一个确定的时刻。`, keep: ['结算处理中', yuan(d.txnAmount)], card: { type: 'settle', merchant: M.name, steps: [['交易成功', '完成'], ['清算完成', '完成'], ['等待出款', '当前'], ['银行入账', '未开始']] } } }); }
    if (d.status === 'paid_out') { ac('结论不越过依据', '通过', '只确认平台出款，不确认银行入账');
      return out({ outcome: '部分答复', evidence: '业务工具', reply: { text: `平台已于 ${d.paidAt.slice(5)} 出款。银行那边是否已经入账，我这边无法核实，以你的银行到账通知为准。`, keep: [d.paidAt.slice(5), ['无法核实', '没法核实', '不能核实']], card: { type: 'settle', merchant: M.name, steps: [['交易成功', '完成'], ['清算完成', '完成'], ['平台出款', '完成'], ['银行入账', '无法核实']] } } }); }
    if (d.status === 'returned') { ac('展示范围符合权限', '通过', '退回原因允许展示');
      return out({ outcome: '直答', evidence: '业务工具 + 知识库', reply: { text: `这批结算被退回了，原因是：${d.reason}。更换为户名一致的结算卡后，系统会重新结算。`, keep: [d.reason], card: { type: 'settle', merchant: M.name, steps: [['交易成功', '完成'], ['清算完成', '完成'], ['结算出款', '退回']] }, chips: ['怎么更换结算卡？'] } }); }
  }

  if (task === 'diagnosis') {
    const r = call('get_settlement_breakdown', { date });
    if (r.status === 'error') return degrade('结算系统');
    const d = r.data, diff = +(d.txnAmount - d.arrived).toFixed(2);
    if (d.conflict) {
      ac('证据闭合', '不通过', d.conflict);
      return out({ outcome: '交人工', evidence: '业务工具', reply: requestHandoff(s, '系统或证据异常：账务对不上', [d.conflict], ['核查差额来源'], '这笔的结算记录对不上，我不能给你一个可靠的解释。') });
    }
    if (d.explained < diff) {
      ac('证据闭合', '部分', `已核实 ${yuan(d.explained)} 元，未核实 ${yuan(diff - d.explained)} 元`);
      return out({ outcome: '部分答复', evidence: '业务工具 + 知识库', reply: { text: `差额 ${yuan(diff)} 元里，已核实 ${yuan(d.explained)} 元；剩下的 ${yuan(+(diff - d.explained).toFixed(2))} 元暂时没有找到对应记录，我不推测原因，可以转人工帮你核查。`, keep: [yuan(d.explained), '不推测'], card: { type: 'breakdown', ...d, diff }, chips: ['我要找人工'] } });
    }
    ac('证据闭合', '通过', '差额由系统记录完全解释');
    return out({ outcome: '直答', evidence: '业务工具 + 知识库', reply: { text: `差额 ${yuan(diff)} 元已经核实清楚，构成如下：`, keep: [yuan(diff)], card: { type: 'breakdown', ...d, diff } } });
  }

  if (u.domain === 'account') {
    const r = call('get_account_status', {});
    if (r.status === 'error') return degrade('账户系统');
    const a = r.data;
    if (a.status === 'normal') return out({ outcome: '直答', evidence: '业务工具', reply: { text: `查到${M.name}账户状态正常。`, keep: ['正常'], card: { type: 'account', status: '正常' } } });
    const asp = u.aspect || 'status';
    if (asp === 'status') { ac('原样转述状态', '通过', '只说状态');
      return out({ outcome: '直答', evidence: '业务工具', reply: { text: `查到${M.name}账户目前处于冻结状态（自 ${a.since.slice(5)} 起）。`, keep: ['冻结'], card: { type: 'account', status: '冻结中', since: a.since }, chips: ['我的账户为什么被冻结？', '什么时候能解冻？'] } }); }
    if (asp === 'reason') {
      if (!a.reasonDisplayable) { ac('展示范围符合权限', '不通过', '原因不允许由 AI 展示');
        return out({ outcome: '交人工', evidence: '业务工具', reply: requestHandoff(s, '需要有权限的处置：原因需人工复核', ['账户冻结中'], ['告知冻结原因'], '账户确实处于冻结状态，但具体原因需要人工复核后告知，我不推测原因。') }); }
      ac('展示范围符合权限', '通过', '原因与所需材料允许展示'); ac('结论不越过依据', '通过', '不做违规认定');
      return out({ outcome: '直答', evidence: '业务工具', reply: { text: `冻结原因是${a.reason}，目前需要${a.required}。这不等于已经认定违规，结果以审核结论为准。`, keep: [a.reason], card: { type: 'account', status: '冻结中', since: a.since, reason: a.reason, required: a.required, upload: true } } });
    }
    if (asp === 'schedule') { ac('结论不越过依据', '通过', '系统无正式解冻安排，不做承诺');
      const kb = tb.call('search_knowledge', { query: '审核多久' });
      return out({ outcome: '部分答复', evidence: '业务工具 + 知识库', reply: { text: `系统里目前没有正式的解冻安排，所以我没法承诺解冻时间。一般规则是：${kb.data[0].answer}需要的话，我帮你转人工确认进度。`, keep: [['没法承诺', '无法承诺', '不能承诺']], chips: ['去上传材料', '我要找人工'] } }); }
  }
  return out({ outcome: '交人工', evidence: '—', reply: requestHandoff(s, '理解或服务未完成', [], ['未识别的诉求']) });
}

async function execInfo(s, change, trace, t0, llm) {
  const tb = s.toolbox; s.pending = null;
  const M = MERCHANTS[change.mid];
  trace.preChecks.push({ name: '商户确认', result: '通过', note: '商户已确认变更内容' });
  const call = (n, a) => { const r = tb.call(n, a, { merchantId: change.mid }); if (r.status === 'ok') s.facts.push(factOf(n, r.data)); return r; };
  const r = call('update_merchant_info', { field: change.field, value: change.value });
  if (r.status === 'error') {
    const st = call('get_change_status', { field: change.field });
    trace.answerChecks.push({ name: '可能已执行的操作', result: '已核对', note: '超时后先查执行状态，不重复提交' });
    if (st.status === 'ok') return finish(s, trace, t0, { taskLabel: TASKS.execute, outcome: '直答', evidence: '业务工具',
      reply: { text: `提交时系统没有及时返回结果。我查了执行状态：申请已经提交（${st.data.requestId}），正在审核中，不需要重复提交。`, keep: ['不需要重复提交'], card: { type: 'change', id: st.data.requestId, state: st.data.state } } }, llm);
    return finish(s, trace, t0, { taskLabel: TASKS.execute, outcome: '部分答复', evidence: '业务工具', reply: { text: '提交结果暂时无法确认，请不要重复提交，我帮你转人工核实。', keep: ['不要重复提交'] } }, llm);
  }
  trace.answerChecks.push({ name: '区分已提交与已生效', result: '通过', note: '当前为审核中' });
  return finish(s, trace, t0, { taskLabel: TASKS.execute, outcome: '直答', evidence: '业务工具',
    reply: { text: `已提交修改申请（${r.data.requestId}），当前状态：审核中。审核通过后才算修改成功。`, keep: ['审核中'], card: { type: 'change', id: r.data.requestId, state: r.data.state } } }, llm);
}

async function finish(s, trace, t0, o, llm) {
  let reply = o.reply || null;
  // 请商户确认变更的话术不交给模型改写：改写可能把"请确认"写成"已收到申请"，关键词检查拦不住
  if (reply && llm && !reply.noPolish) {
    try {
      const polished = await llmPolish(llm, reply.text);
      const g = guard(polished, reply.keep, reply.text);
      trace.polishedRaw = polished;
      trace.guard = g;
      trace.template = reply.text;
      if (g.ok) reply = { ...reply, text: polished, polished: true };
    } catch (e) { trace.guard = { ok: false, reasons: ['大模型调用失败，使用模板回复'] }; }
  } else if (reply) trace.guard = guard(reply.text, reply.keep);
  if (reply) s.history.push({ role: 'ai', text: reply.text });
  const tools = s.toolbox.audit.slice(trace.toolsBefore);
  // 取证路径按实际调用记录，不按预设标签
  const biz = tools.some(t => t.tool !== 'search_knowledge'), kb = tools.some(t => t.tool === 'search_knowledge');
  const evidence = o.failureTag ? '业务工具（失败）→ 通用话术' : biz && kb ? '业务工具 + 知识库' : biz ? '业务工具' : kb ? '知识库' : o.evidence;
  const demand = s.handoff ? (s.handoff.status === '已接入' ? '人工处理中' : '人工待接入') : (o.outcome === '直答' ? '已答复，待商户确认' : o.outcome === '待确认' ? '待商户确认' : '待处理');
  if (reply?.handoff?.status === '转接失败') o.outcome = '交人工（未成功）';
  return {
    reply, system: o.system || null, silent: !!o.silent,
    trace: { task: o.taskLabel, understand: trace.understand || null, preChecks: trace.preChecks, evidence, template: trace.template || null, polishedRaw: trace.polishedRaw || null,
      tools, answerChecks: trace.answerChecks, outcome: o.outcome, guard: trace.guard || null, failureTag: o.failureTag || null,
      handoff: reply?.handoff?.summary || null, state: { session: s.aiStopped ? '人工接管' : '进行中', demand: o.outcome === '直答（错误）' ? '误判为已答复' : demand },
      ms: Date.now() - t0, model: llm ? llm.model : '规则模式' },
  };
}
