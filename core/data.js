// PayDesk Agent Lab — 模拟业务数据。全部为虚构数据，不对应任何真实商户或公司。
// 固定"今天"，保证评测结果可复现。
export const TODAY = '2026-11-06';

export const MERCHANTS = {
  M1001: { id: 'M1001', name: '张记小面馆', feeRate: '0.38%', settleCycle: 'T+1',
    account: { status: 'normal' } },
  M2001: { id: 'M2001', name: '王氏烘焙·人民路店', alias: ['人民路'], feeRate: '0.38%', settleCycle: 'T+1',
    account: { status: 'normal' } },
  M2002: { id: 'M2002', name: '王氏烘焙·滨江店', alias: ['滨江'], feeRate: '0.30%', settleCycle: 'T+1',
    account: { status: 'normal' } },
  M2003: { id: 'M2003', name: '王氏烘焙·大学城店', alias: ['大学城'], feeRate: '0.38%', settleCycle: 'T+1',
    // 冻结原因不允许向商户展示：用于验证"有数据但无展示权限 → 转人工"
    account: { status: 'frozen', since: '2026-11-02', reasonDisplay: null, requiredAction: null,
      displayable: false, finalDetermination: false } },
  M3001: { id: 'M3001', name: '李家水果铺', feeRate: '0.38%', settleCycle: 'T+1',
    account: { status: 'frozen', since: '2026-11-04', reasonCode: 'RISK_RULE_021', reasonDisplay: '风险审核',
      requiredAction: '补充经营材料（营业执照、近期进货凭证）', displayable: true, finalDetermination: false } },
  M4001: { id: 'M4001', name: '陈氏五金', feeRate: '0.38%', settleCycle: 'T+1',
    account: { status: 'normal' } },
};

export const USERS = {
  u_zhang: { id: 'u_zhang', name: '张老板', desc: '单店老板', merchants: ['M1001'], session: 'valid' },
  u_wang:  { id: 'u_wang',  name: '王会计', desc: '连锁店财务，管理 3 家店', merchants: ['M2001', 'M2002', 'M2003'], session: 'valid' },
  u_li:    { id: 'u_li',    name: '李老板', desc: '账户风控审核中', merchants: ['M3001'], session: 'valid' },
  u_chen:  { id: 'u_chen',  name: '陈老板', desc: '登录已失效', merchants: ['M4001'], session: 'expired' },
  guest:   { id: 'guest',   name: '访客', desc: '未登录', merchants: [], session: 'none' },
};

export const TRANSACTIONS = [
  { id: 'T1001-1', merchant: 'M1001', date: '2026-11-05', amount: 1280.00, status: 'processing', settleExpected: '2026-11-07' },
  { id: 'T1001-3', merchant: 'M1001', date: '2026-11-05', amount: 88.00, status: 'failed', failReason: '持卡人银行退回' },
  { id: 'T1001-2', merchant: 'M1001', date: '2026-11-04', amount: 356.50, status: 'settled', settledAt: '2026-11-05' },
  { id: 'T2001-1', merchant: 'M2001', date: '2026-11-05', amount: 2300.00, status: 'settled', settledAt: '2026-11-06' },
  { id: 'T2002-1', merchant: 'M2002', date: '2026-11-05', amount: 980.00, status: 'processing', settleExpected: '2026-11-07' },
  { id: 'T2003-1', merchant: 'M2003', date: '2026-11-05', amount: 4500.00, status: 'settled', settledAt: '2026-11-06' },
  { id: 'T3001-1', merchant: 'M3001', date: '2026-11-03', amount: 600.00, status: 'held', holdReason: '账户处于风险审核，结算暂停' },
  { id: 'T4001-1', merchant: 'M4001', date: '2026-11-05', amount: 150.00, status: 'settled', settledAt: '2026-11-06' },
];

export const REFUNDS = [
  { id: 'R1001-1', merchant: 'M1001', date: '2026-11-06', amount: 45.00, status: 'success' },
  { id: 'R1001-2', merchant: 'M1001', date: '2026-11-05', amount: 120.00, status: 'processing' },
  { id: 'R2001-1', merchant: 'M2001', date: '2026-11-05', amount: 66.00, status: 'success' },
  { id: 'R2002-1', merchant: 'M2002', date: '2026-11-05', amount: 210.00, status: 'processing' },
];

export const WITHDRAWALS = [
  { id: 'W1001-1', merchant: 'M1001', date: '2026-11-05', amount: 5000.00, status: 'success', arrivedAt: '2026-11-05' },
  { id: 'W3001-1', merchant: 'M3001', date: '2026-11-04', amount: 3000.00, status: 'risk_review',
    requiredAction: '补充身份材料（法人身份证正反面）', displayable: true },
  { id: 'W2002-1', merchant: 'M2002', date: '2026-11-05', amount: 8000.00, status: 'risk_review',
    requiredAction: null, displayable: false },
];

export const STATUS_LABEL = {
  txn: { processing: '处理中（已支付，待结算）', settled: '已结算', failed: '交易失败', held: '暂停结算' },
  refund: { success: '退款成功', processing: '退款处理中' },
  withdrawal: { success: '已到账', risk_review: '风险审核中' },
};

// 知识库：只回答"一般规则"，不回答"你现在怎样"。
export const KNOWLEDGE = [
  { id: 'K01', keys: ['提现', '多久', '到账'], title: '提现到账时间', answer: '提现申请成功后，一般在 1 个工作日内到账，节假日顺延。' },
  { id: 'K02', keys: ['结算周期', '怎么算', '结算'], title: '结算周期', answer: '默认结算周期为 T+1：今天的交易在下一个工作日结算到账。' },
  { id: 'K03', keys: ['T+1'], title: 'T+1 的含义', answer: 'T+1 指交易日（T）的下一个工作日完成结算。' },
  { id: 'K04', keys: ['退款', '多久', '退回'], title: '退款到账时间', answer: '退款成功后原路退回，顾客一般在 1-3 个工作日内收到。' },
  { id: 'K05', keys: ['为什么会', '冻结'], title: '账户冻结的常见原因', answer: '账户可能因交易异常、资料不完整或触发风险规则而进入审核，具体原因以账户页面通知为准。' },
  { id: 'K06', keys: ['冻结', '材料', '准备'], title: '冻结后所需材料', answer: '冻结后通常需要按页面提示补充经营材料，例如营业执照、经营场所照片或进货凭证。' },
  { id: 'K07', keys: ['交易失败', '原因'], title: '交易失败的常见原因', answer: '交易失败常见原因包括余额不足、银行风控拦截、持卡人银行退回等。' },
  { id: 'K08', keys: ['手续费', '怎么收'], title: '手续费收取方式', answer: '手续费按交易金额乘以签约费率收取，在结算时直接扣除。' },
  { id: 'K09', keys: ['节假日', '顺延'], title: '节假日结算', answer: '节假日期间结算顺延至下一个工作日。' },
  { id: 'K10', keys: ['结算银行卡', '修改', '银行卡'], title: '修改结算银行卡', answer: '可在「账户设置 - 结算信息」中修改结算银行卡，需完成法人身份验证。' },
  { id: 'K11', keys: ['提现', '手续费'], title: '提现手续费', answer: 'T+1 自动结算免手续费，手动提现每笔收取 1 元手续费。' },
  { id: 'K12', keys: ['退款', '退手续费'], title: '退款与手续费', answer: '全额退款时，原交易手续费会一并退回；部分退款按比例退回。' },
  { id: 'K13', keys: ['处理中', '什么意思'], title: '交易"处理中"的含义', answer: '"处理中"表示顾客已完成支付，资金正在等待结算，不代表交易失败。' },
  { id: 'K14', keys: ['风险审核', '多久'], title: '风险审核时长', answer: '风险审核一般在材料齐全后 3-5 个工作日内完成，以审核结论为准。' },
  { id: 'K15', keys: ['限额', '提高', '申请'], title: '提高收款限额', answer: '可在「账户设置 - 收款限额」提交申请，审核通过后生效。' },
];

export const KB_FALLBACK_TXN = '交易到账时间可能受到结算周期、银行处理时间等因素影响，请耐心等待。';
