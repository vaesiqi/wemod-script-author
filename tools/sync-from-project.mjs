#!/usr/bin/env node
/**
 * 维护者工具：把 WeMod 项目侧的技能包同步到本开源仓库。
 *
 * 背景：本仓库是项目内技能包的「对外发布版」，两边内容基本一致，差异是这里**移除**了
 * 抢票 / 抢单三个样例。项目侧改了 SKILL.md 或校验器后，在本仓库执行本脚本即可对齐，
 * 避免两份内容长期漂移（"新增动作忘了更新技能"那类问题的温床）。
 *
 * 会覆盖：SKILL.md、tools/validate-script.mjs，并镜像 examples/*.axs（排除抢购类样例）。
 * 不会碰：README*、LICENSE、.gitignore、.github/（这些是本仓库专属）。
 *
 * 用法：
 *   node tools/sync-from-project.mjs                 # 用默认项目路径
 *   node tools/sync-from-project.mjs --dry-run       # 只看会改什么
 *   node tools/sync-from-project.mjs --project <dir> # 指定技能包目录
 *
 * 退出码：0 = 成功（无论有无变更）；1 = 出错（源不存在 / 文档悬空引用 / 样例校验失败）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // 仓库根
const DEFAULT_PROJECT_SKILL = 'D:/wemod/wemod/.reasonix/skills/wemod-script-author';

/** 只在本仓库移除的样例（项目侧保留） */
const EXCLUDE = new Set([
  'ticket-grab-mtop-001.axs',
  'ticket-semi-protocol-001.axs',
  'grab-order-moving-001.axs',
]);

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const projectIdx = argv.indexOf('--project');
const projectSkill = path.resolve(projectIdx >= 0 ? argv[projectIdx + 1] : DEFAULT_PROJECT_SKILL);

const changes = [];
const notes = [];

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/** 统一行尾为 LF。
 *  源（项目仓库）与本仓库可能因各自的 core.autocrlf / .gitattributes 得到不同行尾，
 *  同一内容会出现「字节不同」的假变更，导致每次同步都全量 diff（LF/CRLF 反复横跳）。
 *  这里统一按 LF 归一化后再比较与写入，保证「内容相同 = 无变化」。 */
function normalizeNewlines(text) {
  return text.replace(/\r\n/g, '\n');
}

function copyIfChanged(src, dst, label) {
  const srcText = normalizeNewlines(fs.readFileSync(src, 'utf8'));
  const same = fs.existsSync(dst)
    ? normalizeNewlines(fs.readFileSync(dst, 'utf8')) === srcText
    : false;
  if (same) {
    notes.push(`= ${label}（无变化）`);
    return;
  }
  if (!dryRun) fs.writeFileSync(dst, srcText, 'utf8');
  changes.push(`${fs.existsSync(dst) ? '~' : '+'} ${label}`);
}

console.log('=== 从项目技能包同步到本仓库 ===');
console.log(`源目录 : ${projectSkill}`);
console.log(`本仓库 : ${HERE}`);
console.log(`模式   : ${dryRun ? 'DRY-RUN（不写文件）' : '实际写入'}`);
console.log('');

// 1) 源目录基本校验
for (const rel of ['SKILL.md', path.join('tools', 'validate-script.mjs')]) {
  if (!fs.existsSync(path.join(projectSkill, rel))) fail(`源目录缺少 ${rel}：${projectSkill}`);
}

// 2) 覆盖两个核心文件
copyIfChanged(path.join(projectSkill, 'SKILL.md'), path.join(HERE, 'SKILL.md'), 'SKILL.md');
copyIfChanged(
  path.join(projectSkill, 'tools', 'validate-script.mjs'),
  path.join(HERE, 'tools', 'validate-script.mjs'),
  'tools/validate-script.mjs',
);

// 3) 镜像 examples（排除抢购类；开源侧多余文件只提示不删除）
const srcExamples = path.join(projectSkill, 'examples');
const dstExamples = path.join(HERE, 'examples');
if (!fs.existsSync(srcExamples)) fail(`源目录缺少 examples/：${srcExamples}`);
if (!fs.existsSync(dstExamples) && !dryRun) fs.mkdirSync(dstExamples, { recursive: true });

const wanted = fs.readdirSync(srcExamples).filter((f) => f.endsWith('.axs') && !EXCLUDE.has(f));
const skipped = fs.readdirSync(srcExamples).filter((f) => f.endsWith('.axs') && EXCLUDE.has(f));
for (const f of wanted) {
  copyIfChanged(path.join(srcExamples, f), path.join(dstExamples, f), `examples/${f}`);
}
for (const f of skipped) notes.push(`- examples/${f}（按发布口径排除）`);

if (fs.existsSync(dstExamples)) {
  const extra = fs.readdirSync(dstExamples).filter((f) => f.endsWith('.axs') && !wanted.includes(f) && !EXCLUDE.has(f));
  for (const f of extra) notes.push(`! examples/${f} 在源侧已不存在（未自动删除，请人工确认）`);
}

// 4) 悬空引用自检：被排除的样例名不得出现在对外文档里
const docs = ['SKILL.md', 'README.md', 'README.en.md'].filter((f) => fs.existsSync(path.join(HERE, f)));
for (const doc of docs) {
  const text = fs.readFileSync(path.join(HERE, doc), 'utf8');
  for (const name of EXCLUDE) {
    if (text.includes(name)) fail(`${doc} 引用了被排除的样例「${name}」，会导致文档指向不存在的文件`);
  }
}
notes.push('✓ 对外文档无悬空引用');

// 5) 跑一遍全部样例校验（同步后必须仍全绿）
if (!dryRun) {
  const exampleFiles = fs.readdirSync(dstExamples).filter((f) => f.endsWith('.axs')).sort();
  if (exampleFiles.length < 6) fail(`examples 下样例少于 6 个（当前 ${exampleFiles.length} 个），疑似误删`);
  console.log('=== 校验全部样例 ===');
  let bad = 0;
  for (const f of exampleFiles) {
    try {
      execFileSync(process.execPath, [path.join(HERE, 'tools', 'validate-script.mjs'), path.join(dstExamples, f)], {
        stdio: 'pipe',
      });
      console.log(`  ✓ ${f}`);
    } catch (e) {
      bad += 1;
      console.log(`  ✗ ${f}`);
      console.log(String(e.stdout || e.stderr || e.message).trim().split('\n').slice(-4).join('\n'));
    }
  }
  if (bad > 0) fail(`${bad} 个样例未通过校验`);
  notes.push(`✓ ${exampleFiles.length} 个样例全部通过校验`);
}

console.log('');
console.log('=== 结果 ===');
for (const c of changes) console.log(`  ${c}`);
if (changes.length === 0) console.log('  （无文件变化，已是最新）');
for (const n of notes) console.log(`  ${n}`);
console.log('');
if (dryRun) {
  console.log('DRY-RUN 结束：未写入任何文件。去掉 --dry-run 即实际同步。');
} else if (changes.length > 0) {
  console.log('下一步：');
  console.log('  git add -A');
  console.log('  git commit -m "sync: 从项目技能包同步（SKILL.md / 校验器 / 样例）"');
} else {
  console.log('无需提交。');
}