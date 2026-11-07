// 按场景跑完多轮对话，并按 expect 判定。
import { newSession, runTurn } from './agent.js';

export async function runCell(cell, { llm = null } = {}) {
  const s = newSession(cell.persona, cell.variant);
  const turns = [];
  for (const input of cell.turns) {
    const inp = typeof input === 'string' ? { text: input } : input;
    const r = await runTurn(s, inp, { llm });
    turns.push({ input: inp, ...r });
  }
  return { id: cell.id, turns, checks: check(cell, turns) };
}

export function check(cell, turns) {
  const fails = [];
  cell.expect.forEach((e, i) => {
    const t = turns[i]; if (!t) return fails.push(`第${i + 1}轮缺失`);
    const tr = t.trace, text = t.reply?.text || '';
    if (e.outcome && tr.outcome !== e.outcome) fails.push(`第${i + 1}轮出口应为「${e.outcome}」，实际「${tr.outcome}」`);
    if (e.task && tr.task !== e.task) fails.push(`第${i + 1}轮任务应为「${e.task}」，实际「${tr.task}」`);
    for (const k of e.includes || []) if (!text.includes(k)) fails.push(`第${i + 1}轮答复缺少「${k}」`);
    for (const k of e.excludes || []) if (text.includes(k)) fails.push(`第${i + 1}轮答复不应出现「${k}」`);
    if (e.card && t.reply?.card?.type !== e.card) fails.push(`第${i + 1}轮应出卡片 ${e.card}，实际 ${t.reply?.card?.type || '无'}`);
    if (e.tool && !tr.tools.some(x => x.tool === e.tool)) fails.push(`第${i + 1}轮应调用 ${e.tool}`);
    if (e.noTool && tr.tools.some(x => x.tool !== 'search_knowledge')) fails.push(`第${i + 1}轮不应调用业务工具`);
    if (e.noKnowledge && tr.tools.some(x => x.tool === 'search_knowledge')) fails.push(`第${i + 1}轮不应用知识库顶替`);
    if (e.failureTag && !tr.failureTag) fails.push(`第${i + 1}轮应标出失效归因`);
    if (e.handoffReason && !(tr.handoff?.reason || '').includes(e.handoffReason)) fails.push(`第${i + 1}轮交接原因应含「${e.handoffReason}」`);
    if (e.silent && !t.silent) fails.push(`第${i + 1}轮 AI 应停止回复`);
  });
  return fails;
}
