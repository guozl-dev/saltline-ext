/* 决定性校验：原版主脚本 + 全部汉化替换表 === 当前主脚本 ? */
import fs from 'node:fs';
const orig = fs.readFileSync('E:/work/WorkBuddy_workplace/saltline_ref/index.html', 'utf8');
const mod = fs.readFileSync('E:/work/WorkBuddy_workplace/saltline_dev/index.html', 'utf8');
function mainScript(s) {
  const a = s.indexOf('<script>'), b = s.indexOf('</script>', a);
  return s.slice(a + 8, b);
}
/* 从 localize.mjs 源码中提取替换表（不执行其写文件逻辑） */
const src = fs.readFileSync('E:/work/WorkBuddy_workplace/saltline_dev/localize.mjs', 'utf8');
const m = src.match(/const T = \[([\s\S]*?)\n\];/);
if (!m) { console.log('FAIL: cannot extract T'); process.exit(1); }
const T = eval('[' + m[1] + ']');
/* 第二轮与后续人工补丁 */
const T2 = [
  ['<span class="comms-who">Control</span>', '<span class="comms-who">指挥部</span>', 1],
  ['o.message("Hauled out of the water",2.5)', 'o.message("已把你从水里拉了上来",2.5)', 1],
  ['o.message("Relays still live \\u2014 the boat will not wait under fire",3.5)', 'o.message("中继仍在运行——交火中船不会靠岸",3.5)', 1],
  ['>Settings<', '>设置<', 3],
  ['>Controls<', '>操作<', 3],
  ['<label id="l-fs">Display</label>', '<label id="l-fs">显示</label>', 1],
  ['<span>Off</span>', '<span>关</span>', 1],
  ['el.innerHTML+="<em>Weak point</em>"', 'el.innerHTML+="<em>弱点</em>"', 1],
];
let s = mainScript(orig);
let bad = 0;
for (const [f, r, want] of [...T, ...T2]) {
  const n = s.split(f).length - 1;
  if (n !== want) { console.log('COUNT MISMATCH', JSON.stringify(f.slice(0, 50)), 'found', n, 'want', want); bad++; continue; }
  s = s.split(f).join(r);
}
const B = mainScript(mod);
console.log('替换对:', T.length + T2.length, '计数不符:', bad);
console.log('重建主脚本 === 当前主脚本:', s === B);
if (s !== B) {
  let p = 0;
  while (p < s.length && p < B.length && s[p] === B[p]) p++;
  console.log('首个差异 @' + p, JSON.stringify(s.slice(p - 50, p + 80)), 'vs', JSON.stringify(B.slice(p - 50, p + 80)));
}
