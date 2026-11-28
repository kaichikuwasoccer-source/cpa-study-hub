const crypto = require('crypto');

const ALLOWED_ORIGINS = new Set(['https://cpa-study-hub.vercel.app']);
const LOCALHOST_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 8;
const rateLimitStore = new Map();

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin) || LOCALHOST_ORIGIN_RE.test(origin);
}

function setCorsHeaders(req, res) {
  const origin = req.headers?.origin || '';
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

function checkRateLimit(userKey) {
  const now = Date.now();
  const timestamps = (rateLimitStore.get(userKey) || []).filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateLimitStore.set(userKey, timestamps);
    return false;
  }
  timestamps.push(now);
  rateLimitStore.set(userKey, timestamps);
  if (rateLimitStore.size > 1000) {
    for (const [k, list] of rateLimitStore.entries()) {
      if (!list.some(ts => now - ts < RATE_LIMIT_WINDOW_MS)) rateLimitStore.delete(k);
    }
  }
  return true;
}

async function verifyGoogleAccessToken(authHeader) {
  const match = String(authHeader || '').match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return null;
  const accessToken = match[1];
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
    if (!res.ok) return null;
    const info = await res.json();
    const userId = info.sub || info.email || info.aud;
    if (!userId || Number(info.expires_in || 0) <= 0) return null;
    return crypto.createHash('sha256').update(String(userId)).digest('hex');
  } catch (_) {
    return null;
  }
}

function getPersonaInstruction(persona) {
  switch (persona) {
    case 'passionate':
      return 'あなたは「熱血伴走コーチ」です。受験生の努力を全力で肯定し、温かく前向きで背中を力強く押すトーンで語りかけてください。ただし根拠は必ず定量メトリクスの数値に基づいて具体的に示してください。';
    case 'spartan':
      return 'あなたは「スパルタ合格請負人」です。甘えを許さず、合格ボーダーから逆算したシビアかつ愛のある現実直視のトーンで端的に指摘してください。ただし人格否定は厳禁とし、必ず具体的な改善行動と数値を示してください。';
    case 'strategist':
    default:
      return 'あなたは「論理ストラテジスト」です。感情論を排し、ROI・確率・時間配分・相関データに基づき冷静かつ明晰な分析と最短合格戦略を提示してください。';
  }
}

function compactMetricsForPrompt(metricsReport, focusIds) {
  const metrics = metricsReport?.metrics || {};
  const list = [];
  const targetKeys = Array.isArray(focusIds) && focusIds.length
    ? focusIds
    : Object.keys(metrics);

  targetKeys.forEach(id => {
    const m = metrics[id];
    if (!m) return;
    if (m.status === 'insufficient_data') return;
    list.push({
      id: m.id,
      name: m.name,
      category: m.category,
      status: m.status,
      summary: m.summary,
      value: m.value,
      weight: m.weight ?? 1.0
    });
  });

  // フォーカス外でも要改善(warning/alert)の指標は最大5件追加
  if (Array.isArray(focusIds) && focusIds.length) {
    const set = new Set(focusIds);
    let extra = 0;
    for (const id of Object.keys(metrics)) {
      if (set.has(id) || extra >= 5) continue;
      const m = metrics[id];
      if (m && (m.status === 'alert' || m.status === 'warning')) {
        list.push({
          id: m.id,
          name: m.name,
          category: m.category,
          status: m.status,
          summary: m.summary,
          value: m.value,
          weight: m.weight ?? 1.0
        });
        extra++;
      }
    }
  }

  return list;
}

async function callGeminiJson(apiKey, prompt, temperature = 0.3) {
  const models = ['gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.0-flash'];
  const payload = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json'
    }
  });

  let lastStatus = 502;
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
      const json = await res.json();
      if (res.ok) {
        const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        return { parsed: JSON.parse(cleaned), model };
      }
      lastStatus = res.status;
    } catch (_) {
      // Try next fallback model
    }
  }
  const err = new Error(`AIコーチサービスで一時的なエラーが発生しました（HTTP ${lastStatus}）`);
  err.status = 502;
  throw err;
}

module.exports = async function handler(req, res) {
  const origin = req.headers?.origin || '';
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ status: 'error', message: '許可されていないオリジンからのリクエストです' });
  }
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
  }

  const hashedUserId = await verifyGoogleAccessToken(req.headers?.authorization || req.headers?.Authorization);
  if (!hashedUserId) {
    return res.status(401).json({
      status: 'error',
      message: 'GoogleアカウントでログインしてからAIコーチ機能をご利用ください（認証エラー）'
    });
  }

  if (!checkRateLimit(hashedUserId)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({
      status: 'error',
      message: 'リクエストが集中しています。1分ほど待ってから再度お試しください（上限：1分間8回）'
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      status: 'error',
      message: 'サーバー側の環境変数「GEMINI_API_KEY」が未設定です。'
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const action = String(body.action || 'analyze');
    const persona = String(body.persona || 'strategist');
    const coachProfile = body.coachProfile || {};
    const coachRole = String(body.coachRole || '公認会計士（CPA）試験の学習コーチ');

    if (action === 'evolve_profile') {
      const feedbackType = String(body.feedbackType || 'opinion');
      const metricId = String(body.metricId || '');
      const reasonChip = String(body.reasonChip || '');
      const userText = String(body.userText || '').slice(0, 600);
      const existingCustomCount = Array.isArray(coachProfile.custom_metrics) ? coachProfile.custom_metrics.length : 0;
      const nextCustomId = `M${56 + existingCustomCount}`;

      const evolvePrompt = [
        `あなたは${coachRole}のパーソナル設定最適化エンジンです。`,
        'ユーザーからのフィードバック・意見をもとに、パーソナルコーチ設定（coachProfile）を適切に更新してください。',
        '',
        '【現在のcoachProfile】',
        JSON.stringify(coachProfile).slice(0, 4000),
        '',
        '【ユーザーからのフィードバック】',
        `- 種別: ${feedbackType} (hit=刺さった, miss=外れ・事情あり, opinion=自由要望・指標追加リクエスト)`,
        `- 対象指標ID: ${metricId || 'なし（全般）'}`,
        `- 理由チップ: ${reasonChip || 'なし'}`,
        `- 自由記述: ${userText || 'なし'}`,
        '',
        '【更新ルール】',
        '1. feedbackTypeが "hit" で metricId がある場合: base_weights[metricId] を +0.2（最大2.0）に上げる。',
        '2. feedbackTypeが "miss" で metricId がある場合: base_weights[metricId] を -0.3（最小0.1、完全無視要望なら0）に下げ、理由を user_constraints に簡潔に追記する。',
        '3. ユーザーが固有の生活制約（例：「朝は仕事」「日曜は完全休養」「講義視聴期なので演習少なめは許容」等）を述べた場合、user_constraints に重複なく追加する。',
        `4. ユーザーが新しい観点や独自指標の追加を要望した場合のみ、custom_metrics に新しい指標オブジェクト（id: "${nextCustomId}"）を1件追加する。追加不要なら既存の custom_metrics を維持する。`,
        '5. 個人情報（氏名・学校名・メールアドレス等）は保存しない。',
        '',
        '【出力JSONスキーマ（JSONのみ）】',
        '{',
        '  "base_weights": { "M01": 1.2 },',
        '  "user_constraints": ["制約メモ1"],',
        '  "custom_metrics": [',
        '    {',
        `      "id": "${nextCustomId}",`,
        '      "name": "指標名",',
        '      "description": "何を測定するか",',
        '      "category": "custom",',
        '      "ruleType": "keyword_minutes" | "subject_min_ratio" | "timeband_focus" | "note_only",',
        '      "params": { "keyword": "", "subject": "", "targetMinutes": 60 },',
        '      "createdAt": "YYYY-MM-DD"',
        '    }',
        '  ],',
        '  "replyMessage": "ユーザーへの反映完了メッセージ（日本語・100文字以内）"',
        '}'
      ].join('\n');

      const { parsed, model } = await callGeminiJson(apiKey, evolvePrompt, 0.2);
      return res.status(200).json({
        status: 'ok',
        model,
        updatedProfile: {
          base_weights: parsed.base_weights || coachProfile.base_weights || {},
          user_constraints: Array.isArray(parsed.user_constraints) ? parsed.user_constraints.slice(0, 20) : (coachProfile.user_constraints || []),
          custom_metrics: Array.isArray(parsed.custom_metrics) ? parsed.custom_metrics.slice(0, 20) : (coachProfile.custom_metrics || [])
        },
        replyMessage: String(parsed.replyMessage || 'フィードバックをパーソナル設定に反映しました。')
      });
    }

    const metricsReport = body.metricsReport || {};
    const depth = String(body.depth || 'daily');
    const isLatestExam = action === 'latest_exam';

    const depthFocusMap = {
      daily: ['M01', 'M02', 'M03', 'M04', 'M05', 'M07', 'M08', 'M09', 'M10', 'M45', 'M53'],
      weekly: ['M06', 'M11', 'M12', 'M13', 'M14', 'M15', 'M16', 'M17', 'M18', 'M19', 'M20', 'M23', 'M25', 'M30', 'M31', 'M36', 'M42', 'M52'],
      monthly: ['M21', 'M22', 'M24', 'M26', 'M27', 'M28', 'M29', 'M32', 'M33', 'M34', 'M35', 'M44', 'M45', 'M46', 'M47', 'M48', 'M49', 'M50', 'M51', 'M54', 'M55'],
      latest_exam: ['M28', 'M29', 'M32', 'M34', 'M35', 'M37', 'M38', 'M39', 'M40', 'M41', 'M42', 'M43']
    };

    const focusIds = isLatestExam ? depthFocusMap.latest_exam : (depthFocusMap[depth] || depthFocusMap.daily);
    const compactMetrics = compactMetricsForPrompt(metricsReport, focusIds);
    const customMetrics = Array.isArray(metricsReport.customMetrics) ? metricsReport.customMetrics : [];

    const modeDescription = isLatestExam
      ? '【最新答練の緊急診断モード】直近の答練結果・誤答明細と直前2週間の学習ログを掛け合わせ、失点原因の特定と最優先復習アクションを提示する。'
      : depth === 'daily'
        ? '【毎日（ライト分析）モード】昨日の集中傾向・時間帯リズムから、今日やるべき最優先1アクションと短い励ましを簡潔に提示する。'
        : depth === 'weekly'
          ? '【週末（ミドル分析）モード】週間予実・学習内容比率（講義/テキスト/回転教材）・単元偏り・科目共食いを分析し、来週の時間配分案を提示する。'
          : '【月末（ディープ分析）モード】学習内容と偏差値の相関・ROI・タイムラグ・試験残り日数への適応度・スランプ予兆を深く分析する。';

    const latestExamBlock = isLatestExam && body.latestExamContext
      ? `\n【直近の答練データ】\n${JSON.stringify(body.latestExamContext).slice(0, 3000)}\n`
      : '';

    const analysisPrompt = [
      getPersonaInstruction(persona),
      `専門領域: ${coachRole}`,
      modeDescription,
      '',
      '【ユーザーの固有制約・好み（必ず尊重すること）】',
      JSON.stringify({
        user_constraints: coachProfile.user_constraints || [],
        base_weights: coachProfile.base_weights || {}
      }),
      '',
      '【計算済み定量メトリクス（M01〜M55の抜粋）】',
      JSON.stringify(compactMetrics).slice(0, 6000),
      customMetrics.length ? `\n【ユーザー追加カスタム指標】\n${JSON.stringify(customMetrics).slice(0, 1500)}` : '',
      latestExamBlock,
      '【基本コンテキスト】',
      JSON.stringify(metricsReport.overview || {}).slice(0, 1200),
      '',
      '【厳守事項】',
      '- 必ず提供されたメトリクスの具体的な数値・科目名を引用して助言すること。',
      '- base_weights が 0.5 以下の指標は控えめに扱うか省略し、1.2 以上の指標を優先すること。',
      '- strengths（強みの承認）を1〜2件、improvements（改善提案）を2〜3件生成すること。',
      '- improvements にはワンタップ実行ボタン用の actionType ("timer" | "calendar" | "review") と actionPayload を必ず設定すること。',
      '',
      '【出力JSONスキーマ（JSONのみ・マークダウン不要）】',
      '{',
      '  "headline": "30文字以内の見出し",',
      '  "summary": "全体サマリー（120〜200文字）",',
      '  "strengths": [',
      '    { "metricId": "M01", "title": "強みの見出し", "detail": "具体的数値を含む承認コメント" }',
      '  ],',
      '  "improvements": [',
      '    {',
      '      "metricId": "M04",',
      '      "priority": 1,',
      '      "badge": "時間帯最適化",',
      '      "title": "改善アクションの見出し",',
      '      "detail": "数値根拠と具体的な改善手順",',
      '      "actionType": "timer",',
      '      "actionLabel": "財務(計算) 45分タイマー開始",',
      '      "actionPayload": { "subject": "財務(計算)", "material": "短答問題集", "topic": "", "minutes": 45, "suggestedTime": "09:00" }',
      '    }',
      '  ],',
      '  "nextAction": "今すぐ取り組む最優先1アクション（60文字以内）"',
      '}'
    ].join('\n');

    const { parsed, model } = await callGeminiJson(apiKey, analysisPrompt, 0.35);
    return res.status(200).json({
      status: 'ok',
      model,
      mode: isLatestExam ? 'latest_exam' : depth,
      persona,
      analysis: {
        headline: String(parsed.headline || 'パーソナル学習診断'),
        summary: String(parsed.summary || ''),
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 3) : [],
        improvements: Array.isArray(parsed.improvements) ? parsed.improvements.slice(0, 4) : [],
        nextAction: String(parsed.nextAction || '')
      }
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      status: 'error',
      message: err.message || 'AIコーチ分析中にエラーが発生しました。'
    });
  }
};
