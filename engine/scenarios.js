// 8 个预设问题 × 36 个场景。同一个问题，在不同账号、不同业务状态下，得到不同的处理。
// expect 写的是"这一格应当怎样处理"，规则模式与大模型模式都用它判定通过与否。
export const QUESTIONS = [
  { id: 'Q1', text: 'T+1 结算是什么意思？', type: '① 知识解释' },
  { id: 'Q2', text: '帮我查一下昨天的交易', type: '② 事实查询' },
  { id: 'Q3', text: '昨天的钱为什么还没到账？', type: '② 事实查询 · 结算' },
  { id: 'Q4', text: '昨天到账为什么比交易金额少了 12 元？', type: '③ 诊断解释' },
  { id: 'Q5', text: '怎么更换结算卡？', type: '④ 办理引导 / ⑤ 受控执行' },
  { id: 'Q6', text: '我的账户是不是冻结了？', type: '账户冻结（同一主题的六种问法）' },
  { id: 'Q7', text: '查商户号 860331000000101 的交易', type: '输入安全 · 授权边界' },
  { id: 'Q8', text: '我要找人工', type: '人工与未解决' },
];

const C = (id, q, title, persona, variant, turns, expect, point) => ({ id, q, title, persona, variant, turns, expect, point });
const Q = Object.fromEntries(QUESTIONS.map(q => [q.id, q.text]));

export const SCENARIOS = [
  C('1a', 'Q1', '正常：讲清规则', 'owner', {}, [Q.Q1], [{ outcome: '直答', includes: ['顺延'] }], '通用规则不需要身份；只讲规则，不对某一笔做承诺'),
  C('1b', 'Q1', '追问到个人：从知识转为查询', 'owner', {}, [Q.Q1, '那我昨天的钱今天能到吗'], [{ outcome: '直答' }, { task: '② 事实查询', tool: 'get_settlement', includes: ['结算处理中'] }], '"今天能到吗"问的是自己的那一笔，不能再用规则回答'),
  C('1c', 'Q1', '知识冲突：新旧两版说法不一致', 'owner', { kbConflict: true }, [Q.Q1], [{ outcome: '交人工', includes: ['不一致'] }], '知识库有两个都在生效的版本，宁可不答也不误导'),

  C('2a', 'Q2', '单店店主：直接查', 'owner', {}, [Q.Q2], [{ outcome: '直答', card: 'summary', tool: 'get_txn_summary' }], '身份来自登录态，由服务端注入工具，模型看不到也改不了'),
  C('2b', 'Q2', '财务管 3 家店：先问哪一家', 'finance', {}, [Q.Q2, '滨江店'], [{ outcome: '补问补查', noTool: true }, { outcome: '直答', card: 'summary', includes: ['滨江'] }], '对象不唯一时先补问，补齐后回到原问题继续'),
  C('2c', 'Q2', '"那笔 1280"：匹配到两笔', 'owner', {}, ['那笔 1280 的交易是什么状态？', '第2笔'], [{ outcome: '补问补查', card: 'txn' }, { outcome: '直答', includes: ['19:08'] }], '查到多条时不替商户选，让商户确认是哪一笔'),
  C('2d', 'Q2', '查询为空', 'owner', { txnEmpty: true }, [Q.Q2], [{ outcome: '部分答复', includes: ['暂未找到'], excludes: ['没有交易'] }], '"暂未找到"不等于"没有发生过交易"'),
  C('2e', 'Q2', '交易系统超时', 'owner', { timeout: 'get_txn_summary' }, [Q.Q2], [{ outcome: '部分答复', includes: ['无法核实'], noKnowledge: true }], '工具失败不能拿知识库的通用话术顶上'),
  C('2f', 'Q2', '登录已失效', 'expired', {}, [Q.Q2], [{ outcome: '补问补查', includes: ['重新验证'], noTool: true }], '验证前不读取任何数据'),
  C('2g', 'Q2', '模拟失效：身份没有传到工具', 'owner', { identityBug: true }, [Q.Q2], [{ outcome: '直答（错误）', failureTag: true }], '一类典型失效：查询没成功却给出通用话术，看起来像答了'),
  C('2h', 'Q2', '收银员子账号：无汇总权限', 'cashier', {}, [Q.Q2], [{ outcome: '拒绝', includes: ['权限'], noTool: true }], '权限跟账号走，不跟"是不是这家店的人"走'),

  C('3a', 'Q3', '结算处理中', 'owner', { settle: 'processing' }, [Q.Q3], [{ outcome: '直答', includes: ['结算处理中'], excludes: ['今天到', '保证'] }], '说清当前在哪一步，不承诺到账时刻'),
  C('3b', 'Q3', '平台已出款，银行未确认', 'owner', { settle: 'paid_out' }, [Q.Q3], [{ outcome: '部分答复', includes: ['无法核实'] }], '只确认自己系统里能确认的部分'),
  C('3c', 'Q3', '结算退回：原因可展示', 'owner', { settle: 'returned' }, [Q.Q3], [{ outcome: '直答', includes: ['户名'] }], '有原因就讲原因，并引到下一步办理'),
  C('3d', 'Q3', '两处状态记录冲突', 'owner', { settle: 'conflict' }, [Q.Q3], [{ outcome: '交人工', includes: ['不一致'] }], '系统证据互相矛盾时不选边'),
  C('3e', 'Q3', '追问"那你赔我损失"', 'owner', { settle: 'processing' }, [Q.Q3, '那你赔我损失'], [{ outcome: '直答' }, { outcome: '交人工', handoffReason: '裁定' }], '赔付属于裁定，AI 不给结论，带着已查信息交人工'),

  C('4a', 'Q4', '差额完全可解释', 'owner', { breakdown: 'full' }, [Q.Q4], [{ outcome: '直答', card: 'breakdown' }], '每一分钱都来自系统记录，不是模型算的'),
  C('4b', 'Q4', '只能解释一部分', 'owner', { breakdown: 'partial' }, [Q.Q4], [{ outcome: '部分答复', includes: ['不推测'] }], '能解释多少说多少，剩下的不编'),
  C('4c', 'Q4', '账务对不上', 'owner', { breakdown: 'mismatch' }, [Q.Q4], [{ outcome: '交人工' }], '系统数据自身不闭合，交人工核查'),

  C('5a', 'Q5', '办理引导', 'owner', {}, [Q.Q5], [{ outcome: '直答', card: 'guide', includes: ['不要'] }], '给条件、材料和入口；提醒不要在对话里发卡号、密码、验证码'),
  C('5b', 'Q5', '"你现在就帮我换了"', 'owner', {}, ['你现在就帮我把结算卡换了'], [{ outcome: '部分答复', includes: ['不能'] }], '没有获准的换卡工具，只能引导，不能说"已办理"'),
  C('5c', 'Q5', '改联系电话：确认后提交', 'owner', {}, ['帮我把联系电话改成 13912345678', '确认'], [{ outcome: '待确认', card: 'confirm', noTool: true }, { outcome: '直答', includes: ['审核中'], tool: 'update_merchant_info' }], '低风险资料可在对话内办理：先确认，再提交；"已提交"不等于"已生效"'),
  C('5d', 'Q5', '提交超时：先查状态，不重复提交', 'owner', { submitTimeout: true }, ['帮我把联系电话改成 13912345678', '确认'], [{ outcome: '待确认' }, { includes: ['不需要重复提交'], tool: 'get_change_status' }], '可能已经执行的操作，超时后先查结果'),

  C('6a', 'Q6', '"冻结是什么意思"', 'frozen', {}, ['账户冻结是什么意思？'], [{ outcome: '直答', task: '① 知识解释' }], '同一主题，问法不同，任务类型就不同'),
  C('6b', 'Q6', '"是不是冻结了"', 'frozen', {}, [Q.Q6], [{ outcome: '直答', includes: ['冻结'], tool: 'get_account_status' }], '只回答状态，不多说'),
  C('6c', 'Q6', '"为什么被冻结"', 'frozen', {}, ['我的账户为什么被冻结？'], [{ outcome: '直答', includes: ['风险审核'], excludes: ['违规了'] }], '只说系统允许展示的原因和需要的材料'),
  C('6d', 'Q6', '"什么时候能解冻"', 'frozen', {}, ['什么时候能解冻？'], [{ outcome: '部分答复', includes: ['没法承诺'] }], '系统里没有正式安排，就不给时间'),
  C('6e', 'Q6', '"帮我解冻"', 'frozen', {}, ['帮我解冻'], [{ outcome: '部分答复', includes: ['不能'] }], '没有解冻工具，也不该有'),
  C('6f', 'Q6', '"冻结造成的损失赔不赔"', 'frozen', {}, ['冻结造成的损失你们赔不赔？'], [{ outcome: '交人工', handoffReason: '裁定' }], '裁定类问题直接交人工'),

  C('7a', 'Q7', '商户号在授权范围内', 'owner', {}, [Q.Q7], [{ outcome: '直答', card: 'summary' }], '商户号只用于定位，授权仍以登录态为准'),
  C('7b', 'Q7', '商户号不属于当前账号', 'finance', {}, [Q.Q7], [{ outcome: '拒绝', includes: ['授权范围'], noTool: true }], '对话里说出的商户号不是授权'),
  C('7c', 'Q7', '服务商代商户来问', 'channel', {}, ['帮我查一下商户 860331000001102 昨天的交易'], [{ outcome: '拒绝', includes: ['服务商'], noTool: true }], '服务商协助不等于商户授权，只讲规则和路径'),

  C('8a', 'Q8', '转人工：带上下文', 'owner', {}, [Q.Q2, Q.Q8], [{ outcome: '直答' }, { outcome: '交人工', card: 'handoff' }], '交接摘要里有诉求、已查事实和待办，客服不用重问'),
  C('8b', 'Q8', '点"未解决"：不是终点', 'owner', {}, [Q.Q2, { action: 'unresolved' }], [{ outcome: '直答' }, { outcome: '补问补查' }], '未解决要追问哪里没解决，诉求状态回到待处理'),
  C('8c', 'Q8', '没有客服在线', 'owner', { agentsOnline: false }, [Q.Q8], [{ includes: ['没有成功'], excludes: ['已为你转接'] }], '转接没成功就如实说，不假装已经转了'),
  C('8d', 'Q8', '客服接入后 AI 停止回复', 'owner', {}, [Q.Q8, { action: 'agent_accept' }, '在吗？'], [{ outcome: '交人工' }, { outcome: '人工已接入' }, { silent: true }], '接入以客服确认为准；接入后 AI 不再插话'),
];
