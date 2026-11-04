#!/usr/bin/env node
/**
 * 校验 `.axsp` 项目包（H5 示例这类"脚本 + 页面 HTML"的多文件工程）。
 *
 * 背景：`.axs` 是单脚本文件，`examples/*.axs` 用 `validate-script.mjs` 就能校验；
 * 但 H5 运行前菜单需要项目清单（`project.json → runGate`）与页面文件（`ui/*.html`），
 * 只能打成 `.axsp`（zip）。本工具做三件事：
 *   1. 读 zip 中央目录（不依赖系统 unzip，Windows/macOS/Linux 一致）；
 *   2. 校验包内 `project.json` 能解析、`main.axs` 存在、`runGate.path` 指向的页面文件存在；
 *   3. 把 `main.axs` 抽到临时文件，复用 `validate-script.mjs` 的完整脚本校验。
 *
 * 用法：
 *   node tools/validate-axsp.mjs                     # 默认校验 tools/../examples 下全部 .axsp
 *   node tools/validate-axsp.mjs a.axsp b.axsp       # 指定文件
 *   node tools/validate-axsp.mjs examples/           # 指定目录
 *
 * 退出码：0 = 全部通过；1 = 有失败项或输入错误。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VALIDATOR = path.join(HERE, 'validate-script.mjs');

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/** 读 zip 中央目录，返回 { buf, entries: Map<name, {method, compSize, localOff}> } */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到 EOCD）');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('zip 中央目录损坏');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.set(name, { method, compSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 取出 zip 内某个条目（支持 store / deflate） */
function extractEntry(buf, entries, name) {
  const entry = entries.get(name);
  if (!entry) return null;
  const lh = entry.localOff;
  if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error(`zip 本地头损坏：${name}`);
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const start = lh + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`不支持的压缩方式 ${entry.method}：${name}`);
}

/** 收集要校验的 .axsp 文件 */
function collect(args) {
  if (args.length === 0) {
    const dir = path.join(HERE, '..', 'examples');
    if (!fs.existsSync(dir)) fail(`找不到默认 examples 目录：${dir}`);
    return fs.readdirSync(dir).filter((f) => f.endsWith('.axsp')).map((f) => path.join(dir, f));
  }
  const out = [];
  for (const a of args) {
    const p = path.resolve(a);
    if (!fs.existsSync(p)) fail(`路径不存在：${p}`);
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p)) {
        if (f.endsWith('.axsp')) out.push(path.join(p, f));
      }
    } else {
      out.push(p);
    }
  }
  return out;
}

const files = collect(process.argv.slice(2)).sort();
if (files.length === 0) fail('没找到任何 .axsp 文件');
if (!fs.existsSync(VALIDATOR)) fail(`找不到 validate-script.mjs：${VALIDATOR}`);

let bad = 0;
console.log(`=== 校验 .axsp 项目包（${files.length} 个）===`);
for (const file of files) {
  const label = path.basename(file);
  try {
    const buf = fs.readFileSync(file);
    const entries = readZip(buf);
    const projectRaw = extractEntry(buf, entries, 'project.json');
    if (!projectRaw) throw new Error('缺少 project.json');
    const project = JSON.parse(projectRaw.toString('utf8'));
    if (!project.id) throw new Error('project.json 缺 id');
    if (!project.main) throw new Error('project.json 缺 main');
    const mainRaw = extractEntry(buf, entries, project.main);
    if (!mainRaw) throw new Error(`缺少主脚本 ${project.main}`);
    const gate = project.runGate;
    if (gate) {
      if (!gate.path) throw new Error('runGate 缺 path');
      if (!entries.get(gate.path)) throw new Error(`runGate.path 指向的页面不存在：${gate.path}`);
    }
    // 复用脚本校验器
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axsp-'));
    const tmp = path.join(tmpDir, 'main.axs');
    fs.writeFileSync(tmp, mainRaw);
    try {
      execFileSync(process.execPath, [VALIDATOR, tmp], { stdio: 'pipe' });
    } catch (e) {
      const detail = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '');
      throw new Error(`主脚本校验失败：\n${detail.trim()}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    console.log(`✓ ${label}（project=${project.id}，${project.runGate ? 'H5 运行前菜单' : '普通项目'}）`);
  } catch (e) {
    bad++;
    console.error(`✗ ${label}：${e.message}`);
  }
}
if (bad > 0) {
  console.error(`\n✗ ${bad} 个项目包校验失败`);
  process.exit(1);
}
console.log(`\n✓ 全部 ${files.length} 个项目包校验通过`);
