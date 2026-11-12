// 演示支付 · 商户服务助手 —— 模拟业务数据。全部虚构，不对应任何真实机构、商户或个人。
export const BRAND = '演示支付';
export const TODAY = '2026-11-06';
export const YESTERDAY = '2026-11-05';

export const MERCHANTS = {
  S01: { id: 'S01', no: '860331000000101', name: '老街面馆' },
  S11: { id: 'S11', no: '860331000001101', name: '禾木烘焙·人民路店', alias: '人民路' },
  S12: { id: 'S12', no: '860331000001102', name: '禾木烘焙·滨江店', alias: '滨江' },
  S13: { id: 'S13', no: '860331000001103', name: '禾木烘焙·大学城店', alias: '大学城' },
  S21: { id: 'S21', no: '860331000002101', name: '鲜果铺' },
  S31: { id: 'S31', no: '860331000003101', name: '诚信五金' },
};
export const maskNo = no => `${no.slice(0, 4)}****${no.slice(-4)}`;

// 账号：权限按账号实际授权，不按岗位自动开放
const ALL = { txn_summary: true, txn_detail: true, settle: true, account: true, info_edit: true };
export const ACCOUNTS = {
  owner:   { id: 'owner',   name: '张老板', role: '店主', desc: '单店店主',            merchants: ['S01'], session: 'valid', perms: ALL },
  finance: { id: 'finance', name: '王会计', role: '财务', desc: '连锁店财务，授权 3 家门店', merchants: ['S11', 'S12', 'S13'], session: 'valid', perms: { ...ALL, info_edit: false } },
  cashier: { id: 'cashier', name: '小周',   role: '收银员', desc: '滨江店收银员子账号',     merchants: ['S12'], session: 'valid', perms: { txn_summary: false, txn_detail: true, settle: false, account: false, info_edit: false } },
  frozen:  { id: 'frozen',  name: '李老板', role: '店主', desc: '账户风险审核中',        merchants: ['S21'], session: 'valid', perms: ALL },
  expired: { id: 'expired', name: '陈老板', role: '店主', desc: '登录已失效',            merchants: ['S31'], session: 'expired', perms: ALL },
  channel: { id: 'channel', name: '刘经理', role: '服务商一线', desc: '服务商人员，无商户数据授权', merchants: [], session: 'valid', perms: {}, channel: true },
};

// 交易（昨天）
export const TXNS = {
  S01: [
    { id: 'T0105-01', time: '11:42', amount: 1280.00, status: '交易成功' },
    { id: 'T0105-02', time: '19:08', amount: 1280.00, status: '交易成功' },
    { id: 'T0105-03', time: '20:15', amount: 88.00, status: '交易失败', reason: '持卡人银行退回' },
  ],
  S11: [{ id: 'T1105-01', time: '10:20', amount: 2300.00, status: '交易成功' }],
  S12: [{ id: 'T1205-01', time: '15:31', amount: 980.00, status: '交易成功' }],
  S13: [{ id: 'T1305-01', time: '09:12', amount: 4500.00, status: '交易成功' }],
  S21: [{ id: 'T2105-01', time: '13:00', amount: 600.00, status: '交易成功' }],
  S31: [{ id: 'T3105-01', time: '16:45', amount: 150.00, status: '交易成功' }],
};
export const SUMMARY = {
  S01: { amount: 3560.00, fee: 13.53, refund: 45.00, count: 42 },
  S11: { amount: 8650.00, fee: 32.87, refund: 0, count: 77 },
  S12: { amount: 5320.00, fee: 15.96, refund: 66.00, count: 51 },
  S13: { amount: 12400.00, fee: 47.12, refund: 120.00, count: 96 },
  S21: { amount: 2100.00, fee: 7.98, refund: 0, count: 18 },
  S31: { amount: 980.00, fee: 3.72, refund: 0, count: 9 },
};

// 结算（昨天交易对应的结算批次），status 由场景决定
export const SETTLEMENT_VARIANTS = {
  processing: { status: 'processing', label: '结算处理中', stage: '清算完成，等待出款', expected: null },
  paid_out:   { status: 'paid_out', label: '平台已出款', paidAt: '2026-11-06 09:30', bankConfirmed: false },
  returned:   { status: 'returned', label: '结算退回', reason: '结算卡户名与商户开户名不一致', displayable: true },
  conflict:   { status: 'conflict', label: '状态待核实', a: '平台已出款', b: '结算处理中' },
};
export const SETTLE_BASE = { date: YESTERDAY, txnAmount: 1200.00, payable: 1188.00 };
export const BREAKDOWN_VARIANTS = {
  full:     { txnAmount: 1200.00, arrived: 1188.00, items: [{ name: '手续费（费率 0.38%）', amount: 4.56 }, { name: '当日退款', amount: 7.44 }], explained: 12.00 },
  partial:  { txnAmount: 1200.00, arrived: 1188.00, items: [{ name: '手续费（费率 0.38%）', amount: 4.56 }, { name: '交易冲正', amount: 3.44 }], explained: 8.00 },
  mismatch: { txnAmount: 1200.00, arrived: 1188.00, items: [{ name: '手续费（费率 0.38%）', amount: 4.56 }], explained: 4.56, conflict: '结算系统应结算额 1,195.44 元，与实际到账 1,188.00 元不一致' },
};

export const ACCOUNT_STATUS = {
  S01: { status: 'normal' }, S11: { status: 'normal' }, S12: { status: 'normal' }, S13: { status: 'normal' }, S31: { status: 'normal' },
  S21: { status: 'frozen', since: '2026-11-04', reason: '风险审核', reasonDisplayable: true,
    required: '补充经营材料：营业执照、近期进货凭证', schedule: null, finalDecision: false },
};

// 知识库：只有"已发布"的条目进入正式服务
export const KNOWLEDGE = [
  { id: 'K-T1-v2', title: 'T+1 结算的含义', status: '已发布', version: 'v2', keys: ['T+1', 'T＋1'], must: ['下一个工作日', '顺延', '结算记录'],
    answer: 'T+1 指交易日（T）的下一个工作日完成结算；遇法定节假日顺延到下一个工作日。具体某一笔何时到账，以结算记录为准。' },
  { id: 'K-T1-v1', title: 'T+1 结算的含义（旧版）', status: '已发布', version: 'v1', keys: ['T+1', 'T＋1'], legacy: true,
    answer: 'T+1 指交易日的下一个自然日结算，节假日不顺延。' },
  { id: 'K-CARD', title: '更换结算卡', status: '已发布', version: 'v3', keys: ['结算卡', '换卡', '更换'],
    answer: '更换结算卡需要：①新卡户名与商户开户名一致；②准备新卡照片和法人身份证；③在 App「我的 - 结算信息 - 更换结算卡」提交，完成人脸验证。审核通过后生效，以页面显示的状态为准。', entry: '我的 - 结算信息 - 更换结算卡' },
  { id: 'K-FREEZE', title: '账户冻结是什么意思', status: '已发布', version: 'v2', keys: ['冻结'], must: ['风险审核', '资料待补充', '账户页面通知'],
    answer: '账户冻结是指因风险审核、资料待补充等原因，暂停结算或部分功能。冻结期间交易资金会保留，审核结束后按结论处理。具体原因以账户页面通知为准。' },
  { id: 'K-REVIEW', title: '风险审核时长', status: '已发布', version: 'v1', keys: ['审核', '多久'],
    answer: '材料齐全后，风险审核一般在 3-5 个工作日内完成，以审核结论为准。' },
  { id: 'K-FEE-DRAFT', title: '手续费调整说明（草稿）', status: '草稿', version: 'v1', keys: ['手续费'], answer: '（草稿，未发布）' },
];

export const HANDOFF = { queuePosition: 2 };
