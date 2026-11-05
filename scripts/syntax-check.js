import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const SCAN_DIRS = ['src', 'tests', 'scripts'];

const SECRET_PATTERNS = [
  { name: 'Discord Bot Token', regex: /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}/ },
  { name: 'GitHub Fine-grained PAT', regex: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'GitHub Classic Token', regex: /gh[pousr]_[A-Za-z0-9_]{20,}/ },
];

function collectJsFiles(dir) {
  const fullDir = path.join(ROOT, dir);
  if (!fs.existsSync(fullDir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    const fullPath = path.join(fullDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(path.relative(ROOT, fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Tính tổng độ dài ký tự của một Slash Command theo đúng quy tắc kiểm duyệt của Discord REST API v10 (tối đa 4.000 ký tự/lệnh).
 */
function measureDiscordNodeChars(node, breadcrumb) {
  if (!/^[a-z0-9_-]{1,32}$/.test(node.name)) {
    throw new Error(`Tên không hợp lệ tại ${breadcrumb}: "${node.name}"`);
  }
  if (!node.description || node.description.length > 100) {
    throw new Error(
      `Mô tả vượt 100 ký tự (${node.description?.length}) tại ${breadcrumb}`
    );
  }
  let total = node.name.length + node.description.length;

  if (Array.isArray(node.choices)) {
    if (node.choices.length > 25) {
      throw new Error(`Vượt quá 25 choices tại ${breadcrumb}`);
    }
    for (const ch of node.choices) {
      total += String(ch.name).length + String(ch.value).length;
    }
  }

  if (Array.isArray(node.options)) {
    if (node.options.length > 25) {
      throw new Error(
        `Vượt quá 25 options/subcommands (${node.options.length}) tại ${breadcrumb}`
      );
    }
    for (const opt of node.options) {
      total += measureDiscordNodeChars(opt, `${breadcrumb}.${opt.name}`);
    }
  }
  return total;
}

async function main() {
  console.log('🔍 [1/5] Kiểm tra cấu trúc dự án & cú pháp (node --check)...');
  const jsFiles = SCAN_DIRS.flatMap((d) => collectJsFiles(d));
  if (jsFiles.length === 0) {
    throw new Error('Không tìm thấy tệp mã nguồn JavaScript nào!');
  }

  for (const file of jsFiles) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
  console.log(`   ✅ Đã kiểm tra cú pháp thành công ${jsFiles.length} tệp .js.`);

  console.log('🔍 [2/5] Kiểm tra ES Modules import thực tế...');
  const srcFiles = collectJsFiles('src').filter(
    (f) => path.basename(f) !== 'index.js'
  );
  for (const file of srcFiles) {
    await import(pathToFileURL(file).href);
  }
  console.log(`   ✅ Tất cả ${srcFiles.length} module trong src/ đều import sạch không lỗi.`);

  console.log('🔍 [3/5] Xác thực quyền tối cao HARDCODED_OWNER_ID...');
  const { HARDCODED_OWNER_ID } = await import(
    pathToFileURL(path.join(ROOT, 'src/config/constants.js')).href
  );
  if (HARDCODED_OWNER_ID !== '1243061570247069696') {
    throw new Error(`HARDCODED_OWNER_ID sai lệch: ${HARDCODED_OWNER_ID}`);
  }
  console.log(`   ✅ HARDCODED_OWNER_ID cố định chuẩn xác: ${HARDCODED_OWNER_ID}`);

  console.log('🔍 [4/5] Kiểm duyệt chuẩn giới hạn Discord Slash Command API v10...');
  const { COMMAND_MAP, getSlashCommandsJSON } = await import(
    pathToFileURL(path.join(ROOT, 'src/commands/index.js')).href
  );
  const payload = getSlashCommandsJSON();
  if (payload.length > 100) {
    throw new Error(`Vượt quá 100 Global Commands của Discord (${payload.length})`);
  }

  const requiredNames = [
    'help', 'menu', 'balance', 'daily', 'weekly', 'monthly', 'pay', 'top',
    'history', 'work', 'beg', 'deposit', 'withdraw', 'interest',
    'baucua', 'taixiu', 'coinflip', 'guess', 'race', 'rps', 'noitu',
    'quest', 'shop', 'buy', 'inventory', 'use', 'sell', 'pet',
    'profile', 'rob', 'protect', 'bounty', 'wanted', 'event',
    'admin', 'owner', 'antispam',
  ];
  for (const req of requiredNames) {
    if (!COMMAND_MAP.has(req)) {
      throw new Error(`Thiếu Slash Command bắt buộc: /${req}`);
    }
  }

  let maxCmdChars = 0;
  let maxCmdName = '';
  for (const cmd of payload) {
    const chars = measureDiscordNodeChars(cmd, `/${cmd.name}`);
    if (chars > 4000) {
      throw new Error(
        `Lệnh /${cmd.name} vượt giới hạn 4.000 ký tự của Discord (${chars} ký tự)!`
      );
    }
    if (chars > maxCmdChars) {
      maxCmdChars = chars;
      maxCmdName = cmd.name;
    }
  }
  console.log(
    `   ✅ Đã kiểm duyệt ${payload.length} Slash Commands hợp lệ 100% (Lệnh lớn nhất /${maxCmdName}: ${maxCmdChars}/4000 ký tự).`
  );

  console.log('🔍 [5/5] Quét bảo mật chống lộ Token / Secrets trong mã nguồn...');
  const allFilesToScan = [
    ...jsFiles,
    path.join(ROOT, 'package.json'),
    path.join(ROOT, '.env.example'),
    path.join(ROOT, 'README.md'),
  ].filter((f) => fs.existsSync(f));

  for (const file of allFilesToScan) {
    if (path.basename(file) === 'syntax-check.js' || path.basename(file) === 'logger.js') {
      continue;
    }
    const content = fs.readFileSync(file, 'utf8');
    for (const pat of SECRET_PATTERNS) {
      if (pat.regex.test(content)) {
        throw new Error(
          `PHÁT HIỆN RÒ RỈ BÍ MẬT (${pat.name}) trong tệp: ${path.relative(ROOT, file)}`
        );
      }
    }
  }
  console.log('   ✅ Không phát hiện bất kỳ Token hoặc thông tin nhạy cảm nào bị lộ.');
  console.log('\n🎉 TOÀN BỘ KIỂM TRA HỆ THỐNG ĐỀU VƯỢT QUA XUẤT SẮC!');
}

main().catch((err) => {
  console.error('\n❌ KIỂM TRA THẤT BẠI:', err.message || err);
  process.exit(1);
});
