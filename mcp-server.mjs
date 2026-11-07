#!/usr/bin/env node
// 把模拟业务系统的工具以 MCP（stdio，JSON-RPC 2.0）暴露出来，可接入任意支持 MCP 的客户端。
// 关键设计：工具参数里没有 merchant_id。商户身份来自服务端会话（这里用环境变量模拟登录态），
// 模型只能传日期、金额这类业务参数，无法通过改参数去查别人的商户。
//   MCP_ACCOUNT=owner|finance|cashier|frozen|expired|channel   MCP_STORE=滨江（多店账号指定门店）
import { createInterface } from 'node:readline';
import { ACCOUNTS, MERCHANTS } from './engine/data.js';
import { TOOL_DEFS, createToolbox } from './engine/tools.js';

const account = ACCOUNTS[process.env.MCP_ACCOUNT || 'owner'];
const toolbox = createToolbox({ account, variant: {} });
const store = process.env.MCP_STORE;
const merchantId = (store && account.merchants.find(m => MERCHANTS[m].alias === store)) || account.merchants[0] || null;

const schema = input => ({ type: 'object', properties: Object.fromEntries(Object.entries(input).map(([k, t]) => [k, { type: t.replace('?', '') }])),
  required: Object.entries(input).filter(([, t]) => !t.endsWith('?')).map(([k]) => k) });
const tools = TOOL_DEFS.map(t => ({ name: t.name, description: t.description, inputSchema: schema(t.input) }));

const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  let req; try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'demo-merchant-service', version: '1.0.0' } } });
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools } });
  if (method === 'tools/call') {
    if (account.session !== 'valid') return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: '登录态已失效，需重新验证' }) }] } });
    const r = toolbox.call(params.name, params.arguments || {}, { merchantId });
    return send({ jsonrpc: '2.0', id, result: { isError: r.status === 'error', content: [{ type: 'text', text: JSON.stringify(r) }] } });
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `未知方法 ${method}` } });
});
