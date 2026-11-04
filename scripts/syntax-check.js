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

async function main() {
  console.log('🔍 [1/4] Kiểm tra cấu trúc dự án & cú pháp (node --check)...');
  const jsFiles = SCAN_DIRS.flatMap((d) => collectJsFiles(d));
  if (jsFiles.length === 0) {
    throw new Error('Không tìm thấy tệp mã nguồn JavaScript nào!');
  }

  for (const file of jsFiles) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
  console.log(`   ✅ Đã kiểm tra cú pháp thành công ${jsFiles.length} tệp .js.`);

  console.log('🔍 [2/4] Kiểm tra ES Modules import thực tế (trừ index.js khởi chạy trực tiếp)...');
  const srcFiles = collectJsFiles('src').filter(
    (f) => path.basename(f) !== 'index.js'
  );
  for (const file of srcFiles) {
    await import(pathToFileURL(file).href);
  }
  console.log(`   ✅ Tất cả ${srcFiles.length} module trong src/ đều import sạch không lỗi.`);

  console.log('🔍 [3/4] Kiểm tra định nghĩa Slash Command Discord API...');
  const { COMMAND_MAP, getSlashCommandsJSON } = await import(
    pathToFileURL(path.join(ROOT, 'src/commands/index.js')).href
  );
  if (!COMMAND_MAP.has('help') || !COMMAND_MAP.has('antispam')) {
    throw new Error('Thiếu lệnh gốc bắt buộc: /help hoặc /antispam');
  }
  const cmdJson = COMMAND_MAP.get('antispam').data.toJSON();
  const subNames = (cmdJson.options ?? []).map((o) => o.name);
  const expectedSubs = ['on', 'off', 'config', 'whitelist', 'logs', 'status', 'reset'];
  for (const reqSub of expectedSubs) {
    if (!subNames.includes(reqSub)) {
      throw new Error(`Thiếu Slash Subcommand bắt buộc: /antispam ${reqSub}`);
    }
  }
  console.log(
    `   ✅ Đã đăng ký ${getSlashCommandsJSON().length} lệnh gốc (/help, /antispam) kèm đầy đủ ${subNames.length} subcommands.`
  );

  console.log('🔍 [4/4] Quét bảo mật chống lộ Token / Secrets trong mã nguồn...');
  const allFilesToScan = [
    ...jsFiles,
    path.join(ROOT, 'package.json'),
    path.join(ROOT, '.env.example'),
    path.join(ROOT, 'README.md'),
  ].filter((f) => fs.existsSync(f));

  if (fs.existsSync(path.join(ROOT, '.env'))) {
    console.warn('   ⚠️ Phát hiện tệp .env cục bộ — đảm bảo .gitignore đã chặn commit.');
  }

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
  console.log('   ✅ Không phát hiện bất kỳ token hay thông tin nhạy cảm nào trong mã nguồn.');
  console.log('\n🎉 Toàn bộ kiểm tra cấu trúc, cú pháp, import và bảo mật đều ĐẠT 100%!');
}

main().catch((err) => {
  console.error('❌ Kiểm tra thất bại:', err);
  process.exit(1);
});
