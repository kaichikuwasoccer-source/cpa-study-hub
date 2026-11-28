const crypto = require('crypto');

const DEFAULT_GOOGLE_CLIENT_ID = '821337474921-neisfd7oa82qjmf2q7vghks2412arhau.apps.googleusercontent.com';
const ALLOWED_ORIGINS = new Set(['https://cpa-study-hub.vercel.app']);
const LOCALHOST_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const COOKIE_NAME = 'cpa_hub_rt';
const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30日間（1か月）

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin) || LOCALHOST_ORIGIN_RE.test(origin);
}

function setCorsHeaders(req, res) {
  const origin = req.headers?.origin || '';
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function isSecureRequest(req) {
  const proto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const host = String(req.headers?.host || '').toLowerCase();
  if (proto === 'https') return true;
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return false;
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
}

function getEncryptionKey() {
  const secret = process.env.AUTH_COOKIE_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
  if (!secret) return null;
  return crypto.createHash('sha256').update(`cpa-study-hub-rt-key:${secret}`).digest();
}

function encryptSession(payloadObj) {
  const key = getEncryptionKey();
  if (!key) throw new Error('ENCRYPTION_KEY_MISSING');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

function decryptSession(tokenStr) {
  const key = getEncryptionKey();
  if (!key || !tokenStr) return null;
  try {
    const buf = Buffer.from(tokenStr, 'base64url');
    if (buf.length < 29) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted);
  } catch (_) {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  String(cookieHeader).split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setRefreshCookie(req, res, value, maxAgeSec) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/api',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearRefreshCookie(req, res) {
  setRefreshCookie(req, res, '', 0);
}

function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body); } catch (_) { return null; }
  }
  return {};
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

  const body = parseJsonBody(req);
  if (!body) {
    return res.status(400).json({ status: 'error', message: '不正なJSONリクエストです' });
  }

  const action = String(body.action || '');
  const clientId = (process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID).trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();

  // ログアウト（Cookie削除＆リフレッシュトークン失効）
  if (action === 'logout') {
    const cookies = parseCookies(req.headers?.cookie);
    const session = decryptSession(cookies[COOKIE_NAME]);
    clearRefreshCookie(req, res);
    if (session?.rt) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(session.rt)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
      } catch (_) { }
    }
    return res.status(200).json({ status: 'ok' });
  }

  if (!clientSecret) {
    return res.status(503).json({
      status: 'error',
      code: 'MISSING_CLIENT_SECRET',
      message: 'サーバー側に GOOGLE_CLIENT_SECRET が未設定のため長期セッションを利用できません'
    });
  }

  // 認可コード → アクセストークン + リフレッシュトークン交換
  if (action === 'exchange') {
    const code = String(body.code || '').trim();
    if (!code) {
      return res.status(400).json({ status: 'error', message: '認可コードが指定されていません' });
    }

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: 'postmessage',
          grant_type: 'authorization_code'
        })
      });
      const tokenJson = await tokenRes.json();
      if (!tokenRes.ok || !tokenJson.access_token) {
        return res.status(400).json({
          status: 'error',
          code: tokenJson.error || 'TOKEN_EXCHANGE_FAILED',
          message: tokenJson.error_description || 'Googleトークンの交換に失敗しました'
        });
      }

      // リフレッシュトークンが返ってきた場合は30日間有効な暗号化HttpOnly Cookieに保存
      let hasRefreshToken = false;
      const existingCookies = parseCookies(req.headers?.cookie);
      const existingSession = decryptSession(existingCookies[COOKIE_NAME]);
      const refreshToken = tokenJson.refresh_token || existingSession?.rt || '';
      if (refreshToken) {
        const exp = Date.now() + SESSION_MAX_AGE_SEC * 1000;
        const encrypted = encryptSession({ rt: refreshToken, exp });
        setRefreshCookie(req, res, encrypted, SESSION_MAX_AGE_SEC);
        hasRefreshToken = true;
      }

      return res.status(200).json({
        status: 'ok',
        access_token: tokenJson.access_token,
        expires_in: Number(tokenJson.expires_in) || 3500,
        has_refresh_token: hasRefreshToken,
        session_days: 30
      });
    } catch (err) {
      return res.status(500).json({ status: 'error', message: err.message || '認証サーバー通信エラー' });
    }
  }

  // Cookie内のリフレッシュトークンを使ってサイレント更新
  if (action === 'refresh') {
    const cookies = parseCookies(req.headers?.cookie);
    const session = decryptSession(cookies[COOKIE_NAME]);
    if (!session || !session.rt) {
      return res.status(401).json({ status: 'error', code: 'NO_REFRESH_SESSION', message: '再ログインが必要です' });
    }
    if (session.exp && Date.now() > Number(session.exp)) {
      clearRefreshCookie(req, res);
      return res.status(401).json({ status: 'error', code: 'SESSION_EXPIRED', message: '長期セッションの有効期限（30日）が切れました' });
    }

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: session.rt,
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token'
        })
      });
      const tokenJson = await tokenRes.json();
      if (!tokenRes.ok || !tokenJson.access_token) {
        if (tokenJson.error === 'invalid_grant') {
          clearRefreshCookie(req, res);
        }
        return res.status(401).json({
          status: 'error',
          code: tokenJson.error || 'REFRESH_FAILED',
          message: tokenJson.error_description || 'アクセストークンの自動更新に失敗しました'
        });
      }

      // 新しいリフレッシュトークンが返った場合はCookieを更新（残存期限を維持）
      if (tokenJson.refresh_token) {
        const remainingSec = Math.max(60, Math.floor((Number(session.exp) - Date.now()) / 1000));
        const encrypted = encryptSession({ rt: tokenJson.refresh_token, exp: session.exp });
        setRefreshCookie(req, res, encrypted, remainingSec);
      }

      return res.status(200).json({
        status: 'ok',
        access_token: tokenJson.access_token,
        expires_in: Number(tokenJson.expires_in) || 3500
      });
    } catch (err) {
      return res.status(500).json({ status: 'error', message: err.message || '自動更新通信エラー' });
    }
  }

  return res.status(400).json({ status: 'error', message: '未対応のアクションです' });
};
