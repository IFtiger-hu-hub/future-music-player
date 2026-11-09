import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawn, execSync } from 'node:child_process';
import type { Plugin } from 'vite';

const AUTHORIZE_ENDPOINT = 'https://oauth-login.platform.hicloud.com/oauth2/v3/authorize';
const TOKEN_ENDPOINT = 'https://oauth-login.cloud.huawei.com/oauth2/v3/token';
const MUSIC_ENDPOINT = 'https://api-drcn.music.dbankcloud.cn';
const CLIENT_ID = '101444301';
const REDIRECT_URI = 'hms://redirect_uri';

export interface StoredHuaweiSession {
  token: string;
  snsUserID: string;
  expireTime: string;
  updatedAt: string;
}

export interface ParsedLyricWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface ParsedLyricLine {
  timeMs: number;
  endMs: number;
  text: string;
  romanization?: string;
  translation?: string;
  words?: ParsedLyricWord[];
}

const SESSION_FILE = path.resolve(process.cwd(), '.local/huawei-session.json');
const TINGLAN_CONFIG_DIR = path.join(os.homedir(), '.config/tinglan/native-v1');

function randomUrlSafe(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256Base64Url(input: string): string {
  return crypto.createHash('sha256').update(input).digest('base64url');
}

function buildMusicDigestHeader(token: string): string {
  const nonce = randomUrlSafe(24);
  const created = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  let header = `Digest username=app-music-baseline, nonce=${nonce}, created=${created}`;
  if (token) {
    header += `, token=${token}`;
  }
  return header;
}

export function isSafeHuaweiResourceUrl(raw: string): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    if (u.port && u.port !== '443') return false;
    const host = u.hostname.toLowerCase();
    return ['.dbankcdn.cn', '.tingmall.com', '.kuke.com'].some(
      (suffix) => host.endsWith(suffix) && host.length > suffix.length
    );
  } catch {
    return false;
  }
}

/**
 * Attempts to load a valid Huawei Music session from:
 * 1. `.local/huawei-session.json` in workspace
 * 2. `~/.config/tinglan/native-v1/secrets.local.json` (AES-256-GCM encrypted plugin vault)
 * 3. `~/.config/tinglan/native-v1/session.local.json` (AES-256-GCM encrypted host vault)
 */
function loadPersistedSession(): StoredHuaweiSession | null {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
      if (raw && raw.token && raw.snsUserID) return raw;
    }
  } catch {
    // ignore
  }

  // Fallback 1: Decrypt from ~/.config/tinglan/native-v1/secrets.local.json
  try {
    const secretsPath = path.join(TINGLAN_CONFIG_DIR, 'secrets.local.json');
    if (fs.existsSync(secretsPath)) {
      const raw = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
      const b64Blob = raw?.data?.['plugin.session.huawei'];
      if (raw?.version === 1 && raw?.key && b64Blob) {
        const key = Buffer.from(raw.key, 'base64');
        const blob = Buffer.from(b64Blob, 'base64');
        const nonce = blob.subarray(0, 12);
        const tag = blob.subarray(blob.length - 16);
        const ct = blob.subarray(12, blob.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(tag);
        decipher.setAAD(Buffer.from('hwmusic-viva-secret-v1:plugin.session.huawei'));
        const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
        const doc = JSON.parse(plain);
        const entries = Object.values(doc?.entries || {}) as Array<{ value?: string }>;
        for (const entry of entries) {
          if (!entry?.value) continue;
          let decodedStr = entry.value;
          if (!decodedStr.trim().startsWith('{')) {
            decodedStr = Buffer.from(decodedStr, 'base64').toString('utf-8');
          }
          const sessObj = JSON.parse(decodedStr);
          if (sessObj?.token && (sessObj?.userID || sessObj?.snsUserID)) {
            const session: StoredHuaweiSession = {
              token: sessObj.token,
              snsUserID: sessObj.userID || sessObj.snsUserID,
              expireTime: sessObj.expires || sessObj.expireTime || '',
              updatedAt: new Date().toISOString(),
            };
            savePersistedSession(session);
            return session;
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // Fallback 2: Decrypt from ~/.config/tinglan/native-v1/session.local.json
  try {
    const sessionLocalPath = path.join(TINGLAN_CONFIG_DIR, 'session.local.json');
    if (fs.existsSync(sessionLocalPath)) {
      const raw = JSON.parse(fs.readFileSync(sessionLocalPath, 'utf-8'));
      if (raw?.version === 1 && raw?.key && raw?.data) {
        const key = Buffer.from(raw.key, 'base64');
        const blob = Buffer.from(raw.data, 'base64');
        const nonce = blob.subarray(0, 12);
        const tag = blob.subarray(blob.length - 16);
        const ct = blob.subarray(12, blob.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(tag);
        decipher.setAAD(Buffer.from('hwmusic-viva-session-v1'));
        const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
        const doc = JSON.parse(plain);
        if (doc?.Token && doc?.User) {
          const session: StoredHuaweiSession = {
            token: doc.Token,
            snsUserID: doc.User,
            expireTime: doc.Expiry || '',
            updatedAt: new Date().toISOString(),
          };
          savePersistedSession(session);
          return session;
        }
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function savePersistedSession(session: StoredHuaweiSession) {
  const dir = path.dirname(SESSION_FILE);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
}

function findChromiumBinary(): string | null {
  for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    try {
      const p = execSync(`which ${name}`, { encoding: 'utf-8' }).trim();
      if (p) return p;
    } catch {
      // continue
    }
  }
  return null;
}

function isCallbackUrl(raw: string): boolean {
  if (!raw || raw.includes('#')) return false;
  try {
    const u = new URL(raw);
    return (
      u.protocol.toLowerCase() === 'hms:' &&
      (u.hostname.toLowerCase() === 'redirect_uri' || u.pathname.startsWith('//redirect_uri'))
    );
  } catch {
    return raw.toLowerCase().startsWith('hms://redirect_uri');
  }
}

/**
 * Spawns an isolated Chromium/Chrome window via CDP, navigates to Huawei's OAuth2 PKCE page,
 * intercepts `hms://redirect_uri?code=...&state=...` automatically and closes the window cleanly.
 */
async function captureHuaweiOAuthViaCDP(authorizeUrl: string): Promise<string> {
  const binary = findChromiumBinary();
  if (!binary) {
    throw new Error('未检测到本机 Chrome / Chromium / Edge 浏览器');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'future-hw-auth-'));
  const args = [
    `--user-data-dir=${tmpDir}`,
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    '--window-size=520,700',
    `--app=${authorizeUrl}`,
  ];

  const proc = spawn(binary, args, { stdio: 'ignore' });

  const cleanup = () => {
    try {
      proc.kill('SIGTERM');
    } catch {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  };

  try {
    let port = '';
    const startWait = Date.now();
    while (Date.now() - startWait < 12000) {
      if (proc.exitCode !== null) {
        throw new Error('登录窗口已关闭');
      }
      const portFile = path.join(tmpDir, 'DevToolsActivePort');
      if (fs.existsSync(portFile)) {
        const content = fs.readFileSync(portFile, 'utf-8').trim();
        const firstLine = content.split('\n')[0]?.trim();
        if (firstLine && /^\d+$/.test(firstLine)) {
          port = firstLine;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 80));
    }

    if (!port) {
      throw new Error('等待浏览器调试端口超时');
    }

    let wsUrl = '';
    const startTarget = Date.now();
    while (Date.now() - startTarget < 10000) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        if (res.ok) {
          const targets = (await res.json()) as Array<{
            type: string;
            url: string;
            webSocketDebuggerUrl?: string;
          }>;
          const pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
          if (pageTarget?.webSocketDebuggerUrl) {
            wsUrl = pageTarget.webSocketDebuggerUrl;
            break;
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }

    if (!wsUrl) {
      throw new Error('未找到登录页面调试目标');
    }

    return await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let msgId = 1;

      const sendCmd = (method: string, params: Record<string, unknown> = {}) => {
        const id = msgId++;
        ws.send(JSON.stringify({ id, method, params }));
        return id;
      };

      const onProcExit = () => {
        reject(new Error('用户关闭了华为登录窗口'));
      };
      proc.once('exit', onProcExit);

      ws.addEventListener('open', () => {
        sendCmd('Page.enable');
        sendCmd('Network.enable');
        sendCmd('Fetch.enable', {
          patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Response' }],
        });
      });

      ws.addEventListener('message', (ev) => {
        try {
          const data = JSON.parse(String(ev.data));
          const method = data.method as string | undefined;
          const params = data.params || {};

          if (method === 'Fetch.requestPaused') {
            const headers = (params.responseHeaders || []) as Array<{
              name: string;
              value: string;
            }>;
            for (const h of headers) {
              if (h.name.toLowerCase() === 'location' && isCallbackUrl(h.value)) {
                proc.off('exit', onProcExit);
                ws.close();
                resolve(h.value);
                return;
              }
            }
            if (params.request?.url && isCallbackUrl(params.request.url)) {
              proc.off('exit', onProcExit);
              ws.close();
              resolve(params.request.url);
              return;
            }
            if (params.requestId) {
              sendCmd('Fetch.continueRequest', { requestId: params.requestId });
            }
          }

          const candidateUrl =
            params.url || params.request?.url || params.redirectResponse?.headers?.location || '';
          if (typeof candidateUrl === 'string' && isCallbackUrl(candidateUrl)) {
            proc.off('exit', onProcExit);
            ws.close();
            resolve(candidateUrl);
          }
        } catch {}
      });

      ws.addEventListener('error', () => {
        proc.off('exit', onProcExit);
        reject(new Error('浏览器 CDP 连接异常断开'));
      });
    });
  } finally {
    cleanup();
  }
}

async function exchangeCodeForSession(
  code: string,
  verifier: string
): Promise<StoredHuaweiSession> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code,
    code_verifier: verifier,
  });

  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  if (!tokenRes.ok) {
    throw new Error(`OAuth 令牌兑换失败 (HTTP ${tokenRes.status})`);
  }

  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    throw new Error('响应缺少华为账号 access_token');
  }

  const loginexRes = await fetch(
    `${MUSIC_ENDPOINT}/music-odpapp-service/v5/service/userinfo/loginex`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: buildMusicDigestHeader(''),
      },
      body: JSON.stringify({ accessToken: tokenData.access_token }),
    }
  );

  if (!loginexRes.ok) {
    throw new Error(`音乐 loginex 会话兑换失败 (HTTP ${loginexRes.status})`);
  }

  const loginexData = (await loginexRes.json()) as {
    result?: { resultCode?: string };
    token?: string;
    snsUserID?: string;
    expireTime?: string;
  };

  if (
    loginexData.result?.resultCode !== '000000' ||
    !loginexData.token ||
    !loginexData.snsUserID
  ) {
    throw new Error(
      `华为音乐 loginex 拒绝访问 (resultCode=${loginexData.result?.resultCode || 'unknown'})`
    );
  }

  const session: StoredHuaweiSession = {
    token: loginexData.token,
    snsUserID: loginexData.snsUserID,
    expireTime: loginexData.expireTime || '',
    updatedAt: new Date().toISOString(),
  };

  savePersistedSession(session);
  return session;
}

// ============================================================================
// Production Lyric Parsers: HMRC (Word-by-Word + Cantonese Jyutping) & LRC
// ============================================================================

function stripWordMarkers(text: string): string {
  return text.replace(/<\d+,\d+>/g, '').replace(/\s+/g, ' ').trim();
}

function hasHan(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

export function parseHMRC(raw: string): ParsedLyricLine[] {
  const out: ParsedLyricLine[] = [];
  const rows = raw.replace(/\r\n/g, '\n').split('\n');

  for (let line of rows) {
    line = line.trim();
    if (
      !line ||
      line.startsWith('[ti:') ||
      line.startsWith('[ar:') ||
      line.startsWith('[al:') ||
      line.startsWith('[by:') ||
      line.startsWith('[offset:') ||
      !line.startsWith('[')
    ) {
      continue;
    }
    const endBracket = line.indexOf(']');
    if (endBracket < 0) continue;
    const pairParts = line.slice(1, endBracket).split(',');
    if (pairParts.length !== 2) continue;
    const lineStartMs = parseFloat(pairParts[0]);
    const lineDurationMs = parseFloat(pairParts[1]);
    if (Number.isNaN(lineStartMs) || Number.isNaN(lineDurationMs)) continue;

    let rest = line.slice(endBracket + 1);
    let romanization: string | undefined;
    let translation: string | undefined;

    const caretIdx = rest.indexOf('^');
    if (caretIdx >= 0) {
      const tail = stripWordMarkers(rest.slice(caretIdx + 1));
      rest = rest.slice(0, caretIdx);
      const bodyPlain = stripWordMarkers(rest);
      if (tail) {
        if (hasHan(tail) && !hasHan(bodyPlain)) {
          translation = tail;
        } else {
          romanization = tail;
        }
      }
    }

    const words: ParsedLyricWord[] = [];
    let fullText = '';
    const wordRegex = /<(\d+),(\d+)>([^<]*)/g;
    let match: RegExpExecArray | null;
    while ((match = wordRegex.exec(rest)) !== null) {
      const offsetMs = parseFloat(match[1]);
      const durMs = parseFloat(match[2]);
      const chunk = match[3];
      if (!chunk) continue;
      words.push({
        text: chunk,
        startMs: Math.round(lineStartMs + offsetMs),
        endMs: Math.round(lineStartMs + offsetMs + Math.max(15, durMs)),
      });
      fullText += chunk;
    }

    for (let i = 0; i < words.length - 1; i++) {
      if (words[i].endMs > words[i + 1].startMs) {
        words[i].endMs = Math.max(words[i].startMs + 10, words[i + 1].startMs);
      }
    }

    const body = (fullText || stripWordMarkers(rest)).trim();
    if (!body) continue;

    out.push({
      timeMs: Math.round(lineStartMs),
      endMs: Math.round(lineStartMs + Math.max(1500, lineDurationMs)),
      text: body,
      romanization,
      translation,
      words: words.length > 0 ? words : undefined,
    });
  }

  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].endMs > out[i + 1].timeMs) {
      out[i].endMs = out[i + 1].timeMs;
    }
  }
  return out;
}

export function parseLRC(raw: string): ParsedLyricLine[] {
  const temp: Array<{
    timeMs: number;
    text: string;
    romanization?: string;
    translation?: string;
  }> = [];
  const rows = raw.replace(/\r\n/g, '\n').split('\n');
  const timeTagGlobal = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

  for (const row of rows) {
    const trimmed = row.trim();
    if (!trimmed) continue;
    const matches = [...trimmed.matchAll(timeTagGlobal)];
    if (matches.length === 0) continue;
    let text = trimmed.replace(timeTagGlobal, '').trim();
    if (!text || /^(\/\/|作词|作曲|编曲|制作人)/.test(text)) continue;

    let romanization: string | undefined;
    let translation: string | undefined;
    const caretIdx = text.indexOf('^');
    if (caretIdx >= 0) {
      const tail = stripWordMarkers(text.slice(caretIdx + 1));
      text = text.slice(0, caretIdx).trim();
      if (tail) {
        if (hasHan(tail) && !hasHan(text)) {
          translation = tail;
        } else {
          romanization = tail;
        }
      }
    }
    if (!text) continue;

    for (const m of matches) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const fracRaw = m[3] || '0';
      const ms =
        fracRaw.length === 1
          ? parseInt(fracRaw, 10) * 100
          : fracRaw.length === 2
          ? parseInt(fracRaw, 10) * 10
          : parseInt(fracRaw.slice(0, 3), 10);
      const totalMs = min * 60_000 + sec * 1000 + ms;
      temp.push({ timeMs: totalMs, text, romanization, translation });
    }
  }

  temp.sort((a, b) => a.timeMs - b.timeMs);

  // Merge duplicate timestamps (commonly used for original + translation in LRC)
  const merged: ParsedLyricLine[] = [];
  for (const item of temp) {
    const prev = merged[merged.length - 1];
    const isCredits = /written by|作词|作曲|编曲/i.test(item.text);
    if (
      prev &&
      Math.abs(prev.timeMs - item.timeMs) <= 80 &&
      prev.text !== item.text &&
      !isCredits
    ) {
      if (!prev.translation) {
        prev.translation = item.text;
      }
      if (!prev.romanization && item.romanization) {
        prev.romanization = item.romanization;
      }
    } else {
      merged.push({
        timeMs: item.timeMs,
        endMs: item.timeMs + 5000,
        text: item.text,
        romanization: item.romanization,
        translation: item.translation,
      });
    }
  }

  for (let i = 0; i < merged.length - 1; i++) {
    merged[i].endMs = Math.max(merged[i].timeMs + 800, merged[i + 1].timeMs);
  }
  return merged;
}

function mergeTranslations(hmrcLines: ParsedLyricLine[], plainLines: ParsedLyricLine[]): ParsedLyricLine[] {
  if (plainLines.length === 0) return hmrcLines;
  const normalizeText = (s: string) => s.replace(/[\s\p{P}]/gu, '').toLowerCase();

  return hmrcLines.map((line) => {
    if (line.translation) return line;
    const normLine = normalizeText(line.text);
    const candidate = plainLines.find(
      (p) =>
        Math.abs(p.timeMs - line.timeMs) <= 1800 &&
        (p.translation || (normalizeText(p.text) !== normLine && normalizeText(p.text) !== ''))
    );
    if (candidate) {
      return {
        ...line,
        translation:
          candidate.translation ||
          (normalizeText(candidate.text) !== normLine ? candidate.text : undefined),
      };
    }
    return line;
  });
}

function extractLyricUrlsFromPlayData(playData: Record<string, any>): {
  lrcUrl: string;
  hmrcUrl: string;
  inlineText: string;
} {
  let lrcUrl = '';
  let hmrcUrl = '';
  let inlineText = '';

  const parseBlock = (block: any) => {
    if (!block) return;
    let obj = block;
    if (typeof block === 'string') {
      try {
        obj = JSON.parse(block);
      } catch {
        if (isSafeHuaweiResourceUrl(block)) {
          if (block.endsWith('.hmrc')) hmrcUrl = hmrcUrl || block;
          else lrcUrl = lrcUrl || block;
        } else if (block.startsWith('[')) {
          inlineText = inlineText || block;
        }
        return;
      }
    }
    if (typeof obj === 'object' && obj !== null) {
      if (typeof obj.wordByWordLyric === 'string' && isSafeHuaweiResourceUrl(obj.wordByWordLyric)) {
        hmrcUrl = hmrcUrl || obj.wordByWordLyric;
      }
      if (typeof obj.lineByLineLyric === 'string' && isSafeHuaweiResourceUrl(obj.lineByLineLyric)) {
        lrcUrl = lrcUrl || obj.lineByLineLyric;
      }
      if (typeof obj.lyricAddress === 'string' && isSafeHuaweiResourceUrl(obj.lyricAddress)) {
        lrcUrl = lrcUrl || obj.lyricAddress;
      }
    }
  };

  parseBlock(playData.lyrics);
  parseBlock(playData.songInfo?.lyrics);
  parseBlock(playData.lyricAddress);
  parseBlock(playData.contentExInfo);

  return { lrcUrl, hmrcUrl, inlineText };
}

async function fetchPublicFallbackLyrics(
  title: string,
  artist: string
): Promise<ParsedLyricLine[]> {
  if (!title.trim()) return [];
  const keyword = `${title.trim()} ${artist.trim()}`.trim();

  // 1. Kugou Public Lyric Search
  try {
    const searchUrl = `https://songsearch.kugou.com/song_search_v2?${new URLSearchParams({
      keyword,
      page: '1',
      pagesize: '10',
      platform: 'WebFilter',
      userid: '0',
      clientver: '2000',
      iscorrection: '1',
      privilege_filter: '0',
      filter: '10',
    }).toString()}`;
    const sRes = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'HuaweiMusicDesktop/1.0',
        Referer: 'https://www.kugou.com/',
      },
    });
    if (sRes.ok) {
      const sData = (await sRes.json()) as any;
      const firstHit = sData?.data?.lists?.find((item: any) => item?.FileHash);
      if (firstHit?.FileHash) {
        const krcSearchUrl = `https://krcs.kugou.com/search?${new URLSearchParams({
          ver: '1',
          man: 'yes',
          client: 'mobi',
          hash: firstHit.FileHash,
        }).toString()}`;
        const kRes = await fetch(krcSearchUrl);
        if (kRes.ok) {
          const kData = (await kRes.json()) as any;
          const cand = kData?.candidates?.[0];
          if (cand?.id && cand?.accesskey) {
            const dlUrl = `https://lyrics.kugou.com/download?${new URLSearchParams({
              ver: '1',
              client: 'pc',
              id: String(cand.id),
              accesskey: String(cand.accesskey),
              fmt: 'lrc',
              charset: 'utf8',
            }).toString()}`;
            const dlRes = await fetch(dlUrl);
            if (dlRes.ok) {
              const dlData = (await dlRes.json()) as any;
              if (dlData?.content) {
                const rawLrc = Buffer.from(dlData.content, 'base64')
                  .toString('utf-8')
                  .replace(/^\uFEFF/, '');
                const parsed = parseLRC(rawLrc);
                if (parsed.length > 0) return parsed;
              }
            }
          }
        }
      }
    }
  } catch {
    // fallback to LRCLIB
  }

  // 2. LRCLIB Public Fallback
  try {
    const lrcLibUrl = `https://lrclib.net/api/search?${new URLSearchParams({
      q: keyword,
    }).toString()}`;
    const res = await fetch(lrcLibUrl);
    if (res.ok) {
      const rows = (await res.json()) as Array<any>;
      for (const r of rows || []) {
        const text = r?.syncedLyrics || r?.plainLyrics || '';
        const parsed = parseLRC(text);
        if (parsed.length > 0) return parsed;
      }
    }
  } catch {
    // ignore
  }

  return [];
}

function normalizeProviderTrack(item: Record<string, any>) {
  const id = String(item.contentID || item.contentId || item.songCode || '').trim();
  const title = String(item.contentName || item.songName || '').trim();
  if (!id || !title) return null;

  const artists: string[] = [];
  if (Array.isArray(item.artistNamePairs)) {
    for (const pair of item.artistNamePairs) {
      const name = String(pair?.artistName || pair?.name || '').trim();
      if (name) artists.push(name);
    }
  }
  if (artists.length === 0) {
    const rawArtist = String(item.artistName || item.singerName || '未知艺人').trim();
    rawArtist
      .split(/[\/、&,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((a) => artists.push(a));
  }
  if (artists.length === 0) artists.push('未知艺人');

  const album = String(
    item.albumName || item.albumNamePair?.albumName || item.albumNamePair?.name || '华为音乐单曲'
  ).trim();

  const candidates = [
    item.picture?.bigImgURL,
    item.picture?.middleImgURL,
    item.picture?.smallImgURL,
    item.coverUrl,
    item.cover,
  ];
  let coverUrl = '';
  for (const c of candidates) {
    if (typeof c === 'string' && isSafeHuaweiResourceUrl(c)) {
      coverUrl = c;
      break;
    }
  }

  const durNum = Number(item.duration);
  const durationSeconds = Number.isFinite(durNum) && durNum > 0 ? Math.round(durNum) : 230;

  return {
    id: `trk_hw_${id}`,
    sourceTrackId: id,
    title,
    artists,
    album,
    durationSeconds,
    coverUrl,
  };
}

export function huaweiDevBridgePlugin(): Plugin {
  let activeVerifier = '';
  let activeState = '';

  return {
    name: 'huawei-dev-bridge',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlObj = new URL(req.url || '/', 'http://localhost');
        if (!urlObj.pathname.startsWith('/api/huawei/') && !urlObj.pathname.startsWith('/api/local/')) {
          return next();
        }

        try {
          // ==================================================================
          // A. Same-Origin Audio Stream Proxy with HTTP Range Support (206)
          // Eliminates all CORS, Referer, and Web Audio API BiquadFilter issues!
          // ==================================================================
          if (urlObj.pathname === '/api/huawei/stream' && req.method === 'GET') {
            const targetUrl = urlObj.searchParams.get('url') || '';
            if (!isSafeHuaweiResourceUrl(targetUrl)) {
              res.statusCode = 403;
              res.end('Forbidden stream host');
              return;
            }

            const upstreamHeaders: Record<string, string> = {
              'User-Agent': 'HuaweiMusicDesktop/1.0',
            };
            if (req.headers.range) {
              upstreamHeaders['Range'] = String(req.headers.range);
            }

            const upstream = await fetch(targetUrl, {
              method: 'GET',
              headers: upstreamHeaders,
            });

            res.statusCode = upstream.status;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');

            const contentType = upstream.headers.get('content-type') || 'audio/flac';
            res.setHeader('Content-Type', contentType);

            const contentLength = upstream.headers.get('content-length');
            if (contentLength) res.setHeader('Content-Length', contentLength);

            const contentRange = upstream.headers.get('content-range');
            if (contentRange) res.setHeader('Content-Range', contentRange);

            if (!upstream.body) {
              res.end();
              return;
            }

            const nodeStream = Readable.fromWeb(upstream.body as any);
            req.on('close', () => {
              nodeStream.destroy();
            });
            nodeStream.pipe(res);
            return;
          }

          // ==================================================================
          // B. Local Audio File Streamer with HTTP Range Support (206)
          // ==================================================================
          if (urlObj.pathname === '/api/local/stream' && req.method === 'GET') {
            const filePath = urlObj.searchParams.get('path') || '';
            const resolved = path.resolve(filePath);
            if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
              res.statusCode = 404;
              res.end('File Not Found');
              return;
            }
            const stat = fs.statSync(resolved);
            const ext = path.extname(resolved).toLowerCase();
            const mimeMap: Record<string, string> = {
              '.flac': 'audio/flac',
              '.mp3': 'audio/mpeg',
              '.wav': 'audio/wav',
              '.m4a': 'audio/mp4',
              '.ogg': 'audio/ogg',
              '.aac': 'audio/aac',
            };
            const contentType = mimeMap[ext] || 'application/octet-stream';
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Content-Type', contentType);

            const range = req.headers.range;
            if (range) {
              const parts = range.replace(/bytes=/, '').split('-');
              const start = parseInt(parts[0], 10);
              const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
              const chunksize = end - start + 1;
              res.statusCode = 206;
              res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
              res.setHeader('Content-Length', String(chunksize));
              fs.createReadStream(resolved, { start, end }).pipe(res);
            } else {
              res.statusCode = 200;
              res.setHeader('Content-Length', String(stat.size));
              fs.createReadStream(resolved).pipe(res);
            }
            return;
          }

          // All JSON API endpoints below
          res.setHeader('Content-Type', 'application/json; charset=utf-8');

          // 1. Check current persisted session status (auto-imports tinglan vault if present)
          if (urlObj.pathname === '/api/huawei/status' && req.method === 'GET') {
            const sess = loadPersistedSession();
            res.end(
              JSON.stringify({
                loggedIn: Boolean(sess),
                snsUserID: sess?.snsUserID || null,
                snsUserId: sess?.snsUserID || null,
                expireTime: sess?.expireTime || null,
                updatedAt: sess?.updatedAt || null,
              })
            );
            return;
          }

          // 2. Start automated CDP browser login
          if (urlObj.pathname === '/api/huawei/login-popup' && req.method === 'POST') {
            activeVerifier = randomUrlSafe(48);
            activeState = randomUrlSafe(32);
            const challenge = sha256Base64Url(activeVerifier);

            const params = new URLSearchParams({
              client_id: CLIENT_ID,
              redirect_uri: REDIRECT_URI,
              response_type: 'code',
              access_type: 'offline',
              scope: 'openid',
              state: activeState,
              code_challenge: challenge,
              code_challenge_method: 'S256',
              countryCode: 'cn',
              ui_locales: 'zh-cn',
            });

            const authorizeUrl = `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
            const callbackRaw = await captureHuaweiOAuthViaCDP(authorizeUrl);
            const cbUrl = new URL(callbackRaw);
            const gotState = cbUrl.searchParams.get('state') || '';
            const gotCode = cbUrl.searchParams.get('code') || '';

            if (gotState !== activeState || !gotCode) {
              throw new Error('OAuth 回调 state 不匹配或缺少授权码');
            }

            const session = await exchangeCodeForSession(gotCode, activeVerifier);
            res.end(
              JSON.stringify({
                ok: true,
                snsUserID: session.snsUserID,
                snsUserId: session.snsUserID,
                expireTime: session.expireTime,
              })
            );
            return;
          }

          // 3. Fetch real Favorites, Playlists (with tracks!) & History from Huawei Cloud
          if (urlObj.pathname === '/api/huawei/sync' && req.method === 'POST') {
            const sess = loadPersistedSession();
            if (!sess) {
              res.statusCode = 401;
              res.end(JSON.stringify({ error: '尚未登录华为账号' }));
              return;
            }

            const favTracks: Array<ReturnType<typeof normalizeProviderTrack> & {}> = [];
            const seenIds = new Set<string>();
            let start = 0;
            const limit = 50;

            while (start < 2000) {
              const favRes = await fetch(
                `${MUSIC_ENDPOINT}/music-userbehavior-service/v3/service/favorite/simple/all`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: buildMusicDigestHeader(sess.token),
                  },
                  body: JSON.stringify({
                    targetSnsUserID: sess.snsUserID,
                    start,
                    limit,
                    contentTypes: [1],
                  }),
                }
              );

              if (!favRes.ok) break;
              const favData = (await favRes.json()) as {
                result?: { resultCode?: string };
                favoriteInfos?: Array<Record<string, any>>;
              };
              if (favData.result?.resultCode !== '000000') break;

              const items = favData.favoriteInfos || [];
              let addedInPage = 0;
              for (const item of items) {
                const norm = normalizeProviderTrack(item);
                if (!norm || seenIds.has(norm.sourceTrackId)) continue;
                seenIds.add(norm.sourceTrackId);
                addedInPage++;
                favTracks.push(norm);
              }

              if (items.length < limit || addedInPage === 0) break;
              start += items.length;
            }

            // Fetch user's playlists (types 4, 5, 7) and their track lists
            const playlists: Array<Record<string, unknown>> = [];
            const plRes = await fetch(
              `${MUSIC_ENDPOINT}/music-userbehavior-service/v3/service/favorite/simple/all`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: buildMusicDigestHeader(sess.token),
                },
                body: JSON.stringify({
                  targetSnsUserID: sess.snsUserID,
                  start: 0,
                  limit: 100,
                  contentTypes: [4, 5, 7],
                }),
              }
            );

            if (plRes.ok) {
              const plData = (await plRes.json()) as {
                favoriteInfos?: Array<Record<string, any>>;
              };
              for (const p of plData.favoriteInfos || []) {
                const pid = String(p.contentID || '').trim();
                const pname = String(p.contentName || '').trim();
                if (!pid || !pname) continue;
                const cType = Number(p.contentType);
                const kind = cType === 4 ? 'collected' : 'owned';
                const plTrackIds: string[] = [];

                // Fetch tracks inside the playlist so clicking it shows real songs immediately
                try {
                  if (kind === 'owned') {
                    const detailRes = await fetch(
                      `${MUSIC_ENDPOINT}/music-userbehavior-service/v1/service/playlist/detail/all?${new URLSearchParams(
                        {
                          playListID: pid,
                          start: '0',
                          limit: '50',
                        }
                      ).toString()}`,
                      {
                        method: 'GET',
                        headers: { Authorization: buildMusicDigestHeader(sess.token) },
                      }
                    );
                    if (detailRes.ok) {
                      const detailData = (await detailRes.json()) as any;
                      const list = detailData?.playListInfoEx?.playListSongInfoList || [];
                      for (const item of list) {
                        const norm = normalizeProviderTrack(item);
                        if (!norm) continue;
                        plTrackIds.push(norm.id);
                        if (!seenIds.has(norm.sourceTrackId)) {
                          seenIds.add(norm.sourceTrackId);
                          favTracks.push(norm);
                        }
                      }
                    }
                  } else {
                    const detailRes = await fetch(
                      `${MUSIC_ENDPOINT}/music-operation-service/v2/service/musiclist/detail/bymusiclistid`,
                      {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          Authorization: buildMusicDigestHeader(''),
                        },
                        body: JSON.stringify({
                          musicListID: pid,
                          copyrightSwitch: '1',
                          start: 0,
                          limit: '50',
                        }),
                      }
                    );
                    if (detailRes.ok) {
                      const detailData = (await detailRes.json()) as any;
                      const list = detailData?.musicListInfoEx?.songSimpleInfos || [];
                      for (const item of list) {
                        const norm = normalizeProviderTrack(item);
                        if (!norm) continue;
                        plTrackIds.push(norm.id);
                        if (!seenIds.has(norm.sourceTrackId)) {
                          seenIds.add(norm.sourceTrackId);
                          favTracks.push(norm);
                        }
                      }
                    }
                  }
                } catch {
                  // ignore individual playlist detail error
                }

                let coverUrl = '';
                for (const c of [p.picture?.bigImgURL, p.picture?.middleImgURL, p.picture?.smallImgURL]) {
                  if (typeof c === 'string' && isSafeHuaweiResourceUrl(c)) {
                    coverUrl = c;
                    break;
                  }
                }

                playlists.push({
                  id: `pl_hw_${pid}`,
                  remoteId: pid,
                  kind: 'imported',
                  source: 'huawei',
                  name: pname,
                  description: String(p.listDesc || '来自华为音乐账号云端歌单'),
                  coverUrl:
                    coverUrl ||
                    favTracks[0]?.coverUrl ||
                    'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=600&auto=format&fit=crop&q=80',
                  trackCount: Number(p.totalCount) || plTrackIds.length,
                  trackIds: plTrackIds,
                  updatedAt: '刚刚同步',
                });
              }
            }

            res.end(
              JSON.stringify({
                ok: true,
                snsUserID: sess.snsUserID,
                snsUserId: sess.snsUserID,
                tracks: favTracks,
                playlists,
              })
            );
            return;
          }

          // 4. Resolve REAL audio stream URL (proxied via /api/huawei/stream) + Real HMRC/LRC Lyrics
          if (urlObj.pathname === '/api/huawei/resolve' && req.method === 'POST') {
            const sess = loadPersistedSession();
            if (!sess) {
              res.statusCode = 401;
              res.end(JSON.stringify({ error: '尚未登录华为账号' }));
              return;
            }

            let rawBody = '';
            for await (const chunk of req) rawBody += chunk;
            const {
              contentCode,
              title = '',
              artist = '',
              quality = 'lossless',
            } = JSON.parse(rawBody || '{}');

            let targetCode = String(contentCode || '').trim();

            // If contentCode is missing or is a legacy placeholder, resolve the real contentID via search
            if (!targetCode || targetCode.startsWith('hw_') || targetCode.startsWith('loc_')) {
              const q = `${title} ${artist}`.trim();
              if (q) {
                const sRes = await fetch(
                  `${MUSIC_ENDPOINT}/music-search-service/v10/service/fuzzysearch`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: buildMusicDigestHeader(''),
                    },
                    body: JSON.stringify({
                      contentType: '1',
                      correct: '1',
                      queryWord: q,
                      start: '0',
                      limit: '5',
                    }),
                  }
                );
                if (sRes.ok) {
                  const sData = (await sRes.json()) as any;
                  const top = sData?.songSimpleInfos?.[0];
                  if (top) {
                    targetCode = String(top.contentID || top.contentId || top.songCode || '').trim();
                  }
                }
              }
            }

            if (!targetCode) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: '未找到对应的华为音乐曲目 ID' }));
              return;
            }

            const tryResolveQuality = async (qCode: string) => {
              const playRes = await fetch(
                `${MUSIC_ENDPOINT}/music-play-service/v3/service/file/bycontentcode`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: buildMusicDigestHeader(sess.token),
                  },
                  body: JSON.stringify({
                    contentCode: targetCode,
                    contentType: '1',
                    qualityType: qCode,
                  }),
                }
              );
              return (await playRes.json()) as Record<string, any>;
            };

            const preferredQ = quality === 'standard' ? '1' : '3';
            let playData = await tryResolveQuality(preferredQ);
            let fileUrl = String(playData?.fileURL || '');

            // If lossless (3) wasn't available, automatically fallback to standard (1)
            if (!isSafeHuaweiResourceUrl(fileUrl) && preferredQ === '3') {
              playData = await tryResolveQuality('1');
              fileUrl = String(playData?.fileURL || '');
            }

            if (!isSafeHuaweiResourceUrl(fileUrl)) {
              res.statusCode = 404;
              res.end(
                JSON.stringify({
                  error: '当前歌曲暂无可播流或需会员权限',
                  rawCode: playData?.result?.resultCode,
                })
              );
              return;
            }

            // Parse real HMRC word-by-word & LRC line-by-line lyrics
            const { lrcUrl, hmrcUrl, inlineText } = extractLyricUrlsFromPlayData(playData);
            let parsedLyrics: ParsedLyricLine[] = [];

            if (hmrcUrl) {
              try {
                const hmrcRes = await fetch(hmrcUrl);
                if (hmrcRes.ok) {
                  const hmrcText = await hmrcRes.text();
                  parsedLyrics = parseHMRC(hmrcText);
                }
              } catch {}
            }

            if (lrcUrl) {
              try {
                const lrcRes = await fetch(lrcUrl);
                if (lrcRes.ok) {
                  const lrcText = await lrcRes.text();
                  const plainLines = parseLRC(lrcText);
                  if (parsedLyrics.length === 0) {
                    parsedLyrics = plainLines;
                  } else {
                    parsedLyrics = mergeTranslations(parsedLyrics, plainLines);
                  }
                }
              } catch {}
            }

            if (parsedLyrics.length === 0 && inlineText) {
              parsedLyrics = parseLRC(inlineText);
            }

            // Public Kugou / LRCLIB fallback if Huawei has no lyrics for this song
            if (parsedLyrics.length === 0 && title) {
              parsedLyrics = await fetchPublicFallbackLyrics(title, artist);
            }

            const rawDuration = Number(playData?.songInfo?.duration);
            const durationSeconds =
              Number.isFinite(rawDuration) && rawDuration > 0 ? Math.round(rawDuration) : undefined;

            const isLossless =
              Number(playData?.playQuality || playData?.qualityType) === 3 ||
              fileUrl.toLowerCase().includes('.flac');

            // Return same-origin stream proxy URL so browser <audio> + Web Audio EQ + Range Seeking work 100%
            const proxiedStreamUrl = `/api/huawei/stream?url=${encodeURIComponent(fileUrl)}`;

            res.end(
              JSON.stringify({
                ok: true,
                contentCode: targetCode,
                streamUrl: proxiedStreamUrl,
                rawStreamUrl: fileUrl,
                isPreview: fileUrl.toLowerCase().includes('/preview/'),
                quality: isLossless ? 'lossless' : 'standard',
                formatLabel: isLossless ? '无损 FLAC' : '320k MP3',
                durationSeconds,
                lyrics: parsedLyrics,
              })
            );
            return;
          }

          // 5. Public Huawei Fuzzy Search
          if (urlObj.pathname === '/api/huawei/search' && req.method === 'POST') {
            let rawBody = '';
            for await (const chunk of req) rawBody += chunk;
            const { query } = JSON.parse(rawBody || '{}');
            if (!query || !String(query).trim()) {
              res.end(JSON.stringify({ tracks: [] }));
              return;
            }

            const searchRes = await fetch(
              `${MUSIC_ENDPOINT}/music-search-service/v10/service/fuzzysearch`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: buildMusicDigestHeader(''),
                },
                body: JSON.stringify({
                  contentType: '1',
                  correct: '1',
                  queryWord: String(query).trim(),
                  start: '0',
                  limit: '30',
                }),
              }
            );

            const searchData = (await searchRes.json()) as {
              songSimpleInfos?: Array<Record<string, any>>;
            };
            const tracks = (searchData.songSimpleInfos || [])
              .map((item) => normalizeProviderTrack(item))
              .filter(Boolean);

            res.end(JSON.stringify({ ok: true, tracks }));
            return;
          }

          // 6. Toggle Huawei Cloud Favorite Writeback
          if (urlObj.pathname === '/api/huawei/favorite' && req.method === 'POST') {
            const sess = loadPersistedSession();
            if (!sess) {
              res.statusCode = 401;
              res.end(JSON.stringify({ error: '尚未登录华为账号' }));
              return;
            }
            let rawBody = '';
            for await (const chunk of req) rawBody += chunk;
            const { contentCode, favorite } = JSON.parse(rawBody || '{}');
            const action = favorite ? 'create' : 'delete';
            const writeRes = await fetch(
              `${MUSIC_ENDPOINT}/music-userbehavior-service/v1/service/favorite/${action}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: buildMusicDigestHeader(sess.token),
                },
                body: JSON.stringify({
                  contentType: '1',
                  contentID: String(contentCode),
                }),
              }
            );
            const writeData = (await writeRes.json()) as any;
            res.end(
              JSON.stringify({
                ok: writeData?.result?.resultCode === '000000',
                resultCode: writeData?.result?.resultCode,
              })
            );
            return;
          }

          // 7. Scan Local Music Folder (~/Music) for Real Local Audio Files
          if (urlObj.pathname === '/api/local/scan' && req.method === 'POST') {
            let rawBody = '';
            for await (const chunk of req) rawBody += chunk;
            const { folderPath } = JSON.parse(rawBody || '{}');
            const targetDir = folderPath
              ? path.resolve(String(folderPath).replace(/^~/, os.homedir()))
              : path.join(os.homedir(), 'Music');

            const audioExts = new Set(['.flac', '.mp3', '.wav', '.m4a', '.ogg', '.aac']);
            const foundTracks: Array<Record<string, any>> = [];

            const walk = (dir: string, depth = 0) => {
              if (depth > 4 || !fs.existsSync(dir)) return;
              let entries: fs.Dirent[] = [];
              try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
              } catch {
                return;
              }
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  walk(fullPath, depth + 1);
                } else if (entry.isFile()) {
                  const ext = path.extname(entry.name).toLowerCase();
                  if (!audioExts.has(ext)) continue;
                  const base = path.basename(entry.name, ext);
                  // Parse "Artist - Title" or "Title"
                  let artist = '本地音乐人';
                  let title = base;
                  if (base.includes(' - ')) {
                    const parts = base.split(' - ');
                    artist = parts[0].trim();
                    title = parts.slice(1).join(' - ').trim();
                  }
                  const isHiRes = ext === '.flac' || ext === '.wav';
                  const idHash = crypto
                    .createHash('md5')
                    .update(fullPath)
                    .digest('hex')
                    .slice(0, 12);
                  foundTracks.push({
                    id: `trk_loc_${idHash}`,
                    sourceTrackId: fullPath,
                    title,
                    artists: [artist],
                    album: path.basename(path.dirname(fullPath)) || '本地无损专辑',
                    durationSeconds: 240,
                    quality: isHiRes ? 'hires' : 'standard',
                    formatLabel: isHiRes ? `本地 ${ext.slice(1).toUpperCase()}` : `本地 ${ext.slice(1).toUpperCase()}`,
                    streamUrl: `/api/local/stream?path=${encodeURIComponent(fullPath)}`,
                  });
                }
              }
            };

            walk(targetDir);
            res.end(
              JSON.stringify({
                ok: true,
                scannedDir: targetDir,
                tracks: foundTracks,
              })
            );
            return;
          }

          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Not Found' }));
        } catch (err: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err?.message || String(err) }));
        }
      });
    },
  };
}
