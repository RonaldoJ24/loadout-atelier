import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const ignored = new Set(['node_modules', '.git', 'coverage', 'playwright-report', 'test-results']);
const textExtensions = new Set([
  '',
  '.cjs',
  '.css',
  '.env',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);
const binaryArtifactExtensions = new Set(['.png', '.zip', '.tgz', '.gz']);
const localEnvFiles = [];

const rules = [
  { label: 'private key material', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  { label: 'provider-style secret', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  {
    label: 'assigned secret',
    pattern:
      /(?:DEEPSEEK_API_KEY|OPENAI_API_KEY|API_SECRET|CLIENT_SECRET)[ \t]*[:=][ \t]*["']?(?!<|\$\{|process\.env|[ \t]*(?:\r?\n|$))[A-Za-z0-9_./+=-]{12,}/i,
  },
  { label: 'bearer credential', pattern: /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/-]{16,}/i },
];

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry)) continue;
    const absolute = join(directory, entry);
    const info = statSync(absolute);
    if (info.isDirectory()) files.push(...walk(absolute));
    else if (directory === root && /^\.env(?:\.|$)/i.test(entry) && entry !== '.env.example') {
      // Local env files are expected to contain secrets, so never read them.
      // Verify below that Git ignores them; staged/history scans still catch
      // any credential that is accidentally added to version control.
      localEnvFiles.push(absolute);
    } else if (
      info.size <= 5_000_000 &&
      (textExtensions.has(extname(entry)) || binaryArtifactExtensions.has(extname(entry)))
    )
      files.push(absolute);
  }
  return files;
}

function inspect(label, content, findings) {
  for (const rule of rules) {
    if (rule.pattern.test(content)) findings.push(`${label}: ${rule.label}`);
  }
}

const findings = [];
for (const file of localEnvFiles) {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', file], {
      cwd: root,
      stdio: 'ignore',
    });
  } catch {
    findings.push(`${relative(root, file)}: local environment file is not ignored`);
  }
}
for (const file of walk(root)) {
  const extension = extname(file);
  const encoding = textExtensions.has(extension) ? 'utf8' : 'latin1';
  inspect(relative(root, file), readFileSync(file).toString(encoding), findings);
}

if (existsSync(join(root, '.git'))) {
  try {
    const staged = execFileSync('git', ['diff', '--cached', '--no-ext-diff'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    inspect('staged-diff', staged, findings);
  } catch {
    findings.push('staged-diff: unable to inspect');
  }
  try {
    const history = execFileSync('git', ['log', '-p', '--all', '--no-ext-diff'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    inspect('git-history', history, findings);
  } catch {
    findings.push('git-history: unable to inspect');
  }
}

if (findings.length > 0) {
  console.error('Secret scan failed (matched values are intentionally redacted):');
  for (const finding of [...new Set(findings)]) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(
    'Secret scan passed: working tree, staged diff, build/package artifacts, screenshots, and Git history contain no known credential patterns.',
  );
}
