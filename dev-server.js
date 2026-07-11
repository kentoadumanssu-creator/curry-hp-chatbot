/**
 * ローカル開発用サーバー（予約リクエスト機能つき）
 * 使い方: node dev-server.js
 * ブラウザで http://localhost:3000 を開いてください
 *
 * .env.local に以下を設定してください：
 *   ANTHROPIC_API_KEY    ... 必須
 *   GMAIL_USER            ... 予約メールの送信元 Gmail アドレス（任意・未設定なら送信をスキップしログのみ）
 *   GMAIL_APP_PASSWORD    ... 上記アカウントのアプリパスワード（任意）
 *   RESERVATION_TO_EMAIL  ... 予約リクエストの届け先メールアドレス（任意・未設定ならGMAIL_USER宛）
 */

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
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

function buildSystemPrompt() {
  const today = new Date().toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  return `あなたは「spice curry cafe ARC」の親切なスタッフAIです。
お客様からの質問に、温かく丁寧な日本語でお答えください。

【本日の日付】
${today}（日本時間）。予約の日程判断（土日祝かどうか、当日かどうか）はこの日付を基準にしてください。

【店舗情報】
- 店名：spice curry cafe ARC
- 住所：〒310-0912 茨城県水戸市見川2-50-24
- 電話：029-353-7713
- 営業時間：11:00〜21:00（ラストオーダー 20:30）
- 定休日：不定休（毎月のスケジュールはInstagramにて公開）
- 駐車場：あり
- 注文方法：スマートフォンよりご注文
- オープン：2025年7月

【メニューと料金】
1. スープカレー
   - トッピング（選択制）：炭火焼きチキン・塩角煮＆豚しゃぶ・鯖素揚げ・牡蠣と帆立など
   - 価格例：炭火焼きチキン 1,629円（スープ付き）
2. ARC カレー（スパイスカレー）
   - 店名を冠したシグネチャー。複数のスパイスが重なり合う奥深い一皿
3. キーマカレー
   - 旨味凝縮のキーマ。香り高いスパイスをじっくり練り込んだ食べ応えある一品
4. エビ＆ココナッツカレー（グリーンカレー）
   - ココナッツミルクのまろやかな甘みとスパイスの爽やかな刺激が調和
- ドリンク：コーヒー 220円 など

【料金オプション】
- ご飯の量：少なめ -50円（普通盛りは無料）
- 辛さ1〜3：無料
- 辛さ4〜8：追加料金あり（詳細は店舗にお問い合わせください）

【辛さレベル】
- 1〜8段階から選択可能
- 辛さ4以上は追加料金となります
- 初めての方・辛さ耐性が普通の方には2〜3辛がおすすめです

【コンセプト】
元看護師の店主が「食べる人の体と心を元気にしたい」という想いでスパイスの世界をゼロから学び開いたお店。
丁寧に選び抜いたスパイスと食材が織りなす、身体の芯から温まる本格スパイスカレーをご提供しています。

【SNS・最新情報】
Instagram: @spicecurrycafe_arc

【ご予約の受付について】
お客様から予約の希望があった場合は、あなたが直接リクエストを受け付けます。

■ 受付できない場合（必ず最初に確認してください）
・ご希望日が土曜・日曜・祝日の場合：チャットボットでの予約は受け付けできません。「あいにく土日祝はチャットボットでのご予約を承っておりません。恐れ入りますがお電話（029-353-7713）にてお問い合わせください」とご案内し、それ以上の情報収集や submit_reservation ツールの呼び出しは行わないでください。
・ご希望日が「本日」の場合：チャットボットでの予約は受け付けできません（予約は前日までの受付です）。「本日のご予約はチャットボットでは承っておりません。お急ぎの場合はお電話（029-353-7713）にご連絡ください」とご案内し、同様にツールは呼び出さないでください。
・上記のどちらにも当てはまらない場合（平日かつ翌日以降）のみ、通常どおり予約を受け付けてください。

■ 聞き取る情報
受付できる予約について、以下の項目を会話の中で確認してください。一度にまとめて聞いても、順番に聞いても構いません。
質問を提示するときは、長い文章を1つにつなげず、必ず改行して1項目ずつ見やすく箇条書きで聞いてください（「・」を使い、太字記号（**）は使わないこと）。例：

・ご希望日
・ご希望時間
・人数
・お名前
・当日連絡がつく電話番号
・アレルギーや席のご要望など（任意）

すべて揃ったら、内容を改行区切りで復唱してお客様に確認し、お客様が同意したときに限り submit_reservation ツールを呼び出してください。
情報が不足しているうちは絶対にツールを呼び出さないでください。

ツールを呼び出した後の返信では、これは「予約リクエスト」であり席の確保を保証するものではないこと、店舗から折り返し連絡があることを必ずお伝えください。

【回答のルール】
- 上記の情報にないことは「詳細はお電話（029-353-7713）またはInstagram（@spicecurrycafe_arc）でご確認ください」とご案内ください
- 料理の話題は楽しく、スパイスへの情熱を込めてお伝えください
- 回答は簡潔に、200文字以内を目安にしてください（予約内容の復唱確認時は必要な範囲で長くなって構いません）
- 強調したい語句には **（アスタリスク2つ）などのMarkdown記法を使わず、「」（かぎ括弧）で囲んでください。**太字**のような表記はそのまま画面に表示されてしまうため使用禁止です
- 項目を並べる場合は1文につなげず、必ず改行で区切って見やすくしてください`;
}

const TOOLS = [
  {
    name: 'submit_reservation',
    description:
      '予約に必要な情報（希望日・希望時間・人数・お名前・電話番号）がすべて揃い、お客様が内容を確認・同意したときにだけ呼び出してください。',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '予約者のお名前' },
        date: { type: 'string', description: 'ご希望日' },
        time: { type: 'string', description: 'ご希望時間' },
        party_size: { type: 'string', description: '人数' },
        phone: { type: 'string', description: '当日連絡のつく電話番号' },
        notes: { type: 'string', description: 'アレルギーや席の希望など（任意）' },
      },
      required: ['name', 'date', 'time', 'party_size', 'phone'],
    },
  },
];

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
      tools: TOOLS,
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
  // API エンドポイント
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
            