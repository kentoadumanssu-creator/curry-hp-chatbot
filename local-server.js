/**
 * ローカル開発用サーバー（予約リクエスト機能つき）
 * 使い方: node local-server.js
 * ブラウザで http://localhost:3000 を開いてください
 *
 * .env.local に以下を設定してください：
 *   ANTHROPIC_API_KEY    ... 必須
 *   GMAIL_USER            ... 予約メールの送信元 Gmail アドレス（任意・未設定なら送信をスキップしログのみ）
 *   GMAIL_APP_PASSWORD    ... 上記アカウントのアプリパスワード（任意）
 *   RESERVATION_TO_EMAIL  ... 予約リクエストの届け先メールアドレス（任意・未設定ならGMAIL_USER宛）
 *
 * システムプロンプトは system-prompt.txt、ツール定義は tools.json に分離しています。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
let nodemailer;
try { nodemailer = require('nodemailer'); } catch (e) { nodemailer = null; }

// .env.local から環境変数を読み込む
const env = {};
try {
  const content = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf-8');
  content.split('\n').forEach((line) => {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].trim();
  });
} catch (e) {}

const apiKey = env.ANTHROPIC_API_KEY || '';
if (!apiKey) {
  console.error('❌  .env.local に ANTHROPIC_API_KEY が見つかりません');
  process.exit(1);
}

if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
  console.warn('⚠️  GMAIL_USER / GMAIL_APP_PASSWORD が未設定です。予約メールは送信されず、ログ出力のみになります。');
}
if (!nodemailer) {
  console.warn('⚠️  nodemailer がインストールされていません（npm install を実行してください）。予約メールは送信されません。');
}

const PORT = 3000;
const PROMPT_PATH = path.join(__dirname, 'system-prompt.txt');
const TOOLS_PATH = path.join(__dirname, 'tools.json');

function buildSystemPrompt() {
  const today = new Date().toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
  const template = fs.readFileSync(PROMPT_PATH, 'utf-8');
  return template.replace('{{TODAY}}', today);
}

function loadTools() {
  return JSON.parse(fs.readFileSync(TOOLS_PATH, 'utf-8'));
}

async function sendReservationEmail(details) {
  if (!nodemailer || !env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
    console.warn('[予約メール未送信] 予約内容:', details);
    return { sent: false };
  }
  const to = env.RESERVATION_TO_EMAIL || env.GMAIL_USER;
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
  });
  await transporter.sendMail({
    from: `"spice curry cafe ARC 予約フォーム" <${env.GMAIL_USER}>`,
    to,
    replyTo: env.GMAIL_USER,
    subject: `【ご予約リクエスト】${details.name}様 ${details.date} ${details.time}〜 ${details.party_size}`,
    text: `大久保様

ホームページのチャットボット経由で、以下のご予約リクエストがありました。

------------------------------
お名前　　：${details.name}
ご希望日　：${details.date}
ご希望時間：${details.time}
人数　　　：${details.party_size}
電話番号　：${details.phone}
その他　　：${details.notes || 'なし'}
------------------------------`,
  });
  return { sent: true };
}

async function callClaude(messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: buildSystemPrompt(),
      tools: loadTools(),
      messages,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errText}`);
  }
  return res.json();
}

// ファイル配信
function serveFile(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (e) {
    res.writeHead(404);
    res.end('Not found');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'text/javascript',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  if (req.url === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const { messages } = JSON.parse(body);
        let convo = (messages || []).slice(-12).map((m) => ({ role: m.role, content: m.content }));

        let data = await callClaude(convo);

        let loops = 0;
        while (data.stop_reason === 'tool_use' && loops < 2) {
          loops++;
          const toolUseBlocks = data.content.filter((b) => b.type === 'tool_use');
          convo.push({ role: 'assistant', content: data.content });

          const toolResults = [];
          for (const block of toolUseBlocks) {
            if (block.name === 'submit_reservation') {
              const result = await sendReservationEmail(block.input);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: result.sent
                  ? '予約リクエストを店舗に送信しました。'
                  : '送信システムが未設定のため店舗への自動送信はできませんでした。お客様には後ほど店舗から確認の連絡が来る旨を伝えてください。',
              });
            } else {
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'unknown tool', is_error: true });
            }
          }
          convo.push({ role: 'user', content: toolResults });
          data = await callClaude(convo);
        }

        const textBlock = data.content?.find((b) => b.type === 'text');
        const reply = textBlock?.text ?? 'すみません、うまく回答できませんでした。';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reply }));
      } catch (e) {
        console.error('Server error:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(__dirname, urlPath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  serveFile(res, filePath, contentType);
});

server.listen(PORT, () => {
  console.log('');
  console.log('🌶️  ARC カフェ ローカルサーバー起動中');
  console.log(`   → http://localhost:${PORT} をブラウザで開いてください`);
  console.log('   停止: Ctrl+C');
  console.log('');

  const { exec } = require('child_process');
  exec(`start http://localhost:${PORT}`);
});
