// 读取 recordings/ 里四轮评测结果，生成 docs/eval.html。页面上的数字全部来自录制文件，不手填。
import { readFileSync, writeFileSync } from 'node:fs';

const load = v => JSON.parse(readFileSync(`recordings/eval-qwen-plus-${v}.json`, 'utf8'));
const V = { v1: load('v1'), v2: load('v2'), v3: load('v3'), v4: load('v4') };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tone = d => d.cells.reduce((n, c) => n + c.runs.reduce((m, r) => m + r.turns.filter(t => t.polishedRaw && /[～~]|[哦哈啦]/.test(t.polishedRaw)).length, 0), 0);
const same = d => d.cells.filter(c => new Set(c.runs.map(r => JSON.stringify(r.turns.map(t => t.text)))).size === 1).length;
const avgMs = d => { const a = d.cells.flatMap(c => c.runs.map(r => r.ms)); return Math.round(a.reduce((x, y) => x + y, 0) / a.length / 100) / 10; };
const turn = (d, id, i = 0, k = 0) => d.cells.find(c => c.id === id).runs[k].turns[i];
const S = v => V[v].summary, N = V.v4.cells.length, R = V.v4.meta.runs;
const model = V.v4.meta.model;

const ROUNDS = [
  ['v1', '第 1 轮', '初始版本', '—'],
  ['v2', '第 2 轮', '路由按"任务 + 领域"兜底；答复校验改为"事实 + 边界"，允许同义说法；改写提示词加约束', '系统'],
  ['v3', '第 3 轮', '评测判定与答复校验共用一份同义说法清单。本轮答复校验的修改没有生效（文件未同步），实际验证的是"第 2 轮的系统 + 修正后的判定"', '判定'],
  ['v4', '第 4 轮', '第 3 轮的修改全部生效，补全同义说法清单', '系统'],
];
const row = ([v, name, what, kind]) => {
  const s = S(v);
  return `<tr><td style="white-space:nowrap"><b>${name}</b></td><td class="what">${kind === '—' ? '' : `<i class="tag ${kind === '系统' ? 't-info' : 't-warn'}">改${kind}</i> `}${what}</td>
<td class="n">${s.runPass}/${s.runTotal}</td><td class="n">${s.passK}/${N}</td><td class="n">${s.polishKept}/${s.polishTried}</td><td class="n">${s.polishBlocked}</td><td class="n">${tone(V[v])}</td></tr>`;
};
const pair = (label1, t1, label2, t2, cls = '') => `<div class="pair ${cls}"><div><span>${label1}</span>${esc(t1)}</div><div><span>${label2}</span>${esc(t2)}</div></div>`;

const c6 = turn(V.v1, '6c'), c6b = turn(V.v4, '6c');
const c5 = turn(V.v4, '5c', 0);
const g1 = turn(V.v1, '6b'), g2 = turn(V.v1, '5b');
const s1 = S('v1'), s4 = S('v4');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI 客服评测：让真的大模型来答，它答得对吗？</title>
<style>
:root{--brand:#3d63f5;--brand-ink:#2340b8;--brand-soft:#e9eeff;--ink:#1b2130;--ink2:#535c70;--ink3:#9098a9;--line:#e8eaf0;--page:#f2f3f7;
--ok:#11905f;--ok-soft:#e5f5ee;--info:#2f63d8;--info-soft:#e8efff;--warn:#b86e00;--warn-soft:#fff3df;--bad:#cf3434;--bad-soft:#fdeceb}
*{box-sizing:border-box;margin:0;padding:0}
body{font:15px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;color:var(--ink);background:var(--page);-webkit-font-smoothing:antialiased}
a{color:var(--brand-ink);text-decoration:none}a:hover{text-decoration:underline}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.tag{font-style:normal;display:inline-block;font-size:11px;line-height:18px;padding:0 7px;border-radius:5px;white-space:nowrap;vertical-align:1px}
.t-ok{background:var(--ok-soft);color:var(--ok)}.t-info{background:var(--info-soft);color:var(--info)}.t-warn{background:var(--warn-soft);color:var(--warn)}.t-bad{background:var(--bad-soft);color:var(--bad)}
.top{position:sticky;top:0;z-index:40;background:rgba(242,243,247,.86);backdrop-filter:saturate(1.4) blur(10px);-webkit-backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid rgba(20,30,60,.06)}
.top-in{max-width:860px;margin:0 auto;height:56px;padding:0 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.me-name{font-size:16px;font-weight:700;letter-spacing:.5px;color:var(--ink);display:flex;align-items:baseline;gap:10px}
.me-name span{font-size:12.5px;font-weight:400;color:var(--ink3);letter-spacing:0}
.top-r{font-size:13px;color:var(--ink2);display:flex;align-items:center;gap:14px}
.mail{color:var(--ink);cursor:pointer;user-select:all}
.cp{font-size:12px;border:1px solid var(--line);border-radius:14px;padding:2px 10px;background:#fff;color:var(--ink2);margin-left:6px}
main{max-width:860px;margin:0 auto;padding:0 20px 40px}
.hero{padding:52px 0 0}
.hero h1{font-size:34px;line-height:1.3;font-weight:700;letter-spacing:.5px}
.hero p{font-size:16px;color:var(--ink2);margin-top:14px}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0 6px}
.stat{flex:1 1 180px;background:#fff;border-radius:14px;padding:16px 18px}
.stat b{display:block;white-space:nowrap;font-size:23px;line-height:1.2;font-weight:650;font-variant-numeric:tabular-nums}
.stat span{font-size:12.5px;color:var(--ink2)}
.stat.warn b{color:var(--warn)}
h2{font-size:21px;font-weight:650;margin:44px 0 12px}
h3{font-size:16px;font-weight:650;margin:26px 0 8px}
p{margin:10px 0}ul{margin:10px 0 10px 22px}li{margin:5px 0}
.card{background:#fff;border-radius:14px;padding:6px 18px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13.5px;min-width:640px}
th{font-weight:500;color:var(--ink3);font-size:12px;text-align:left;padding:12px 8px 8px;white-space:nowrap}
td{padding:11px 8px;border-top:1px solid var(--line);vertical-align:top}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.what{color:var(--ink2);line-height:1.6}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}
.pair>div{background:#fff;border-radius:12px;padding:12px 14px;font-size:13.5px;line-height:1.65;white-space:pre-wrap;border-left:3px solid var(--line)}
.pair>div span{display:block;font-size:11.5px;color:var(--ink3);margin-bottom:4px}
.pair.bad>div:last-child,.pair.good>div:first-child{border-left-color:var(--bad)}.pair.good>div:last-child{border-left-color:var(--ok)}.pair.warn>div:last-child{border-left-color:var(--warn)}
.q{font-size:13.5px;color:var(--ink2);margin:14px 0 -4px}
.note{background:var(--warn-soft);border-radius:12px;padding:12px 16px;font-size:14px;margin:14px 0}
.ft{max-width:860px;margin:0 auto;padding:14px 20px 40px;font-size:12px;color:var(--ink3);border-top:1px solid rgba(20,30,60,.06)}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:22px 0 4px}
.steps>div{background:#fff;border-radius:14px;padding:16px 18px}
.steps i{font-style:normal;display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--brand-soft);color:var(--brand-ink);font-size:13px;font-weight:600;margin-bottom:8px}
.steps b{display:block;font-size:15.5px;margin-bottom:4px}
.steps span{font-size:13.5px;color:var(--ink2);line-height:1.65;display:block}
details{margin-top:44px;background:rgba(255,255,255,.55);border-radius:14px;padding:4px 20px 8px}
summary{cursor:pointer;font-weight:600;font-size:15px;padding:14px 0;color:var(--brand-ink)}
details[open] summary{border-bottom:1px solid var(--line);margin-bottom:4px}
details .card,details .pair>div{background:#fff}
.q b{color:var(--ink);font-size:16px}
@media(max-width:640px){.steps{grid-template-columns:1fr}.hero h1{font-size:26px}.pair{grid-template-columns:1fr}.me-name span{display:none}}
</style>
</head>
<body>
<nav class="top"><div class="top-in"><a class="me-name" href="./">三桥君<span>AI 产品经理 · 作品</span></a><div class="top-r"><a href="./">← 对话演示</a><span class="mailbox"></span></div></div></nav>
<main>
<header class="hero">
<h1>把剧本拿掉，让真的 AI 来答，它答得对吗？</h1>
<p><a href="./">对话演示</a>里 AI 客服的每句回答都是提前写好的。这一页记录的是另一件事：我接上真实的大模型（${esc(model)}），让它自己回答，再检查它答得对不对。</p>
</header>

<div class="steps">
<div><i>1</i><b>出 ${N} 道题</b><span>每道题是一种商户情况：问冻结原因、收银员想查老板才能看的数据、系统超时、知识库说法打架……每道题事先写好"正确做法"。</span></div>
<div><i>2</i><b>每道题让 AI 答 ${R} 遍</b><span>一共 ${s4.runTotal} 次。同一道题答 ${R} 遍，是为了看它会不会时对时错。</span></div>
<div><i>3</i><b>程序判卷，错了就改，改完再考</b><span>这样考了 4 轮。全对之后，我又把 AI 的回答人工读了一遍。</span></div>
</div>

<h2>先看一个例子</h2>
<p class="q">商户问：<b>"我的账户为什么被冻结？"</b></p>
${pair('第 1 轮，AI 的回答（答非所问）', c6.text, '改完之后，AI 的回答', c6b.text, 'good')}
<p>商户问的是冻结，AI 答的是到账差额，${R} 遍都错，而且是当作正常回答发出去的。这种错在照剧本演的演示里永远发现不了，只有接上真的 AI 才会暴露。</p>
<p><b>为什么会错：</b>AI 把这句话理解成"想知道一件事的原因"，这个理解本身没毛病。但系统里"问原因"这一类只接了"解释到账差额"一条流程，于是把冻结的问题送进了差额的流程。</p>
<p><b>怎么改的：</b>没有去教 AI "这句话应该归到哪一类"，因为它的归类会随问法变化，靠不住。改的是系统的分流规则：同时看"想做什么"和"问的是哪块业务"，凡是账户方面的"为什么"，一律去查账户原因。AI 怎么归类，都会走到对的流程上。</p>

<h2>结果</h2>
<div class="stats">
<div class="stat"><b>${s1.runPass} → ${s4.runPass}</b><span>${s4.runTotal} 次回答里答对的次数，第 1 轮到第 4 轮</span></div>
<div class="stat"><b>${s1.polishBlocked} → ${s4.polishBlocked}</b><span>AI 把话说得更自然时，被安全检查误拦的次数（共 ${s4.polishTried} 次）</span></div>
<div class="stat warn"><b>1 处</b><span>程序判卷全对之后，人工读一遍仍然发现的问题</span></div>
</div>

<h2>我从这次评测里得到的三点</h2>
<h3>1. 真问题要接上真的 AI 才测得出来</h3>
<p>上面"答非所问"的例子就是。规则写得再细，也要让真模型跑一遍，才知道它会把什么问题送到哪里去。</p>

<h3>2. 程序判卷全对，不等于没有问题</h3>
<p>第 4 轮 ${s4.runPass}/${s4.runTotal} 全对。我没有就此打住，把 AI 的回答逐条读了一遍，发现有一句意思变了：</p>
${pair('系统原本要说的话', c5.template, 'AI 改写后的话', c5.text, 'bad')}
<p>原话是请商户确认，改写后读起来像申请已经受理了。程序只检查"确认"这个词在不在，词还在，就放行了。<b>改法：</b>请商户确认的话不再让 AI 改写，直接用原话。这类话改写的好处很小，出错的代价很大。</p>

<h3>3. 判卷标准自己也会出错</h3>
<p>第 2 轮答对的次数从 ${S('v1').runPass} 掉到 ${S('v2').runPass}，看起来像越改越差。实际是 AI 把"我不能直接解冻"说成了"我无法直接解冻"，意思一样，安全检查放行了，判卷程序却还在逐字找"不能"两个字。我把两处改成共用一份标准后，这 ${S('v2').runTotal - S('v2').runPass} 次都判回了正确。所以这部分答对次数的回升，不能算 AI 变好了，只是判卷变准了。</p>

<details>
<summary>展开看细节：四轮各改了什么、误拦的例子、这次评测的局限</summary>

<h3>系统是怎么分工的</h3>
<ul>
<li><b>规则说了算的：</b>身份、权限、查不查数据、转不转人工、金额和状态。</li>
<li><b>大模型只做两件事：</b>理解商户想要什么；把系统生成的回答改写得更自然。</li>
<li><b>安全检查：</b>改写后的话发出前要检查一遍（金额和状态没被改、没有擅自承诺、没有索要密码），不通过就退回系统原话。</li>
</ul>

<h3>四轮结果</h3>
<div class="card"><table>
<tr><th>轮次</th><th>这一轮改了什么</th><th class="n">答对次数</th><th class="n">${R} 遍都对的题</th><th class="n">改写被采用</th><th class="n">被安全检查拦下</th><th class="n">出现"哦、哈、～"</th></tr>
${ROUNDS.map(row).join('\n')}
</table></div>
<p class="q">"改系统"指改了被测的系统或给模型的指令；"改判定"指只改了判卷程序。规则模式（不接模型）作为基线，${V.v4.rules.pass}/${V.v4.rules.total} 通过。每轮约 ${Math.round(V.v4.meta.tokens / 1000)}K tokens，平均每次约 ${avgMs(V.v4)} 秒。</p>

<h3>安全检查误拦的例子</h3>
<p>第 1 轮 ${s1.polishTried} 次改写里有 ${s1.polishBlocked} 次被拦，大部分其实没问题。被拦后退回原话，回答是对的，只是生硬。</p>
${pair('系统原话', g1.template, '被拦下的改写（理由：' + g1.guardReasons.join('；') + '）', g1.polishedRaw, 'warn')}
${pair('系统原话', g2.template.split('\n')[0], '被拦下的改写（理由：' + g2.guardReasons.join('；') + '）', g2.polishedRaw.split('\n')[0], 'warn')}
<p><b>改法：</b>必须保留的内容从"原话"改为"事实和底线"。金额、状态、原因、办理路径一个字不能改；"不能 / 无法"这类表达底线的说法允许换同义词；日期按数值比较。同时要求模型不用"哦、哈、啦、～"，出现次数从 ${tone(V.v1)} 降到 ${tone(V.v4)}。</p>

<h3>这次评测的局限</h3>
<ul>
<li><b>判卷靠找关键词。</b>同义词补不完，意思变了也未必拦得住。全对只说明"没有触发已知的检查"。</li>
<li><b>题是我自己出的。</b>${N} 道题和系统出自同一人，问法固定。真实商户会用方言、错别字、一句话问两件事，这些没有覆盖。</li>
<li><b>答 ${R} 遍的信息量有限。</b>模型很稳定，第 4 轮有 ${same(V.v4)}/${N} 道题 ${R} 遍回答一字不差。要测稳定性，应该换着问法问。</li>
<li><b>只测了一个模型，数据是虚构的。</b>换模型结论可能不同；没有真实流量，测不出延迟和并发。</li>
</ul>

<h3>下一步</h3>
<ul>
<li>加一层"意思有没有变"的判断，用第二个模型或人工抽检，和关键词检查一起用。</li>
<li>每道题补 5 到 10 种问法。</li>
<li>换一个模型重跑。</li>
</ul>

<h3>可复现</h3>
<p>评测脚本、四轮的原始结果和系统代码都在<a href="https://github.com/sanqiaojun/merchant-service-ai-demo">代码仓库</a>里。本页的数字由脚本从原始结果生成，不手填。</p>
</details>
</main>
<footer class="ft">评测时间 ${V.v1.meta.startedAt.slice(0, 10)}，模型 ${esc(model)}。品牌、商户与数据均为虚构，不代表任何线上系统。　© 2026 三桥君</footer>
<script>
const ML = ['conforest616', 'gmail.com'].join('@');
function copyText(t) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
  return new Promise((ok, no) => { const a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;opacity:0'; document.body.append(a); a.select(); try { document.execCommand('copy') ? ok() : no(); } catch (e) { no(e); } a.remove(); });
}
document.querySelectorAll('.mailbox').forEach(el => {
  el.innerHTML = '<span class="mail" title="点击复制">' + ML + '</span><button class="cp">复制</button>';
  const go = () => { const b = el.querySelector('.cp'); copyText(ML).then(() => { b.textContent = '已复制'; }, () => { b.textContent = '请手动复制'; }); setTimeout(() => b.textContent = '复制', 2000); };
  el.querySelector('.mail').onclick = go; el.querySelector('.cp').onclick = go;
});
</script>
</body>
</html>
`;
writeFileSync('docs/eval.html', html);
console.log(`已生成 docs/eval.html（${Math.round(html.length / 1024)} KB）`);
