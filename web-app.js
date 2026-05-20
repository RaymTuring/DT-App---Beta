#!/usr/bin/env node
const http = require('http');
const PY_SEND_RESET_EMAIL = 'import sys, json, smtplib, ssl\nfrom email.message import EmailMessage\npayload = json.loads(sys.stdin.read())\nSMTP_USER = "metaverso.uk@gmail.com"\nSMTP_PASS = "mkyc apht psak iwei"\nto_addr = payload["to"]\ncode = payload["code"]\nname = payload.get("name") or to_addr.split("@")[0]\nmsg = EmailMessage()\nmsg["From"] = "DataToalha <" + SMTP_USER + ">"\nmsg["To"] = to_addr\nmsg["Subject"] = "Codigo para redefinir sua senha - DataToalha"\nmsg.set_content("Ola " + name + ",\\n\\nSeu codigo para redefinir a senha do DataToalha e:\\n\\n    " + code + "\\n\\nValido por 30 minutos. Se voce nao solicitou, ignore este e-mail.\\n\\nDataToalha\\nhttps://datatoalha.com")\nmsg.add_alternative(\n    "<div style=\\"font-family:-apple-system,Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#06060F;color:#F4F4FB;\\">"\n    "<h2 style=\\"font-family:Inter,sans-serif;font-weight:800;font-size:22px;background:linear-gradient(135deg,#5EE9FF,#B14AFF);-webkit-background-clip:text;background-clip:text;color:transparent;margin:0 0 16px;\\">DataToalha</h2>"\n    "<p style=\\"font-size:14px;color:#9799BD;margin:0 0 8px;\\">Ola " + name + ",</p>"\n    "<p style=\\"font-size:14px;color:#F4F4FB;line-height:1.5;margin:0 0 24px;\\">Use o codigo abaixo para redefinir a senha da sua conta:</p>"\n    "<div style=\\"font-family:ui-monospace,Menlo,monospace;font-size:32px;letter-spacing:0.4em;font-weight:800;text-align:center;padding:16px;background:rgba(0,240,255,0.08);border:1px solid rgba(0,240,255,0.30);border-radius:14px;color:#5EE9FF;margin:0 0 24px;\\">" + code + "</div>"\n    "<p style=\\"font-size:12px;color:#6B6E91;line-height:1.5;margin:0;\\">Codigo valido por 30 minutos. Se voce nao solicitou, ignore este e-mail.</p>"\n    "</div>",\n    subtype="html"\n)\nctx = ssl.create_default_context()\nwith smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as s:\n    s.starttls(context=ctx)\n    s.login(SMTP_USER, SMTP_PASS)\n    s.send_message(msg)\nprint("ok")\n';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 18793;
const HOST = '0.0.0.0';
const DATA_DIR = '/Users/raymondturing/Documents/Data-Toalha';
const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const SESSION_TTL = 24 * 60 * 60 * 1000;
const SOC_API_KEY = process.env.DT_SOC_KEY || 'dt-soc-' + crypto.randomBytes(16).toString('hex');
const SOC_TOTP_SECRET = process.env.DT_SOC_TOTP || crypto.randomBytes(20).toString('hex');
const SOC_ALLOWED_IPS = (process.env.DT_SOC_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
const _socAuditLog = [];
function totp(secret, window) {
    const t = Math.floor(Date.now() / 30000) + (window || 0);
    const buf = Buffer.alloc(8); buf.writeUInt32BE(0, 0); buf.writeUInt32BE(t, 4);
    const hmac = crypto.createHmac('sha1', Buffer.from(secret, 'hex')).update(buf).digest();
    const off = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[off] & 0x7f) << 24 | hmac[off+1] << 16 | hmac[off+2] << 8 | hmac[off+3]) % 1000000;
    return code.toString().padStart(6, '0');
}
function verifyTotp(secret, token) {
    for (let w = -1; w <= 1; w++) { if (totp(secret, w) === token) return true; }
    return false;
}

// OAuth Config (placeholders - set env vars for production)
const OAUTH_CONFIG = {
  google: { clientId: process.env.GOOGLE_CLIENT_ID || '', enabled: !!process.env.GOOGLE_CLIENT_ID },
  apple: { clientId: process.env.APPLE_CLIENT_ID || '', enabled: !!process.env.APPLE_CLIENT_ID },
  facebook: { clientId: process.env.FACEBOOK_APP_ID || '', enabled: !!process.env.FACEBOOK_APP_ID }
};

// Password hashing with scrypt
function isValidEmail(s) {
  if (typeof s !== 'string') return false;
  s = s.trim();
  if (s.length < 5 || s.length > 254) return false;
  const at = s.indexOf('@');
  if (at <= 0 || at !== s.lastIndexOf('@')) return false;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (!local || !domain) return false;
  const dot = domain.lastIndexOf('.');
  if (dot <= 0 || dot >= domain.length - 1) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 32 || c === 60 || c === 62 || c === 9 || c === 10 || c === 13) return false;
  }
  return true;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST }).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored.startsWith('scrypt:')) {
    // Legacy plaintext comparison - migrate on next save
    return password === stored;
  }
  const [, salt, hash] = stored.split(':');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST }).toString('hex');
  return derived === hash;
}

// Session token generation
function createToken(user) {
  const payload = JSON.stringify({ id: user.id, role: user.role, exp: Date.now() + SESSION_TTL });
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const [payloadB64, sig] = token.split('.');
    const payload = Buffer.from(payloadB64, 'base64url').toString();
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('hex');
    if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
    const parsed = JSON.parse(payload);
    if (parsed.exp < Date.now()) return null;
    return parsed;
  } catch { return null; }
}

let data = {
    users: [],
    candidates: [],
    votes: [],
    polls: [],
    pollVotes: [],
    pollRankings: {},
    products: [],
    productOrders: [],
    candleHistory: {},
    pollChats: {},
    chatReports: [],
    contacts: [],
    countries: [],
    states: [],
    cities: []
};

function loadJSON(file) {
    try {
        return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
    } catch (e) {
        console.log(`Error loading ${file}: ${e.message}`);
        return [];
    }
}

function loadData() {
    console.log('Loading data...');
    data.countries = loadJSON('countries.json');
    data.states = loadJSON('states.json');
    data.cities = loadJSON('cities.json');
    
    console.log(`Loaded: ${data.countries.length} countries, ${data.states.length} states, ${data.cities.length} cities`);
    
    loadUsers();
    
    const candidatesFile = path.join(process.env.HOME || '/Users/raymondturing', 'Library/Application Support/DataToalha/candidates.json');
    try {
        if (fs.existsSync(candidatesFile)) {
            data.candidates = JSON.parse(fs.readFileSync(candidatesFile, 'utf8'));
        } else {
            data.candidates = [
                { id: '1', name: 'João Silva', country: 'Brazil', state: 'São Paulo', city: 'São Paulo', role: 'President', party: 'PT' },
                { id: '2', name: 'Maria Santos', country: 'Brazil', state: 'São Paulo', city: 'São Paulo', role: 'President', party: 'PSDB' },
                { id: '3', name: 'Pedro Oliveira', country: 'Brazil', state: 'Rio de Janeiro', city: 'Rio de Janeiro', role: 'President', party: 'PL' },
                { id: '4', name: 'Ana Costa', country: 'Brazil', state: 'Minas Gerais', city: 'Belo Horizonte', role: 'Governor', party: 'PT' },
                { id: '5', name: 'Carlos Souza', country: 'Brazil', state: 'São Paulo', city: 'São Paulo', role: 'Mayor', party: 'PSB' }
            ];
            fs.mkdirSync(path.dirname(candidatesFile), { recursive: true });
            fs.writeFileSync(candidatesFile, JSON.stringify(data.candidates, null, 2));
        }
    } catch (e) {
        console.log('Error with candidates:', e.message);
    }
    
    console.log(`Total candidates: ${data.candidates.length}`);
}

function saveCandidates() {
    const candidatesFile = path.join(process.env.HOME || '/Users/raymondturing', 'Library/Application Support/DataToalha/candidates.json');
    try {
        fs.mkdirSync(path.dirname(candidatesFile), { recursive: true });
        fs.writeFileSync(candidatesFile, JSON.stringify(data.candidates, null, 2));
    } catch (e) {
        console.log('Error saving candidates:', e.message);
    }
}

function loadUsers() {
    const usersFile = path.join(process.env.HOME || '/Users/raymondturing', 'Library/Application Support/DataToalha/users.json');
    try {
        if (fs.existsSync(usersFile)) {
            data.users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
        } else {
            data.users = [
                { id: 'admin1', username: 'admin', email: 'admin@datatoalha.com', password: hashPassword('admin123'), role: 'admin', name: 'Administrator', createdAt: new Date().toISOString() },
                { id: 'user1', username: 'user', email: 'user@datatoalha.com', password: hashPassword('user123'), role: 'user', name: 'Regular User', createdAt: new Date().toISOString() }
            ];
            fs.mkdirSync(path.dirname(usersFile), { recursive: true });
            fs.writeFileSync(usersFile, JSON.stringify(data.users, null, 2));
        }
    } catch (e) {
        console.log('Error with users:', e.message);
    }
    console.log(`Total users: ${data.users.length}`);
}

function saveUsers() {
    const usersFile = path.join(process.env.HOME || '/Users/raymondturing', 'Library/Application Support/DataToalha/users.json');
    try {
        fs.mkdirSync(path.dirname(usersFile), { recursive: true });
        fs.writeFileSync(usersFile, JSON.stringify(data.users, null, 2));
    } catch (e) {
        console.log('Error saving users:', e.message);
    }
}

const DATA_PERSIST_DIR = path.join(process.env.HOME || '/Users/raymondturing', 'Library/Application Support/DataToalha');

function saveAllData() {
    try {
        fs.mkdirSync(DATA_PERSIST_DIR, { recursive: true });
        const toSave = { votes: 'votes.json', polls: 'polls.json', pollVotes: 'pollVotes.json', pollRankings: 'pollRankings.json', products: 'products.json', productOrders: 'productOrders.json', candleHistory: 'candleHistory.json', pollChats: 'pollChats.json', chatReports: 'chatReports.json', contacts: 'contacts.json' };
        for (const [key, file] of Object.entries(toSave)) {
            fs.writeFileSync(path.join(DATA_PERSIST_DIR, file), JSON.stringify(data[key] || [], null, 2));
        }
    } catch (e) {
        console.log('Error saving data:', e.message);
    }
}

function loadAllData() {
    const toLoad = { votes: 'votes.json', polls: 'polls.json', pollVotes: 'pollVotes.json', pollRankings: 'pollRankings.json', products: 'products.json', productOrders: 'productOrders.json', candleHistory: 'candleHistory.json', pollChats: 'pollChats.json', chatReports: 'chatReports.json', contacts: 'contacts.json' };
    for (const [key, file] of Object.entries(toLoad)) {
        try {
            const fp = path.join(DATA_PERSIST_DIR, file);
            if (fs.existsSync(fp)) {
                data[key] = JSON.parse(fs.readFileSync(fp, 'utf8'));
                console.log(`Loaded ${file}: ${Array.isArray(data[key]) ? data[key].length + ' items' : 'object'}`);
            }
        } catch (e) {
            console.log(`Error loading ${file}: ${e.message}`);
        }
    }
}

function generateId() {
    return crypto.randomBytes(6).toString('hex');
}

function generateShareCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = crypto.randomBytes(8);
    return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

const GLOBAL_ROLES = ['President', 'Senator'];
const STATE_ROLES = ['Governor', 'Mayor', 'MP', 'Deputy'];

const POLL_CATEGORIES = [
    'Futebol', 'Music', 'Celebrities', 'YouTubers', 'TV Programs', 
    'Movies', 'Sports', 'Technology', 'Gaming', 'Food', 
    'Travel', 'Fashion', 'Education', 'Politics', 'Science', 'Other'
];

const html = `
<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="DataToalha">
    <meta name="theme-color" content="#0F0F2A">
    <meta name="format-detection" content="telephone=no">
    <title>DataToalha — Votação</title>
    <link rel="apple-touch-icon" href="/logo">
    <link rel="icon" type="image/png" href="/logo">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800;900&family=Inter:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --safe-top: env(safe-area-inset-top, 0px);
            --safe-bottom: env(safe-area-inset-bottom, 0px);
            --safe-left: env(safe-area-inset-left, 0px);
            --safe-right: env(safe-area-inset-right, 0px);
            --nav-h-mobile: 64px;
            --nav-w-desktop: 240px;
            --c-bg: #06060F;
            --c-surface: rgba(15,15,42,0.55);
            --c-surface-strong: rgba(26,27,61,0.85);
            --c-border: rgba(120,130,200,0.18);
            --c-border-hot: rgba(0,240,255,0.30);
            --c-text: #F4F4FB;
            --c-text-mute: #9799BD;
            --c-text-dim: #6B6E91;
            --c-cyan: #00F0FF;
            --c-cyan-soft: #5EE9FF;
            --c-purple: #B14AFF;
            --c-danger: #FF5A6E;
            --c-success: #6FFFB8;
            --c-warn: #FFCB47;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
        html, body {
            background: var(--c-bg);
            min-height: 100%;
            min-height: 100dvh;
            color: var(--c-text);
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            -webkit-font-smoothing: antialiased;
            -webkit-text-size-adjust: 100%;
            overscroll-behavior-y: contain;
        }
        body {
            padding-left: var(--safe-left);
            padding-right: var(--safe-right);
        }
        body::before {
            content: "";
            position: fixed;
            inset: 0;
            background:
                radial-gradient(ellipse 80% 60% at 18% 8%, rgba(0,240,255,0.16), transparent 70%),
                radial-gradient(ellipse 70% 60% at 88% 22%, rgba(177,74,255,0.18), transparent 65%),
                linear-gradient(180deg, #0A0A1F 0%, #06060F 50%, #0A0A1F 100%);
            z-index: -2; pointer-events: none;
        }
        body::after {
            content: "";
            position: fixed; inset: 0;
            background-image:
                linear-gradient(rgba(120,130,200,0.04) 1px, transparent 1px),
                linear-gradient(90deg, rgba(120,130,200,0.04) 1px, transparent 1px);
            background-size: 32px 32px;
            mask-image: radial-gradient(ellipse 90% 80% at 50% 30%, black, transparent 70%);
            z-index: -1; pointer-events: none;
        }

        /* ═════════ Sidebar / bottom-nav ═════════ */
        .sidebar {
            position: fixed;
            z-index: 50;
            bottom: 0; left: 0; right: 0;
            top: auto; width: auto; height: auto;
            display: flex;
            justify-content: space-evenly;
            gap: 2px;
            padding: 6px 4px calc(6px + var(--safe-bottom));
            background: linear-gradient(180deg, rgba(6,6,15,0.0) 0%, rgba(6,6,15,0.85) 30%, rgba(6,6,15,0.92) 100%);
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            border-top: 1px solid rgba(120,130,200,0.18);
            overflow: hidden;
        }
        .sidebar > div:first-child { display: none; }   /* hide logo+spacer at top */
        .sidebar > div:last-child  { display: none; }   /* hide bottom logout block */
        .sidebar button {
            background: transparent;
            border: none;
            color: var(--c-text-mute);
            font-family: 'Geist Mono', ui-monospace, monospace;
            font-size: 9px;
            letter-spacing: 0.02em;
            text-transform: uppercase;
            text-align: center;
            padding: 6px 2px 4px;
            border-radius: 10px;
            min-height: 46px;
            flex: 1;
            max-width: 72px;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 3px;
            transition: color 0.18s ease, background 0.18s ease;
            line-height: 1.1;
        }
        .sidebar button:not(.admin-only):nth-of-type(n+9) { display: none; } /* safety */
        .sidebar button.active {
            color: var(--c-cyan);
            background: linear-gradient(180deg, rgba(0,240,255,0.12), rgba(177,74,255,0.10));
            box-shadow: inset 0 1px 0 rgba(0,240,255,0.30);
        }
        .sidebar button:active { transform: scale(0.96); }

        /* Desktop layout: bring back the side rail */
        @media (min-width: 1024px) {
            .sidebar {
                top: 0; bottom: 0;
                right: auto; width: var(--nav-w-desktop);
                flex-direction: column;
                justify-content: flex-start;
                padding: calc(20px + var(--safe-top)) 14px 20px;
                border-top: none;
                border-right: 1px solid rgba(120,130,200,0.15);
                gap: 4px;
                overflow-y: auto;
            }
            .sidebar > div:first-child { display: block; text-align: center; margin-bottom: 24px; }
            .sidebar > div:first-child img { max-width: 88px; border-radius: 14px; box-shadow: 0 0 0 1px rgba(0,240,255,0.35), 0 0 30px rgba(177,74,255,0.4); }
            .sidebar > div:last-child {
                display: block;
                margin-top: 32px;
                padding-top: 20px;
                border-top: 1px solid rgba(120,130,200,0.15);
            }
            .sidebar > div:last-child p:first-of-type { font-size: 10px !important; color: var(--c-text-dim) !important; margin-bottom: 2px !important; font-family: 'Geist Mono', monospace; letter-spacing: 0.08em; text-transform: uppercase; }
            .sidebar > div:last-child p:nth-of-type(2) { font-size: 14px !important; color: var(--c-cyan-soft) !important; margin-bottom: 14px !important; font-weight: 600; }
            .sidebar > div:last-child button {
                background: rgba(255,90,110,0.08) !important;
                color: var(--c-danger) !important;
                border: 1px solid rgba(255,90,110,0.30) !important;
                padding: 10px !important;
                border-radius: 10px !important;
                font-weight: 600 !important;
            }
            .sidebar button {
                flex-direction: row;
                justify-content: flex-start;
                flex: none;
                max-width: none;
                width: 100%;
                font-size: 13px;
                font-family: 'Inter', system-ui, sans-serif;
                font-weight: 500;
                text-transform: none;
                letter-spacing: normal;
                padding: 12px 14px;
                gap: 10px;
                min-height: 44px;
                color: var(--c-text-mute);
            }
        }

        /* ═════════ Pro cards + photos + lightbox (added by photos patch) ═════════ */
        .card-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
            gap: 14px;
            margin-top: 6px;
        }
        @media (max-width: 480px) {
            .card-grid { grid-template-columns: 1fr; }
        }
        .entity-card {
            position: relative;
            display: flex;
            gap: 14px;
            align-items: center;
            padding: 14px;
            background: linear-gradient(135deg, rgba(26,27,61,0.55), rgba(10,10,31,0.55));
            backdrop-filter: blur(20px) saturate(160%);
            -webkit-backdrop-filter: blur(20px) saturate(160%);
            border: 1px solid rgba(120,130,200,0.20);
            border-radius: 18px;
            transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
            cursor: pointer;
            overflow: hidden;
            min-width: 0;
        }
        .entity-card:hover {
            border-color: rgba(0,240,255,0.50);
            box-shadow: 0 8px 28px rgba(0,240,255,0.10), 0 2px 8px rgba(177,74,255,0.10);
            transform: translateY(-2px);
        }
        .entity-card.selected {
            border-color: var(--c-cyan);
            box-shadow: inset 0 0 0 1px rgba(0,240,255,0.50), 0 8px 28px rgba(0,240,255,0.20);
        }
        .entity-avatar {
            flex: 0 0 auto;
            width: 64px; height: 64px;
            border-radius: 50%;
            background: linear-gradient(135deg, #1A1B3D, #0A0A1F);
            border: 1px solid rgba(120,130,200,0.30);
            display: flex; align-items: center; justify-content: center;
            font-family: 'Inter Tight', sans-serif;
            font-weight: 800; font-size: 22px;
            color: var(--c-cyan-soft);
            overflow: hidden;
            cursor: zoom-in;
        }
        .entity-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .entity-cover {
            flex: 0 0 auto;
            width: 88px; height: 88px;
            border-radius: 14px;
            background: linear-gradient(135deg, #1A1B3D, #0A0A1F);
            border: 1px solid rgba(120,130,200,0.30);
            display: flex; align-items: center; justify-content: center;
            font-family: 'Inter Tight', sans-serif;
            font-weight: 800; font-size: 28px;
            color: var(--c-cyan-soft);
            overflow: hidden;
            cursor: zoom-in;
        }
        .entity-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .entity-body { flex: 1 1 auto; min-width: 0; }
        .entity-title {
            font-family: 'Inter Tight', sans-serif;
            font-weight: 700; font-size: 17px;
            color: var(--c-text);
            line-height: 1.2;
            margin: 0 0 4px;
            overflow: hidden; text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-line-clamp: 2; -webkit-box-orient: vertical;
            word-break: break-word;
        }
        .entity-sub {
            font-size: 13px;
            color: var(--c-text-mute);
            margin: 0 0 6px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .entity-meta {
            font-family: 'Geist Mono', ui-monospace, monospace;
            font-size: 11px;
            color: var(--c-text-dim);
            text-transform: uppercase;
            letter-spacing: 0.06em;
        }
        .entity-badge {
            position: absolute;
            top: 8px; right: 8px;
            font-family: 'Geist Mono', ui-monospace, monospace;
            font-size: 9px;
            padding: 3px 8px;
            border-radius: 999px;
            background: rgba(111,255,184,0.14);
            color: var(--c-success);
            border: 1px solid rgba(111,255,184,0.30);
            text-transform: uppercase;
            letter-spacing: 0.06em;
        }
        .entity-actions {
            display: flex; gap: 8px; flex-wrap: wrap;
            margin-top: 8px;
        }

        /* Photo upload field */
        .photo-input {
            display: flex; gap: 12px; align-items: center;
            padding: 12px; border-radius: 14px;
            background: rgba(15,15,42,0.55);
            border: 1px dashed rgba(120,130,200,0.30);
        }
        .photo-input .preview {
            flex: 0 0 auto;
            width: 64px; height: 64px;
            border-radius: 14px; overflow: hidden;
            background: linear-gradient(135deg, #1A1B3D, #0A0A1F);
            border: 1px solid rgba(120,130,200,0.30);
            display: flex; align-items: center; justify-content: center;
            color: var(--c-text-dim); font-size: 22px;
        }
        .photo-input .preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .photo-input .controls { flex: 1 1 auto; min-width: 0; }
        .photo-input input[type=file] { display: none; }
        .photo-input label.btn { display: inline-block; cursor: pointer; }
        .photo-input .hint { display: block; font-size: 11px; color: var(--c-text-dim); margin-top: 4px; font-family: 'Geist Mono', monospace; }

        /* Lightbox */
        #lightbox {
            position: fixed; inset: 0;
            background: rgba(6,6,15,0.94);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            z-index: 2500;
            display: none;
            align-items: center; justify-content: center;
            padding: calc(env(safe-area-inset-top, 0px) + 24px) 16px calc(env(safe-area-inset-bottom, 0px) + 24px);
        }
        #lightbox.open { display: flex; }
        #lightbox .lb-stage {
            position: relative; max-width: 100%; max-height: 100%;
        }
        #lightbox img {
            max-width: 100%; max-height: calc(100dvh - 96px);
            border-radius: 18px;
            box-shadow: 0 24px 80px rgba(0,0,0,0.6);
            border: 1px solid rgba(120,130,200,0.30);
            display: block; margin: 0 auto;
        }
        #lightbox .lb-close {
            position: absolute; top: -14px; right: -14px;
            width: 44px; height: 44px;
            border-radius: 50%;
            background: linear-gradient(135deg, rgba(255,90,110,0.95), rgba(177,74,255,0.85));
            border: 1px solid rgba(255,255,255,0.30);
            color: white; font-size: 22px; font-weight: 800; line-height: 1;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer;
            box-shadow: 0 6px 18px rgba(0,0,0,0.6);
        }
        #lightbox .lb-close:active { transform: scale(0.94); }

        /* ═════════ Overflow / responsive hardening (added by tva-parity) ═════════ */
        .section { min-width: 0; max-width: 100%; }
        .card    { min-width: 0; max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
        .grid    { min-width: 0; max-width: 100%; }
        .grid > * { min-width: 0; }
        table, .table { width: 100%; max-width: 100%; display: block; overflow-x: auto; }
        img, video, iframe { max-width: 100%; height: auto; }
        input, select, textarea { max-width: 100%; }
        /* Bottom-nav button label truncation so 7 cells always fit */
        .sidebar button span { font-size: 8px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        @media (min-width: 1024px) { .sidebar button span { font-size: 13px; } }

        /* ═════════ Main content ═════════ */
        .main {
            margin-left: 0;
            padding: calc(var(--safe-top) + 20px) 18px calc(var(--nav-h-mobile) + var(--safe-bottom) + 24px);
            min-height: 100dvh;
            max-width: 100%;
        }
        @media (min-width: 1024px) {
            .main {
                margin-left: var(--nav-w-desktop);
                padding: calc(var(--safe-top) + 32px) 32px calc(var(--safe-bottom) + 32px);
            }
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 22px;
            flex-wrap: wrap;
            gap: 12px;
        }
        .header h2 {
            font-family: 'Inter Tight', system-ui, sans-serif;
            font-weight: 800;
            font-size: 26px;
            color: var(--c-text);
            letter-spacing: -0.025em;
            line-height: 1.1;
            background: linear-gradient(135deg, #5EE9FF 0%, #B14AFF 100%);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
        }
        @media (min-width: 768px) { .header h2 { font-size: 32px; } }

        /* ═════════ Cards ═════════ */
        .card {
            background: var(--c-surface);
            backdrop-filter: blur(20px) saturate(160%);
            -webkit-backdrop-filter: blur(20px) saturate(160%);
            border: 1px solid var(--c-border);
            border-radius: 18px;
            padding: 20px;
            margin-bottom: 16px;
            box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.06), 0 20px 60px -20px rgba(0,0,0,0.5);
        }
        @media (min-width: 768px) { .card { padding: 26px; } }
        .card h3 {
            font-family: 'Inter Tight', system-ui, sans-serif;
            font-weight: 700;
            font-size: 17px;
            margin-bottom: 18px;
            color: var(--c-text);
            letter-spacing: -0.01em;
        }

        /* ═════════ Forms ═════════ */
        .form-group { margin-bottom: 16px; }
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-family: 'Geist Mono', ui-monospace, monospace;
            font-size: 10px;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            color: var(--c-text-mute);
            font-weight: 500;
        }
        .form-group input,
        .form-group select,
        .form-group textarea,
        input[type="text"],
        input[type="email"],
        input[type="password"],
        input[type="number"],
        input[type="tel"],
        input[type="date"],
        select,
        textarea {
            width: 100%;
            min-height: 48px;
            padding: 12px 14px;
            background: rgba(6,6,15,0.6);
            border: 1px solid var(--c-border);
            border-radius: 12px;
            color: var(--c-text);
            font-size: 16px;  /* prevents iOS zoom on focus */
            font-family: inherit;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
            -webkit-text-size-adjust: 100%;
            text-transform: none;
        }
        select { appearance: none; -webkit-appearance: none;
            background-image: linear-gradient(45deg, transparent 50%, var(--c-cyan) 50%), linear-gradient(135deg, var(--c-cyan) 50%, transparent 50%);
            background-position: calc(100% - 18px) center, calc(100% - 13px) center;
            background-size: 5px 5px, 5px 5px;
            background-repeat: no-repeat;
            padding-right: 36px;
            cursor: pointer;
        }
        textarea { min-height: 96px; resize: vertical; }
        .form-group input:focus,
        .form-group select:focus,
        .form-group textarea:focus,
        input:focus, select:focus, textarea:focus {
            outline: none;
            border-color: var(--c-border-hot);
            box-shadow: 0 0 0 3px rgba(0,240,255,0.12);
        }
        ::placeholder { color: rgba(151,153,189,0.6); }

        /* ═════════ Buttons ═════════ */
        .btn {
            min-height: 44px;
            padding: 12px 22px;
            background: linear-gradient(135deg, var(--c-cyan) 0%, var(--c-purple) 100%);
            color: #06060F;
            border: none;
            border-radius: 12px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 700;
            font-family: inherit;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: transform 0.15s ease, box-shadow 0.2s ease;
            box-shadow: 0 0 0 1px rgba(0,240,255,0.35), 0 12px 30px -8px rgba(0,240,255,0.4);
        }
        .btn:hover { box-shadow: 0 0 0 1px rgba(0,240,255,0.5), 0 18px 40px -8px rgba(177,74,255,0.5); }
        .btn:active { transform: scale(0.97); }
        .btn-secondary {
            background: rgba(244,244,251,0.06);
            color: var(--c-text);
            border: 1px solid var(--c-border);
            box-shadow: none;
            font-weight: 600;
        }
        .btn-secondary:hover { background: rgba(244,244,251,0.10); border-color: var(--c-border-hot); }
        .btn-danger {
            background: linear-gradient(135deg, #FF5A6E 0%, #B14AFF 100%);
            color: white;
            box-shadow: 0 0 0 1px rgba(255,90,110,0.4), 0 12px 30px -8px rgba(255,90,110,0.4);
        }
        .btn-success {
            background: linear-gradient(135deg, #6FFFB8 0%, #00F0FF 100%);
            color: #06060F;
            box-shadow: 0 0 0 1px rgba(111,255,184,0.4), 0 12px 30px -8px rgba(111,255,184,0.4);
        }
        .btn-small { padding: 8px 14px; font-size: 12px; min-height: 36px; }
        .btn-group { display: flex; gap: 10px; flex-wrap: wrap; }

        /* ═════════ Grids / stat cards ═════════ */
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
            gap: 12px;
        }
        .stat-card {
            background: var(--c-surface);
            backdrop-filter: blur(20px) saturate(160%);
            -webkit-backdrop-filter: blur(20px) saturate(160%);
            border: 1px solid var(--c-border);
            border-radius: 16px;
            padding: 18px;
            text-align: center;
            box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.06);
        }
        .stat-card .value {
            font-family: 'Inter Tight', system-ui, sans-serif;
            font-size: 36px;
            font-weight: 800;
            line-height: 1;
            letter-spacing: -0.03em;
            background: linear-gradient(135deg, #5EE9FF 0%, #B14AFF 100%);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
        }
        .stat-card .label {
            margin-top: 8px;
            font-family: 'Geist Mono', ui-monospace, monospace;
            font-size: 10px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: var(--c-text-mute);
        }

        /* ═════════ Tables ═════════ */
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
        }
        th, td {
            padding: 12px 10px;
            text-align: left;
            border-bottom: 1px solid var(--c-border);
            color: var(--c-text);
        }
        th {
            font-family: 'Geist Mono', ui-monospace, monospace;
            font-size: 10px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: var(--c-text-mute);
            font-weight: 500;
            background: transparent;
        }

        /* ═════════ Candidate / poll rows ═════════ */
        .candidate-row {
            display: flex;
            align-items: center;
            padding: 14px;
            background: rgba(15,15,42,0.4);
            border: 1px solid var(--c-border);
            border-radius: 12px;
            margin-bottom: 10px;
            cursor: pointer;
            transition: border-color 0.18s ease, background 0.18s ease;
        }
        .candidate-row:hover { background: rgba(26,27,61,0.55); border-color: var(--c-border-hot); }
        .candidate-row input[type="radio"] {
            margin-right: 14px;
            accent-color: var(--c-cyan);
            min-height: auto;
            width: 20px; height: 20px;
            cursor: pointer;
        }
        .candidate-info { flex: 1; }
        .candidate-name { font-weight: 600; color: var(--c-text); font-size: 15px; }
        .candidate-party { color: var(--c-text-mute); font-size: 12px; margin-top: 2px; }

        .poll-card {
            background: var(--c-surface);
            backdrop-filter: blur(16px) saturate(160%);
            -webkit-backdrop-filter: blur(16px) saturate(160%);
            border: 1px solid var(--c-border);
            border-radius: 14px;
            padding: 16px;
            margin-bottom: 12px;
            transition: border-color 0.18s ease;
        }
        .poll-card:hover { border-color: var(--c-border-hot); }
        .poll-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px; }
        .share-code {
            background: rgba(0,240,255,0.12);
            color: var(--c-cyan-soft);
            padding: 4px 12px;
            border: 1px solid rgba(0,240,255,0.30);
            border-radius: 999px;
            font-size: 11px;
            font-family: 'Geist Mono', ui-monospace, monospace;
            letter-spacing: 0.08em;
        }

        /* ═════════ Badges ═════════ */
        .poll-type-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 999px;
            font-family: 'Geist Mono', ui-monospace, monospace;
            font-size: 10px;
            font-weight: 500;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }
        .badge-political { background: rgba(177,74,255,0.15); color: #C77BFF; border: 1px solid rgba(177,74,255,0.30); }
        .badge-community { background: rgba(0,240,255,0.12); color: var(--c-cyan-soft); border: 1px solid rgba(0,240,255,0.30); }
        .voted-badge {
            background: rgba(111,255,184,0.12);
            color: var(--c-success);
            padding: 4px 10px;
            border: 1px solid rgba(111,255,184,0.30);
            border-radius: 999px;
            font-size: 11px;
            font-family: 'Geist Mono', ui-monospace, monospace;
            letter-spacing: 0.08em;
        }

        /* ═════════ Misc ═════════ */
        .section { display: none; }
        .section.active { display: block; animation: sectionIn 0.4s cubic-bezier(0.2,0.9,0.3,1); }
        @keyframes sectionIn {
            from { opacity: 0; transform: translateY(8px); }
            to   { opacity: 1; transform: translateY(0); }
        }
        .admin-only { display: none; }
        body.admin-mode .admin-only { display: flex; }
        @media (min-width: 1024px) {
            body.admin-mode .admin-only { display: flex; }
        }

        .search-box { margin-bottom: 14px; }
        .search-box input { background: rgba(6,6,15,0.6); }
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--c-text-mute);
            font-size: 14px;
        }

        /* Override any inline style="color:#333" / color:#666 from server-rendered chunks
           that would otherwise be invisible on dark bg */
        [style*="color:#333"], [style*="color: #333"],
        [style*="color:#1a1a2e"], [style*="color: #1a1a2e"] { color: var(--c-text) !important; }
        [style*="color:#666"], [style*="color: #666"],
        [style*="color:#999"], [style*="color: #999"] { color: var(--c-text-mute) !important; }
        [style*="background:white"], [style*="background: white"],
        [style*="background:#fff"], [style*="background: #fff"],
        [style*="background:#f5f5f5"], [style*="background: #f5f5f5"],
        [style*="background:#f8f8f8"], [style*="background: #f8f8f8"],
        [style*="background:#f9f9f9"], [style*="background: #f9f9f9"] {
            background: var(--c-surface) !important;
            color: var(--c-text) !important;
        }
        [style*="background:#1a1a2e"], [style*="background: #1a1a2e"],
        [style*="background:linear-gradient(135deg, #1a1a2e"] {
            background: transparent !important;
        }
        [style*="border:1px solid #ddd"], [style*="border: 1px solid #ddd"],
        [style*="border:1px solid #eee"], [style*="border: 1px solid #eee"] {
            border-color: var(--c-border) !important;
        }
        [style*="border-bottom:1px solid #444"] { border-color: var(--c-border) !important; }

        /* Reduce motion */
        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
    </style>
</head>
<body>

    <!-- ═══════════ LOGIN OVERLAY (dark glassmorphism) ═══════════ -->
    <div id="loginOverlay" style="position:fixed;inset:0;z-index:2000;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:calc(env(safe-area-inset-top,0px) + 24px) 18px calc(env(safe-area-inset-bottom,0px) + 24px);">
        <div style="position:relative;width:100%;max-width:420px;margin:auto;background:var(--c-surface-strong);backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);border:1px solid rgba(0,240,255,0.22);border-radius:24px;box-shadow:inset 0 1px 0 0 rgba(255,255,255,0.08), 0 40px 120px -20px rgba(0,200,220,0.25);padding:28px 24px;text-align:center;">
            <img src="/logo?v=1778874407" style="width:72px;height:72px;border-radius:18px;margin:0 auto 16px;display:block;box-shadow:0 0 0 1px rgba(0,240,255,0.4), 0 0 40px rgba(177,74,255,0.4);" alt="DataToalha">
            <div style="font-family:'Geist Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:var(--c-text-mute);margin-bottom:8px;">// Plataforma de Votação</div>
            <h2 style="font-family:'Inter Tight',system-ui,sans-serif;font-weight:800;font-size:24px;letter-spacing:-0.02em;background:linear-gradient(135deg,#5EE9FF 0%,#B14AFF 100%);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:20px;">DataToalha</h2>

            <!-- Tab Switcher -->
            <div style="display:flex;gap:4px;margin-bottom:20px;padding:4px;border-radius:12px;background:rgba(6,6,15,0.5);border:1px solid var(--c-border);">
                <button id="loginTab" onclick="switchAuthTab('login')" style="flex:1;min-height:42px;padding:0 12px;border:none;background:linear-gradient(135deg,var(--c-cyan),var(--c-purple));color:#06060F;cursor:pointer;font-weight:700;border-radius:9px;font-family:'Geist Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;">Entrar</button>
                <button id="registerTab" onclick="switchAuthTab('register')" style="flex:1;min-height:42px;padding:0 12px;border:none;background:transparent;color:var(--c-text-mute);cursor:pointer;font-weight:600;border-radius:9px;font-family:'Geist Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;">Registrar</button>
            </div>

            <!-- Login Form -->
            <div id="loginForm">
                <div class="form-group">
                    <input type="text" id="loginUsername" placeholder="E-mail ou nome de usuário" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" style="text-align:center;">
                </div>
                <div class="form-group">
                    <input type="password" id="loginPassword" placeholder="Senha" autocomplete="current-password" style="text-align:center;">
                </div>
                <button class="btn" onclick="doLogin()" style="width:100%;">Entrar</button>
                <div style="margin-top:14px;">
                    <a href="#" onclick="event.preventDefault();showForgotPassword();" style="color:var(--c-cyan-soft);font-size:13px;font-family:'Geist Mono',monospace;letter-spacing:0.04em;text-decoration:none;border-bottom:1px dashed rgba(94,233,255,0.35);padding-bottom:1px;">Esqueci minha senha?</a>
                </div>
            </div>

            <!-- Register Form -->
            <div id="registerForm" style="display:none;">
                <div class="form-group">
                    <input type="text" id="regName" placeholder="Nome completo" autocomplete="name" style="text-align:center;">
                </div>
                <div class="form-group">
                    <input type="email" id="regEmail" placeholder="E-mail" autocomplete="email" inputmode="email" autocapitalize="off" autocorrect="off" spellcheck="false" style="text-align:center;">
                </div>
                <div class="form-group">
                    <input type="text" id="regUsername" placeholder="Nome de usuário" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" style="text-align:center;">
                </div>
                <div class="form-group">
                    <input type="password" id="regPassword" placeholder="Senha (mín. 6 caracteres)" autocomplete="new-password" style="text-align:center;">
                </div>
                <button class="btn" onclick="doRegister()" style="width:100%;">Criar conta</button>
            </div>

            <!-- Forgot password (step 1: request code) -->
            <div id="forgotForm" style="display:none;">
                <p style="color:var(--c-text-mute);font-size:13px;line-height:1.5;margin-bottom:14px;">
                    Digite o e-mail da sua conta. Enviaremos um código de 6 dígitos para você redefinir a senha.
                </p>
                <div class="form-group">
                    <input type="email" id="forgotEmail" placeholder="E-mail da conta" autocomplete="email" inputmode="email" autocapitalize="off" autocorrect="off" spellcheck="false" style="text-align:center;">
                </div>
                <button class="btn" onclick="doForgotPassword()" style="width:100%;">Enviar código</button>
                <div style="margin-top:14px;">
                    <a href="#" onclick="event.preventDefault();switchAuthTab('login');" style="color:var(--c-text-mute);font-size:12px;font-family:'Geist Mono',monospace;letter-spacing:0.04em;text-decoration:none;">← Voltar ao login</a>
                </div>
            </div>

            <!-- Reset password (step 2: enter code + new password) -->
            <div id="resetForm" style="display:none;">
                <p style="color:var(--c-text-mute);font-size:13px;line-height:1.5;margin-bottom:14px;">
                    Verifique seu e-mail e digite o código de 6 dígitos abaixo, junto com sua nova senha.
                </p>
                <div class="form-group">
                    <input type="text" id="resetCode" placeholder="Código (6 dígitos)" inputmode="numeric" maxlength="6" autocomplete="one-time-code" style="text-align:center;letter-spacing:0.4em;font-family:'Geist Mono',monospace;">
                </div>
                <div class="form-group">
                    <input type="password" id="resetNewPassword" placeholder="Nova senha (mín. 6 caracteres)" autocomplete="new-password" style="text-align:center;">
                </div>
                <button class="btn" onclick="doResetPassword()" style="width:100%;">Definir nova senha</button>
                <div style="margin-top:14px;">
                    <a href="#" onclick="event.preventDefault();switchAuthTab('forgot');" style="color:var(--c-text-mute);font-size:12px;font-family:'Geist Mono',monospace;letter-spacing:0.04em;text-decoration:none;">Não recebi o código — reenviar</a>
                </div>
            </div>

            <div id="authError" style="color:var(--c-danger);font-size:13px;margin-top:14px;display:none;padding:10px;background:rgba(255,90,110,0.10);border:1px solid rgba(255,90,110,0.25);border-radius:10px;"></div>

            <!-- OAuth Buttons (hidden in native app — Apple 4.8 requires SIWA if any OAuth present) -->
            <div id="oauth-section" style="margin-top:22px;padding-top:18px;border-top:1px solid var(--c-border);">
                <p style="font-family:'Geist Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:var(--c-text-mute);margin-bottom:14px;">// ou entre com</p>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
                    <button data-oauth="google" onclick="oauthLogin('google')" style="min-height:50px;padding:10px;border:1px solid var(--c-border);border-radius:12px;background:rgba(244,244,251,0.04);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:11px;color:var(--c-text);font-family:'Geist Mono',monospace;letter-spacing:0.06em;text-transform:uppercase;">
                        <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                        Google<span style="display:block;font-size:8px;color:var(--c-warn);letter-spacing:0.08em;margin-top:1px;">EM BREVE</span>
                    </button>
                    <button data-oauth="apple" onclick="oauthLogin('apple')" style="min-height:50px;padding:10px;border:1px solid var(--c-border);border-radius:12px;background:rgba(244,244,251,0.04);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:11px;color:var(--c-text);font-family:'Geist Mono',monospace;letter-spacing:0.06em;text-transform:uppercase;">
                        <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#FFFFFF" d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                        Apple<span style="display:block;font-size:8px;color:var(--c-warn);letter-spacing:0.08em;margin-top:1px;">EM BREVE</span>
                    </button>
                    <button data-oauth="facebook" onclick="oauthLogin('facebook')" style="min-height:50px;padding:10px;border:1px solid var(--c-border);border-radius:12px;background:rgba(244,244,251,0.04);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:11px;color:var(--c-text);font-family:'Geist Mono',monospace;letter-spacing:0.06em;text-transform:uppercase;">
                        <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                        Facebook<span style="display:block;font-size:8px;color:var(--c-warn);letter-spacing:0.08em;margin-top:1px;">EM BREVE</span>
                    </button>
                </div>
            </div>
        </div>
    </div>

    <div id="appContent" style="display:none;">
    <div class="sidebar">
        <div style="text-align:center;margin-bottom:20px;">
            <img src="/logo?v=1778874407" style="max-width:120px;border-radius:8px;" alt="Data Toalha">
        </div>
        <button class="active" onclick="showSection('home')">🏠<span>Início</span></button>
        <button onclick="showSection('vote')">📊<span>Opinar</span></button>
        <button onclick="showSection('results')">📈<span>Resultados</span></button>
        <button onclick="showSection('candidates')">👥<span>Personalidades</span></button>
        <button onclick="showSection('polls')">📝<span>Enquetes</span></button>
        <button onclick="showSection('account')">👤<span>Conta</span></button>
        <!-- <button onclick="showSection('products')">🎁<span>Brindes</span></button> -->  <!-- v1: hidden for App Store IAP scope -->
        <button id="adminMenuBtn" class="admin-only" onclick="showSection('admin')">⚙️<span>Admin</span></button>
        <div style="margin-top:auto;padding-top:20px;border-top:1px solid #444;">
            <p style="font-size:12px;color:#888;margin-bottom:5px;">Conectado como:</p>
            <p style="font-size:14px;color:#4A90D9;margin-bottom:10px;" id="currentUserName">-</p>
            <button onclick="doLogout()" style="background:#444;width:100%;padding:8px;border:none;color:white;border-radius:6px;cursor:pointer;">Logout</button>
        </div>
    </div>

    <div class="main">

        <!-- HOME -->
        <div id="home" class="section active">
            <div style="text-align:center;margin-bottom:20px;">
                <img src="/logo?v=2" style="width:140px;height:140px;border-radius:20px;margin-bottom:10px;" alt="DataToalha">
                <h2 style="font-family:'Inter Tight',system-ui,sans-serif;font-weight:800;font-size:26px;letter-spacing:-0.02em;color:var(--c-text);">Bem-vindo</h2>
            </div>
            
            <div class="grid" style="margin-bottom: 30px;">
                <div class="stat-card">
                    <div class="value" id="totalVotes">0</div>
                    <div class="label">Opiniões registradas</div>
                </div>
                <div class="stat-card">
                    <div class="value" id="totalCandidates">0</div>
                    <div class="label">Personalidades</div>
                </div>
                <div class="stat-card">
                    <div class="value" id="totalCountries">0</div>
                    <div class="label">Países/Regiões</div>
                </div>
                <div class="stat-card">
                    <div class="value" id="totalPolls">0</div>
                    <div class="label">Enquetes ativas</div>
                </div>
            </div>
            
            <div class="card" style="border:1px solid rgba(255,203,71,0.25);background:linear-gradient(135deg,rgba(26,27,61,0.7),rgba(15,15,42,0.6));">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                    <h3 style="margin:0;">🔥 Em Alta</h3>
                    <span style="font-size:10px;color:var(--c-text-dim);font-family:'Geist Mono',monospace;letter-spacing:0.1em;text-transform:uppercase;">Trending</span>
                </div>
                <div id="trendingSection" style="display:flex;flex-direction:column;gap:10px;">
                    <p style="color:var(--c-text-mute);font-size:13px;">Carregando...</p>
                </div>
            </div>

            <div class="card">
                <h3>Acoes rapidas</h3>
                <div class="btn-group">
                    <button class="btn" onclick="showSection('vote')">📊 Opinar agora</button>
                    <button class="btn btn-secondary" onclick="showSection('results')">📈 Ver resultados</button>
                    <button class="btn btn-secondary" onclick="showSection('polls')">📝 Criar enquete</button>
                </div>
            </div>

            <div class="card" style="margin-top:20px;">
                <h3>📬 Contato</h3>
                <p style="color:var(--c-text-mute);font-size:13px;margin-bottom:15px;">Entre em contato para pesquisas de mercado, satisfação, eleitorais ou personalizadas.</p>
                <div style="display:flex;flex-direction:column;gap:12px;">
                    <div class="form-group"><input type="text" id="contactName" placeholder="Nome completo *"></div>
                    <div class="form-group"><input type="email" id="contactEmail" placeholder="E-mail *"></div>
                    <div class="form-group"><input type="tel" id="contactPhone" placeholder="Telefone"></div>
                    <div class="form-group"><input type="text" id="contactCity" placeholder="Cidade"></div>
                    <div class="form-group">
                        <select id="contactInterest">
                            <option value="">Tipo de interesse</option>
                            <option value="Pesquisa de Mercado">Pesquisa de Mercado</option>
                            <option value="Satisfação do Cliente">Satisfação do Cliente</option>
                            <option value="Pesquisa Eleitoral">Pesquisa Eleitoral</option>
                            <option value="Outros / Personalizado">Outros / Personalizado</option>
                        </select>
                    </div>
                </div>
                <button class="btn" style="margin-top:15px;width:100%;" onclick="submitContact()">Enviar</button>
                <p id="contactStatus" style="margin-top:10px;font-size:13px;"></p>
            </div>
        </div>

        <!-- VOTE -->
        <div id="vote" class="section">
            <div class="header">
                <div style="display:flex;align-items:center;gap:10px;"><img src="/logo?v=2" style="width:36px;height:36px;border-radius:8px;" alt=""><h2>Sua opinião conta</h2></div>
            </div>
            
            <div class="card">
                <h3>Passo 1: Tipo de pesquisa</h3>
                <div class="form-group">
                    <label>Sobre qual tema você quer dar sua opinião?</label>
                    <select id="electionType" onchange="onElectionTypeChange()">
                        <option value="">Selecione o tipo de pesquisa</option>
                        <option value="political">🏛️ Pesquisa política (Presidente, Governador, etc.)</option>
                        <option value="community">👥 Pesquisa de opinião</option>
                    </select>
                </div>
            </div>
            
            <div id="politicalSection" style="display:none;">
                <div class="card">
                    <h3>Passo 2: Cargo</h3>
                    <div class="form-group">
                        <label>Cargo *</label>
                        <select id="roleSelect" onchange="onRoleChange()">
                            <option value="">Selecione o cargo</option>
                            <option value="President">Presidente (Nacional)</option>
                            <option value="Senator">Senador (Nacional)</option>
                            <option value="Governor">Governador (Estadual)</option>
                            <option value="Mayor">Prefeito (Municipal)</option>
                            <option value="MP">Deputado Federal (Estadual)</option>
                            <option value="Deputy">Deputado Estadual</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>País *</label>
                        <select id="countrySelect" onchange="onCountryChange()">
                            <option value="">Selecione o país</option>
                        </select>
                    </div>
                    
                    <div class="form-group" id="stateGroup" style="display:none;">
                        <label>Estado * (digite para buscar)</label>
                        <input type="text" id="stateInput" placeholder="Digite o nome do estado..." list="statesList" oninput="onStateInput()">
                        <datalist id="statesList"></datalist>
                    </div>
                    
                    <div id="candidatesList"></div>
                </div>
            </div>
            
            <div id="communitySection" style="display:none;">
                <div class="card" id="categorySelectCard">
                    <h3>Passo 2: Categoria</h3>
                    <div class="form-group">
                        <select id="categorySelect" onchange="onCategoryChange()">
                            <option value="">Selecione uma categoria</option>
                        </select>
                    </div>
                </div>
                
                <div class="card" id="pollListCard" style="display:none;">
                    <h3>Passo 3: Enquetes disponíveis</h3>
                    <button class="btn btn-small btn-secondary" onclick="backToCategories()" style="margin-bottom:15px;">← Voltar às categorias</button>
                    <div id="availablePollsList"></div>
                </div>
                
                <div class="card" id="pollVotingCard" style="display:none;">
                    <h3>Passo 4: Sua opinião</h3>
                    <button class="btn btn-small btn-secondary" onclick="backToPollList()" style="margin-bottom:15px;">← Voltar às enquetes</button>
                    <div id="pollVotingOptions"></div>
                </div>
            </div>
            
            <div class="card">
                <p style="color:#666;">Conectado como: <strong id="voterNameDisplay" style="color:#4A90D9;"></strong></p>
                <button class="btn" onclick="submitVote()" style="margin-top: 20px;">Enviar opinião</button>
            </div>
        </div>

        <!-- RESULTS -->
        <div id="results" class="section">
            <div class="header">
                <div style="display:flex;align-items:center;gap:10px;"><img src="/logo?v=2" style="width:36px;height:36px;border-radius:8px;" alt=""><h2>Resultados das pesquisas</h2></div>
                <button class="btn btn-secondary" onclick="loadResults()">🔄 Atualizar</button>
            </div>
            
            <div id="resultsMainView">
                <div class="card">
                    <h3>Pesquisas politicas <span style="font-size:10px;color:#4caf50;background:rgba(76,175,80,0.15);padding:2px 6px;border-radius:4px;vertical-align:middle;font-weight:600;">Oficial by DataToalha</span></h3>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
                        <select id="polFilterCountry" onchange="filterPoliticalResults()" style="flex:1;min-width:120px;"><option value="">Todos os paises</option></select>
                        <select id="polFilterScope" onchange="filterPoliticalResults()" style="flex:1;min-width:120px;">
                            <option value="">Todos os niveis</option>
                            <option value="national">Nacional (Presidente/Senador/Deputado)</option>
                            <option value="regional">Regional (Governador/Prefeito)</option>
                        </select>
                        <select id="polFilterRole" onchange="filterPoliticalResults()" style="flex:1;min-width:120px;"><option value="">Todos os cargos</option></select>
                    </div>
                    <div id="politicalResults"></div>
                </div>

                <div class="card">
                    <h3>Enquetes por categoria</h3>
                    <div class="form-group">
                        <label>Buscar por codigo da enquete:</label>
                        <input type="text" id="pollCodeSearch" placeholder="Digite o codigo da enquete..." oninput="searchPollByCode()" style="margin-bottom:10px;">
                    </div>
                    <div id="searchResult"></div>
                    <div class="form-group">
                        <label>Selecione a categoria:</label>
                        <select id="resultsCategorySelect" onchange="loadCommunityResults()">
                            <option value="">Todas as categorias (Geral)</option>
                        </select>
                    </div>
                    <div id="communityResults"></div>
                </div>
            </div>
            <div id="resultsDetailView" style="display:none;"></div>
        </div>

        <!-- CANDIDATES -->
        <div id="candidates" class="section">
            <div class="header">
                <div style="display:flex;align-items:center;gap:10px;"><img src="/logo?v=2" style="width:36px;height:36px;border-radius:8px;" alt=""><h2>Personalidades</h2></div>
            </div>
            
            <div class="search-box">
                <input type="text" id="candidateSearch" placeholder="Buscar por nome, partido, pais, cargo..." oninput="loadCandidatesList()" autocapitalize="off" autocorrect="off">
            </div>
            
            <div class="card">
                <div id="candidatesTable"></div>
            </div>
        </div>

        <!-- POLLS -->
        <div id="polls" class="section">
            <div class="header">
                <div style="display:flex;align-items:center;gap:10px;"><img src="/logo?v=2" style="width:36px;height:36px;border-radius:8px;" alt=""><h2>Minhas enquetes</h2></div>
                <button class="btn" onclick="showCreatePollForm()">+ Criar enquete</button>
            </div>
            
            <div id="pollsList"></div>
        </div>

        <!-- PRODUCTS -->
        <div id="products" class="section" style="display:none !important;">
            <div class="header">
                <div style="display:flex;align-items:center;gap:10px;"><img src="/logo?v=2" style="width:36px;height:36px;border-radius:8px;" alt=""><h2>🎁 Products & Donations</h2></div>
                <button class="btn" onclick="showAddProductForm()">+ Add Product</button>
            </div>
            
            <div class="card">
                <h3>How It Works</h3>
                <p style="color:#666;line-height:1.6;">
                    Purchase products and send as donations to friends!<br><br>
                    1. Browse products below and click "Buy as Gift"<br>
                    2. Enter recipient's name and contact info<br>
                    3. Recipient must create an account and vote in this poll to claim their gift<br><br>
                    <strong>Note:</strong> To receive a donation, the recipient needs to register, login, and cast their vote in the same poll where the product was sent.
                </p>
            </div>
            
            <div class="card">
                <h3>Available Products</h3>
                <div id="productsList"></div>
            </div>
            
            <div class="card">
                <h3>🎁 Redeem Voucher</h3>
                <p style="color:#666;margin-bottom:15px;">Received a gift? Enter your voucher code to claim it!</p>
                <div class="form-group">
                    <label>Voucher Code *</label>
                    <input type="text" id="redeemVoucherCode" placeholder="Enter voucher code">
                </div>
                <div class="form-group">
                    <label>Your Name *</label>
                    <input type="text" id="redeemName" placeholder="Your full name">
                </div>
                <div class="form-group">
                    <label>Email *</label>
                    <input type="email" id="redeemEmail" placeholder="your@email.com">
                </div>
                <div class="form-group">
                    <label>Telephone</label>
                    <input type="text" id="redeemTelephone" placeholder="+55 11 99999-9999">
                </div>
                <div class="form-group">
                    <label>Delivery Address *</label>
                    <input type="text" id="redeemAddress" placeholder="Full delivery address">
                </div>
                <button class="btn" onclick="redeemVoucher()">Redeem Voucher</button>
            </div>
            
            <div class="card">
                <h3>My Gift Orders</h3>
                <div id="myProductOrders"></div>
            </div>
        </div>

        <!-- ACCOUNT (Apple App Store 5.1.1(v) — delete-account mandatory) -->
        <div id="account" class="section">
            <div class="header">
                <div style="display:flex;align-items:center;gap:10px;"><img src="/logo?v=2" style="width:36px;height:36px;border-radius:8px;" alt=""><h2>Sua conta</h2></div>
            </div>

            <div class="card">
                <h3>Informações da conta</h3>
                <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;align-items:baseline;">
                    <span style="color:var(--c-text-mute);font-size:13px;">Nome:</span>
                    <span style="color:var(--c-text);font-size:15px;font-weight:600;" id="accountName">-</span>
                    <span style="color:var(--c-text-mute);font-size:13px;">Usuário:</span>
                    <span style="color:var(--c-text);font-size:15px;" id="accountUsername">-</span>
                    <span style="color:var(--c-text-mute);font-size:13px;">E-mail:</span>
                    <span style="color:var(--c-cyan-soft);font-size:15px;" id="accountEmail">-</span>
                    <span style="color:var(--c-text-mute);font-size:13px;">Membro desde:</span>
                    <span style="color:var(--c-text);font-size:15px;" id="accountSince">-</span>
                </div>
            </div>

            <div class="card">
                <h3>Privacidade e termos</h3>
                <p style="color:var(--c-text-mute);font-size:14px;line-height:1.6;margin-bottom:14px;">
                    Leia como tratamos seus dados e os termos de uso do aplicativo.
                </p>
                <div class="btn-group">
                    <div style="max-height:0;overflow:hidden;transition:max-height 0.3s;" id="privacyFull">
                        <div style="padding:12px;background:rgba(255,255,255,0.04);border-radius:10px;margin-bottom:10px;font-size:12px;color:var(--c-text-mute);line-height:1.7;">
                            <p><strong style="color:var(--c-text);">1. Dados Coletados:</strong> Nome, email, senha (criptografada com scrypt), votos e enquetes. Opcionalmente: telefone, cidade, tipo de interesse.</p>
                            <p><strong style="color:var(--c-text);">2. Uso dos Dados:</strong> Autenticacao, exibicao de resultados (anonimizados), recuperacao de senha e resposta a contatos.</p>
                            <p><strong style="color:var(--c-text);">3. Armazenamento:</strong> Servidores privados. Senhas criptografadas com scrypt (N=16384). Nao armazenamos senhas em texto plano.</p>
                            <p><strong style="color:var(--c-text);">4. Compartilhamento:</strong> Nao vendemos, alugamos ou compartilhamos dados pessoais. Resultados exibidos de forma agregada e anonima.</p>
                            <p><strong style="color:var(--c-text);">5. Cookies e Tokens:</strong> Tokens de sessao HMAC-SHA256, 24h de validade. Sem cookies de rastreamento de terceiros.</p>
                            <p><strong style="color:var(--c-text);">6. Direitos:</strong> Acesse, corrija ou exclua seus dados a qualquer momento em Conta > Excluir conta.</p>
                            <p><strong style="color:var(--c-text);">7. Rastreamento:</strong> Nao utilizamos IDFA, AdSupport ou SDKs de rastreamento. Nao coletamos dados de localizacao do dispositivo.</p>
                        </div>
                    </div>
                    <button class="btn btn-secondary" onclick="var el=document.getElementById('privacyFull');el.style.maxHeight=el.style.maxHeight==='0px'||!el.style.maxHeight?'600px':'0px'">Politica de privacidade</button>

                    <div style="max-height:0;overflow:hidden;transition:max-height 0.3s;margin-top:10px;" id="touFull">
                        <div style="padding:12px;background:rgba(255,255,255,0.04);border-radius:10px;margin-bottom:10px;font-size:12px;color:var(--c-text-mute);line-height:1.7;">
                            <p><strong style="color:var(--c-text);">1. Aceitacao:</strong> Ao usar o DataToalha, voce concorda com estes termos.</p>
                            <p><strong style="color:var(--c-text);">2. Servico:</strong> Plataforma de pesquisa de opiniao e enquetes comunitarias.</p>
                            <p><strong style="color:var(--c-text);">3. Conta:</strong> Voce e responsavel pela confidencialidade da sua conta. Idade minima: 13 anos.</p>
                            <p><strong style="color:var(--c-text);">4. Conteudo:</strong> Conteudo difamatorio, discriminatorio ou ilegal sera removido. Usuarios podem denunciar conteudo inadequado.</p>
                            <p><strong style="color:var(--c-text);">5. Conduta Proibida:</strong> Manipulacao de votos, contas falsas, assedio, conteudo ilegal, comprometimento da seguranca.</p>
                            <p><strong style="color:var(--c-text);">6. Exclusao:</strong> Exclua sua conta a qualquer momento. Dados removidos permanentemente.</p>
                            <p><strong style="color:var(--c-text);">7. Propriedade:</strong> DataToalha e propriedade da Xpirit AI.</p>
                            <p><strong style="color:var(--c-text);">8. Apple:</strong> Estes termos sao entre voce e a Xpirit AI, nao com a Apple. Uso sujeito aos <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" style="color:var(--c-cyan-soft);">Termos de Servicos de Midia da Apple</a>.</p>
                        </div>
                    </div>
                    <button class="btn btn-secondary" style="margin-top:8px;" onclick="var el=document.getElementById('touFull');el.style.maxHeight=el.style.maxHeight==='0px'||!el.style.maxHeight?'600px':'0px'">Termos de uso</button>

                    <p style="font-size:13px;color:var(--c-cyan-soft);margin-top:14px;"><a href="mailto:contact@datatoalha.com" style="color:var(--c-cyan-soft);">contact@datatoalha.com</a></p>
                </div>
            </div>

            <div class="card">
                <h3>Sessão</h3>
                <p style="color:var(--c-text-mute);font-size:14px;margin-bottom:14px;">
                    Encerre sua sessão neste aparelho.
                </p>
                <button class="btn btn-secondary" onclick="doLogout()">Sair desta sessão</button>
            </div>

            <div class="card" style="border:1px solid rgba(255,90,110,0.30);">
                <h3 style="color:var(--c-danger);">Excluir minha conta</h3>
                <p style="color:var(--c-text-mute);font-size:14px;line-height:1.6;margin-bottom:14px;">
                    Esta acao apaga permanentemente sua conta, suas opinioes, suas enquetes e
                    qualquer voucher associado. <strong>Nao pode ser desfeita.</strong>
                </p>
                <p style="color:var(--c-text-mute);font-size:14px;line-height:1.6;margin-bottom:14px;">
                    Para confirmar, digite a palavra <strong style="color:var(--c-danger);">EXCLUIR</strong> e sua senha:
                </p>
                <div class="form-group">
                    <label>Confirmacao</label>
                    <input type="text" id="deleteConfirm" placeholder="Digite EXCLUIR" autocomplete="off">
                </div>
                <div class="form-group">
                    <label>Senha</label>
                    <input type="password" id="deletePassword" placeholder="Sua senha" autocomplete="current-password">
                </div>
                <button class="btn" style="background:rgba(255,90,110,0.18);color:var(--c-danger);border:1px solid rgba(255,90,110,0.45);" onclick="doDeleteAccount()">Excluir conta permanentemente</button>
                <p id="deleteAccountStatus" style="margin-top:12px;font-size:13px;"></p>
            </div>
        </div>

        <!-- ADMIN -->
        <div id="admin" class="section">
            <div class="header">
                <div style="display:flex;align-items:center;gap:10px;"><img src="/logo?v=2" style="width:36px;height:36px;border-radius:8px;" alt=""><h2>Painel administrativo</h2></div>
            </div>

            <!-- Admin stats -->
            <div class="card">
                <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                    <span>Personalidades: <strong id="adminCandidates">0</strong></span>
                    <span>Opinioes: <strong id="adminVotes">0</strong></span>
                    <span>Enquetes: <strong id="adminPolls">0</strong></span>
                </div>
            </div>

            <!-- Admin tabs -->
            <div style="display:flex;gap:4px;overflow-x:auto;margin-bottom:16px;padding-bottom:4px;">
                <button class="btn btn-small" onclick="showAdminTab('enquetes')" id="adminTab_enquetes" style="white-space:nowrap;">📝 Enquetes</button>
                <button class="btn btn-small btn-secondary" onclick="showAdminTab('personalidades')" id="adminTab_personalidades" style="white-space:nowrap;">👥 Personalidades</button>
                <button class="btn btn-small btn-secondary" onclick="showAdminTab('emalta')" id="adminTab_emalta" style="white-space:nowrap;">🔥 Em Alta</button>
                <button class="btn btn-small btn-secondary" onclick="showAdminTab('usuarios')" id="adminTab_usuarios" style="white-space:nowrap;">👤 Usuarios</button>
                <button class="btn btn-small btn-secondary" onclick="showAdminTab('moderacao')" id="adminTab_moderacao" style="white-space:nowrap;">🚩 Moderacao</button>
                <button class="btn btn-small btn-secondary" onclick="showAdminTab('dados')" id="adminTab_dados" style="white-space:nowrap;">⚠️ Dados</button>
            </div>

            <!-- TAB: Enquetes (pending + approved) -->
            <div id="adminPanel_enquetes">
                <div class="card">
                    <h3>Pendentes (aguardando aprovacao)</h3>
                    <div id="adminPendingPollsList"></div>
                </div>
                <div class="card">
                    <h3>Aprovadas</h3>
                    <div id="adminPollsList"></div>
                </div>
            </div>

            <!-- TAB: Personalidades (organized by enquete) -->
            <div id="adminPanel_personalidades" style="display:none;">
                <div class="card">
                    <h3>Filtrar por enquete</h3>
                    <div id="adminPollButtons" style="display:flex;flex-wrap:wrap;gap:6px;max-height:200px;overflow-y:auto;padding:4px 0;"></div>
                    <input type="hidden" id="adminPollSelector" value="">
                </div>
                <div class="card">
                    <h3>➕ Adicionar personalidade</h3>
                    <div style="display:flex;flex-direction:column;gap:10px;">
                        <div class="form-group"><input type="text" id="newCandidateName" placeholder="Nome *"></div>
                        <div class="form-group"><input type="text" id="newCandidateParty" placeholder="Descricao/posicao (ex: Goleiro, PT)"></div>
                        <div class="form-group">
                            <select id="newCandidateCountry" onchange="loadAdminStates()">
                                <option value="">Pais *</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <select id="newCandidateState" onchange="loadAdminCities()"><option value="">Estado</option></select>
                        </div>
                        <div class="form-group">
                            <select id="newCandidateCity"><option value="">Cidade</option></select>
                        </div>
                        <div class="form-group">
                            <select id="newCandidateRole">
                                <option value="President">President</option>
                                <option value="Senator">Senator</option>
                                <option value="Governor">Governor</option>
                                <option value="Mayor">Mayor</option>
                                <option value="MP">MP</option>
                                <option value="Deputy">Deputy</option>
                                <option value="Copa 2026">Copa 2026</option>
                                <option value="Comunidade">Comunidade</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Foto</label>
                            <div class="photo-input">
                                <div class="preview" id="candPhotoPreview">📷</div>
                                <div class="controls">
                                    <label class="btn btn-secondary btn-small" for="candPhotoFile">Selecionar</label>
                                    <input type="file" id="candPhotoFile" accept="image/*" onchange="handleCandPhoto(event)">
                                    <input type="hidden" id="candPhotoUrl">
                                </div>
                            </div>
                        </div>
                    </div>
                    <button class="btn" style="margin-top:10px;width:100%;" onclick="addCandidate()">Adicionar</button>
                </div>
                <div class="card">
                    <h3>Personalidades</h3>
                    <div class="search-box">
                        <input type="text" id="adminCandidateSearch" placeholder="Buscar..." oninput="loadAdminCandidatesForPoll()">
                    </div>
                    <div id="adminCandidatesList"></div>
                </div>
            </div>

            <!-- TAB: Em Alta (algorithm + override) -->
            <div id="adminPanel_emalta" style="display:none;">
                <div class="card">
                    <h3>🔥 Algoritmo "Em Alta"</h3>
                    <p style="color:var(--c-text-mute);font-size:12px;margin-bottom:12px;">Algoritmo: <strong>votos × 2 + engajamento (chat) × 3 + novidade (decai em 7 dias) × 10 + peso admin + keywords</strong>. Marque as enquetes para destaque manual (override do algoritmo).</p>
                    <div class="form-group">
                        <label>Adicionar keyword de destaque</label>
                        <div style="display:flex;gap:8px;align-items:center;">
                            <input type="text" id="adminNewKeyword" placeholder="Ex: copa, presidente, neymar" style="flex:1;" onkeydown="if(event.key==='Enter')addKeyword()">
                            <button class="btn btn-small" onclick="addKeyword()">+ Adicionar</button>
                        </div>
                        <span class="hint">Cada keyword ativa ganha o peso configurado no slider (0-100)</span>
                    </div>
                    <div id="adminKeywordsList" style="margin-bottom:12px;"></div>
                    <div id="adminTrendingList"></div>
                    <div style="display:flex;gap:8px;margin-top:10px;">
                        <button class="btn btn-secondary" style="flex:1;" onclick="saveTrendingOverride()">Salvar destaques</button>
                        <button class="btn btn-secondary" style="flex:1;" onclick="clearTrendingOverride()">Resetar (algoritmo)</button>
                    </div>
                </div>
                <div class="card">
                    <h3>🏆 Ordenacao de enquetes</h3>
                    <div id="pollRankingList"></div>
                </div>
            </div>

            <!-- TAB: Usuarios -->
            <div id="adminPanel_usuarios" style="display:none;">
                <div class="card">
                    <h3>👥 Usuarios registrados</h3>
                    <div id="adminUsersList" style="overflow-x:auto;"></div>
                </div>
                <div class="card">
                    <h3>📬 Contatos recebidos</h3>
                    <div id="adminContactsList" style="overflow-x:auto;"></div>
                </div>
            </div>

            <!-- TAB: Moderacao -->
            <div id="adminPanel_moderacao" style="display:none;">
                <div class="card">
                    <h3>🚩 Denuncias de chat</h3>
                    <div id="adminChatReports" style="overflow-x:auto;"></div>
                </div>
                <div class="card">
                    <h3>📦 Produtos</h3>
                    <div id="adminProductsList"></div>
                </div>
            </div>

            <!-- TAB: Dados -->
            <div id="adminPanel_dados" style="display:none;">
                <div class="card">
                    <h3>⚠️ Gerenciamento de dados</h3>
                    <div class="btn-group">
                        <button class="btn btn-danger" onclick="clearVotes()">Limpar todas as opinioes</button>
                        <button class="btn btn-secondary" onclick="exportData()">Exportar dados</button>
                    </div>
                </div>
            </div>
        </div>

        <div id="createPollModal" style="display:none;position:fixed;inset:0;z-index:100;background:rgba(6,6,15,0.78);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:calc(env(safe-area-inset-top,0px) + 16px) 16px calc(env(safe-area-inset-bottom,0px) + 16px);">
            <div style="position:relative;width:100%;max-width:480px;margin:auto;background:linear-gradient(135deg,rgba(26,27,61,0.85),rgba(10,10,31,0.78));backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);border:1px solid rgba(0,240,255,0.22);border-radius:24px;padding:28px 24px;">
                <button onclick="closeCreatePollModal()" aria-label="Fechar" style="position:absolute;top:12px;right:12px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(6,6,15,0.4);color:rgba(244,244,251,0.85);font-size:22px;line-height:1;border:1px solid rgba(255,255,255,0.12);cursor:pointer;">×</button>
                <div style="font-family:'Geist Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:var(--c-text-mute);margin-bottom:6px;">// Nova enquete</div>
                <h2 style="font-family:'Inter Tight',system-ui,sans-serif;font-weight:800;font-size:22px;letter-spacing:-0.02em;color:var(--c-text);margin-bottom:20px;">Criar enquete de opinião</h2>
                <div class="form-group">
                    <label>Pergunta *</label>
                    <input type="text" id="newPollTitle" placeholder="Ex: Qual o maior desafio do seu bairro?" maxlength="200">
                </div>
                <div class="form-group">
                    <label>Categoria *</label>
                    <select id="newPollCategory"></select>
                </div>
                <div class="form-group">
                    <label>Descrição (opcional)</label>
                    <textarea id="newPollDescription" placeholder="Contexto adicional para os participantes" rows="3" maxlength="500"></textarea>
                </div>
                <div class="form-group">
                    <label>Opcoes * (separadas por virgula)</label>
                    <input type="text" id="newPollOptions" placeholder="Ex: Neymar, Vinicius Jr, Casemiro">
                    <button class="btn btn-secondary btn-small" style="margin-top:8px;" onclick="expandPollOptions()">+ Adicionar detalhes por opcao</button>
                </div>
                <div id="pollOptionDetails" style="display:none;">
                    <label style="font-size:12px;color:var(--c-text-mute);margin-bottom:6px;display:block;">Detalhes por opcao (descricao, posicao, etc.):</label>
                    <div id="pollOptionRows"></div>
                </div>
                <div class="form-group">
                    <label>Capa da enquete (opcional)</label>
                    <div class="photo-input">
                        <div class="preview" id="pollCoverPreview">🖼️</div>
                        <div class="controls">
                            <label class="btn btn-secondary btn-small" for="pollCoverFile">Selecionar capa</label>
                            <input type="file" id="pollCoverFile" accept="image/*" onchange="handlePollCover(event)">
                            <input type="hidden" id="pollCoverUrl">
                            <span class="hint">JPEG/PNG, max 5 MB</span>
                        </div>
                    </div>
                </div>
                <p style="font-size:12px;color:var(--c-text-mute);margin-bottom:14px;">Sua enquete será revisada antes de ficar visível ao público.</p>
                <div style="display:flex;gap:10px;flex-wrap:wrap;">
                    <button class="btn" onclick="submitCreatePoll()" style="flex:1;">Enviar para revisão</button>
                    <button class="btn btn-secondary" onclick="closeCreatePollModal()">Cancelar</button>
                </div>
            </div>
        </div>
    </div>  <!-- .main -->
    </div>  <!-- #appContent -->

    <script>
        let countriesData = [];
        let currentPollId = null;
        let currentPollType = null;
        let selectedCandidateId = null;
        let selectedCandidateName = null;
        
        const GLOBAL_ROLES = ['President', 'Senator'];
        const STATE_ROLES = ['Governor', 'Mayor', 'MP', 'Deputy'];
        
        const POLL_CATEGORIES = ['Futebol', 'Music', 'Celebrities', 'YouTubers', 'TV Programs', 'Movies', 'Sports', 'Technology', 'Gaming', 'Food', 'Travel', 'Fashion', 'Education', 'Politics', 'Science', 'Other'];
        
        let selectedCategory = null;
        let selectedPollId = null;
        
        function showSection(id) {
            if (typeof stopChatRefresh === 'function') stopChatRefresh();
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            document.getElementById(id).classList.add('active');
            document.querySelectorAll('.sidebar button').forEach(b => b.classList.remove('active'));
            if (event && event.target) event.target.classList.add('active');
            
            if (id === 'home') loadStats();
            if (id === 'vote') loadVoteForm();
            if (id === 'results') loadResults();
            if (id === 'candidates') loadCandidatesList();
            if (id === 'polls') loadPolls();
            if (id === 'products') loadProducts();
            if (id === 'admin') loadAdmin();
            if (id === 'account' && typeof loadAccountInfo === 'function') loadAccountInfo();
        }
        
        // Detect base path (for proxy/subpath deployments)
        // Admin-mode flag — set when wrapper URL is /app?admin=1.
        // After login, if user is admin, jump straight to #admin section
        // (instead of #home) and tag the body so admin-only UI shows.
        const ADMIN_WRAPPER = (function() {
            try {
                const params = new URLSearchParams(window.location.search);
                return params.get('admin') === '1';
            } catch (e) { return false; }
        })();

                const BASE = (function() {
            const p = window.location.pathname;
            // If served under /app, API calls go to /app/api
            if (p.startsWith('/app')) return '/app';
            return '';
        })();

        async function api(path, method = 'GET', body = null) {
            try {
                const options = { method, headers: { 'Content-Type': 'application/json' } };
                var tk = localStorage.getItem('dt_app_token'); try { if (authToken) tk = authToken; } catch(_) {}
                if (tk) options.headers['Authorization'] = 'Bearer ' + tk;
                if (body) options.body = JSON.stringify(body);
                const res = await fetch(BASE + '/api' + path, options);
                return res.json();
            } catch (e) {
                console.error('API Error:', e);
                alert('Error: ' + e.message);
                return null;
            }
        }
        
        async function loadTrending() {
            const el = document.getElementById('trendingSection');
            if (!el) return;
            try {
                const [votes, polls, pollVotes, candidates] = await Promise.all([
                    api('/votes'), api('/polls?type=community&approved=true'), api('/poll-votes'), api('/all-candidates')
                ]);
                let html = '';

                // ── Political trending: top candidates by vote count ──
                const polVotes = (votes || []).filter(v => v.electionType === 'political');
                const candStats = {};
                polVotes.forEach(v => {
                    (v.choices || []).forEach(c => {
                        const key = c.candidateName;
                        if (!candStats[key]) candStats[key] = { name: key, country: v.country, role: v.role, count: 0 };
                        candStats[key].count++;
                    });
                });
                const topCands = Object.values(candStats).sort((a,b) => b.count - a.count).slice(0, 5);

                // Default: show Brazil Presidential if no votes yet
                if (topCands.length === 0) {
                    const brazilPres = (candidates || []).filter(c => c.country === 'Brazil' && c.role === 'President');
                    html += '<div style="margin-bottom:6px;display:flex;align-items:center;gap:6px;"><span style="font-size:10px;color:var(--c-warn);font-family:monospace;letter-spacing:0.1em;">POLITICA — PRESIDENTE BRASIL</span><span style="font-size:9px;color:#4caf50;background:rgba(76,175,80,0.15);padding:1px 5px;border-radius:4px;">Oficial by DataToalha</span></div>';
                    brazilPres.forEach(c => {
                        html += '<div style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(255,255,255,0.04);border-radius:8px;margin-bottom:4px;cursor:pointer;" onclick="goToVoteDirect(\\x27Brazil\\x27,\\x27President\\x27)">';
                        html += '<div style="width:32px;height:32px;border-radius:50%;background:var(--c-surface-strong);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:var(--c-cyan);">' + (c.name||'?').charAt(0) + '</div>';
                        html += '<div style="flex:1;"><p style="font-size:13px;color:var(--c-text);font-weight:600;">' + c.name + '</p>';
                        html += '<p style="font-size:11px;color:var(--c-text-dim);">' + (c.party||'') + '</p></div>';
                        html += '<span style="font-size:11px;color:var(--c-cyan-soft);">Opinar →</span></div>';
                    });
                } else {
                    html += '<div style="margin-bottom:6px;display:flex;align-items:center;gap:6px;"><span style="font-size:10px;color:var(--c-warn);font-family:monospace;letter-spacing:0.1em;">POLITICA</span><span style="font-size:9px;color:#4caf50;background:rgba(76,175,80,0.15);padding:1px 5px;border-radius:4px;">Oficial by DataToalha</span></div>';
                    topCands.forEach((c, i) => {
                        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i+1) + '.';
                        html += '<div style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(255,255,255,0.04);border-radius:8px;margin-bottom:4px;cursor:pointer;" onclick="goToVoteDirect(\\x27' + c.country + '\\x27,\\x27' + c.role + '\\x27)">';
                        html += '<span style="font-size:16px;min-width:24px;text-align:center;">' + medal + '</span>';
                        html += '<div style="flex:1;"><p style="font-size:13px;color:var(--c-text);font-weight:600;">' + c.name + '</p>';
                        html += '<p style="font-size:11px;color:var(--c-text-dim);">' + c.role + ' — ' + c.country + '</p></div>';
                        html += '<span style="font-size:13px;font-weight:700;color:var(--c-cyan-soft);">' + c.count + '</span></div>';
                    });
                }

                // ── Community trending: top polls by vote count (admin rankings override) ──
                const approvedPolls = (polls || []).filter(p => p.approved);
                if (approvedPolls.length > 0) {
                    const pVotes = pollVotes || [];
                    // Algorithm: votes × 2 + chat engagement × 3 + recency × 10 + keyword match × 20 + admin override
                    var _kwData = []; try { _kwData = JSON.parse(localStorage.getItem('dt_trending_keywords_v2') || '[]'); } catch(_e) {}
                    var keywords = _kwData.filter(function(k){return k.active;});
                    var chatCounts = {};
                    Object.keys(window._adminTrendingOverride || {}).length; // just reference
                    var scored = approvedPolls.map(function(p) {
                        var voteCount = pVotes.filter(function(v) { return v.pollId === p.id; }).length;
                        var ageHours = (Date.now() - new Date(p.createdAt || 0).getTime()) / 3600000;
                        var recencyBoost = Math.max(0, 1 - ageHours / 168);
                        var keywordBoost = 0;
                        var titleLower = (p.title || '').toLowerCase();
                        keywords.forEach(function(kw) { if (kw.word && titleLower.indexOf(kw.word) > -1) keywordBoost += (kw.weight || 20); });
                        var adminRank = (window._adminTrendingOverride || {})[p.id];
                        var score = adminRank != null ? (1000 - adminRank) : (voteCount * 2 + recencyBoost * 10 + keywordBoost);
                        return { id:p.id, title:p.title, category:p.category, voteCount:voteCount, score:score };
                    }).sort(function(a,b) { return b.score - a.score; }).slice(0, 4);

                    html += '<div style="margin-top:12px;margin-bottom:6px;"><span style="font-size:10px;color:var(--c-warn);font-family:monospace;letter-spacing:0.1em;">ENQUETES</span></div>';
                    scored.forEach(p => {
                        html += '<div style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(255,255,255,0.04);border-radius:8px;margin-bottom:4px;cursor:pointer;" onclick="goToPollDirect(\\x27' + p.id + '\\x27)">';
                        html += '<div style="width:32px;height:32px;border-radius:8px;background:var(--c-surface-strong);display:flex;align-items:center;justify-content:center;font-size:13px;">📊</div>';
                        html += '<div style="flex:1;"><p style="font-size:13px;color:var(--c-text);font-weight:600;">' + p.title + '</p>';
                        html += '<p style="font-size:11px;color:var(--c-text-dim);">' + (p.category || 'Outro') + '</p></div>';
                        html += '<span style="font-size:12px;color:var(--c-cyan-soft);font-weight:600;">' + p.voteCount + ' votos</span></div>';
                    });
                }

                el.innerHTML = html || '<p style="color:var(--c-text-mute);font-size:13px;">Nenhuma pesquisa em alta ainda.</p>';
            } catch(e) {
                el.innerHTML = '<p style="color:var(--c-text-mute);font-size:13px;">Erro ao carregar.</p>';
            }
        }

        async function loadStats() {
            const stats = await api('/stats');
            if (!stats) return;
            document.getElementById('totalVotes').textContent = stats.votes;
            document.getElementById('totalCandidates').textContent = stats.candidates;
            document.getElementById('totalCountries').textContent = stats.countries;
            document.getElementById('totalPolls').textContent = stats.polls;
            loadTrending();

            countriesData = await api('/countries');
            if (!countriesData) return;
            
            const select = document.getElementById('countrySelect');
            if (select) {
                select.innerHTML = '<option value="">Selecione o país</option>';
                countriesData.forEach(c => {
                    select.innerHTML += '<option value="' + c.name + '">' + c.name + '</option>';
                });
            }
        }
        
        async function loadVoteForm() {
            const electionType = document.getElementById('electionType').value;
            await loadStats();
            if (document.getElementById('voterNameDisplay')) {
                document.getElementById('voterNameDisplay').textContent = currentUser ? currentUser.name : 'Guest';
            }
            if (!electionType) document.getElementById('electionType').value = '';
            document.getElementById('politicalSection').style.display = 'none';
            document.getElementById('communitySection').style.display = 'none';
            document.getElementById('roleSelect').value = '';
            document.getElementById('countrySelect').value = '';
            document.getElementById('stateInput').value = '';
            document.getElementById('stateGroup').style.display = 'none';
            document.getElementById('candidatesList').innerHTML = '';
            if (!electionType) {
                document.getElementById('categorySelect').innerHTML = '<option value="">Selecione uma categoria</option>';
                POLL_CATEGORIES.forEach(cat => {
                    document.getElementById('categorySelect').innerHTML += '<option value="' + cat + '">' + cat + '</option>';
                });
                document.getElementById('categorySelect').value = '';
            }
            document.getElementById('pollListCard').style.display = 'none';
            document.getElementById('pollVotingCard').style.display = 'none';
            document.getElementById('categorySelectCard').style.display = 'block';
            selectedCategory = null;
            selectedPollId = null;
            currentPollId = null;
            currentPollType = null;
            selectedCandidateId = null;
            selectedCandidateName = null;
        }
        
        function onElectionTypeChange() {
            const type = document.getElementById('electionType').value;
            document.getElementById('politicalSection').style.display = 'none';
            document.getElementById('communitySection').style.display = 'none';
            
            if (type === 'political') {
                document.getElementById('politicalSection').style.display = 'block';
            } else if (type === 'community') {
                document.getElementById('communitySection').style.display = 'block';
                initCommunitySection();
            }
        }
        
        function initCommunitySection() {
            document.getElementById('categorySelect').innerHTML = '<option value="">Selecione uma categoria</option>';
            POLL_CATEGORIES.forEach(cat => {
                document.getElementById('categorySelect').innerHTML += '<option value="' + cat + '">' + cat + '</option>';
            });
            document.getElementById('categorySelect').value = '';
            document.getElementById('categorySelectCard').style.display = 'block';
            document.getElementById('pollListCard').style.display = 'none';
            document.getElementById('pollVotingCard').style.display = 'none';
            selectedCategory = null;
            selectedPollId = null;
        }
        
        function onCategoryChange() {
            selectedCategory = document.getElementById('categorySelect').value;
            if (selectedCategory) {
                document.getElementById('categorySelectCard').style.display = 'none';
                document.getElementById('pollListCard').style.display = 'block';
                document.getElementById('pollVotingCard').style.display = 'none';
                loadCommunityPolls();
            }
        }
        
        function backToCategories() {
            document.getElementById('categorySelectCard').style.display = 'block';
            document.getElementById('pollListCard').style.display = 'none';
            document.getElementById('pollVotingCard').style.display = 'none';
            document.getElementById('categorySelect').value = '';
            selectedCategory = null;
        }
        
        function backToPollList() {
            document.getElementById('categorySelectCard').style.display = 'none';
            document.getElementById('pollListCard').style.display = 'block';
            document.getElementById('pollVotingCard').style.display = 'none';
            selectedPollId = null;
            loadCommunityPolls();
        }
        
        function onRoleChange() {
            const role = document.getElementById('roleSelect').value;
            const stateGroup = document.getElementById('stateGroup');
            
            if (GLOBAL_ROLES.includes(role)) {
                stateGroup.style.display = 'none';
            } else {
                stateGroup.style.display = 'block';
            }
            
            loadCandidates();
        }
        
        async function onCountryChange() {
            const country = document.getElementById('countrySelect').value;
            const stateGroup = document.getElementById('stateGroup');
            const role = document.getElementById('roleSelect').value;
            
            if (GLOBAL_ROLES.includes(role)) {
                stateGroup.style.display = 'none';
            } else if (country) {
                const states = await api('/states?country=' + encodeURIComponent(country));
                const dataList = document.getElementById('statesList');
                dataList.innerHTML = '';
                states.forEach(s => {
                    dataList.innerHTML += '<option value="' + s.name + '">';
                });
            }
            
            loadCandidates();
        }
        
        async function onStateInput() {
            loadCandidates();
        }
        
        async function loadCandidates() {
            const role = document.getElementById('roleSelect').value;
            const country = document.getElementById('countrySelect').value;
            const state = document.getElementById('stateInput').value;
            
            if (!role || !country) {
                document.getElementById('candidatesList').innerHTML = '<p style="color:#666;">Select position and country to see candidates</p>';
                return;
            }
            
            let candidates;
            if (GLOBAL_ROLES.includes(role)) {
                candidates = await api('/candidates?country=' + encodeURIComponent(country) + '&role=' + encodeURIComponent(role));
            } else {
                if (!state) {
                    document.getElementById('candidatesList').innerHTML = '<p style="color:#666;">Select state to see candidates</p>';
                    return;
                }
                candidates = await api('/candidates?country=' + encodeURIComponent(country) + '&state=' + encodeURIComponent(state) + '&role=' + encodeURIComponent(role));
            }
            
            if (!candidates) return;
            
            let html = '<label style="display:block;margin-bottom:6px;">Personalidades — ' + role + '</label>';
            html += '<p style="font-size:13px;color:var(--c-cyan-soft);margin-bottom:12px;">Clique no candidato para selecionar e depois submeta seu voto.</p>';
            if (candidates.length === 0) {
                html += '<div class="empty-state" style="padding:24px;color:var(--c-text-mute);"><p>Nenhuma personalidade cadastrada para esta selecao.</p></div>';
            } else {
                html += '<div class="card-grid">';
                candidates.forEach(c => {
                    const safeName = (c.name||'').split(String.fromCharCode(92)).join(String.fromCharCode(92,92)).split("'").join(String.fromCharCode(92,39));
                    html += '<div class="entity-card" data-cid="' + c.id + '" onclick="selectCandidate(\\x27' + c.id + '\\x27, \\x27' + safeName + '\\x27)">';
                    html += avatarHtml(c.name, c.photoUrl);
                    html += '<div class="entity-body">';
                    html += '<h4 class="entity-title">' + (c.name || '-') + '</h4>';
                    html += '<p class="entity-sub">' + (c.party || '') + '</p>';
                    html += '<p class="entity-meta">' + (c.role || '') + '</p>';
                    html += '<p class="entity-meta">' + (c.country || '') + (c.state && c.state !== 'N/A' ? ' — ' + c.state : '') + '</p>';
                    html += '<input type="radio" name="candidate" value="' + c.id + '" data-name="' + (c.name||'').replace(/"/g, '&quot;') + '" style="display:none;">';
                    html += '</div></div>';
                });
                html += '</div>';
            }
            html += '<div style="margin-top:16px;padding:12px;background:rgba(255,203,71,0.08);border:1px solid rgba(255,203,71,0.2);border-radius:10px;font-size:11px;color:var(--c-text-mute);line-height:1.6;">';
            html += '<strong style="color:var(--c-warn);">Aviso:</strong> Alguns candidatos podem ser independentes ou adicionados por solicitacao da comunidade. O Brasil e membro da Convencao Americana de Direitos Humanos, porem a candidatura independente ainda nao e permitida no pais. Neste periodo pre-eleitoral, esta plataforma tem carater informativo e de entretenimento.';
            html += '</div>';
            document.getElementById('candidatesList').innerHTML = html;
        }

        function selectCandidate(id, name) {
            selectedCandidateId = id;
            selectedCandidateName = name;
            currentPollType = 'political';
            document.querySelectorAll('input[name="candidate"]').forEach(r => {
                r.checked = (r.value === id);
            });
            document.querySelectorAll('.entity-card[data-cid]').forEach(el => {
                el.classList.toggle('selected', el.getAttribute('data-cid') === id);
            });
        }
        
        async function getVotedPolls() {
            if (!currentUser) return [];
            // Admins can always vote again (for testing)
            if (currentUser.role === 'admin') return [];
            const myVotes = await api('/my-votes?userId=' + currentUser.id);
            return myVotes ? myVotes.map(v => v.pollId) : [];
        }
        
        async function loadCommunityPolls() {
            const polls = await api('/polls?type=community&approved=true');
            
            if (!polls) return;
            
            const votedPolls = await getVotedPolls();
            
            const filteredPolls = selectedCategory 
                ? polls.filter(p => p.category === selectedCategory)
                : polls;
            
            let html = '';
            if (filteredPolls.length === 0) {
                html = '<div class="empty-state" style="padding:24px;color:var(--c-text-mute);text-align:center;"><p>Nenhuma enquete aprovada nesta categoria.</p><button class="btn" style="margin-top:12px;" onclick="showCreatePollForm()">📝 Crie a primeira!</button></div>';
            } else {
                html += '<div class="card-grid">';
                filteredPolls.forEach(p => {
                    const hasVoted = votedPolls.includes(p.id);
                    html += '<div class="entity-card" onclick="selectPollForVoting(\\x27' + p.id + '\\x27)">';
                    html += coverHtml(p.title, p.coverUrl);
                    html += '<div class="entity-body">';
                    html += '<h4 class="entity-title">' + (p.title || '-') + '</h4>';
                    if (p.description) html += '<p class="entity-sub">' + p.description + '</p>';
                    html += '<p class="entity-meta">' + (p.options ? p.options.length : 0) + ' opcoes · ' + (p.votes || 0) + ' opinioes</p>';
                    html += '</div>';
                    if (hasVoted) html += '<span class="entity-badge">✓ opinou</span>';
                    html += '</div>';
                });
                html += '</div>';
            }
            document.getElementById('availablePollsList').innerHTML = html;
        }
        
        async function selectPollForVoting(pollId) {
            selectedPollId = pollId;
            const polls = await api('/polls?type=community&approved=true');
            
            const poll = polls.find(p => p.id === pollId);
            if (!poll) return;
            
            const votedPolls = await getVotedPolls();
            const hasVoted = votedPolls.includes(pollId);
            
            document.getElementById('categorySelectCard').style.display = 'none';
            document.getElementById('pollListCard').style.display = 'none';
            document.getElementById('pollVotingCard').style.display = 'block';
            
            let html = '<h4 style="margin-bottom:15px;">' + poll.title + '</h4>';
            if (poll.description) html += '<p style="margin-bottom:15px;">' + poll.description + '</p>';
            
            if (hasVoted) {
                html += '<div class="voted-badge" style="padding:10px;margin-bottom:15px;">You have already voted in this poll</div>';
            } else {
                poll.options.forEach(opt => {
                    html += '<div class="candidate-row" onclick="selectPollOption(\\'' + poll.id + '\\', \\'' + opt.id + '\\', \\'' + opt.text.replace(/'/g, "\\\\'") + '\\')">';
                    html += '<input type="radio" name="poll_' + poll.id + '" value="' + opt.id + '">';
                    html += '<div class="candidate-info"><div class="candidate-name">' + opt.text + '</div></div>';
                    html += '</div>';
                });
            }
            
            html += '<div style="margin-top:15px;">';
            html += '<button class="btn btn-small btn-secondary" onclick="sharePoll(\\x27' + poll.shareCode + '\\x27)">📤 Share Poll</button>';
            html += '</div>';
            
            // Add products for this poll
            const products = await api('/products');
            const pollProducts = products.filter(p => p.approved && p.pollId === pollId);
            if (pollProducts.length > 0) {
                html += '<div style="margin-top:20px;">';
                html += '<h4 style="margin-bottom:10px;">🎁 Available Products</h4>';
                pollProducts.forEach(prod => {
                    html += '<div style="padding:10px;margin:5px 0;background:#f8f8f8;border-radius:8px;display:flex;justify-content:space-between;align-items:center;">';
                    html += '<div><strong>' + prod.name + '</strong><br><span style="color:#28a745;font-weight:bold;">$' + prod.price + '</span></div>';
                    html += '<button class="btn btn-small" onclick="openBuyGift(\\x27' + prod.id + '\\x27)">🎁 Buy Gift</button>';
                    html += '</div>';
                });
                html += '</div>';
            }
            
            document.getElementById('pollVotingOptions').innerHTML = html;
        }
        
        function selectPollOption(pollId, optionId, optionText) {
            currentPollId = pollId;
            currentPollType = 'community';
            selectedCandidateId = optionId;
            selectedCandidateName = optionText;
            document.querySelectorAll('input[name="poll_' + pollId + '"]').forEach(r => {
                r.checked = (r.value === optionId);
            });
        }
        
        async function submitVote() {
            if (!currentUser) {
                alert('Please login to vote');
                return;
            }
            
            const electionType = document.getElementById('electionType').value;
            
            if (!electionType) {
                alert('Please select election type');
                return;
            }
            
            if (electionType === 'political') {
                const role = document.getElementById('roleSelect').value;
                const country = document.getElementById('countrySelect').value;
                
                if (!role || !country) {
                    alert('Please select position and country');
                    return;
                }
                
                if (GLOBAL_ROLES.includes(role) && !selectedCandidateId) {
                    alert('Please select a candidate');
                    return;
                }
                
                if (!GLOBAL_ROLES.includes(role)) {
                    const state = document.getElementById('stateInput').value;
                    if (!state) {
                        alert('Please select state');
                        return;
                    }
                    if (!selectedCandidateId) {
                        alert('Please select a candidate');
                        return;
                    }
                }
                
                const result = await api('/vote', 'POST', {
                    userId: currentUser.id,
                    userName: currentUser.name,
                    electionType: 'political',
                    role,
                    country,
                    state: document.getElementById('stateInput').value,
                    candidateId: selectedCandidateId,
                    candidateName: selectedCandidateName
                });
                
                if (result && result.success) {
                    alert('Vote submitted successfully!');
                    showSection('home');
                } else if (result && result.error) {
                    alert(result.error);
                }
            } else if (electionType === 'community') {
                if (!selectedPollId || !selectedCandidateId) {
                    alert('Please select a poll and option');
                    return;
                }
                
                const result = await api('/poll-vote', 'POST', {
                    userId: currentUser.id,
                    userName: currentUser.name,
                    pollId: selectedPollId,
                    optionId: selectedCandidateId,
                    optionText: selectedCandidateName
                });
                
                if (result && result.success) {
                    alert('Vote submitted successfully!');
                    showSection('home');
                } else if (result && result.error) {
                    alert(result.error);
                }
            }
        }
        
        async function loadResults() {
            const votes = await api('/votes');
            const candidates = await api('/all-candidates');
            const polls = await api('/polls');
            
            if (!votes || !candidates || !polls) return;
            
            // Populate category select
            const catSelect = document.getElementById('resultsCategorySelect');
            catSelect.innerHTML = '<option value="">Todas as categorias (Geral)</option>';
            const categories = [...new Set(polls.filter(p => p.type === 'community' && p.approved).map(p => p.category))];
            categories.forEach(cat => {
                catSelect.innerHTML += '<option value="' + cat + '">' + cat + '</option>';
            });
            
            // Political results
            const politicalVotes = votes.filter(v => v.electionType === 'political');
            const stats = {};
            politicalVotes.forEach(v => {
                v.choices.forEach(c => {
                    const key = v.country + ' - ' + v.role + ' - ' + c.candidateName;
                    stats[key] = (stats[key] || 0) + 1;
                });
            });
            
            // Group by race (country + role)
            const races = {};
            Object.entries(stats).forEach(([key, count]) => {
                const [country, role, name] = key.split(' - ');
                const raceKey = country + ' - ' + role;
                if (!races[raceKey]) races[raceKey] = { country, role, candidates: [], totalVotes: 0 };
                races[raceKey].candidates.push({ name, count });
                races[raceKey].totalVotes += count;
            });

            // Store for detail view
            window._politicalRaces = races;

            // Populate filter dropdowns
            var polCountries = [...new Set(Object.values(races).map(function(r){return r.country;}))].sort();
            var polRoles = [...new Set(Object.values(races).map(function(r){return r.role;}))].sort();
            var cSel = document.getElementById('polFilterCountry');
            var rSel = document.getElementById('polFilterRole');
            if (cSel) { cSel.innerHTML = '<option value="">Todos os paises</option>'; polCountries.forEach(function(c){ cSel.innerHTML += '<option value="'+c+'">'+c+'</option>'; }); }
            if (rSel) { rSel.innerHTML = '<option value="">Todos os cargos</option>'; polRoles.forEach(function(r){ rSel.innerHTML += '<option value="'+r+'">'+r+'</option>'; }); }

            filterPoliticalResults();
            document.getElementById('resultsMainView').style.display = 'block';
            document.getElementById('resultsDetailView').style.display = 'none';

            // Load community results
            loadCommunityResults();
        }

        function showResultsMain() {
            if (typeof stopChatRefresh === 'function') stopChatRefresh();
            document.getElementById('resultsMainView').style.display = 'block';
            document.getElementById('resultsDetailView').style.display = 'none';
        }

        var _nationalRoles = ['President','Senator','MP','Deputy','Deputado Federal','Deputado Estadual'];
        function filterPoliticalResults() {
            var races = window._politicalRaces || {};
            var filterCountry = (document.getElementById('polFilterCountry') || {}).value || '';
            var filterScope = (document.getElementById('polFilterScope') || {}).value || '';
            var filterRole = (document.getElementById('polFilterRole') || {}).value || '';
            var entries = Object.entries(races).filter(function(e) {
                var race = e[1];
                if (filterCountry && race.country !== filterCountry) return false;
                if (filterRole && race.role !== filterRole) return false;
                if (filterScope === 'national' && _nationalRoles.indexOf(race.role) === -1) return false;
                if (filterScope === 'regional' && _nationalRoles.indexOf(race.role) !== -1) return false;
                return true;
            });
            var politicalHtml = '';
            if (entries.length === 0) {
                politicalHtml = '<p style="color:var(--c-text-mute);">Nenhum resultado para estes filtros.</p>';
            } else {
                entries.forEach(function(entry) {
                    var raceKey = entry[0], race = entry[1];
                    var raceId = raceKey.replace(/[^a-zA-Z0-9]/g, '_');
                    var sorted = race.candidates.slice().sort(function(a,b){return b.count - a.count;});
                    var leader = sorted[0];
                    politicalHtml += '<div class="card" style="padding:14px;margin-bottom:8px;cursor:pointer;" onclick="viewPoliticalRace(\\x27' + raceId + '\\x27)">';
                    politicalHtml += '<div style="display:flex;justify-content:space-between;align-items:center;">';
                    politicalHtml += '<div>';
                    politicalHtml += '<p style="font-weight:700;font-size:15px;color:var(--c-text);">' + race.role + '</p>';
                    politicalHtml += '<p style="font-size:12px;color:var(--c-text-mute);">' + race.country + ' — ' + race.totalVotes + ' votos</p>';
                    politicalHtml += '<p style="font-size:10px;color:#4caf50;font-weight:600;">Oficial by DataToalha</p>';
                    politicalHtml += '</div>';
                    politicalHtml += '<div style="text-align:right;">';
                    politicalHtml += '<p style="font-size:13px;color:var(--c-cyan-soft);">Lider: ' + leader.name + '</p>';
                    politicalHtml += '<p style="font-size:11px;color:var(--c-text-dim);">Toque para detalhes →</p>';
                    politicalHtml += '</div></div></div>';
                });
            }
            document.getElementById('politicalResults').innerHTML = politicalHtml;
        }

        async function viewPoliticalRace(raceId) {
            var races = window._politicalRaces || {};
            var race = Object.entries(races).find(function(e) { return e[0].replace(/[^a-zA-Z0-9]/g, '_') === raceId; });
            if (!race) return;
            var raceKey = race[0], data = race[1];
            var chatId = 'pol_' + raceId;

            var html = '<button class="btn btn-small btn-secondary" onclick="showResultsMain()" style="margin-bottom:15px;">← Voltar</button>';
            html += '<div class="card">';
            html += '<h3 style="color:var(--c-text);">' + data.role + ' — ' + data.country + '</h3>';
            html += '<p style="font-size:12px;color:var(--c-text-dim);margin-bottom:14px;">' + data.totalVotes + ' votos registrados</p>';

            const sorted = data.candidates.slice().sort((a,b) => b.count - a.count);
            sorted.forEach((c, i) => {
                const percent = data.totalVotes > 0 ? (c.count / data.totalVotes * 100).toFixed(1) : 0;
                const barW = Math.max(2, parseFloat(percent));
                const medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '';
                html += '<div style="margin:10px 0;">';
                html += '<p style="font-size:14px;color:var(--c-text);font-weight:' + (i === 0 ? '700' : '400') + ';">' + medal + c.name + '</p>';
                html += '<div style="display:flex;align-items:center;gap:8px;margin-top:3px;">';
                html += '<div style="flex:1;height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;"><div style="width:' + barW + '%;height:100%;background:linear-gradient(90deg,var(--c-cyan),var(--c-purple));border-radius:4px;"></div></div>';
                html += '<span style="font-size:12px;color:var(--c-cyan-soft);min-width:70px;text-align:right;">' + c.count + ' (' + percent + '%)</span>';
                html += '</div></div>';
            });

            html += '<button class="btn btn-secondary" style="margin-top:14px;width:100%;" onclick="sharePoliticalRace(\\x27' + data.role + '\\x27, \\x27' + data.country + '\\x27)">📤 Compartilhar esta pesquisa</button>';
            html += '</div>';

            // Candle charts for this political race (cumulative)
            var candleData = await api('/political-candle-history?country=' + encodeURIComponent(data.country) + '&role=' + encodeURIComponent(data.role));
            if (candleData && candleData.charts && candleData.charts.length > 0) {
                for (var ci = 0; ci < candleData.charts.length; ci++) {
                    var chart = candleData.charts[ci];
                    if (chart.history.length > 0) {
                        html += await generateCandleChartFromData(chart.option1.text, chart.option2.text, chart.history);
                    }
                }
            }

            // Chat for this race
            html += '<div class="card" style="margin-top:16px;">';
            html += '<h3 style="margin-bottom:12px;color:var(--c-text);">💬 Discussao — ' + data.role + ' ' + data.country + '</h3>';
            html += '<div id="chatMessages_' + chatId + '" style="max-height:350px;overflow-y:auto;border:1px solid var(--c-border);border-radius:10px;padding:10px;margin-bottom:10px;background:rgba(6,6,15,0.4);"></div>';
            html += '<div style="display:flex;gap:8px;">';
            html += '<input type="text" id="chatInput_' + chatId + '" placeholder="Escreva uma mensagem..." style="flex:1;padding:10px;border:1px solid var(--c-border);border-radius:10px;background:rgba(6,6,15,0.6);color:var(--c-text);font-size:14px;" onkeypress="if(event.key===\\x27Enter\\x27)sendChatMessage(\\x27' + chatId + '\\x27)">';
            html += '<button class="btn" onclick="sendChatMessage(\\x27' + chatId + '\\x27)">Enviar</button>';
            html += '</div></div>';

            document.getElementById('resultsMainView').style.display = 'none';
            document.getElementById('resultsDetailView').style.display = 'block';
            document.getElementById('resultsDetailView').innerHTML = html;
            loadPollChat(chatId);
            startChatRefresh(chatId);
        }
        
        async function loadCommunityResults() {
            const polls = await api('/polls?type=community&approved=true');
            const pollVotes = await api('/poll-votes');
            const selectedCategory = document.getElementById('resultsCategorySelect').value;
            
            if (!polls) return;
            
            const votedPolls = await getVotedPolls();
            
            const filteredPolls = selectedCategory 
                ? polls.filter(p => p.category === selectedCategory)
                : polls;
            
            let communityHtml = '';
            if (filteredPolls.length === 0) {
                communityHtml = '<p>No community polls yet</p>';
            } else {
                filteredPolls.forEach(p => {
                    const pVotes = pollVotes.filter(v => v.pollId === p.id);
                    const total = pVotes.length;
                    const hasVoted = votedPolls.includes(p.id);
                    
                    if (selectedCategory === '') {
                        // General view - one line, clickable
                        communityHtml += '<div class="poll-card" style="cursor:pointer;" onclick="viewPollResults(\\'' + p.id + '\\')">';
                        communityHtml += '<div class="poll-header"><h4>' + p.title + '</h4>';
                        communityHtml += '<span class="poll-type-badge badge-community">' + (p.category || 'Other') + '</span>';
                        communityHtml += '</div>';
                        communityHtml += '<p>' + p.options.length + ' options | ' + total + ' votes';
                        if (hasVoted) communityHtml += ' | ✓ You Voted';
                        communityHtml += '</p>';
                        communityHtml += '<p style="color:#4A90D9;font-size:12px;">Click to see results →</p>';
                        communityHtml += '</div>';
                    } else {
                        // Category view - full details
                        communityHtml += '<div class="poll-card"><h4>' + p.title + '</h4>';
                        p.options.forEach(opt => {
                            const count = pVotes.filter(v => v.optionId === opt.id).length;
                            const percent = total > 0 ? (count / total * 100).toFixed(1) : 0;
                            communityHtml += '<p>' + opt.text + ': ' + count + ' votes (' + percent + '%)</p>';
                        });
                        if (hasVoted) communityHtml += '<div class="voted-badge" style="margin-top:10px;">✓ You Voted</div>';
                        communityHtml += '</div>';
                    }
                });
            }
            document.getElementById('communityResults').innerHTML = communityHtml;
        }
        
        async function viewPollResults(pollId) {
            const polls = await api('/polls?type=community&approved=true');
            const poll = polls.find(p => p.id === pollId);
            if (!poll) return;
            
            const pollVotes = await api('/poll-votes');
            const pVotes = pollVotes.filter(v => v.pollId === pollId);
            const total = pVotes.length;
            const votedPolls = await getVotedPolls();
            const hasVoted = votedPolls.includes(pollId);
            
            let html = '<button class="btn btn-small btn-secondary" onclick="showResultsMain()" style="margin-bottom:15px;">← Voltar</button>';
            html += '<div class="card">';
            html += '<h3 style="color:var(--c-text);">' + poll.title + '</h3>';
            if (poll.description) html += '<p style="color:var(--c-text-mute);margin-bottom:10px;">' + poll.description + '</p>';
            html += '<p style="font-size:12px;color:var(--c-text-dim);margin-bottom:14px;">' + (poll.category || 'Outro') + ' — ' + total + ' votos</p>';

            poll.options.forEach(opt => {
                const count = pVotes.filter(v => v.optionId === opt.id).length;
                const percent = total > 0 ? (count / total * 100).toFixed(1) : 0;
                html += '<div style="margin:8px 0;">';
                html += '<p style="font-size:14px;color:var(--c-text);margin-bottom:4px;">' + opt.text + '</p>';
                html += '<div style="display:flex;align-items:center;gap:8px;">';
                html += '<div style="flex:1;height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;"><div style="width:' + percent + '%;height:100%;background:linear-gradient(90deg,var(--c-cyan),var(--c-purple));border-radius:4px;"></div></div>';
                html += '<span style="font-size:12px;color:var(--c-cyan-soft);min-width:70px;text-align:right;">' + count + ' (' + percent + '%)</span>';
                html += '</div></div>';
            });

            if (hasVoted) {
                html += '<div style="margin-top:14px;display:inline-block;padding:6px 14px;background:rgba(111,255,184,0.12);border:1px solid rgba(111,255,184,0.3);border-radius:8px;font-size:13px;color:var(--c-success);">✓ Voce ja votou</div>';
            } else {
                html += '<button class="btn" style="margin-top:14px;" onclick="goToVoteCommunity()">Votar agora</button>';
            }
            html += '</div>';

            // Candle chart
            if (poll.options.length >= 2 && total > 0) {
                html += await generateCandleChart(pollId, poll);
            }

            // Discussion chat
            html += '<div class="card" style="margin-top:16px;">';
            html += '<h3 style="margin-bottom:12px;color:var(--c-text);">💬 Discussao</h3>';
            html += '<div id="chatMessages_' + pollId + '" style="max-height:350px;overflow-y:auto;border:1px solid var(--c-border);border-radius:10px;padding:10px;margin-bottom:10px;background:rgba(6,6,15,0.4);"></div>';
            html += '<div style="display:flex;gap:8px;">';
            html += '<input type="text" id="chatInput_' + pollId + '" placeholder="Escreva uma mensagem..." style="flex:1;padding:10px;border:1px solid var(--c-border);border-radius:10px;background:rgba(6,6,15,0.6);color:var(--c-text);font-size:14px;" onkeypress="if(event.key===\\x27Enter\\x27)sendChatMessage(\\x27' + pollId + '\\x27)">';
            html += '<button class="btn" onclick="sendChatMessage(\\x27' + pollId + '\\x27)">Enviar</button>';
            html += '</div></div>';

            document.getElementById('resultsMainView').style.display = 'none';
            document.getElementById('resultsDetailView').style.display = 'block';
            document.getElementById('resultsDetailView').innerHTML = html;
            loadPollChat(pollId);
            startChatRefresh(pollId);
        }
        
        function goToVoteCommunity() {
            showSection('vote');
            document.getElementById('electionType').value = 'community';
            document.getElementById('communitySection').style.display = 'block';
            initCommunitySection();
        }

        // Shortcut: go directly to political vote with pre-selected country+role
        async function goToVoteDirect(country, role) {
            showSection('vote');
            // Ensure countries are loaded
            if (!countriesData || countriesData.length === 0) {
                countriesData = await api('/countries');
                var sel = document.getElementById('countrySelect');
                if (sel) {
                    sel.innerHTML = '<option value="">Selecione o pais</option>';
                    countriesData.forEach(function(c) { sel.innerHTML += '<option value="' + c.name + '">' + c.name + '</option>'; });
                }
            }
            // Set type to political
            var et = document.getElementById('electionType');
            if (et) et.value = 'political';
            onElectionTypeChange();
            // Set role
            var rs = document.getElementById('roleSelect');
            if (rs) rs.value = role;
            // Set country
            var cs = document.getElementById('countrySelect');
            if (cs) cs.value = country;
            // Load candidates directly
            await loadCandidates();
        }

        // Shortcut: go directly to community poll results
        function goToPollDirect(pollId) {
            showSection('results');
            setTimeout(function() { viewPollResults(pollId); }, 300);
        }

        async function loadCandidatesList() {
            const search = document.getElementById('candidateSearch').value.trim();
            let candidates = await api('/all-candidates');
            if (!candidates) return;
            
            if (search) {
                candidates = candidates.filter(c => 
                    c.name.toLowerCase().includes(search.toLowerCase()) ||
                    c.party.toLowerCase().includes(search.toLowerCase()) ||
                    c.country.toLowerCase().includes(search.toLowerCase()) ||
                    c.role.toLowerCase().includes(search.toLowerCase())
                );
            }
            
            if (candidates.length === 0) {
                document.getElementById('candidatesTable').innerHTML = '<p style="color:var(--c-text-mute);">Nenhum candidato encontrado.</p>';
                return;
            }
            
            let html = '<div class="card-grid">';
            candidates.forEach(c => {
                html += '<div class="card" style="padding:14px;">';
                html += avatarHtml(c.name, c.photoUrl);
                html += '<div style="margin-top:8px;">';
                html += '<p style="font-weight:700;font-size:15px;color:var(--c-text);">' + (c.name || '-') + '</p>';
                html += '<p style="font-size:13px;color:var(--c-cyan-soft);">' + (c.party || '-') + '</p>';
                html += '<p style="font-size:12px;color:var(--c-text-mute);">' + (c.role || '-') + '</p>';
                html += '<p style="font-size:12px;color:var(--c-text-dim);">' + (c.country || '-') + (c.state && c.state !== 'N/A' ? ' — ' + c.state : '') + '</p>';
                html += '</div></div>';
            });
            html += '</div>';
            document.getElementById('candidatesTable').innerHTML = html;
        }
        
        async function loadPolls() {
            var [polls, myPollVotes, myPoliticalVotes] = await Promise.all([
                api('/polls'), api('/my-votes'), api('/votes')
            ]);
            if (!polls) polls = [];
            if (!myPollVotes) myPollVotes = [];
            if (!myPoliticalVotes) myPoliticalVotes = [];

            var userId = currentUser ? currentUser.id : '';
            var html = '';

            // Political votes I cast
            var myPolVotes = myPoliticalVotes.filter(function(v) { return v.userId === userId; });
            if (myPolVotes.length > 0) {
                html += '<div style="margin-bottom:6px;"><span style="font-size:10px;color:var(--c-warn);font-family:monospace;letter-spacing:0.1em;">MEUS VOTOS POLITICOS</span></div>';
                var seen = {};
                myPolVotes.forEach(function(v) {
                    var key = v.country + '_' + v.role;
                    if (seen[key]) return;
                    seen[key] = true;
                    var raceId = key.replace(/[^a-zA-Z0-9]/g, '_');
                    var candNames = (v.choices || []).map(function(c) { return c.candidateName; }).join(', ');
                    html += '<div class="card" style="padding:12px;margin-bottom:8px;cursor:pointer;" onclick="showSection(\\x27results\\x27);setTimeout(function(){loadResults();setTimeout(function(){viewPoliticalRace(\\x27' + raceId + '\\x27);},500);},300);">';
                    html += '<p style="font-weight:700;color:var(--c-text);">🏛️ ' + v.role + ' — ' + v.country + '</p>';
                    html += '<p style="font-size:12px;color:var(--c-text-mute);">Votou em: ' + candNames + '</p>';
                    html += '<p style="font-size:11px;color:var(--c-cyan-soft);">Ver resultados e chat →</p>';
                    html += '</div>';
                });
            }

            // Community polls I voted on or created
            var votedPollIds = myPollVotes.map(function(v) { return v.pollId; });
            var myPolls = polls.filter(function(p) { return votedPollIds.includes(p.id) || p.createdBy === userId; });

            if (myPolls.length > 0) {
                html += '<div style="margin-bottom:6px;margin-top:16px;"><span style="font-size:10px;color:var(--c-warn);font-family:monospace;letter-spacing:0.1em;">MINHAS ENQUETES</span></div>';
                myPolls.forEach(function(p) {
                    var voted = votedPollIds.includes(p.id);
                    html += '<div class="card" style="padding:12px;margin-bottom:8px;cursor:pointer;" onclick="goToPollDirect(\\x27' + p.id + '\\x27)">';
                    html += '<p style="font-weight:700;color:var(--c-text);">📊 ' + p.title + '</p>';
                    html += '<p style="font-size:12px;color:var(--c-text-mute);">' + (p.category || 'Outro') + (voted ? ' · ✓ votou' : ' · criou') + '</p>';
                    html += '<p style="font-size:11px;color:var(--c-cyan-soft);">Ver resultados e chat →</p>';
                    html += '</div>';
                });
            }

            // All other polls (not voted, not created)
            var otherPolls = polls.filter(function(p) { return p.approved && !votedPollIds.includes(p.id) && p.createdBy !== userId; });
            if (otherPolls.length > 0) {
                html += '<div style="margin-bottom:6px;margin-top:16px;"><span style="font-size:10px;color:var(--c-warn);font-family:monospace;letter-spacing:0.1em;">OUTRAS ENQUETES</span></div>';
                otherPolls.forEach(function(p) {
                    html += '<div class="card" style="padding:12px;margin-bottom:8px;cursor:pointer;" onclick="goToPollDirect(\\x27' + p.id + '\\x27)">';
                    html += '<p style="font-weight:700;color:var(--c-text);">📊 ' + p.title + '</p>';
                    html += '<p style="font-size:12px;color:var(--c-text-mute);">' + (p.category || 'Outro') + '</p>';
                    html += '</div>';
                });
            }

            if (!html) {
                html = '<div class="empty-state" style="padding:24px;color:var(--c-text-mute);text-align:center;"><p>Voce ainda nao votou em nenhuma pesquisa.</p><button class="btn" style="margin-top:12px;" onclick="showSection(\\x27vote\\x27)">Opinar agora</button></div>';
            }

            document.getElementById('pollsList').innerHTML = html;
        }
        
        async function sharePoll(code) {
            const url = 'https://datatoalha.com/app#poll=' + code;
            const text = 'Opine nesta enquete no DataToalha! ' + url + ' (Codigo: ' + code + ')';
            if (navigator.share) {
                try {
                    await navigator.share({ title: 'DataToalha — Enquete', text: text, url: url });
                } catch(e) {
                    try { await navigator.clipboard.writeText(url); } catch(_) {}
                    alert('Link copiado: ' + url);
                }
            } else {
                try { await navigator.clipboard.writeText(url); } catch(_) {}
                alert('Link copiado: ' + url);
            }
        }
        
        async function showCreatePollForm() {
            const modal = document.getElementById('createPollModal');
            const categorySelect = document.getElementById('newPollCategory');
            categorySelect.innerHTML = '';
            POLL_CATEGORIES.forEach(cat => {
                categorySelect.innerHTML += '<option value="' + cat + '">' + cat + '</option>';
            });
            modal.style.display = 'block';
        }
        
        async function sharePoliticalRace(role, country) {
            const url = 'https://datatoalha.com/app';
            const text = 'Opine na pesquisa para ' + role + ' no ' + country + '! Acesse: ' + url;
            if (navigator.share) {
                try { await navigator.share({ title: 'DataToalha — ' + role, text: text, url: url }); }
                catch(e) { try { await navigator.clipboard.writeText(url); } catch(_) {} alert('Link copiado!'); }
            } else {
                try { await navigator.clipboard.writeText(url); } catch(_) {}
                alert('Link copiado: ' + url);
            }
        }

        function closeCreatePollModal() {
            document.getElementById('createPollModal').style.display = 'none';
            document.getElementById('newPollTitle').value = '';
            document.getElementById('newPollCategory').value = '';
            document.getElementById('newPollDescription').value = '';
            document.getElementById('newPollOptions').value = '';
            const pcu = document.getElementById('pollCoverUrl'); if (pcu) pcu.value = '';
            const pcp = document.getElementById('pollCoverPreview'); if (pcp) pcp.textContent = '🖼️';
            const pcf = document.getElementById('pollCoverFile'); if (pcf) pcf.value = '';
        }
        
        async function previewOptPhoto(input, idx) {
            if (!input.files || !input.files[0]) return;
            var status = document.getElementById('poll-opt-status-' + idx);
            var urlInput = document.getElementById('poll-opt-url-' + idx);
            try {
                status.textContent = 'Enviando...';
                var resized = await _resizeImage(input.files[0], 800);
                var result = await api('/upload-photo', 'POST', { data: resized, kind: 'candidate' });
                if (result && result.url) {
                    urlInput.value = result.url;
                    status.textContent = '✓ Foto enviada';
                    status.style.color = 'var(--c-success)';
                } else {
                    status.textContent = 'Erro';
                    status.style.color = 'var(--c-danger)';
                }
            } catch(e) {
                status.textContent = 'Erro: ' + e.message;
                status.style.color = 'var(--c-danger)';
            }
        }

        function expandPollOptions() {
            var input = document.getElementById('newPollOptions');
            var str = (input ? input.value : '').trim();
            if (!str) { alert('Digite as opcoes separadas por virgula primeiro.'); return; }
            var names = str.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
            if (names.length < 2) { alert('Insira pelo menos 2 opcoes separadas por virgula.'); return; }
            var container = document.getElementById('pollOptionRows');
            var html = '';
            names.forEach(function(name, i) {
                html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;padding:8px;background:rgba(255,255,255,0.04);border-radius:8px;">';
                html += '<span style="min-width:24px;text-align:center;font-weight:700;color:var(--c-cyan);">' + (i+1) + '</span>';
                html += '<div style="flex:1;">';
                html += '<input type="text" value="' + name.replace(/"/g, '&quot;') + '" class="poll-opt-name" style="margin-bottom:4px;font-weight:600;" placeholder="Nome">';
                html += '<input type="text" class="poll-opt-desc" placeholder="Descricao/posicao (ex: Goleiro, Atacante)" style="font-size:13px;margin-bottom:4px;">';
                html += '<div style="display:flex;align-items:center;gap:6px;">';
                html += '<label class="btn btn-secondary btn-small" style="font-size:10px;padding:3px 8px;min-height:28px;" for="poll-opt-photo-' + i + '">📷 Foto</label>';
                html += '<input type="file" id="poll-opt-photo-' + i + '" class="poll-opt-photo" accept="image/*" style="display:none;" onchange="previewOptPhoto(this,' + i + ')">';
                html += '<span class="poll-opt-photo-status" id="poll-opt-status-' + i + '" style="font-size:10px;color:var(--c-text-dim);">Sem foto</span>';
                html += '<input type="hidden" class="poll-opt-photo-url" id="poll-opt-url-' + i + '">';
                html += '</div>';
                html += '</div></div>';
            });
            container.innerHTML = html;
            document.getElementById('pollOptionDetails').style.display = 'block';
        }

        async function submitCreatePoll() {
            var title = document.getElementById('newPollTitle').value.trim();
            var category = document.getElementById('newPollCategory').value;
            var description = document.getElementById('newPollDescription').value.trim();
            var optionsStr = document.getElementById('newPollOptions').value.trim();

            if (!title || !category || !optionsStr) {
                alert('Preencha todos os campos obrigatorios');
                return;
            }

            var options;
            var detailRows = document.querySelectorAll('#pollOptionRows .poll-opt-name');
            if (detailRows.length > 0) {
                var descRows = document.querySelectorAll('#pollOptionRows .poll-opt-desc');
                var photoUrls = document.querySelectorAll('#pollOptionRows .poll-opt-photo-url');
                options = [];
                detailRows.forEach(function(el, i) {
                    var name = el.value.trim();
                    var desc = descRows[i] ? descRows[i].value.trim() : '';
                    var photo = photoUrls[i] ? photoUrls[i].value.trim() : '';
                    if (name) options.push({ id: generateId(), text: name, description: desc, photoUrl: photo, votes: 0 });
                });
            } else {
                options = optionsStr.split(',').map(function(o) { return { id: generateId(), text: o.trim(), votes: 0 }; }).filter(function(o) { return o.text; });
            }

            if (options.length < 2) { alert('Insira pelo menos 2 opcoes.'); return; }

            var coverUrl = (document.getElementById('pollCoverUrl') || {}).value || '';
            var result = await api('/polls', 'POST', {
                title: title,
                category: category,
                description: description,
                options: options,
                shareCode: generateShareCode(),
                type: 'community',
                approved: false,
                createdBy: currentUser ? currentUser.id : 'anonymous',
                coverUrl: coverUrl
            });

            if (result && result.success) {
                alert('Enquete criada! Sera visivel apos aprovacao. Codigo: ' + (result.shareCode || ''));
                closeCreatePollModal();
                loadPolls();
            }
        }
        
        function generateId() { return Math.random().toString(36).substr(2, 9); }
        
        function generateShareCode() {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            return Array(8).fill(0).map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
        }
        
        let adminMode = false;
        function toggleAdminMode() {
            const password = prompt('Enter admin password (leave empty for demo):');
            if (password === '' || password === 'admin123') {
                adminMode = !adminMode;
                document.body.classList.toggle('admin-mode', adminMode);
                alert(adminMode ? 'Admin mode enabled' : 'Admin mode disabled');
                if (adminMode) showSection('admin');
            } else if (password !== null) {
                alert('Incorrect password');
            }
        }
        
        // Admin tab switching
        function showAdminTab(tab) {
            var tabs = ['enquetes','personalidades','emalta','usuarios','moderacao','dados'];
            tabs.forEach(function(t) {
                var panel = document.getElementById('adminPanel_' + t);
                var btn = document.getElementById('adminTab_' + t);
                if (panel) panel.style.display = t === tab ? 'block' : 'none';
                if (btn) {
                    btn.className = t === tab ? 'btn btn-small' : 'btn btn-small btn-secondary';
                }
            });
            // Load data for the active tab
            if (tab === 'enquetes') loadAdminPolls();
            if (tab === 'personalidades') { loadAdminPollSelector(); loadAdminCandidatesForPoll(); }
            if (tab === 'emalta') { loadAdminTrending(); loadPollRanking(); }
            if (tab === 'usuarios') { loadAdminUsers(); loadAdminContacts(); }
            if (tab === 'moderacao') { loadAdminReports(); }
        }

        // Populate poll selector for personalidades tab
        async function loadAdminPollSelector() {
            var container = document.getElementById('adminPollButtons');
            var hidden = document.getElementById('adminPollSelector');
            if (!container) return;
            var polls = await api('/polls');
            window._adminAllPolls = polls || [];
            var currentVal = hidden ? hidden.value : '';
            var items = [{ label: 'Todas', value: 'Todas' }, { label: 'Pesquisa politica', value: 'Pesquisa politica' }];
            (polls || []).forEach(function(p) { items.push({ label: p.title || '(sem titulo)', value: p.title || '' }); });
            var html = '';
            items.forEach(function(item) {
                var active = currentVal === item.value || (!currentVal && item.value === 'Todas');
                html += '<button onclick="selectAdminPoll(this)" data-value="' + item.value.replace(/"/g, '&quot;') + '" style="padding:5px 10px;border-radius:8px;border:1px solid var(--c-border);background:' + (active ? 'var(--c-accent)' : 'rgba(6,6,15,0.6)') + ';color:' + (active ? '#fff' : 'var(--c-text)') + ';font-size:12px;cursor:pointer;white-space:nowrap;">' + item.label + '</button>';
            });
            container.innerHTML = html;
        }
        function selectAdminPoll(btn) {
            var hidden = document.getElementById('adminPollSelector');
            if (hidden) hidden.value = btn.getAttribute('data-value');
            var container = document.getElementById('adminPollButtons');
            if (container) container.querySelectorAll('button').forEach(function(b) {
                var isActive = b === btn;
                b.style.background = isActive ? 'var(--c-accent)' : 'rgba(6,6,15,0.6)';
                b.style.color = isActive ? '#fff' : 'var(--c-text)';
            });
            loadAdminCandidatesForPoll();
        }

        // Load candidates filtered by selected poll
        async function loadAdminCandidatesForPoll() {
            var sel = document.getElementById('adminPollSelector');
            var filterText = sel ? sel.value.trim().toLowerCase() : '';
            var search = (document.getElementById('adminCandidateSearch') || {}).value.trim().toLowerCase();
            var candidates = await api('/all-candidates');
            if (!candidates) return;

            if (filterText && filterText !== 'todas') {
                if (filterText === 'pesquisa politica') {
                    candidates = candidates.filter(function(c) { return ['President','Senator','Governor','Mayor','MP','Deputy'].indexOf(c.role) > -1; });
                } else {
                    // Match by poll title
                    var polls = window._adminAllPolls || [];
                    var poll = polls.find(function(p) { return (p.title||'').toLowerCase() === filterText; });
                    if (poll) {
                        var optNames = (poll.options || []).map(function(o) { return (typeof o === 'string' ? o : o.text || '').toLowerCase(); });
                        candidates = candidates.filter(function(c) {
                            return c.role === poll.title || optNames.indexOf(c.name.toLowerCase()) > -1;
                        });
                    } else {
                        // Partial match on role or name
                        candidates = candidates.filter(function(c) {
                            return (c.role||'').toLowerCase().indexOf(filterText) > -1 || (c.name||'').toLowerCase().indexOf(filterText) > -1;
                        });
                    }
                }
            }

            if (search) {
                candidates = candidates.filter(function(c) {
                    return (c.name||'').toLowerCase().indexOf(search) > -1 || (c.party||'').toLowerCase().indexOf(search) > -1;
                });
            }

            loadAdminCandidates(candidates);
        }

        async function loadAdmin() {
            var stats = await api('/stats');
            if (!stats) return;
            document.getElementById('adminCandidates').textContent = stats.candidates;
            document.getElementById('adminVotes').textContent = stats.votes;
            document.getElementById('adminPolls').textContent = stats.polls;

            var countries = await api('/countries');
            if (!countries) return;
            var adminSelect = document.getElementById('newCandidateCountry');
            if (adminSelect) {
                adminSelect.innerHTML = '<option value="">Pais *</option>';
                countries.forEach(function(c) {
                    adminSelect.innerHTML += '<option value="' + c.name + '">' + c.name + '</option>';
                });
            }

            // Migrate old keywords format to v2
            if (!localStorage.getItem('dt_trending_keywords_v2') && localStorage.getItem('dt_trending_keywords')) {
                var oldKws = localStorage.getItem('dt_trending_keywords').split(',').map(function(k){return k.trim();}).filter(function(k){return k;});
                var migrated = oldKws.map(function(w){return {word:w.toLowerCase(),active:true,weight:20};});
                localStorage.setItem('dt_trending_keywords_v2', JSON.stringify(migrated));
            }
            renderKeywordsList();

            // Load default tab
            showAdminTab('enquetes');
        }

        async function loadAdminStates() {
            const country = document.getElementById('newCandidateCountry').value;
            if (!country) return;
            
            const states = await api('/states?country=' + encodeURIComponent(country));
            if (!states) return;
            
            const stateSelect = document.getElementById('newCandidateState');
            stateSelect.innerHTML = '<option value="">Selecione o estado</option>';
            states.forEach(s => {
                stateSelect.innerHTML += '<option value="' + s.name + '">' + s.name + '</option>';
            });
            
            document.getElementById('newCandidateCity').innerHTML = '<option value="">Selecione a cidade</option>';
        }
        
        async function loadAdminCities() {
            const country = document.getElementById('newCandidateCountry').value;
            const state = document.getElementById('newCandidateState').value;
            if (!country || !state) return;
            
            const cities = await api('/cities?country=' + encodeURIComponent(country) + '&state=' + encodeURIComponent(state));
            if (!cities) return;
            
            const citySelect = document.getElementById('newCandidateCity');
            citySelect.innerHTML = '<option value="">Selecione a cidade</option>';
            cities.forEach(c => {
                citySelect.innerHTML += '<option value="' + c.name + '">' + c.name + '</option>';
            });
        }
        
        async function loadAdminCandidates(prefilteredList) {
            var candidates = prefilteredList || await api('/all-candidates');
            if (!candidates) return;

            var el = document.getElementById('adminCandidatesList');
            if (candidates.length === 0) {
                el.innerHTML = '<p style="color:var(--c-text-mute);">Nenhuma personalidade nesta selecao.</p>';
                return;
            }

            var html = '';
            candidates.forEach(function(c) {
                html += '<div style="display:flex;align-items:center;gap:10px;padding:10px;border-bottom:1px solid rgba(255,255,255,0.05);">';
                html += avatarHtml(c.name, c.photoUrl);
                html += '<div style="flex:1;min-width:0;">';
                html += '<p style="font-weight:600;color:var(--c-text);font-size:14px;">' + (c.name || '-') + '</p>';
                html += '<p style="font-size:12px;color:var(--c-text-mute);">' + (c.party || '') + ' · ' + (c.role || '') + '</p>';
                html += '</div>';
                html += '<div style="display:flex;gap:4px;flex-shrink:0;">';
                html += '<button class="btn btn-secondary btn-small" onclick="event.stopPropagation();editCandidate(\\x27' + c.id + '\\x27)">Editar</button>';
                html += '<button class="btn btn-danger btn-small" onclick="event.stopPropagation();removeCandidate(\\x27' + c.id + '\\x27)">Remover</button>';
                html += '</div></div>';
            });
            el.innerHTML = html;
        }
        
        async function loadAdminPolls() {
            const polls = await api('/polls');
            if (!polls) return;
            
            const pendingPolls = polls.filter(p => !p.approved);
            const approvedPolls = polls.filter(p => p.approved);
            
            if (pendingPolls.length === 0) {
                document.getElementById('adminPendingPollsList').innerHTML = '<p style="color:var(--c-text-mute);">Nenhuma enquete pendente.</p>';
            } else {
                let html = '<table><tr><th>Title</th><th>Category</th><th>Code</th><th>Votes</th><th>Action</th></tr>';
                pendingPolls.forEach(p => {
                    html += '<tr><td>' + p.title + '</td><td>' + (p.category || 'N/A') + '</td><td>' + p.shareCode + '</td><td>' + p.votes + '</td>';
                    html += '<td><button class="btn btn-success btn-small" onclick="approvePoll(\\'' + p.id + '\\')">Approve</button> ';
                    html += '<button class="btn btn-danger btn-small" onclick="removePoll(\\'' + p.id + '\\')">Reject</button></td></tr>';
                });
                html += '</table>';
                document.getElementById('adminPendingPollsList').innerHTML = html;
            }
            
            if (approvedPolls.length === 0) {
                document.getElementById('adminPollsList').innerHTML = '<p style="color:var(--c-text-mute);">Nenhuma enquete aprovada.</p>';
            } else {
                var html = '';
                approvedPolls.forEach(function(p) {
                    html += '<div style="display:flex;align-items:center;gap:8px;padding:10px;border-bottom:1px solid rgba(255,255,255,0.05);">';
                    html += '<div style="flex:1;min-width:0;">';
                    html += '<p style="font-weight:600;color:var(--c-text);font-size:14px;">' + p.title + '</p>';
                    html += '<p style="font-size:11px;color:var(--c-text-mute);">' + (p.category||'') + ' · ' + (p.shareCode||'') + ' · ' + (p.votes||0) + ' votos</p>';
                    html += '</div>';
                    html += '<button class="btn btn-secondary btn-small" onclick="editPollInAdmin(\\x27' + p.title.replace(/'/g,'') + '\\x27)" style="flex-shrink:0;">Editar</button>';
                    html += '<button class="btn btn-danger btn-small" onclick="removePoll(\\x27' + p.id + '\\x27)" style="flex-shrink:0;">Excluir</button>';
                    html += '</div>';
                });
                document.getElementById('adminPollsList').innerHTML = html;
            }
            
            loadPollRanking();
            loadAdminProducts();
        }
        
        async function loadPollRanking() {
            const polls = await api('/polls?type=community&approved=true');
            if (!polls) return;
            var el = document.getElementById('pollRankingList');
            if (!el) return;

            const rankings = (await api('/poll-rankings')) || {};

            polls.sort((a, b) => {
                const rankA = rankings[a.id] !== undefined ? rankings[a.id] : 999;
                const rankB = rankings[b.id] !== undefined ? rankings[b.id] : 999;
                return rankA - rankB;
            });

            if (polls.length === 0) { el.innerHTML = '<p style="color:var(--c-text-mute);">Nenhuma enquete aprovada.</p>'; return; }
            let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;"><tr style="border-bottom:1px solid var(--c-border);"><th style="padding:6px;text-align:center;">Rank</th><th style="padding:6px;text-align:left;">Enquete</th><th style="padding:6px;text-align:center;">Votos</th><th style="padding:6px;text-align:center;">Mover</th></tr>';
            polls.forEach((p, index) => {
                const currentRank = rankings[p.id] !== undefined ? rankings[p.id] : index + 1;
                html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:6px;text-align:center;">' + currentRank + '</td><td style="padding:6px;">' + p.title + '</td><td style="padding:6px;text-align:center;">' + (p.votes || 0) + '</td>';
                html += '<td style="padding:6px;text-align:center;"><button class="btn btn-small" onclick="movePoll(\\x27' + p.id + '\\x27, -1)">↑</button> ';
                html += '<button class="btn btn-small" onclick="movePoll(\\x27' + p.id + '\\x27, 1)">↓</button></td></tr>';
            });
            html += '</table>';
            el.innerHTML = html;
        }

        async function movePoll(pollId, direction) {
            const polls = await api('/polls?type=community&approved=true');
            if (!polls) return;

            const rankings = (await api('/poll-rankings')) || {};
            const currentRank = rankings[pollId] !== undefined ? rankings[pollId] : polls.findIndex(p => p.id === pollId) + 1;
            const newRank = currentRank + direction;

            if (newRank < 1 || newRank > polls.length) return;

            for (let p of polls) {
                if (p.id === pollId) {
                    rankings[pollId] = newRank;
                } else if (rankings[p.id] === newRank) {
                    rankings[p.id] = currentRank;
                } else if (!rankings[p.id]) {
                    const idx = polls.indexOf(p) + 1;
                    if (idx === newRank) {
                        rankings[p.id] = currentRank;
                    }
                }
            }

            await api('/save-rankings', 'POST', { rankings });
            loadPollRanking();
        }
        
        async function loadAdminProducts() {
            const products = await api('/products');
            if (!products) return;
            
            const pendingProducts = products.filter(p => !p.approved);
            const approvedProducts = products.filter(p => p.approved);
            
            let html = '<h4>Pending Products</h4>';
            if (pendingProducts.length === 0) {
                html += '<p>No pending products</p>';
            } else {
                html += '<table><tr><th>Name</th><th>Price</th><th>Poll</th><th>Action</th></tr>';
                pendingProducts.forEach(p => {
                    html += '<tr><td>' + p.name + '</td><td>$' + p.price + '</td><td>' + (p.pollId || 'N/A') + '</td>';
                    html += '<td><button class="btn btn-success btn-small" onclick="approveProduct(\\x27' + p.id + '\\x27)">Approve</button> ';
                    html += '<button class="btn btn-danger btn-small" onclick="removeProduct(\\x27' + p.id + '\\x27)">Reject</button></td></tr>';
                });
                html += '</table>';
            }
            html += '<h4 style="margin-top:20px;">Approved Products</h4>';
            if (approvedProducts.length === 0) {
                html += '<p>No approved products</p>';
            } else {
                html += '<table><tr><th>Name</th><th>Price</th><th>Action</th></tr>';
                approvedProducts.forEach(p => {
                    html += '<tr><td>' + p.name + '</td><td>$' + p.price + '</td>';
                    html += '<td><button class="btn btn-danger btn-small" onclick="removeProduct(\\x27' + p.id + '\\x27)">Delete</button></td></tr>';
                });
                html += '</table>';
            }
            document.getElementById('adminProductsList').innerHTML = html;
        }
        
        async function approveProduct(id) {
            const result = await api('/products/approve/' + id, 'POST');
            if (result && result.success) {
                alert('Product approved!');
                loadAdminProducts();
            }
        }
        
        async function removeProduct(id) {
            if (!confirm('Delete this product?')) return;
            const result = await api('/products/' + id, 'DELETE');
            if (result && result.success) {
                loadAdminProducts();
            }
        }
        
        async function loadProducts() {
            const products = await api('/products');
            const polls = await api('/polls?type=community&approved=true');
            const orders = await api('/product-orders');
            
            if (!products) return;
            
            let html = '';
            if (products.length === 0) {
                html = '<p>No products available yet.</p>';
            } else {
                products.filter(p => p.approved).forEach(prod => {
                    const poll = polls.find(p => p.id === prod.pollId);
                    html += '<div class="poll-card">';
                    html += '<div class="poll-header"><h4>' + prod.name + '</h4>';
                    html += '<span style="font-size:18px;font-weight:bold;color:#28a745;">$' + prod.price + '</span></div>';
                    if (prod.description) html += '<p>' + prod.description + '</p>';
                    html += '<p style="color:#666;font-size:12px;">For poll: ' + (poll ? poll.title : 'N/A') + '</p>';
                    html += '<button class="btn btn-small" onclick="openBuyGift(\\x27' + prod.id + '\\x27)">🎁 Buy as Gift</button>';
                    html += '</div>';
                });
            }
            document.getElementById('productsList').innerHTML = html;
            
            let ordersHtml = '';
            const myOrders = orders.filter(o => o.buyerId === currentUser?.id || o.recipientContact === currentUser?.username);
            if (myOrders.length === 0) {
                ordersHtml = '<p>No gift orders yet.</p>';
            } else {
                myOrders.forEach(o => {
                    const prod = products.find(p => p.id === o.productId);
                    ordersHtml += '<div class="poll-card">';
                    ordersHtml += '<p><strong>' + (prod ? prod.name : 'Unknown') + '</strong> - $' + (prod ? prod.price : '0') + '</p>';
                    ordersHtml += '<p>To: ' + o.recipientName + ' (' + o.recipientContact + ')</p>';
                    ordersHtml += '<p>Voucher: ' + o.voucherCode + '</p>';
                    ordersHtml += '<p>Status: ' + (o.claimed ? '✓ Claimed' : '⏳ Pending claim') + '</p>';
                    ordersHtml += '</div>';
                });
            }
            document.getElementById('myProductOrders').innerHTML = ordersHtml;
        }
        
        function showAddProductForm() {
            api('/polls?type=community&approved=true').then(polls => {
                const select = document.getElementById('productPollSelect');
                select.innerHTML = '';
                polls.forEach(p => {
                    select.innerHTML += '<option value="' + p.id + '">' + p.title + '</option>';
                });
                document.getElementById('addProductModal').style.display = 'block';
            });
        }
        
        function closeAddProductModal() {
            document.getElementById('addProductModal').style.display = 'none';
        }
        
        async function submitProduct() {
            const name = document.getElementById('productName').value.trim();
            const price = parseFloat(document.getElementById('productPrice').value);
            const description = document.getElementById('productDescription').value.trim();
            const pollId = document.getElementById('productPollSelect').value;
            
            if (!name || !price || !pollId) {
                alert('Please fill all required fields');
                return;
            }
            
            const result = await api('/products', 'POST', {
                name, price, description, pollId,
                suggestedBy: currentUser?.id,
                approved: currentUser?.role === 'admin'
            });
            
            if (result && result.success) {
                alert(currentUser?.role === 'admin' ? 'Product added!' : 'Product suggested! Waiting for admin approval.');
                closeAddProductModal();
                loadProducts();
            }
        }
        
        let selectedProductForGift = null;
        
        function openBuyGift(productId) {
            selectedProductForGift = productId;
            api('/products').then(products => {
                const prod = products.find(p => p.id === productId);
                if (!prod) return;
                document.getElementById('giftProductInfo').innerHTML = '<p><strong>' + prod.name + '</strong> - $' + prod.price + '</p>';
                document.getElementById('buyGiftModal').style.display = 'block';
            });
        }
        
        function closeBuyGiftModal() {
            document.getElementById('buyGiftModal').style.display = 'none';
            selectedProductForGift = null;
        }
        
        async function confirmPurchase() {
            const recipientName = document.getElementById('recipientName').value.trim();
            const recipientContact = document.getElementById('recipientContact').value.trim();
            const message = document.getElementById('giftMessage').value.trim();
            
            if (!recipientName || !recipientContact || !selectedProductForGift) {
                alert('Please fill required fields');
                return;
            }
            
            const result = await api('/product-orders', 'POST', {
                productId: selectedProductForGift,
                buyerId: currentUser?.id,
                buyerName: currentUser?.name,
                recipientName,
                recipientContact,
                message
            });
            
            if (result && result.success) {
                alert('Gift purchased! Voucher Code: ' + result.voucherCode + '\\n\\nShare this code with ' + recipientName + ' to claim their gift after registering and voting.');
                closeBuyGiftModal();
                loadProducts();
            }
        }
        
        async function redeemVoucher() {
            if (!currentUser) {
                alert('Please login to redeem voucher');
                return;
            }
            
            const voucherCode = document.getElementById('redeemVoucherCode').value.trim().toUpperCase();
            const name = document.getElementById('redeemName').value.trim();
            const email = document.getElementById('redeemEmail').value.trim();
            const telephone = document.getElementById('redeemTelephone').value.trim();
            const address = document.getElementById('redeemAddress').value.trim();
            
            if (!voucherCode || !name || !email || !address) {
                alert('Please fill all required fields');
                return;
            }
            
            const result = await api('/redeem-voucher', 'POST', {
                voucherCode,
                name,
                email,
                telephone,
                address,
                userId: currentUser.username
            });
            
            if (result && result.success) {
                alert('Voucher redeemed successfully! Your gift will be delivered to the provided address.');
                document.getElementById('redeemVoucherCode').value = '';
                document.getElementById('redeemName').value = '';
                document.getElementById('redeemEmail').value = '';
                document.getElementById('redeemTelephone').value = '';
                document.getElementById('redeemAddress').value = '';
                loadProducts();
            } else {
                alert(result?.error || 'Failed to redeem voucher');
            }
        }
        
        async function searchPollByCode() {
            const code = document.getElementById('pollCodeSearch').value.trim().toUpperCase();
            if (code.length < 3) {
                document.getElementById('searchResult').innerHTML = '';
                return;
            }
            
            const polls = await api('/polls');
            const poll = polls.find(p => p.shareCode && p.shareCode.toUpperCase() === code);
            
            if (poll) {
                let html = '<div class="poll-card" style="border:2px solid #4A90D9;cursor:pointer;" onclick="viewPollResults(\\x27' + poll.id + '\\x27)">';
                html += '<h4>' + poll.title + '</h4>';
                html += '<p>Category: ' + (poll.category || 'Other') + '</p>';
                html += '<p>Click to view results and vote →</p>';
                html += '</div>';
                document.getElementById('searchResult').innerHTML = html;
            } else {
                document.getElementById('searchResult').innerHTML = '<p style="color:#666;">No poll found with this code</p>';
            }
        }
        
        function generateCandleChartFromData(name1, name2, history) {
            if (!history || history.length === 0) return '';
            var last = history[history.length - 1];
            var prev = history.length > 1 ? history[history.length - 2] : { closePct: 50 };
            var change = (last.closePct - prev.closePct).toFixed(1);
            var changeColor = parseFloat(change) >= 0 ? '#00ff88' : '#ff4444';
            var arrow = parseFloat(change) >= 0 ? '▲' : '▼';
            var html = '<div class="card" style="margin-top:16px;background:#1a1a2e;color:white;padding:16px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
            html += '<h4 style="color:white;margin:0;font-size:14px;">📈 ' + name1 + ' / ' + name2 + '</h4>';
            html += '<span style="color:#888;font-size:11px;font-family:monospace;">' + history.length + ' candles</span></div>';
            html += '<div style="display:flex;gap:16px;align-items:baseline;margin-bottom:10px;">';
            html += '<span style="font-size:20px;font-weight:bold;color:white;font-family:monospace;">' + last.closePct.toFixed(1) + '%</span>';
            html += '<span style="color:' + changeColor + ';font-size:12px;font-family:monospace;">' + arrow + ' ' + (parseFloat(change)>=0?'+':'') + change + '%</span>';
            html += '<span style="color:#00ff88;font-size:11px;">' + name1.substring(0,12) + ': ' + last.votes1 + '</span>';
            html += '<span style="color:#ff4444;font-size:11px;">' + name2.substring(0,12) + ': ' + last.votes2 + '</span></div>';

            // highPct = total ALL votes at that moment, lowPct = previous total
            var maxTotal = 1;
            for (var i = 0; i < history.length; i++) {
                if (history[i].highPct > maxTotal) maxTotal = history[i].highPct;
            }

            var chartH = 140, marginL = 40, marginR = 10, marginT = 8, marginB = 40;
            var svgW = Math.max(400, Math.min(history.length * 24 + marginL + marginR, 900));
            var svgH = chartH + marginT + marginB;
            var plotW = svgW - marginL - marginR;
            var candleW = Math.max(6, Math.min(18, (plotW / history.length) - 2));
            var gap = (plotW - candleW * history.length) / Math.max(1, history.length);
            html += '<div style="overflow-x:auto;margin:0 -8px;padding:0 8px;">';
            html += '<svg width="' + svgW + '" height="' + svgH + '" style="background:#0f0f1e;border-radius:8px;display:block;">';
            // Grid: Y-axis = percentage (body), 50% midline
            for (var pct = 0; pct <= 100; pct += 25) {
                var gy = marginT + chartH - (pct / 100 * chartH);
                html += '<line x1="' + marginL + '" y1="' + gy + '" x2="' + (svgW-marginR) + '" y2="' + gy + '" stroke="' + (pct===50?'#444':'#1a1a2e') + '" stroke-width="1" stroke-dasharray="' + (pct===50?'4,2':'2,4') + '"/>';
                html += '<text x="' + (marginL-4) + '" y="' + (gy+3) + '" fill="#555" font-size="8" text-anchor="end" font-family="monospace">' + pct + '%</text>';
            }
            html += '<text x="' + (marginL-4) + '" y="' + (marginT-1) + '" fill="#00ff88" font-size="7" text-anchor="end">' + name1.substring(0,10) + '</text>';
            html += '<text x="' + (marginL-4) + '" y="' + (marginT+chartH+10) + '" fill="#ff4444" font-size="7" text-anchor="end">' + name2.substring(0,10) + '</text>';

            // Draw volume line (total votes over time) behind candles
            var volPath = 'M';
            for (var vi = 0; vi < history.length; vi++) {
                var vx = marginL + vi * (candleW + gap) + candleW / 2;
                var vy = marginT + chartH - (history[vi].highPct / maxTotal * chartH * 0.9);
                volPath += (vi === 0 ? '' : ' L') + vx + ' ' + vy;
            }
            html += '<path d="' + volPath + '" fill="none" stroke="rgba(255,203,71,0.3)" stroke-width="1.5"/>';
            // Volume label on right
            html += '<text x="' + (svgW - marginR - 2) + '" y="' + (marginT + 10) + '" fill="rgba(255,203,71,0.5)" font-size="7" text-anchor="end" font-family="monospace">Total: ' + history[history.length-1].highPct + '</text>';

            for (var idx = 0; idx < history.length; idx++) {
                var candle = history[idx];
                var cx = marginL + idx * (candleW + gap) + candleW / 2;
                // Body: open/close = pair percentage (who leads between the two)
                var openY = marginT + chartH - (candle.openPct / 100 * chartH);
                var closeY = marginT + chartH - (candle.closePct / 100 * chartH);
                var bullish = candle.closePct >= candle.openPct;
                var color = bullish ? '#00ff88' : '#ff4444';
                var bodyTop = Math.min(openY, closeY);
                var bodyBot = Math.max(openY, closeY);
                var bodyH = Math.max(2, bodyBot - bodyTop);
                // Wick: extends from body proportional to individual candidate vote counts
                var wickUp = (candle.votes1 / maxTotal) * chartH * 0.3;
                var wickDn = (candle.votes2 / maxTotal) * chartH * 0.3;
                var wickTopY = Math.max(marginT, bodyTop - wickUp);
                var wickBotY = Math.min(marginT + chartH, bodyBot + wickDn);
                html += '<line x1="' + cx + '" y1="' + wickTopY + '" x2="' + cx + '" y2="' + wickBotY + '" stroke="' + color + '" stroke-width="1"/>';
                html += '<rect x="' + (cx-candleW/2) + '" y="' + bodyTop + '" width="' + candleW + '" height="' + bodyH + '" fill="' + color + '" fill-opacity="0.85" rx="1"/>';
                // Time labels
                var labelEvery = Math.max(1, Math.floor(history.length / 10));
                if (idx % labelEvery === 0 || idx === history.length - 1) {
                    var t = new Date(candle.timestamp);
                    html += '<text x="' + cx + '" y="' + (marginT+chartH+16) + '" fill="#666" font-size="7" text-anchor="middle" font-family="monospace">' + t.toLocaleString('pt-BR',{hour:'2-digit',minute:'2-digit'}) + '</text>';
                    html += '<text x="' + cx + '" y="' + (marginT+chartH+26) + '" fill="#555" font-size="6" text-anchor="middle" font-family="monospace">' + t.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit'}) + '</text>';
                }
                // Last candle: show vote counts
                if (idx === history.length - 1) {
                    html += '<text x="' + (cx+candleW) + '" y="' + (wickTopY+3) + '" fill="#00ff88" font-size="7" font-family="monospace">' + candle.votes1 + '</text>';
                    html += '<text x="' + (cx+candleW) + '" y="' + (wickBotY+3) + '" fill="#ff4444" font-size="7" font-family="monospace">' + candle.votes2 + '</text>';
                }
            }
            html += '<rect x="' + marginL + '" y="' + marginT + '" width="' + plotW + '" height="' + chartH + '" fill="none" stroke="#333" stroke-width="1"/>';
            html += '</svg></div></div>';
            return html;
        }

        async function generateCandleChart(pollId, poll) {
            var candleData = await api('/candle-history?pollId=' + pollId);

            if (!candleData) return '';
            // Render ALL cumulative charts (when leaders change, old chart stays)
            var allHtml = '';
            if (candleData.allCharts && candleData.allCharts.length > 0) {
                for (var i = 0; i < candleData.allCharts.length; i++) {
                    var ch = candleData.allCharts[i];
                    if (ch.history.length > 0) {
                        allHtml += generateCandleChartFromData(ch.option1.text, ch.option2.text, ch.history);
                    }
                }
                return allHtml;
            }
            if (!candleData.history || candleData.history.length === 0) {
                return '';
            }

            const { option1, option2, history } = candleData;
            let html = '<div class="card" style="margin-top:20px;background:#1a1a2e;color:white;padding:16px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
            html += '<h4 style="color:white;margin:0;">📈 ' + option1.text + ' / ' + option2.text + '</h4>';
            html += '<span style="color:#888;font-size:11px;font-family:monospace;">' + history.length + ' candles</span>';
            html += '</div>';

            // Price-like header (latest values)
            const last = history[history.length - 1];
            const prev = history.length > 1 ? history[history.length - 2] : { closePct: 50 };
            const change = (last.closePct - prev.closePct).toFixed(1);
            const changeColor = parseFloat(change) >= 0 ? '#00ff88' : '#ff4444';
            const arrow = parseFloat(change) >= 0 ? '▲' : '▼';
            html += '<div style="display:flex;gap:20px;align-items:baseline;margin-bottom:12px;">';
            html += '<span style="font-size:22px;font-weight:bold;color:white;font-family:monospace;">' + last.closePct.toFixed(1) + '%</span>';
            html += '<span style="color:' + changeColor + ';font-size:13px;font-family:monospace;">' + arrow + ' ' + (parseFloat(change) >= 0 ? '+' : '') + change + '%</span>';
            html += '<span style="color:#555;font-size:11px;">' + last.votes1 + ' vs ' + last.votes2 + ' (' + last.total + ' total)</span>';
            html += '</div>';

            const chartH = 180;
            const marginL = 45;
            const marginR = 10;
            const marginT = 10;
            const marginB = 50;
            const svgW = Math.max(600, Math.min(history.length * 28 + marginL + marginR, 1200));
            const svgH = chartH + marginT + marginB;
            const plotW = svgW - marginL - marginR;
            const candleW = Math.max(8, Math.min(24, (plotW / history.length) - 2));
            const gap = (plotW - candleW * history.length) / Math.max(1, history.length);

            html += '<div style="overflow-x:auto;margin:0 -8px;padding:0 8px;">';
            html += '<svg width="' + svgW + '" height="' + svgH + '" style="background:#0f0f1e;border-radius:8px;display:block;">';

            // Y-axis grid lines (0%, 25%, 50%, 75%, 100%)
            for (let pct = 0; pct <= 100; pct += 25) {
                const gy = marginT + chartH - (pct / 100 * chartH);
                const gridColor = pct === 50 ? '#444' : '#222';
                const dash = pct === 50 ? '4,2' : '2,4';
                html += '<line x1="' + marginL + '" y1="' + gy + '" x2="' + (svgW - marginR) + '" y2="' + gy + '" stroke="' + gridColor + '" stroke-width="1" stroke-dasharray="' + dash + '"/>';
                html += '<text x="' + (marginL - 5) + '" y="' + (gy + 3) + '" fill="#666" font-size="9" text-anchor="end" font-family="monospace">' + pct + '%</text>';
            }

            // Y-axis labels
            html += '<text x="' + (marginL - 5) + '" y="' + (marginT - 2) + '" fill="#00ff88" font-size="8" text-anchor="end">' + option1.text.substring(0, 12) + '</text>';
            html += '<text x="' + (marginL - 5) + '" y="' + (marginT + chartH + 12) + '" fill="#ff4444" font-size="8" text-anchor="end">' + option2.text.substring(0, 12) + '</text>';

            // Candles
            history.forEach((candle, idx) => {
                const cx = marginL + idx * (candleW + gap) + candleW / 2;
                const x = cx - candleW / 2;

                // Map percentages to Y (100% = top, 0% = bottom)
                const openY = marginT + chartH - (candle.openPct / 100 * chartH);
                const closeY = marginT + chartH - (candle.closePct / 100 * chartH);
                const highY = marginT + chartH - (candle.highPct / 100 * chartH);
                const lowY = marginT + chartH - (candle.lowPct / 100 * chartH);

                const bullish = candle.closePct >= candle.openPct;
                const color = bullish ? '#00ff88' : '#ff4444';
                const fillColor = bullish ? '#00ff88' : '#ff4444';
                const fillOpacity = bullish ? '0.85' : '0.85';

                // Wick (high to low)
                html += '<line x1="' + cx + '" y1="' + highY + '" x2="' + cx + '" y2="' + lowY + '" stroke="' + color + '" stroke-width="1.5"/>';

                // Body (open to close)
                const bodyTop = Math.min(openY, closeY);
                const bodyH = Math.max(2, Math.abs(closeY - openY));
                html += '<rect x="' + x + '" y="' + bodyTop + '" width="' + candleW + '" height="' + bodyH + '" fill="' + fillColor + '" fill-opacity="' + fillOpacity + '" rx="1"/>';

                // Time label on X axis (show every Nth label to avoid overlap)
                const labelEvery = Math.max(1, Math.floor(history.length / 12));
                if (idx % labelEvery === 0 || idx === history.length - 1) {
                    const t = new Date(candle.timestamp);
                    const timeStr = t.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                    const dateStr = t.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit' });
                    html += '<text x="' + cx + '" y="' + (marginT + chartH + 18) + '" fill="#666" font-size="8" text-anchor="middle" font-family="monospace">' + timeStr + '</text>';
                    html += '<text x="' + cx + '" y="' + (marginT + chartH + 28) + '" fill="#555" font-size="7" text-anchor="middle" font-family="monospace">' + dateStr + '</text>';
                    // Tick mark
                    html += '<line x1="' + cx + '" y1="' + (marginT + chartH) + '" x2="' + cx + '" y2="' + (marginT + chartH + 4) + '" stroke="#444" stroke-width="1"/>';
                }

                // Tooltip-like last candle highlight
                if (idx === history.length - 1) {
                    html += '<line x1="' + (cx + candleW/2 + 2) + '" y1="' + closeY + '" x2="' + (svgW - marginR) + '" y2="' + closeY + '" stroke="' + color + '" stroke-width="0.5" stroke-dasharray="2,2"/>';
                    html += '<rect x="' + (svgW - marginR - 38) + '" y="' + (closeY - 7) + '" width="38" height="14" fill="' + color + '" rx="2"/>';
                    html += '<text x="' + (svgW - marginR - 19) + '" y="' + (closeY + 3) + '" fill="#000" font-size="9" text-anchor="middle" font-weight="bold" font-family="monospace">' + candle.closePct.toFixed(1) + '</text>';
                }
            });

            // Border frame
            html += '<rect x="' + marginL + '" y="' + marginT + '" width="' + plotW + '" height="' + chartH + '" fill="none" stroke="#333" stroke-width="1"/>';

            html += '</svg>';
            html += '</div>';

            // Volume bars (vote counts per candle)
            html += '<div style="margin-top:10px;overflow-x:auto;">';
            html += '<div style="display:flex;gap:2px;align-items:flex-end;height:30px;min-width:' + (history.length * 14) + 'px;">';
            const maxTotal = Math.max(...history.map(c => c.total));
            history.forEach((candle) => {
                const barH = Math.max(2, (candle.total / maxTotal) * 28);
                const color = candle.closePct >= 50 ? 'rgba(0,255,136,0.4)' : 'rgba(255,68,68,0.4)';
                html += '<div style="flex:1;height:' + barH + 'px;background:' + color + ';border-radius:1px;" title="' + candle.total + ' votes"></div>';
            });
            html += '</div>';
            html += '<div style="display:flex;justify-content:space-between;margin-top:2px;">';
            html += '<span style="color:#555;font-size:9px;font-family:monospace;">VOL</span>';
            html += '<span style="color:#555;font-size:9px;font-family:monospace;">' + last.total + '</span>';
            html += '</div>';
            html += '</div>';

            html += '</div>';
            return html;
        }
        
        async function approvePoll(id) {
            const result = await api('/polls/approve/' + id, 'POST');
            if (result && result.success) {
                alert('Poll approved!');
                loadAdminPolls();
            }
        }
        
        async function addCandidate() {
            const name = document.getElementById('newCandidateName').value.trim();
            const party = document.getElementById('newCandidateParty').value.trim();
            const country = document.getElementById('newCandidateCountry').value;
            const state = document.getElementById('newCandidateState').value;
            const city = document.getElementById('newCandidateCity').value;
            const role = document.getElementById('newCandidateRole').value;
            
            if (!name || !party || !country) {
                alert('Preencha nome, partido e selecione o pais');
                return;
            }
            
            const photoUrl = (document.getElementById('candPhotoUrl') || {}).value || '';
            const result = await api('/candidates', 'POST', {
                name, party,
                country,
                state: state || 'N/A',
                city: city || 'N/A',
                role, type: 'political',
                photoUrl: photoUrl
            });
            
            if (result && result.success) {
                alert('Candidato adicionado!');
                document.getElementById('newCandidateName').value = '';
                document.getElementById('newCandidateParty').value = '';
                const cpu = document.getElementById('candPhotoUrl'); if (cpu) cpu.value = '';
                const cpp = document.getElementById('candPhotoPreview'); if (cpp) cpp.textContent = '📷';
                const cpf = document.getElementById('candPhotoFile'); if (cpf) cpf.value = '';
                loadAdminCandidates();
                loadAdmin();
            }
        }
        
        function editPollInAdmin(title) {
            showAdminTab('personalidades');
            var sel = document.getElementById('adminPollSelector');
            if (sel) { sel.value = title; loadAdminCandidatesForPoll(); }
        }

        async function editCandidate(id) {
            var candidates = await api('/all-candidates');
            var c = candidates ? candidates.find(function(x) { return x.id === id; }) : null;
            if (!c) return;
            var countries = await api('/countries') || [];
            // Build inline edit form
            var el = document.getElementById('adminCandidatesList');
            var countryOpts = countries.map(function(co){return '<option value="'+co.name+'"'+(co.name===c.country?' selected':'')+'>'+co.name+'</option>';}).join('');
            var roleOpts = ['President','Senator','Governor','Mayor','MP','Deputy','Copa 2026','Comunidade'].map(function(r){return '<option value="'+r+'"'+(r===c.role?' selected':'')+'>'+r+'</option>';}).join('');
            var photoPreview = c.photoUrl ? '<img src="' + (c.photoUrl.startsWith('/') ? c.photoUrl : c.photoUrl) + '" style="width:60px;height:60px;border-radius:8px;object-fit:cover;">' : '📷';
            var formHtml = '<div class="card" style="padding:14px;border:2px solid var(--c-accent);margin-bottom:10px;" id="editCandForm">';
            formHtml += '<h4 style="margin:0 0 10px;">Editar: ' + c.name + '</h4>';
            formHtml += '<div style="display:flex;flex-direction:column;gap:8px;">';
            formHtml += '<input type="text" id="editCandName" value="' + (c.name||'').replace(/"/g,'&quot;') + '" placeholder="Nome">';
            formHtml += '<input type="text" id="editCandParty" value="' + (c.party||'').replace(/"/g,'&quot;') + '" placeholder="Descricao/posicao">';
            formHtml += '<select id="editCandRole">' + roleOpts + '</select>';
            formHtml += '<select id="editCandCountry">' + '<option value="">Pais</option>' + countryOpts + '</select>';
            formHtml += '<div style="display:flex;align-items:center;gap:10px;"><div id="editCandPhotoPreview" style="width:60px;height:60px;border-radius:8px;background:var(--c-surface-strong);display:flex;align-items:center;justify-content:center;overflow:hidden;">' + photoPreview + '</div>';
            formHtml += '<label class="btn btn-secondary btn-small" for="editCandPhotoFile">Alterar foto</label>';
            formHtml += '<input type="file" id="editCandPhotoFile" accept="image/*" style="display:none;" onchange="previewEditCandPhoto(event)"></div>';
            formHtml += '<input type="hidden" id="editCandPhotoUrl" value="' + (c.photoUrl||'') + '">';
            formHtml += '</div>';
            formHtml += '<div style="display:flex;gap:8px;margin-top:10px;">';
            formHtml += '<button class="btn" style="flex:1;" onclick="saveEditCandidate(\\x27' + id + '\\x27)">Salvar</button>';
            formHtml += '<button class="btn btn-secondary" style="flex:1;" onclick="loadAdminCandidatesForPoll()">Cancelar</button>';
            formHtml += '</div></div>';
            el.innerHTML = formHtml;
        }
        function previewEditCandPhoto(e) {
            var file = e.target.files[0]; if (!file) return;
            _resizeImage(file, 800).then(function(dataUrl) {
                document.getElementById('editCandPhotoPreview').innerHTML = '<img src="' + dataUrl + '" style="width:60px;height:60px;border-radius:8px;object-fit:cover;">';
                document.getElementById('editCandPhotoUrl').value = '__pending__';
                document.getElementById('editCandPhotoFile').dataset.resized = dataUrl;
            });
        }
        async function saveEditCandidate(id) {
            var name = document.getElementById('editCandName').value.trim();
            var party = document.getElementById('editCandParty').value.trim();
            var role = document.getElementById('editCandRole').value;
            var country = document.getElementById('editCandCountry').value;
            var photoUrl = document.getElementById('editCandPhotoUrl').value;
            if (!name) { alert('Nome obrigatorio'); return; }
            if (photoUrl === '__pending__') {
                var resized = document.getElementById('editCandPhotoFile').dataset.resized;
                var uploadResult = await api('/upload-photo', 'POST', { data: resized, kind: 'candidate' });
                photoUrl = (uploadResult && uploadResult.url) || '';
            }
            await api('/candidates/' + id, 'PUT', { name: name, party: party, role: role, country: country, photoUrl: photoUrl });
            loadAdminCandidatesForPoll();
        }

        async function removeCandidate(id) {
            if (!confirm('Remover este candidato?')) return;
            var result = await api('/candidates/' + id, 'DELETE');
            if (result && result.success) {
                loadAdminCandidatesForPoll();
            }
        }
        
        async function removePoll(id) {
            if (!confirm('Excluir esta enquete?')) return;
            const result = await api('/polls/' + id, 'DELETE');
            if (result && result.success) {
                loadAdminPolls();
                loadAdmin();
            }
        }
        
        async function clearVotes() {
            if (!confirm('Delete ALL votes? This cannot be undone!')) return;
            const result = await api('/votes', 'DELETE');
            if (result && result.success) {
                alert('All votes cleared!');
                loadAdmin();
            }
        }
        
        async function exportData() {
            const data = await api('/export');
            if (!data) return;
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'datatoalha_export_' + new Date().toISOString().split('T')[0] + '.json';
            a.click();
        }

        // ── Contact form ──
        async function submitContact() {
            const name = document.getElementById('contactName').value.trim();
            const email = document.getElementById('contactEmail').value.trim();
            const telephone = document.getElementById('contactPhone').value.trim();
            const city = document.getElementById('contactCity').value.trim();
            const interest = document.getElementById('contactInterest').value;
            const status = document.getElementById('contactStatus');
            if (!name || !email) { status.style.color = '#ff4444'; status.textContent = 'Nome e e-mail são obrigatórios.'; return; }
            const result = await api('/contact', 'POST', { name, email, telephone, city, interest });
            if (result && result.success) {
                status.style.color = '#00ff88'; status.textContent = 'Mensagem enviada com sucesso!';
                ['contactName','contactEmail','contactPhone','contactCity','contactInterest'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
                setTimeout(() => { status.textContent = ''; }, 4000);
            } else {
                status.style.color = '#ff4444'; status.textContent = (result && result.error) || 'Erro ao enviar.';
            }
        }

        // ── Admin: Users table ──
        async function loadAdminUsers() {
            const users = await api('/admin/users');
            const el = document.getElementById('adminUsersList');
            if (!el) return;
            if (!users || !Array.isArray(users)) { el.innerHTML = '<p style="color:#ff4444;font-size:12px;">Erro ao carregar usuarios. ' + (users && users.error ? users.error : 'Verifique o login.') + '</p>'; return; }
            if (users.length === 0) { el.innerHTML = '<p style="color:var(--c-text-mute);">Nenhum usuário registrado.</p>'; return; }
            let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
            html += '<tr style="border-bottom:1px solid var(--c-border);"><th style="text-align:left;padding:6px;">Nome</th><th style="text-align:left;padding:6px;">Email</th><th style="text-align:left;padding:6px;">Username</th><th style="text-align:center;padding:6px;">Papel</th><th style="text-align:left;padding:6px;">Criado</th><th style="padding:6px;">Ações</th></tr>';
            users.forEach(u => {
                const date = u.createdAt ? new Date(u.createdAt).toLocaleDateString('pt-BR') : '-';
                const roleBadge = u.role === 'admin' ? '<span style="background:#e65100;color:white;padding:2px 6px;border-radius:4px;font-size:10px;">admin</span>' : '<span style="background:#1565c0;color:white;padding:2px 6px;border-radius:4px;font-size:10px;">user</span>';
                var roleBtn = u.role === 'admin' ? '<button onclick="adminToggleRole(\\x27' + u.id + '\\x27,\\x27user\\x27)" style="background:none;border:none;color:#ff9800;cursor:pointer;font-size:11px;">Revogar admin</button>' : '<button onclick="adminToggleRole(\\x27' + u.id + '\\x27,\\x27admin\\x27)" style="background:none;border:none;color:#4caf50;cursor:pointer;font-size:11px;">Tornar admin</button>';
                const actions = (u.role !== 'admin' ? '<button onclick="adminDeleteUser(\\x27' + u.id + '\\x27)" style="background:none;border:none;color:#ff4444;cursor:pointer;font-size:11px;">Remover</button> ' : '') + roleBtn;
                html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:6px;">' + (u.name || '-') + '</td><td style="padding:6px;">' + (u.email || '-') + '</td><td style="padding:6px;">' + (u.username || '-') + '</td><td style="padding:6px;text-align:center;">' + roleBadge + '</td><td style="padding:6px;">' + date + '</td><td style="padding:6px;">' + actions + '</td></tr>';
            });
            html += '</table>';
            el.innerHTML = html;
        }

        async function adminDeleteUser(userId) {
            if (!confirm('Remover este usuário permanentemente?')) return;
            await api('/admin/user/' + userId, 'DELETE');
            loadAdminUsers();
        }

        async function adminToggleRole(userId, newRole) {
            var msg = newRole === 'admin' ? 'Tornar este usuario admin?' : 'Revogar papel de admin?';
            if (!confirm(msg)) return;
            await api('/admin/user/' + userId + '/role', 'PUT', { role: newRole });
            loadAdminUsers();
        }

        // ── Admin: Contacts table ──
        async function loadAdminContacts() {
            const contacts = await api('/admin/contacts');
            const el = document.getElementById('adminContactsList');
            if (!el) return;
            if (!contacts || !Array.isArray(contacts)) { el.innerHTML = '<p style="color:#ff4444;font-size:12px;">Erro ao carregar contatos. ' + (contacts && contacts.error ? contacts.error : 'Verifique o login.') + '</p>'; return; }
            if (contacts.length === 0) { el.innerHTML = '<p style="color:var(--c-text-mute);">Nenhum contato recebido.</p>'; return; }
            let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
            html += '<tr style="border-bottom:1px solid var(--c-border);"><th style="text-align:left;padding:6px;">Nome</th><th style="text-align:left;padding:6px;">Email</th><th style="text-align:left;padding:6px;">Telefone</th><th style="text-align:left;padding:6px;">Cidade</th><th style="text-align:left;padding:6px;">Interesse</th><th style="text-align:left;padding:6px;">Data</th></tr>';
            contacts.forEach(c => {
                const date = c.timestamp ? new Date(c.timestamp).toLocaleDateString('pt-BR') : '-';
                html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:6px;">' + (c.name || '-') + '</td><td style="padding:6px;">' + (c.email || '-') + '</td><td style="padding:6px;">' + (c.telephone || '-') + '</td><td style="padding:6px;">' + (c.city || '-') + '</td><td style="padding:6px;">' + (c.interest || '-') + '</td><td style="padding:6px;">' + date + '</td></tr>';
            });
            html += '</table>';
            el.innerHTML = html;
        }

        // ── Admin: Chat reports table ──
        async function loadAdminReports() {
            const reports = await api('/admin/chat-reports');
            const el = document.getElementById('adminChatReports');
            if (!el || !reports || !Array.isArray(reports)) return;
            if (reports.length === 0) { el.innerHTML = '<p style="color:var(--c-text-mute);">Nenhuma denúncia.</p>'; return; }
            let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
            html += '<tr style="border-bottom:1px solid var(--c-border);"><th style="text-align:left;padding:6px;">Denunciante</th><th style="text-align:left;padding:6px;">Denunciado</th><th style="text-align:left;padding:6px;">Mensagem</th><th style="text-align:left;padding:6px;">Motivo</th><th style="text-align:left;padding:6px;">Data</th></tr>';
            reports.forEach(r => {
                const date = r.timestamp ? new Date(r.timestamp).toLocaleDateString('pt-BR') : '-';
                html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:6px;">@' + (r.reporterName || '-') + '</td><td style="padding:6px;">@' + (r.reportedUser || '-') + '</td><td style="padding:6px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (r.reportedText || '-') + '</td><td style="padding:6px;">' + (r.reason || '-') + '</td><td style="padding:6px;">' + date + '</td></tr>';
            });
            html += '</table>';
            el.innerHTML = html;
        }

        loadStats();

        // ── Admin: Trending override ──
        function _getKeywordsData() {
            try { return JSON.parse(localStorage.getItem('dt_trending_keywords_v2') || '[]'); } catch(_) { return []; }
        }
        function _saveKeywordsData(arr) {
            localStorage.setItem('dt_trending_keywords_v2', JSON.stringify(arr));
            // compat: also write comma-separated active keywords for the algorithm
            localStorage.setItem('dt_trending_keywords', arr.filter(function(k){return k.active;}).map(function(k){return k.word;}).join(','));
        }
        function addKeyword() {
            var input = document.getElementById('adminNewKeyword');
            var raw = (input.value || '').split(',');
            var kws = _getKeywordsData();
            raw.forEach(function(w) {
                w = w.trim().toLowerCase();
                if (!w || kws.some(function(k){return k.word===w;})) return;
                kws.push({ word: w, active: true, weight: 20 });
            });
            _saveKeywordsData(kws);
            input.value = '';
            renderKeywordsList();
        }
        function toggleKeyword(idx) {
            var kws = _getKeywordsData(); if (!kws[idx]) return;
            kws[idx].active = !kws[idx].active;
            _saveKeywordsData(kws); renderKeywordsList();
        }
        function updateKeywordWeight(idx, val) {
            var kws = _getKeywordsData(); if (!kws[idx]) return;
            kws[idx].weight = parseInt(val) || 0;
            _saveKeywordsData(kws);
            var label = document.getElementById('kwWeight_' + idx);
            if (label) label.textContent = val;
        }
        function removeKeyword(idx) {
            var kws = _getKeywordsData(); kws.splice(idx, 1);
            _saveKeywordsData(kws); renderKeywordsList();
        }
        function renderKeywordsList() {
            var el = document.getElementById('adminKeywordsList'); if (!el) return;
            var kws = _getKeywordsData();
            if (kws.length === 0) { el.innerHTML = '<p style="color:var(--c-text-mute);font-size:12px;">Nenhuma keyword configurada.</p>'; return; }
            var html = '';
            kws.forEach(function(k, i) {
                html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">';
                html += '<input type="checkbox" ' + (k.active ? 'checked' : '') + ' onchange="toggleKeyword(' + i + ')" style="width:18px;height:18px;">';
                html += '<span style="flex:1;font-size:13px;color:' + (k.active ? 'var(--c-text)' : 'var(--c-text-mute);text-decoration:line-through') + ';">' + k.word + '</span>';
                html += '<input type="range" min="0" max="100" value="' + k.weight + '" oninput="updateKeywordWeight(' + i + ',this.value)" style="width:80px;">';
                html += '<span id="kwWeight_' + i + '" style="font-size:11px;color:var(--c-cyan-soft);min-width:24px;text-align:right;">' + k.weight + '</span>';
                html += '<button onclick="removeKeyword(' + i + ')" style="background:none;border:none;color:#ff4444;cursor:pointer;font-size:14px;">✕</button>';
                html += '</div>';
            });
            el.innerHTML = html;
        }

        async function loadAdminTrending() {
            const el = document.getElementById('adminTrendingList');
            if (!el) return;
            const polls = await api('/polls?type=community&approved=true');
            if (!polls || polls.length === 0) { el.innerHTML = '<p style="color:var(--c-text-mute);">Nenhuma enquete aprovada.</p>'; return; }
            const saved = JSON.parse(localStorage.getItem('dt_trending_override') || '{}');
            window._adminTrendingOverride = saved;
            let html = '';
            polls.forEach((p, i) => {
                const checked = saved[p.id] != null;
                const rank = saved[p.id] || (i + 1);
                html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">';
                html += '<input type="checkbox" id="trend_' + p.id + '" ' + (checked ? 'checked' : '') + ' style="width:18px;height:18px;">';
                html += '<input type="number" id="trendrank_' + p.id + '" value="' + rank + '" min="1" max="99" style="width:50px;padding:4px;border:1px solid var(--c-border);border-radius:6px;background:rgba(6,6,15,0.6);color:var(--c-text);font-size:13px;text-align:center;">';
                html += '<span style="flex:1;font-size:13px;color:var(--c-text);">' + p.title + '</span>';
                html += '<span style="font-size:11px;color:var(--c-text-dim);">' + (p.category || '') + '</span>';
                html += '</div>';
            });
            el.innerHTML = html;
        }

        function saveTrendingOverride() {
            const el = document.getElementById('adminTrendingList');
            if (!el) return;
            const overrides = {};
            el.querySelectorAll('input[type=checkbox]').forEach(cb => {
                if (cb.checked) {
                    const pid = cb.id.replace('trend_', '');
                    const rankEl = document.getElementById('trendrank_' + pid);
                    overrides[pid] = rankEl ? parseInt(rankEl.value) || 1 : 1;
                }
            });
            localStorage.setItem('dt_trending_override', JSON.stringify(overrides));
            window._adminTrendingOverride = overrides;
            alert('Destaques salvos! A homepage usara os itens selecionados.');
            loadTrending();
        }

        function clearTrendingOverride() {
            localStorage.removeItem('dt_trending_override');
            window._adminTrendingOverride = {};
            alert('Destaques resetados. Homepage usara o algoritmo automatico.');
            loadAdminTrending();
            loadTrending();
        }

        let currentUser = null;
        let authToken = localStorage.getItem('dt_app_token') || null;

        // Load saved trending override
        try { window._adminTrendingOverride = JSON.parse(localStorage.getItem('dt_trending_override') || '{}'); } catch(_) { window._adminTrendingOverride = {}; }

        // Email validity — regex-free so JS template literal escapes do not
        // mangle backslashes (the original /^[^@\\s]+/ regex got eaten by
        // the const html = \`...\` template; \\s became s, rejecting any
        // address containing the letter s).
        function isValidEmail(s) {
            if (typeof s !== 'string') return false;
            s = s.trim();
            if (s.length < 5 || s.length > 254) return false;
            const at = s.indexOf('@');
            if (at <= 0 || at !== s.lastIndexOf('@')) return false;
            const local = s.slice(0, at);
            const domain = s.slice(at + 1);
            if (!local || !domain) return false;
            const dot = domain.lastIndexOf('.');
            if (dot <= 0 || dot >= domain.length - 1) return false;
            // No spaces or angle brackets anywhere
            for (let i = 0; i < s.length; i++) {
                const c = s.charCodeAt(i);
                if (c === 32 || c === 60 || c === 62 || c === 9 || c === 10 || c === 13) return false;
            }
            return true;
        }

        function showAuthError(msg) {
            const el = document.getElementById('authError');
            el.textContent = msg;
            el.style.display = 'block';
            setTimeout(() => el.style.display = 'none', 4000);
        }

        function switchAuthTab(tab) {
            const ACTIVE_BG = 'linear-gradient(135deg, var(--c-cyan), var(--c-purple))';
            const IDLE_BG = 'transparent';
            const ACTIVE_COLOR = '#06060F';
            const IDLE_COLOR = 'var(--c-text-mute)';
            const showForm = (id, on) => {
                const el = document.getElementById(id);
                if (el) el.style.display = on ? 'block' : 'none';
            };
            const styleTab = (id, active) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.style.background = active ? ACTIVE_BG : IDLE_BG;
                el.style.color = active ? ACTIVE_COLOR : IDLE_COLOR;
                el.style.fontWeight = active ? '700' : '600';
            };
            showForm('loginForm', tab === 'login');
            showForm('registerForm', tab === 'register');
            showForm('forgotForm', tab === 'forgot');
            showForm('resetForm', tab === 'reset');
            styleTab('loginTab', tab === 'login');
            styleTab('registerTab', tab === 'register');
            const err = document.getElementById('authError'); if (err) err.style.display = 'none';
        }

        function handleAuthSuccess(data) {
            currentUser = data.user;
            authToken = data.token;
            localStorage.setItem('dt_app_token', data.token);
            document.getElementById('loginOverlay').style.display = 'none';
            document.getElementById('appContent').style.display = 'block';
            document.getElementById('currentUserName').textContent = data.user.name;
            if (data.user.role === 'admin') {
                document.body.classList.add('admin-mode');
                document.getElementById('adminMenuBtn').style.display = 'block';
                // Admin wrapper auto-jumps to #admin instead of #home
                if (ADMIN_WRAPPER) {
                    showSection('admin');
                    return;
                }
            } else {
                document.body.classList.remove('admin-mode');
                document.getElementById('adminMenuBtn').style.display = 'none';
                if (ADMIN_WRAPPER) {
                    // Non-admin in admin wrapper — show error in auth overlay
                    alert('Esta versão do app é exclusiva para administradores. Use o app principal DataToalha.');
                    doLogout();
                    return;
                }
            }
            loadStats();
        }

        function doLogin() {
            const username = document.getElementById('loginUsername').value.trim();
            const password = document.getElementById('loginPassword').value;
            if (!username || !password) { showAuthError('Preencha e-mail/usuário e senha'); return; }

            fetch(BASE + '/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) { handleAuthSuccess(data); }
                else { showAuthError(data.error || 'Credenciais invalidas'); }
            })
            .catch(e => showAuthError('Erro de conexao: ' + e.message));
        }

        function doRegister() {
            const name = document.getElementById('regName').value.trim();
            const email = document.getElementById('regEmail').value.trim();
            const username = document.getElementById('regUsername').value.trim();
            const password = document.getElementById('regPassword').value;
            if (!username || !email || !password) { showAuthError('Preencha todos os campos'); return; }
            if (!isValidEmail(email)) { showAuthError('E-mail inválido'); return; }
            if (password.length < 6) { showAuthError('Senha deve ter no mínimo 6 caracteres'); return; }

            fetch(BASE + '/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password, name: name || username })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) { handleAuthSuccess(data); }
                else { showAuthError(data.error || 'Erro ao registrar'); }
            })
            .catch(e => showAuthError('Erro de conexao: ' + e.message));
        }

        function oauthLogin(provider) {
            const label = provider.charAt(0).toUpperCase() + provider.slice(1);
            const pretty = label === 'Apple' ? 'Apple' : label === 'Google' ? 'Google' : 'Facebook';
            showAuthError('Login com ' + pretty + ' chega em breve. Use e-mail e senha por enquanto.');
        }
        async function refreshOAuthState() {
            try {
                const res = await fetch('/api/auth/providers');
                if (!res.ok) return;
                const data = await res.json();
                const map = {};
                (data.providers || []).forEach(p => { map[p.name] = !!p.enabled; });
                ['google','apple','facebook'].forEach(name => {
                    const btn = document.querySelector('[data-oauth="' + name + '"]');
                    if (!btn) return;
                    const enabled = !!map[name];
                    btn.style.opacity = enabled ? '1' : '0.55';
                    btn.title = enabled ? '' : 'Em breve';
                    const tag = btn.querySelector('.oauth-state');
                    if (tag) tag.textContent = enabled ? '' : 'em breve';
                });
            } catch (e) { /* offline — leave buttons as-is */ }
        }

        function doLogout() {
            currentUser = null;
            authToken = null;
            localStorage.removeItem('dt_app_token');
            document.getElementById('loginOverlay').style.display = 'flex';
            document.getElementById('appContent').style.display = 'none';
            document.getElementById('loginUsername').value = '';
            document.getElementById('loginPassword').value = '';
        }

        function checkAuth() {
            return currentUser;
        }

        document.getElementById('loginPassword').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') doLogin();
        });
        document.getElementById('regPassword').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') doRegister();
        });

        // Honor #register in the URL — landing's "Criar conta gratis" CTA
        // navigates to /app#register so the register tab is pre-selected.
        if (typeof refreshOAuthState === 'function') refreshOAuthState();
        if (window.location.hash === '#register') {
            switchAuthTab('register');
            try { history.replaceState(null, '', window.location.pathname); } catch (_) {}
        }

        // Deep link: #poll=CODE — open poll results after login
        (function checkPollDeepLink() {
            const h = window.location.hash;
            if (h && h.startsWith('#poll=')) {
                const code = h.slice(6).toUpperCase();
                window._pendingPollCode = code;
                // After auth success, navigate to the poll
                const origAuth = window.handleAuthSuccess;
                if (typeof origAuth === 'function') {
                    window.handleAuthSuccess = function(data) {
                        origAuth(data);
                        if (window._pendingPollCode) {
                            setTimeout(function() {
                                showSection('results');
                                setTimeout(function() {
                                    var input = document.getElementById('pollCodeSearch');
                                    if (input) { input.value = window._pendingPollCode; searchPollByCode(); }
                                    window._pendingPollCode = null;
                                }, 500);
                            }, 300);
                        }
                    };
                }
            }
        })();

        // ── Poll Chat ──
        let chatRefreshTimer = null;

        function escChat(str) {
            const d = document.createElement('div');
            d.textContent = str || '';
            return d.innerHTML;
        }

        async function loadPollChat(pollId) {
            const msgs = await api('/poll-chat/' + pollId);
            if (!msgs) return;
            const container = document.getElementById('chatMessages_' + pollId);
            if (!container) return;
            if (msgs.length === 0) {
                container.innerHTML = '<p style="color:#999;text-align:center;padding:20px;">No messages yet. Start the discussion!</p>';
            } else {
                container.innerHTML = msgs.map(m => {
                    const isMe = currentUser && m.userId === currentUser.id;
                    const isAdm = m.userName === 'Administrator' || m.userId === 'admin1';
                    const time = new Date(m.timestamp).toLocaleString('pt-BR', {hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'});
                    const btnStyle = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:6px;cursor:pointer;font-size:11px;padding:4px 8px;min-height:28px;color:#aaa;';
                    let actions = '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">';
                    actions += '<button onclick="likeChatMessage(\\x27' + pollId + '\\x27,\\x27' + m.id + '\\x27)" style="' + btnStyle + '" title="Like">&#x2764; ' + (m.likes || 0) + '</button>';
                    if (isMe) {
                        actions += '<button onclick="editChatMessage(\\x27' + pollId + '\\x27,\\x27' + m.id + '\\x27)" style="' + btnStyle + '" title="Editar">&#x270F; Editar</button>';
                        actions += '<button onclick="deleteChatMessage(\\x27' + pollId + '\\x27,\\x27' + m.id + '\\x27)" style="' + btnStyle + 'color:#ff5a6e;border-color:rgba(255,90,110,0.3);" title="Excluir">&#x1F5D1; Excluir</button>';
                    }
                    if (!isMe && currentUser) {
                        actions += '<button onclick="reportChatMessage(\\x27' + pollId + '\\x27,\\x27' + m.id + '\\x27,\\x27' + escChat(m.userName).replace(/'/g,'') + '\\x27,\\x27' + escChat(m.text).replace(/'/g,'') + '\\x27,\\x27' + time + '\\x27)" style="' + btnStyle + 'color:#ffab40;border-color:rgba(255,171,64,0.3);" title="Denunciar">&#x26A0; Denunciar</button>';
                    }
                    actions += '</div>';
                    return '<div style="padding:10px 14px;margin:4px 0;background:' + (isMe ? 'rgba(0,240,255,0.08)' : 'rgba(255,255,255,0.05)') + ';border:1px solid ' + (isMe ? 'rgba(0,240,255,0.15)' : 'rgba(255,255,255,0.08)') + ';border-radius:10px;' + (isMe ? 'margin-left:20px;' : 'margin-right:20px;') + '">'
                        + '<div style="display:flex;justify-content:space-between;margin-bottom:3px;">'
                        + '<strong style="font-size:12px;color:' + (isAdm ? '#ff5a6e' : 'var(--c-cyan-soft,#5EE9FF)') + ';">@' + escChat(m.userName) + (isAdm ? ' (Admin)' : '') + '</strong>'
                        + '<span style="font-size:11px;color:var(--c-text-dim,#6B6E91);">' + time + '</span></div>'
                        + '<div style="font-size:14px;color:var(--c-text,#F4F4FB);">' + escChat(m.text) + (m.edited ? ' <span style="font-size:10px;color:var(--c-text-dim,#6B6E91);">(editado)</span>' : '') + '</div>'
                        + actions + '</div>';
                }).join('');
                container.scrollTop = container.scrollHeight;
            }
        }

        async function sendChatMessage(pollId) {
            if (!currentUser) { alert('Please login first'); return; }
            const input = document.getElementById('chatInput_' + pollId);
            if (!input) return;
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            await api('/poll-chat', 'POST', {
                pollId: pollId,
                userId: currentUser.id,
                userName: currentUser.name,
                text: text
            });
            loadPollChat(pollId);
        }

        function startChatRefresh(pollId) {
            if (chatRefreshTimer) clearInterval(chatRefreshTimer);
            chatRefreshTimer = setInterval(() => loadPollChat(pollId), 5000);
        }

        function stopChatRefresh() {
            if (chatRefreshTimer) { clearInterval(chatRefreshTimer); chatRefreshTimer = null; }
        }

        async function likeChatMessage(pollId, msgId) {
            await api('/poll-chat-action', 'POST', { pollId, msgId, action: 'like', userId: currentUser.id });
            loadPollChat(pollId);
        }

        async function editChatMessage(pollId, msgId) {
            const newText = prompt('Editar mensagem:');
            if (!newText || !newText.trim()) return;
            await api('/poll-chat-action', 'POST', { pollId, msgId, action: 'edit', userId: currentUser.id, text: newText.trim() });
            loadPollChat(pollId);
        }

        async function deleteChatMessage(pollId, msgId) {
            if (!confirm('Excluir esta mensagem?')) return;
            await api('/poll-chat-action', 'POST', { pollId, msgId, action: 'delete', userId: currentUser.id });
            loadPollChat(pollId);
        }

        async function reportChatMessage(pollId, msgId, userName, msgText, timestamp) {
            const reason = prompt('Motivo da denuncia para @' + userName + ': "' + msgText + '" (' + timestamp + ')');
            if (!reason || !reason.trim()) return;
            await api('/poll-chat-action', 'POST', {
                pollId, msgId, action: 'report',
                userId: currentUser.id,
                reporterName: currentUser.name,
                reportedUser: userName,
                reportedText: msgText,
                reportedTime: timestamp,
                reason: reason.trim()
            });
            alert('Denúncia enviada. Obrigado por ajudar a manter a comunidade segura.');
        }

        // === Account section (TV Adventista parity, Apple 5.1.1(v)) ===
        function loadAccountInfo() {
            const u = (currentUser || {});
            const fmt = (iso) => {
                if (!iso) return '-';
                try { return new Date(iso).toLocaleDateString('pt-BR', {year:'numeric',month:'long',day:'numeric'}); }
                catch(e) { return iso; }
            };
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || '-'; };
            set('accountName', u.name);
            set('accountUsername', u.username);
            set('accountEmail', u.email);
            set('accountSince', fmt(u.createdAt));
        }
        // In-app privacy/terms viewer
        async function showInAppPage(page) {
            try {
                const res = await fetch('https://datatoalha.com/' + page);
                const html = await res.text();
                const modal = document.createElement('div');
                modal.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(6,6,15,0.95);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:20px;';
                var body = html;
                var bodyStart = body.indexOf('<body');
                if (bodyStart > -1) { var gt = body.indexOf('>', bodyStart); body = body.slice(gt + 1); }
                body = body.split('<' + '/body>')[0].split('<' + '/html>')[0];
                body = body.split('background:#fafafa').join('background:transparent').split('color:#222').join('color:var(--c-text)');
                modal.innerHTML = '<div style="max-width:680px;margin:0 auto;"><button onclick="this.parentElement.parentElement.remove()" style="position:sticky;top:0;float:right;background:var(--c-surface-strong);border:1px solid var(--c-border);color:var(--c-text);border-radius:50%;width:36px;height:36px;font-size:20px;cursor:pointer;z-index:10;">x</button>' + body + '</div>';
                document.body.appendChild(modal);
            } catch(e) {
                alert('Erro ao carregar pagina.');
            }
        }

        // loadAccountInfo is now called directly from showSection('account')
        async function doDeleteAccount() {
            const confirmField = document.getElementById('deleteConfirm');
            const pwField = document.getElementById('deletePassword');
            const status = document.getElementById('deleteAccountStatus');
            const confirm = (confirmField && confirmField.value || '').trim();
            const password = (pwField && pwField.value || '');
            status.style.color = 'var(--c-danger)';
            if (confirm !== 'EXCLUIR') {
                status.textContent = 'Digite EXCLUIR para confirmar.';
                return;
            }
            if (!password) {
                status.textContent = 'Sua senha e obrigatoria para excluir a conta.';
                return;
            }
            if (!window.confirm('Excluir sua conta permanentemente? Esta acao nao pode ser desfeita.')) return;
            status.style.color = 'var(--c-text-mute)';
            status.textContent = 'Excluindo conta...';
            try {
                const token = localStorage.getItem('dt_token') || '';
                const res = await fetch(BASE + '/api/account/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ confirm: confirm, password: password })
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok) {
                    status.style.color = 'var(--c-success)';
                    status.textContent = 'Conta excluida. Voce sera desconectado.';
                    localStorage.removeItem('dt_token');
                    setTimeout(() => { window.location.reload(); }, 1800);
                } else {
                    status.style.color = 'var(--c-danger)';
                    status.textContent = (data && data.error) || 'Falha ao excluir conta.';
                }
            } catch (e) {
                status.style.color = 'var(--c-danger)';
                status.textContent = 'Erro de rede: ' + e.message;
            }
        }
        // === END account ===

        // === Photos + lightbox + pro cards (added by photos patch) ===
        function _initialsFor(name) {
            return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => (w[0] || '').toUpperCase()).join('') || '?';
        }
        function avatarHtml(name, photoUrl) {
            if (photoUrl) { var u = BASE + photoUrl; return '<div class="entity-avatar" onclick="event.stopPropagation();openLightbox(\\x27' + u + '\\x27)"><img src="' + u + '" alt="' + (name||'').replace(/"/g,'&amp;quot;') + '"></div>'; }
            return '<div class="entity-avatar">' + _initialsFor(name) + '</div>';
        }
        function coverHtml(title, coverUrl) {
            if (coverUrl) { var u = BASE + coverUrl; return '<div class="entity-cover" onclick="event.stopPropagation();openLightbox(\\x27' + u + '\\x27)"><img src="' + u + '" alt="' + (title||'').replace(/"/g,'&amp;quot;') + '"></div>'; }
            return '<div class="entity-cover">' + _initialsFor(title) + '</div>';
        }
        function openLightbox(url) {
            const lb = document.getElementById('lightbox');
            const img = document.getElementById('lightboxImg');
            if (!lb || !img) return;
            img.src = url;
            lb.classList.add('open');
            document.body.style.overflow = 'hidden';
        }
        function closeLightbox() {
            const lb = document.getElementById('lightbox');
            if (!lb) return;
            lb.classList.remove('open');
            document.body.style.overflow = '';
        }
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') closeLightbox();
        });

        function _resizeImage(file, maxDim) {
            return new Promise(function(resolve, reject) {
                if (!file || !file.type || !file.type.startsWith('image/')) return reject(new Error('Selecione uma imagem'));
                if (file.size > 8 * 1024 * 1024) return reject(new Error('Arquivo muito grande (max 8 MB)'));
                const reader = new FileReader();
                reader.onerror = function() { reject(new Error('Falha ao ler arquivo')); };
                reader.onload = function(e) {
                    const img = new Image();
                    img.onerror = function() { reject(new Error('Imagem invalida')); };
                    img.onload = function() {
                        let w = img.width, h = img.height;
                        if (w > maxDim || h > maxDim) {
                            if (w >= h) { h = Math.round(h * maxDim / w); w = maxDim; }
                            else        { w = Math.round(w * maxDim / h); h = maxDim; }
                        }
                        const cv = document.createElement('canvas');
                        cv.width = w; cv.height = h;
                        const ctx = cv.getContext('2d');
                        ctx.drawImage(img, 0, 0, w, h);
                        try { resolve(cv.toDataURL('image/jpeg', 0.86)); }
                        catch (err) { reject(new Error('Falha ao processar: ' + err.message)); }
                    };
                    img.src = e.target.result;
                };
                reader.readAsDataURL(file);
            });
        }
        async function _uploadPhoto(kind, dataUrl) {
            const token = localStorage.getItem('dt_token') || '';
            const res = await fetch(BASE + '/api/upload-photo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ kind: kind, dataUrl: dataUrl })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
            return data.url;
        }
        async function handleCandPhoto(ev) {
            const file = ev.target.files && ev.target.files[0];
            if (!file) return;
            const preview = document.getElementById('candPhotoPreview');
            const urlField = document.getElementById('candPhotoUrl');
            preview.textContent = '...';
            try {
                const dataUrl = await _resizeImage(file, 800);
                preview.innerHTML = '<img src="' + dataUrl + '" alt="">';
                const url = await _uploadPhoto('candidate', dataUrl);
                urlField.value = url;
                preview.innerHTML = '<img src="' + url + '" alt="">';
            } catch (e) {
                preview.textContent = '⚠';
                alert('Falha no upload: ' + e.message);
            }
        }
        async function handlePollCover(ev) {
            const file = ev.target.files && ev.target.files[0];
            if (!file) return;
            const preview = document.getElementById('pollCoverPreview');
            const urlField = document.getElementById('pollCoverUrl');
            preview.textContent = '...';
            try {
                const dataUrl = await _resizeImage(file, 1200);
                preview.innerHTML = '<img src="' + dataUrl + '" alt="">';
                const url = await _uploadPhoto('poll', dataUrl);
                urlField.value = url;
                preview.innerHTML = '<img src="' + url + '" alt="">';
            } catch (e) {
                preview.textContent = '⚠';
                alert('Falha no upload: ' + e.message);
            }
        }
        // === END photos ===

        // === Password recovery handlers (direct inject) ===
        function showForgotPassword() {
            switchAuthTab('forgot');
            setTimeout(function(){ var f = document.getElementById('forgotEmail'); if (f) f.focus(); }, 50);
        }
        function doForgotPassword() {
            var emailEl = document.getElementById('forgotEmail');
            var email = emailEl ? (emailEl.value || '').trim() : '';
            if (!email || !isValidEmail(email)) { showAuthError('Digite um e-mail valido'); return; }
            var err = document.getElementById('authError');
            err.style.color = 'var(--c-text-mute)';
            err.textContent = 'Enviando...';
            err.style.display = 'block';
            fetch(BASE + '/api/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email })
            })
            .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, data:d}; }); })
            .then(function(o){
                if (o.ok) {
                    err.style.color = 'var(--c-success)';
                    err.textContent = 'Codigo enviado! Verifique seu e-mail (e spam).';
                    setTimeout(function(){
                        switchAuthTab('reset');
                        var ec = document.getElementById('resetCode'); if (ec) ec.focus();
                    }, 1200);
                } else {
                    showAuthError((o.data && o.data.error) || 'Falha ao solicitar redefinicao');
                }
            })
            .catch(function(e){ showAuthError('Erro de conexao: ' + e.message); });
        }
        function doResetPassword() {
            var codeEl = document.getElementById('resetCode');
            var pwEl = document.getElementById('resetNewPassword');
            var emailEl = document.getElementById('forgotEmail');
            var code = codeEl ? (codeEl.value || '').trim() : '';
            var newPassword = pwEl ? pwEl.value : '';
            var email = emailEl ? (emailEl.value || '').trim() : '';
            if (!email) { showAuthError('Volte e digite seu e-mail primeiro'); return; }
            if (!/^\d{6}$/.test(code)) { showAuthError('Codigo deve ter 6 digitos'); return; }
            if (!newPassword || newPassword.length < 6) { showAuthError('Senha deve ter no minimo 6 caracteres'); return; }
            var err = document.getElementById('authError');
            err.style.color = 'var(--c-text-mute)';
            err.textContent = 'Atualizando senha...';
            err.style.display = 'block';
            fetch(BASE + '/api/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email, code: code, newPassword: newPassword })
            })
            .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, data:d}; }); })
            .then(function(o){
                if (o.ok) {
                    err.style.color = 'var(--c-success)';
                    err.textContent = 'Senha atualizada! Faca login com a nova senha.';
                    setTimeout(function(){
                        document.getElementById('loginUsername').value = email;
                        document.getElementById('loginPassword').value = '';
                        switchAuthTab('login');
                    }, 1500);
                } else {
                    showAuthError((o.data && o.data.error) || 'Falha ao redefinir senha');
                }
            })
            .catch(function(e){ showAuthError('Erro de conexao: ' + e.message); });
        }
        // === END password recovery handlers ===

    </script>

    <!-- Lightbox (photo viewer) -->
    <div id="lightbox" onclick="if(event.target.id==='lightbox')closeLightbox()">
        <div class="lb-stage">
            <button class="lb-close" onclick="closeLightbox()" aria-label="Fechar">&times;</button>
            <img id="lightboxImg" src="" alt="">
        </div>
    </div>

</body>
</html>

`;


async function getSession(req) {
    try {
        const auth = (req.headers['authorization'] || req.headers['Authorization'] || '').toString();
        let token = '';
        if (auth.startsWith('Bearer ')) token = auth.slice(7).trim();
        if (!token) {
            const cookie = (req.headers['cookie'] || '').toString();
            const m = /dt_token=([^;]+)/.exec(cookie) || /dt_session=([^;]+)/.exec(cookie);
            if (m) token = decodeURIComponent(m[1]);
        }
        if (!token) return null;
        return verifyToken(token);
    } catch (e) { return null; }
}

// Auto-save: debounced 2s after any write operation
let _saveTimer = null;
function scheduleSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => { saveAllData(); _saveTimer = null; }, 2000);
}

// ── Security: Rate limiting + brute force ──
const _rateLimits = new Map(); // ip -> { count, resetAt }
const _loginFails = new Map(); // ip -> { count, lockedUntil }
function rateLimit(ip, endpoint, maxPerMin) {
    const key = ip + ':' + endpoint;
    const now = Date.now();
    let entry = _rateLimits.get(key);
    if (!entry || now > entry.resetAt) { entry = { count: 0, resetAt: now + 60000 }; _rateLimits.set(key, entry); }
    entry.count++;
    return entry.count > maxPerMin;
}
function checkLoginBrute(ip) {
    const entry = _loginFails.get(ip);
    if (entry && entry.lockedUntil > Date.now()) return true;
    return false;
}
function recordLoginFail(ip) {
    const now = Date.now();
    let entry = _loginFails.get(ip) || { count: 0, lockedUntil: 0 };
    if (now > entry.lockedUntil) entry.count = 0;
    entry.count++;
    if (entry.count >= 5) entry.lockedUntil = now + 15 * 60 * 1000; // 15min lockout
    _loginFails.set(ip, entry);
}
function clearLoginFails(ip) { _loginFails.delete(ip); }
// Clean up rate limit maps every 10 min
setInterval(() => { const now = Date.now(); for (const [k,v] of _rateLimits) { if (now > v.resetAt) _rateLimits.delete(k); } for (const [k,v] of _loginFails) { if (now > v.lockedUntil + 60000) _loginFails.delete(k); } }, 600000);

const MAX_BODY = 256 * 1024; // 256KB for normal endpoints

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

    // ── Security headers on all responses ──
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    // Auto-save after any mutation
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
        res.on('finish', scheduleSave);
    }
    

    // === Password recovery (forgot + reset) ===
    if (url.pathname === '/api/forgot-password' && req.method === 'POST') {
        if (rateLimit(clientIp, 'forgot', 3)) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Muitas tentativas. Aguarde 1 minuto.' }));
            return;
        }
        let body = '';
        req.on('data', c => { body += c; if (body.length > MAX_BODY) { req.destroy(); } });
        req.on('end', () => {
            try {
                const { email } = JSON.parse(body || '{}');
                const emailLower = (email || '').toString().trim().toLowerCase();
                if (!emailLower) { res.writeHead(400, {'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'E-mail obrigatório'})); }
                const user = data.users.find(u => (u.email||'').toLowerCase() === emailLower);
                // Always return 200 to avoid enumeration. Only actually email if user exists.
                if (user) {
                    const code = String(Math.floor(100000 + Math.random() * 900000));
                    user.resetCode = code;
                    user.resetExpiresAt = Date.now() + 30 * 60 * 1000;
                    user.resetAttempts = 0;
                    if (typeof saveUsers === 'function') saveUsers();
                    // Spawn Python helper to send via Gmail SMTP (no nodemailer needed)
                    const py = require('child_process').spawn('python3', ['-c', PY_SEND_RESET_EMAIL], { stdio: ['pipe', 'pipe', 'pipe'] });
                    py.stdin.write(JSON.stringify({ to: user.email, name: user.name || user.username || '', code: code }));
                    py.stdin.end();
                    let pyOut = '', pyErr = '';
                    py.stdout.on('data', d => pyOut += d);
                    py.stderr.on('data', d => pyErr += d);
                    py.on('close', rc => {
                        console.log('[RESET] email rc=' + rc + ' to=' + user.email + (pyErr ? ' err=' + pyErr.slice(0,200) : ''));
                    });
                }
                res.writeHead(200, {'Content-Type':'application/json'});
                res.end(JSON.stringify({success:true, message:'Se o e-mail existir, um código será enviado.'}));
            } catch (e) {
                console.log('[RESET] forgot error: ' + e.message);
                res.writeHead(500, {'Content-Type':'application/json'});
                res.end(JSON.stringify({error:'Erro: ' + e.message}));
            }
        });
        return;
    }
    if (url.pathname === '/api/reset-password' && req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
            try {
                const { email, code, newPassword } = JSON.parse(body || '{}');
                const emailLower = (email || '').toString().trim().toLowerCase();
                if (!emailLower || !code || !newPassword || newPassword.length < 6) {
                    res.writeHead(400, {'Content-Type':'application/json'});
                    return res.end(JSON.stringify({error:'Dados inválidos'}));
                }
                const user = data.users.find(u => (u.email||'').toLowerCase() === emailLower);
                if (!user || !user.resetCode || !user.resetExpiresAt) {
                    res.writeHead(400, {'Content-Type':'application/json'});
                    return res.end(JSON.stringify({error:'Solicite um código primeiro'}));
                }
                if (Date.now() > user.resetExpiresAt) {
                    delete user.resetCode; delete user.resetExpiresAt; delete user.resetAttempts;
                    if (typeof saveUsers === 'function') saveUsers();
                    res.writeHead(400, {'Content-Type':'application/json'});
                    return res.end(JSON.stringify({error:'Código expirado. Solicite novamente.'}));
                }
                user.resetAttempts = (user.resetAttempts || 0) + 1;
                if (user.resetAttempts > 5) {
                    delete user.resetCode; delete user.resetExpiresAt; delete user.resetAttempts;
                    if (typeof saveUsers === 'function') saveUsers();
                    res.writeHead(429, {'Content-Type':'application/json'});
                    return res.end(JSON.stringify({error:'Muitas tentativas. Solicite um novo código.'}));
                }
                if (String(code).trim() !== String(user.resetCode)) {
                    if (typeof saveUsers === 'function') saveUsers();
                    res.writeHead(400, {'Content-Type':'application/json'});
                    return res.end(JSON.stringify({error:'Código inválido'}));
                }
                user.password = await Promise.resolve(hashPassword(newPassword));
                delete user.resetCode; delete user.resetExpiresAt; delete user.resetAttempts;
                if (typeof saveUsers === 'function') saveUsers();
                console.log('[RESET] password updated for ' + user.email);
                res.writeHead(200, {'Content-Type':'application/json'});
                res.end(JSON.stringify({success:true, message:'Senha atualizada.'}));
            } catch (e) {
                console.log('[RESET] reset error: ' + e.message);
                res.writeHead(500, {'Content-Type':'application/json'});
                res.end(JSON.stringify({error:'Erro: ' + e.message}));
            }
        });
        return;
    }

    // === Account deletion (Apple App Store Guideline 5.1.1(v)) ===
    if (url.pathname === '/api/account/delete' && req.method === 'POST') {
        const session = await getSession(req);
        if (!session) { res.writeHead(401, {'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Nao autorizado'})); }
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
            try {
                const { confirm, password } = JSON.parse(body || '{}');
                if (confirm !== 'EXCLUIR') {
                    res.writeHead(400, {'Content-Type':'application/json'});
                    return res.end(JSON.stringify({error:'Digite EXCLUIR para confirmar.'}));
                }
                const userId = session.userId || session.id;
                const user = data.users.find(u => u.id === userId);
                if (!user) {
                    res.writeHead(404, {'Content-Type':'application/json'});
                    return res.end(JSON.stringify({error:'Conta nao encontrada.'}));
                }
                const ok = await Promise.resolve(verifyPassword(password, user.password));
                if (!ok) {
                    res.writeHead(403, {'Content-Type':'application/json'});
                    return res.end(JSON.stringify({error:'Senha incorreta.'}));
                }
                data.votes = (data.votes||[]).filter(v => v.userId !== userId && v.voterId !== userId);
                data.pollVotes = (data.pollVotes||[]).filter(v => v.userId !== userId && v.voterId !== userId);
                data.polls = (data.polls||[]).filter(p => p.createdBy !== userId && p.userId !== userId);
                data.products = (data.products||[]).filter(p => p.sellerId !== userId && p.userId !== userId);
                data.vouchers = (data.vouchers||[]).filter(v => v.userId !== userId && v.recipientUserId !== userId);
                data.users = data.users.filter(u => u.id !== userId);
                if (typeof saveUsers === 'function') saveUsers();
                if (typeof saveAllData === 'function') saveAllData();
                console.log('[ACCOUNT] deleted user=' + userId + ' email=' + (user.email||''));
                res.writeHead(200, {'Content-Type':'application/json'});
                res.end(JSON.stringify({success:true, message:'Conta excluida.'}));
            } catch (e) {
                console.log('[ACCOUNT] delete error: ' + e.message);
                res.writeHead(500, {'Content-Type':'application/json'});
                res.end(JSON.stringify({error:'Erro: ' + e.message}));
            }
        });
        return;
    }

    // === Photo upload (candidates + polls) ===
    if (url.pathname === '/api/upload-photo' && req.method === 'POST') {
        const session = await getSession(req);
        if (!session) { res.writeHead(401, {'Content-Type':'application/json'}); return res.end(JSON.stringify({error:'Nao autorizado'})); }
        let body = '';
        let aborted = false;
        req.on('data', c => {
            body += c;
            if (body.length > 6 * 1024 * 1024) { aborted = true; req.destroy(); }
        });
        req.on('end', () => {
            if (aborted) { try { res.writeHead(413, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Imagem muito grande (max 5 MB)'})); } catch(e){} return; }
            try {
                const parsed = JSON.parse(body || '{}'); const kind = parsed.kind; const dataUrl = parsed.dataUrl || parsed.data;
                if (!['candidate', 'poll'].includes(kind)) {
                    res.writeHead(400, {'Content-Type':'application/json'});
                    return res.end(JSON.stringify({error:'kind invalido'}));
                }
                const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl || '');
                if (!m) {
                    res.writeHead(400, {'Content-Type':'application/json'});
                    return res.end(JSON.stringify({error:'Formato invalido (JPEG/PNG/WebP)'}));
                }
                const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
                const bytes = Buffer.from(m[2], 'base64');
                if (bytes.length > 5 * 1024 * 1024) {
                    res.writeHead(413, {'Content-Type':'application/json'});
                    return res.end(JSON.stringify({error:'Imagem muito grande (max 5 MB)'}));
                }
                const photoDir = path.join(process.env.HOME || '/Users/raymondturing', 'Library/Application Support/DataToalha/photos', kind);
                fs.mkdirSync(photoDir, { recursive: true });
                const fname = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
                fs.writeFileSync(path.join(photoDir, fname), bytes);
                const url2 = '/photos/' + kind + '/' + fname;
                console.log('[PHOTO] uploaded ' + kind + ' ' + fname + ' (' + bytes.length + ' B)');
                res.writeHead(200, {'Content-Type':'application/json'});
                res.end(JSON.stringify({success:true, url:url2}));
            } catch (e) {
                console.log('[PHOTO] upload error: ' + e.message);
                res.writeHead(500, {'Content-Type':'application/json'});
                res.end(JSON.stringify({error:'Erro: ' + e.message}));
            }
        });
        return;
    }

    // === Photo serving ===
    if (url.pathname.startsWith('/photos/') && req.method === 'GET') {
        try {
            const safeRel = url.pathname.replace(/^\/photos\//, '').replace(/\.\./g, '');
            if (!/^(candidate|poll)\/[A-Za-z0-9._-]+$/.test(safeRel)) {
                res.writeHead(404); return res.end();
            }
            const fpath = path.join(process.env.HOME || '/Users/raymondturing', 'Library/Application Support/DataToalha/photos', safeRel);
            if (!fs.existsSync(fpath)) { res.writeHead(404); return res.end(); }
            const ext = fpath.split('.').pop().toLowerCase();
            const ct = {jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp'}[ext] || 'application/octet-stream';
            res.writeHead(200, {'Content-Type': ct, 'Cache-Control':'public, max-age=86400, immutable', 'Access-Control-Allow-Origin':'*'});
            return res.end(fs.readFileSync(fpath));
        } catch (e) { res.writeHead(500); return res.end(); }
    }

    // Health endpoint (before /api/ block so /health works at root)
    if (url.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: '2.1.0', timestamp: new Date().toISOString(), uptime: process.uptime() }));
        return;
    }

    // ── SOC Watcher API (hardened: API key + TOTP MFA + admin binding + IP allowlist + audit) ──
    if (url.pathname === '/api/soc-watcher' && req.method === 'POST') {
        // Layer 1: IP allowlist (if configured)
        if (SOC_ALLOWED_IPS.length > 0 && !SOC_ALLOWED_IPS.includes(clientIp) && !SOC_ALLOWED_IPS.includes(clientIp.replace('::ffff:',''))) {
            _socAuditLog.push({ ts: new Date().toISOString(), ip: clientIp, action: 'BLOCKED_IP', success: false });
            res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'IP not allowed'})); return;
        }
        // Layer 2: Rate limit (5 req/min per IP)
        if (rateLimit(clientIp, 'soc-watcher', 5)) {
            res.writeHead(429, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Rate limited. Max 5 req/min.'})); return;
        }
        // Layer 3: API key
        const tgKey = req.headers['x-soc-key'] || '';
        if (!tgKey || tgKey.length !== SOC_API_KEY.length || !crypto.timingSafeEqual(Buffer.from(tgKey, 'utf8'), Buffer.from(SOC_API_KEY, 'utf8'))) {
            _socAuditLog.push({ ts: new Date().toISOString(), ip: clientIp, action: 'INVALID_KEY', success: false });
            res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Invalid API key'})); return;
        }
        let body = '';
        req.on('data', c => { body += c; if (body.length > MAX_BODY) { req.destroy(); } });
        req.on('end', async () => {
            try {
                const cmd = JSON.parse(body), action = cmd.action;

                // Layer 4: TOTP MFA (required for write/manage actions)
                const readActions = ['help','get_stats','list_users','list_candidates','list_polls','get_poll','get_votes_summary','list_contacts','list_chat_reports','get_poll_chat','search','export','audit_log'];
                const isReadOnly = readActions.includes(action);
                if (!isReadOnly) {
                    const mfaToken = cmd.mfa || req.headers['x-soc-mfa'] || '';
                    if (!mfaToken || !verifyTotp(SOC_TOTP_SECRET, mfaToken)) {
                        _socAuditLog.push({ ts: new Date().toISOString(), ip: clientIp, action: action, success: false, reason: 'MFA_FAILED' });
                        res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'MFA required for write/manage actions. Send mfa:"123456" (TOTP code) in body or X-SOC-MFA header.'})); return;
                    }
                }

                // Layer 5: Admin user binding (write/manage require admin username)
                if (!isReadOnly) {
                    const adminUser = cmd.admin_user || '';
                    const boundAdmin = data.users.find(u => u.username === adminUser && u.role === 'admin');
                    if (!boundAdmin) {
                        _socAuditLog.push({ ts: new Date().toISOString(), ip: clientIp, action: action, success: false, reason: 'NO_ADMIN_BINDING', admin_user: adminUser });
                        res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Write/manage actions require admin_user field matching a valid admin username.'})); return;
                    }
                }

                // Layer 6: Audit log
                _socAuditLog.push({ ts: new Date().toISOString(), ip: clientIp, action: action, admin_user: cmd.admin_user || null, success: true });
                if (_socAuditLog.length > 1000) _socAuditLog.splice(0, _socAuditLog.length - 500);
                let result = { error: 'Unknown action: ' + action };
                if (action === 'help') { result = { read:['get_stats','list_users','list_candidates','list_polls','get_poll','get_votes_summary','list_contacts','list_chat_reports','get_poll_chat','search','export','audit_log'], write:['create_candidate','update_candidate','delete_candidate','create_poll','approve_poll','delete_poll','send_chat'], manage:['set_user_role','delete_user','set_trending_keywords','set_poll_rankings','clear_votes'], auth:'Read actions: API key only. Write/manage actions: API key + TOTP MFA + admin_user binding. IP allowlist via DT_SOC_IPS env.' }; }
                else if (action === 'audit_log') { result = _socAuditLog.slice(-(cmd.limit || 50)); }
                else if (action === 'get_stats') { result = { users:data.users.length, candidates:data.candidates.length, votes:data.votes.length, polls:data.polls.length, pollVotes:data.pollVotes.length, products:(data.products||[]).length, contacts:(data.contacts||[]).length, chatReports:(data.chatReports||[]).length }; }
                else if (action === 'list_users') { result = data.users.map(u => ({id:u.id,username:u.username,email:u.email,name:u.name,role:u.role,createdAt:u.createdAt})); }
                else if (action === 'list_candidates') { let c = data.candidates; if(cmd.role)c=c.filter(x=>x.role===cmd.role); if(cmd.country)c=c.filter(x=>x.country===cmd.country); if(cmd.limit)c=c.slice(0,cmd.limit); result=c.map(x=>({id:x.id,name:x.name,party:x.party,role:x.role,country:x.country,state:x.state,photoUrl:x.photoUrl,type:x.type})); }
                else if (action === 'list_polls') { let p=data.polls; if(cmd.approved!==undefined)p=p.filter(x=>x.approved===cmd.approved); if(cmd.type)p=p.filter(x=>x.type===cmd.type); result=p.map(x=>({id:x.id,title:x.title,category:x.category,type:x.type,approved:x.approved,createdBy:x.createdBy,createdAt:x.createdAt,optionCount:(x.options||[]).length})); }
                else if (action === 'get_poll') { const p=data.polls.find(x=>x.id===cmd.pollId); if(!p){result={error:'Poll not found'};} else { const v=data.pollVotes.filter(x=>x.pollId===cmd.pollId); result={...p,totalVotes:v.length,votesPerOption:{}}; (p.options||[]).forEach(o=>{const oid=typeof o==='string'?o:o.id;const otx=typeof o==='string'?o:o.text;result.votesPerOption[otx]=v.filter(x=>x.optionId===oid).length;}); } }
                else if (action === 'get_votes_summary') { const pv=data.votes.filter(v=>v.electionType==='political'); const s={}; pv.forEach(v=>{(v.choices||[]).forEach(c=>{const k=v.country+' | '+v.role+' | '+c.candidateName; s[k]=(s[k]||0)+1;}); }); result={totalPoliticalVotes:pv.length,breakdown:s}; }
                else if (action === 'list_contacts') { result = data.contacts||[]; }
                else if (action === 'list_chat_reports') { result = data.chatReports||[]; }
                else if (action === 'get_poll_chat') { result = (data.pollChats&&data.pollChats[cmd.pollId])||[]; }
                else if (action === 'search') { const q=(cmd.query||'').toLowerCase(); if(!q){result={error:'query required'};} else { result={ users:data.users.filter(u=>(u.username||'').toLowerCase().includes(q)||(u.name||'').toLowerCase().includes(q)||(u.email||'').toLowerCase().includes(q)).map(u=>({id:u.id,username:u.username,name:u.name,role:u.role})), candidates:data.candidates.filter(c=>(c.name||'').toLowerCase().includes(q)||(c.party||'').toLowerCase().includes(q)).map(c=>({id:c.id,name:c.name,role:c.role,country:c.country})), polls:data.polls.filter(p=>(p.title||'').toLowerCase().includes(q)||(p.category||'').toLowerCase().includes(q)).map(p=>({id:p.id,title:p.title,approved:p.approved})) }; } }
                else if (action === 'export') { result={ users:data.users.map(u=>({id:u.id,username:u.username,email:u.email,name:u.name,role:u.role})), candidates:data.candidates, votes:data.votes, polls:data.polls, pollVotes:data.pollVotes, contacts:data.contacts||[], chatReports:data.chatReports||[], pollRankings:data.pollRankings||{} }; }
                else if (action === 'create_candidate') { if(!cmd.name){result={error:'name required'};} else { const nc={id:generateId(),name:cmd.name,party:cmd.party||'',country:cmd.country||'Brazil',state:cmd.state||'',city:cmd.city||'',role:cmd.role||'President',type:cmd.type||'political',photoUrl:cmd.photoUrl||''}; data.candidates.push(nc); saveCandidates(); result={success:true,candidate:nc}; } }
                else if (action === 'update_candidate') { const c=data.candidates.find(x=>x.id===cmd.id); if(!c){result={error:'Candidate not found'};} else { ['name','party','role','country','state','city','photoUrl','type'].forEach(f=>{if(cmd[f]!==undefined)c[f]=cmd[f];}); saveCandidates(); result={success:true,candidate:c}; } }
                else if (action === 'delete_candidate') { const b=data.candidates.length; data.candidates=data.candidates.filter(c=>c.id!==cmd.id); if(data.candidates.length<b){saveCandidates();result={success:true};}else{result={error:'Candidate not found'};} }
                else if (action === 'create_poll') { if(!cmd.title||!cmd.options||cmd.options.length<2){result={error:'title and at least 2 options required'};} else { const p={id:generateId(),title:cmd.title,description:cmd.description||'',category:cmd.category||'Geral',type:'community',approved:cmd.approved!==false,options:cmd.options.map(o=>typeof o==='string'?{id:generateId(),text:o}:o),createdBy:cmd.createdBy||'soc-watcher',createdAt:new Date().toISOString(),shareCode:generateShareCode()}; data.polls.push(p); result={success:true,poll:{id:p.id,title:p.title,shareCode:p.shareCode}}; } }
                else if (action === 'approve_poll') { const p=data.polls.find(x=>x.id===cmd.pollId); if(!p){result={error:'Poll not found'};} else { p.approved=true; if(p.type==='community'){ const existingNames=new Set(data.candidates.map(c=>(c.name||'').toLowerCase())); let added=0; (p.options||[]).forEach(opt=>{ const name=typeof opt==='string'?opt:(opt.text||''); if(name && !existingNames.has(name.toLowerCase())){ const optDesc=typeof opt==='object'?(opt.description||''):''; const optPhoto=typeof opt==='object'?(opt.photoUrl||''):''; data.candidates.push({id:generateId(),name:name,party:optDesc||p.category||'Comunidade',country:'Brazil',state:'N/A',city:'',role:p.title||'Enquete',type:'community',photoUrl:optPhoto}); existingNames.add(name.toLowerCase()); added++; } }); if(added>0){ saveCandidates(); console.log('[APPROVE/SOC] Poll "'+p.title+'" approved. '+added+' new candidates created.'); } } result={success:true}; } }
                else if (action === 'delete_poll') { const p=data.polls.find(x=>x.id===cmd.pollId); if(!p){result={error:'Poll not found'};} else { data.polls=data.polls.filter(x=>x.id!==cmd.pollId); data.pollVotes=data.pollVotes.filter(v=>v.pollId!==cmd.pollId); if(p.type==='community'){const on=new Set((p.options||[]).map(o=>(typeof o==='string'?o:(o.text||'')).toLowerCase())); data.candidates=data.candidates.filter(c=>!(c.type==='community'&&c.role===(p.title||'')&&on.has((c.name||'').toLowerCase()))); saveCandidates();} if(data.pollChats&&data.pollChats[cmd.pollId])delete data.pollChats[cmd.pollId]; result={success:true}; } }
                else if (action === 'set_user_role') { const u=data.users.find(x=>x.id===cmd.userId||x.username===cmd.username); if(!u){result={error:'User not found'};} else if(cmd.role!=='admin'&&cmd.role!=='user'){result={error:'role must be admin or user'};} else{u.role=cmd.role;saveUsers();result={success:true,username:u.username,role:u.role};} }
                else if (action === 'delete_user') { const u=data.users.find(x=>x.id===cmd.userId||x.username===cmd.username); if(!u){result={error:'User not found'};}else{data.users=data.users.filter(x=>x.id!==u.id);saveUsers();result={success:true};} }
                else if (action === 'send_chat') { if(!cmd.pollId||!cmd.text){result={error:'pollId and text required'};} else { if(!data.pollChats)data.pollChats={}; if(!data.pollChats[cmd.pollId])data.pollChats[cmd.pollId]=[]; const m={id:generateId(),userId:'soc-watcher',username:cmd.as||'DataToalha',text:cmd.text.slice(0,500),timestamp:new Date().toISOString()}; data.pollChats[cmd.pollId].push(m); result={success:true,message:m}; } }
                else if (action === 'set_trending_keywords') { if(!Array.isArray(cmd.keywords)){result={error:'keywords must be array'};}else{data.trendingKeywords=cmd.keywords;result={success:true};} }
                else if (action === 'set_poll_rankings') { if(!cmd.rankings||typeof cmd.rankings!=='object'){result={error:'rankings object required'};}else{data.pollRankings=cmd.rankings;result={success:true};} }
                else if (action === 'clear_votes') { if(cmd.confirm!==true){result={error:'Pass confirm:true'};}else{data.votes=[];data.pollVotes=[];result={success:true,message:'All votes cleared'};} }
                res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(result));
            } catch(e) { res.writeHead(400,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
        });
        return;
    }

    if (url.pathname.startsWith('/api/')) {
        const apiPath = url.pathname.slice(5);

        // Stats
        if (apiPath === 'stats' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                votes: data.votes.length,
                candidates: data.candidates.length,
                countries: data.countries.length,
                polls: data.polls.length
            }));
            return;
        }
        
        // Countries
        if (apiPath === 'countries' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data.countries.map(c => ({ name: c.name }))));
            return;
        }
        
        // States
        if (apiPath === 'states' && req.method === 'GET') {
            const country = url.searchParams.get('country');
            if (!country) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([])); return; }
            const states = data.states.filter(s => s.country_name && s.country_name.toLowerCase() === country.toLowerCase());
            const uniqueStates = [...new Set(states.map(s => s.name))];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(uniqueStates.map(name => ({ name }))));
            return;
        }
        
        // Cities
        if (apiPath === 'cities' && req.method === 'GET') {
            const country = url.searchParams.get('country');
            const state = url.searchParams.get('state');
            if (!country || !state) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([])); return; }
            const cities = data.cities.filter(c => c.country_name && c.country_name.toLowerCase() === country.toLowerCase() && c.state_name && c.state_name.toLowerCase() === state.toLowerCase());
            const uniqueCities = [...new Set(cities.map(c => c.name))];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(uniqueCities.map(name => ({ name }))));
            return;
        }
        
        // Candidates
        if (apiPath === 'candidates' && req.method === 'GET') {
            const country = url.searchParams.get('country');
            const state = url.searchParams.get('state');
            const role = url.searchParams.get('role');
            let candidates = data.candidates;
            if (country) candidates = candidates.filter(c => c.country && c.country.toLowerCase() === country.toLowerCase());
            if (state && role && !GLOBAL_ROLES.includes(role)) candidates = candidates.filter(c => c.state && c.state.toLowerCase() === state.toLowerCase());
            if (role) candidates = candidates.filter(c => c.role === role);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(candidates));
            return;
        }
        
        // All candidates
        if (apiPath === 'all-candidates' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data.candidates));
            return;
        }
        
        // Votes
        if (apiPath === 'votes' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data.votes));
            return;
        }
        
        // POST vote
        if (apiPath === 'vote' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const vote = JSON.parse(body);
                    
                    if (!vote.userId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'User not authenticated' }));
                        return;
                    }
                    
                    // Allow admins to vote unlimited times for testing
                    const votingUser = data.users.find(u => u.id === vote.userId);
                    const isAdmin = votingUser && votingUser.role === 'admin';
                    if (!isAdmin) {
                        const alreadyVoted = data.votes.some(v =>
                            v.userId === vote.userId &&
                            v.role === vote.role &&
                            v.country === vote.country
                        );
                        if (alreadyVoted) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'You have already voted in this election' }));
                            return;
                        }
                    }
                    
                    vote.id = generateId();
                    vote.timestamp = new Date().toISOString();
                    vote.choices = [{ candidateName: vote.candidateName, role: vote.role }];
                    data.votes.push(vote);
                    // Record candle history for political votes
                    recordPoliticalCandle(vote.country, vote.role);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
        
        // My votes (by userId)
        if (apiPath === 'my-votes' && req.method === 'GET') {
            const userId = url.searchParams.get('userId');
            let userVotes = data.pollVotes;
            if (userId) {
                userVotes = userVotes.filter(v => v.userId === userId);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(userVotes));
            return;
        }
        
        // Poll votes
        if (apiPath === 'poll-votes' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data.pollVotes));
            return;
        }
        
        // Products
        if (apiPath === 'products' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data.products));
            return;
        }
        
        if (apiPath === 'products' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const product = JSON.parse(body);
                    product.id = generateId();
                    product.createdAt = new Date().toISOString();
                    data.products.push(product);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
        
        const productsApproveMatch = apiPath.match(/^products\/approve\/(.+)$/);
        if (productsApproveMatch && req.method === 'POST') {
            const id = productsApproveMatch[1];
            const product = data.products.find(p => p.id === id);
            if (product) product.approved = true;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }
        
        const productsDeleteMatch = apiPath.match(/^products\/(.+)$/);
        if (productsDeleteMatch && req.method === 'DELETE') {
            const id = productsDeleteMatch[1];
            data.products = data.products.filter(p => p.id !== id);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }
        
        // Product Orders
        if (apiPath === 'product-orders' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data.productOrders));
            return;
        }
        
        if (apiPath === 'product-orders' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const order = JSON.parse(body);
                    order.id = generateId();
                    order.voucherCode = generateShareCode();
                    order.createdAt = new Date().toISOString();
                    order.claimed = false;
                    data.productOrders.push(order);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, voucherCode: order.voucherCode }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
        
        // Redeem voucher
        if (apiPath === 'redeem-voucher' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { voucherCode, name, email, telephone, address, userId } = JSON.parse(body);
                    const order = data.productOrders.find(o => o.voucherCode === voucherCode);
                    if (!order) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid voucher code' }));
                        return;
                    }
                    if (order.claimed) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Voucher already claimed' }));
                        return;
                    }
                    if (order.recipientContact !== userId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'This voucher is not for you' }));
                        return;
                    }
                    order.claimed = true;
                    order.redeemedAt = new Date().toISOString();
                    order.recipientName = name;
                    order.recipientEmail = email;
                    order.recipientTelephone = telephone;
                    order.recipientAddress = address;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
        
        // Get Rankings
        if (apiPath === 'poll-rankings' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data.pollRankings || {}));
            return;
        }

        // Save Rankings
        if (apiPath === 'save-rankings' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { rankings } = JSON.parse(body);
                    data.pollRankings = rankings;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
        
        // POST poll vote
        if (apiPath === 'poll-vote' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { userId, userName, pollId, optionId, optionText } = JSON.parse(body);
                    
                    if (!userId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'User not authenticated' }));
                        return;
                    }
                    
                    // Check if already voted by userId (allow admins to vote unlimited times)
                    const user = data.users.find(u => u.id === userId);
                    const isAdmin = user && user.role === 'admin';
                    if (!isAdmin) {
                        const alreadyVoted = data.pollVotes.some(v => v.pollId === pollId && v.userId === userId);
                        if (alreadyVoted) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'You have already voted in this poll' }));
                            return;
                        }
                    }
                    
                    data.pollVotes.push({
                        id: generateId(),
                        pollId,
                        userId,
                        userName,
                        optionId,
                        optionText,
                        timestamp: new Date().toISOString()
                    });
                    
                    // Record candle history
                    recordCandleHistory(pollId);
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
        
        // Political candle: tracks top-2 candidates per country+role
        // Political candle: body = leader1 vs leader2 percentage, wicks = total votes at that moment
        function recordPoliticalCandle(country, role) {
            var polVotes = data.votes.filter(function(v) { return v.country === country && v.role === role; });
            if (polVotes.length < 2) return;
            var counts = {};
            polVotes.forEach(function(v) {
                var name = v.candidateName || (v.choices && v.choices[0] && v.choices[0].candidateName) || '';
                if (name) counts[name] = (counts[name] || 0) + 1;
            });
            var sorted = Object.entries(counts).sort(function(a,b) { return b[1] - a[1]; });
            if (sorted.length < 2) return;
            var top1name = sorted[0][0], top1count = sorted[0][1];
            var top2name = sorted[1][0], top2count = sorted[1][1];
            var total = polVotes.length;
            // Body: percentage of leader1 among the two leaders only
            var pairTotal = top1count + top2count;
            // Body: leader1 % among the pair only
            var pct1 = pairTotal > 0 ? (top1count / pairTotal * 100) : 50;

            var key = 'pol_' + country + '_' + role + '_' + top1name + '_vs_' + top2name;
            var racePrefix = 'pol_' + country + '_' + role + '_';
            var existingKeys = Object.keys(data.candleHistory).filter(function(k) { return k.startsWith(racePrefix); });
            if (!existingKeys.find(function(k) { return k === key; })) {
                data.candleHistory[key] = [];
            }
            var history = data.candleHistory[key];
            var now = new Date().toISOString();
            var openP = history.length > 0 ? history[history.length - 1].closePct : 50;
            if (history.length === 0 || Math.abs(openP - pct1) > 0.1) {
                // High/Low = total votes from ALL candidates at this moment
                // Open/Close = percentage between this pair only
                history.push({
                    timestamp: now,
                    openPct: openP,
                    closePct: pct1,
                    highPct: total,
                    lowPct: history.length > 0 ? history[history.length - 1].highPct : 0,
                    votes1: top1count,
                    votes2: top2count,
                    total: total
                });
            }
        }

        function recordCandleHistory(pollId) {
            const pollVotes = data.pollVotes.filter(v => v.pollId === pollId);
            const poll = data.polls.find(p => p.id === pollId);
            if (!poll || !poll.options || poll.options.length < 2) return;
            
            const totalVotes = pollVotes.length;
            if (totalVotes === 0) return;
            
            const votesByOption = {};
            poll.options.forEach(opt => {
                votesByOption[opt.id] = pollVotes.filter(v => v.optionId === opt.id).length;
            });
            
            const sortedOptions = poll.options.slice().sort((a, b) => votesByOption[b.id] - votesByOption[a.id]);
            const top1 = sortedOptions[0];
            const top2 = sortedOptions[1];
            
            if (!top1 || !top2) return;
            
            const key = pollId + '_' + top1.id + '_' + top2.id;
            let history = data.candleHistory[key] || [];
            
            const now = new Date().toISOString();
            const currentVotes1 = votesByOption[top1.id];
            const currentVotes2 = votesByOption[top2.id];
            const pct1 = totalVotes > 0 ? (currentVotes1 / totalVotes * 100) : 50;
            const pct2 = 100 - pct1;
            
            if (history.length > 0) {
                const last = history[history.length - 1];
                if (Math.abs(last.closePct - pct1) > 0.1) {
                    var openP = last.closePct;
                    var pairT = currentVotes1 + currentVotes2;
                    var bodyPct = pairT > 0 ? (currentVotes1 / pairT * 100) : 50;
                    history.push({
                        timestamp: now,
                        openPct: openP,
                        closePct: bodyPct,
                        highPct: totalVotes,
                        lowPct: last.highPct || 0,
                        votes1: currentVotes1,
                        votes2: currentVotes2,
                        total: totalVotes
                    });
                }
            } else {
                var pairT0 = currentVotes1 + currentVotes2;
                var bodyPct0 = pairT0 > 0 ? (currentVotes1 / pairT0 * 100) : 50;
                history.push({
                    timestamp: now,
                    openPct: 50,
                    closePct: bodyPct0,
                    highPct: totalVotes,
                    lowPct: 0,
                    votes1: currentVotes1,
                    votes2: currentVotes2,
                    total: totalVotes
                });
            }
            
            data.candleHistory[key] = history;
        }
        
        // Get candle history
        if (apiPath === 'candle-history' && req.method === 'GET') {
            const pollId = url.searchParams.get('pollId');
            const poll = data.polls.find(p => p.id === pollId);
            if (!poll || !poll.options || poll.options.length < 2) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ type: 'community', history: [] }));
                return;
            }
            
            const pollVotes = data.pollVotes.filter(v => v.pollId === pollId);
            const votesByOption = {};
            poll.options.forEach(opt => {
                votesByOption[opt.id] = pollVotes.filter(v => v.optionId === opt.id).length;
            });
            
            const sortedOptions = poll.options.slice().sort((a, b) => votesByOption[b.id] - votesByOption[a.id]);
            const top1 = sortedOptions[0] ? sortedOptions[0] : null;
            const top2 = sortedOptions[1] ? sortedOptions[1] : null;
            
            if (!top1 || !top2) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ type: 'community', history: [] }));
                return;
            }
            
            // Return ALL candle charts for this poll (cumulative — old leader pairs stay)
            const allCharts = [];
            const prefix = pollId + '_';
            Object.keys(data.candleHistory).forEach(function(k) {
                if (k.startsWith(prefix) && data.candleHistory[k].length > 0) {
                    var parts = k.slice(prefix.length).split('_');
                    var o1id = parts[0], o2id = parts[1];
                    var o1 = poll.options.find(function(o) { return o.id === o1id; }) || { id: o1id, text: o1id };
                    var o2 = poll.options.find(function(o) { return o.id === o2id; }) || { id: o2id, text: o2id };
                    allCharts.push({ option1: o1, option2: o2, history: data.candleHistory[k] });
                }
            });
            // Current leaders chart
            var currentKey = pollId + '_' + top1.id + '_' + top2.id;
            var currentHistory = data.candleHistory[currentKey] || [];

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ type: 'community', option1: top1, option2: top2, history: currentHistory, allCharts: allCharts }));
            return;
        }

        // Political candle history
        if (apiPath === 'political-candle-history' && req.method === 'GET') {
            var country = url.searchParams.get('country') || '';
            var role = url.searchParams.get('role') || '';
            var racePrefix = 'pol_' + country + '_' + role + '_';
            var charts = [];
            Object.keys(data.candleHistory).forEach(function(k) {
                if (k.startsWith(racePrefix) && data.candleHistory[k].length > 0) {
                    var pair = k.slice(racePrefix.length);
                    var vsIdx = pair.indexOf('_vs_');
                    if (vsIdx > -1) {
                        charts.push({
                            option1: { text: pair.slice(0, vsIdx) },
                            option2: { text: pair.slice(vsIdx + 4) },
                            history: data.candleHistory[k]
                        });
                    }
                }
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ charts: charts }));
            return;
        }
        
        // DELETE votes
        if (apiPath === 'votes' && req.method === 'DELETE') {
            data.votes = [];
            data.pollVotes = [];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }
        
        // Polls
        if (apiPath.startsWith('polls') && req.method === 'GET') {
            let polls = data.polls.map(p => ({ 
                ...p, 
                votes: data.pollVotes.filter(pv => pv.pollId === p.id).length 
            }));
            if (url.searchParams.get('type')) {
                polls = polls.filter(p => p.type === url.searchParams.get('type'));
            }
            if (url.searchParams.get('approved') === 'true') {
                polls = polls.filter(p => p.approved === true);
            }
            if (url.searchParams.get('approved') === 'false') {
                polls = polls.filter(p => p.approved !== true);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(polls));
            return;
        }
        
        // Approve poll
        const approveMatch = apiPath.match(/^polls\/approve\/(.+)$/);
        if (approveMatch && req.method === 'POST') {
            const id = approveMatch[1];
            const poll = data.polls.find(p => p.id === id);
            if (poll) {
                poll.approved = true;
                // Auto-create candidates from poll options (if not already existing)
                const existingNames = new Set(data.candidates.map(c => c.name.toLowerCase()));
                let added = 0;
                (poll.options || []).forEach(opt => {
                    const name = typeof opt === 'string' ? opt : (opt.text || '');
                    if (name && !existingNames.has(name.toLowerCase())) {
                        var optDesc = typeof opt === 'object' ? (opt.description || '') : '';
                    var optPhoto = typeof opt === 'object' ? (opt.photoUrl || '') : '';
                    data.candidates.push({
                            id: generateId(),
                            name: name,
                            party: optDesc || poll.category || 'Comunidade',
                            country: 'Brazil',
                            state: 'N/A',
                            city: '',
                            role: poll.title || 'Enquete',
                            type: 'community',
                            photoUrl: optPhoto
                        });
                        existingNames.add(name.toLowerCase());
                        added++;
                    }
                });
                if (added > 0) {
                    saveCandidates();
                    console.log('[APPROVE] Poll "' + poll.title + '" approved. ' + added + ' new candidates created.');
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }
        
        // POST poll
        if (apiPath === 'polls' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const poll = JSON.parse(body);
                    poll.id = generateId();
                    poll.createdAt = new Date().toISOString();
                    if (poll.type === 'community' && poll.approved === undefined) {
                        poll.approved = false;
                    }
                    data.polls.push(poll);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, shareCode: poll.shareCode }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
        
        // DELETE poll
        const pollsMatch = apiPath.match(/^polls\/(.+)$/);
        if (pollsMatch && req.method === 'DELETE') {
            const id = pollsMatch[1];
            const poll = data.polls.find(p => p.id === id);
            data.polls = data.polls.filter(p => p.id !== id);
            data.pollVotes = data.pollVotes.filter(v => v.pollId !== id);
            // Remove community candidates created by this poll (role = poll title, type = community)
            if (poll && poll.type === 'community') {
                const optionNames = new Set((poll.options || []).map(function(o) { return (typeof o === 'string' ? o : (o.text || '')).toLowerCase(); }));
                const before = data.candidates.length;
                data.candidates = data.candidates.filter(function(c) {
                    return !(c.type === 'community' && c.role === (poll.title || '') && optionNames.has((c.name || '').toLowerCase()));
                });
                if (data.candidates.length < before) saveCandidates();
            }
            // Clean up poll chat messages
            if (data.pollChats && data.pollChats[id]) delete data.pollChats[id];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }
        
        // POST candidate
        if (apiPath === 'candidates' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const candidate = JSON.parse(body);
                    candidate.id = generateId();
                    data.candidates.push(candidate);
                    saveCandidates();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
        
        // PUT candidate (edit)
        const candidatesMatch = apiPath.match(/^candidates\/(.+)$/);
        if (candidatesMatch && req.method === 'PUT') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const updates = JSON.parse(body);
                    const id = candidatesMatch[1];
                    const cand = data.candidates.find(c => c.id === id);
                    if (!cand) { res.writeHead(404, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Not found'})); return; }
                    if (updates.name) cand.name = updates.name;
                    if (updates.party !== undefined) cand.party = updates.party;
                    if (updates.photoUrl !== undefined) cand.photoUrl = updates.photoUrl;
                    if (updates.role) cand.role = updates.role;
                    if (updates.country) cand.country = updates.country;
                    if (updates.state !== undefined) cand.state = updates.state;
                    if (updates.city !== undefined) cand.city = updates.city;
                    saveCandidates();
                    res.writeHead(200, {'Content-Type':'application/json'});
                    res.end(JSON.stringify({success:true}));
                } catch(e) { res.writeHead(400,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
            });
            return;
        }

        // DELETE candidate
        if (candidatesMatch && req.method === 'DELETE') {
            const id = candidatesMatch[1];
            data.candidates = data.candidates.filter(c => c.id !== id);
            saveCandidates();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }
        
        // Export
        if (apiPath === 'export' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                candidates: data.candidates,
                votes: data.votes,
                polls: data.polls,
                pollVotes: data.pollVotes,
                exportDate: new Date().toISOString()
            }));
            return;
        }
        
        // Login
        if (apiPath === 'login' && req.method === 'POST') {
            if (rateLimit(clientIp, 'login', 10) || checkLoginBrute(clientIp)) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Muitas tentativas. Aguarde 15 minutos.' }));
                return;
            }
            let body = '';
            req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY) { req.destroy(); } });
            req.on('end', () => {
                try {
                    const { username, password } = JSON.parse(body);
                    const id = (username || '').trim();
                    const idLower = id.toLowerCase();
                    const user = data.users.find(u =>
                        u.username === id ||
                        (u.email && u.email.toLowerCase() === idLower)
                    );
                    if (user && verifyPassword(password, user.password)) {
                        clearLoginFails(clientIp);
                        if (!user.password.startsWith('scrypt:')) {
                            user.password = hashPassword(password);
                            saveUsers();
                        }
                        const token = createToken(user);
                        const { password: pwd, ...safeUser } = user;
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, user: safeUser, token }));
                    } else {
                        recordLoginFail(clientIp);
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'Invalid credentials' }));
                    }
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
        
        // Register
        if (apiPath === 'register' && req.method === 'POST') {
            if (rateLimit(clientIp, 'register', 3)) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Muitas tentativas. Aguarde 1 minuto.' }));
                return;
            }
            let body = '';
            req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY) { req.destroy(); } });
            req.on('end', () => {
                try {
                    const { username, email, password, name } = JSON.parse(body);
                    if (!username || !email || !password || password.length < 6) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Nome de usuário, e-mail e senha (mín. 6 caracteres) são obrigatórios' }));
                        return;
                    }
                    if (!isValidEmail(email)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'E-mail inválido' }));
                        return;
                    }
                    if (data.users.find(u => u.username === username)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Nome de usuário já cadastrado' }));
                        return;
                    }
                    if (data.users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase())) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'E-mail já cadastrado' }));
                        return;
                    }
                    const newUser = {
                        id: generateId(),
                        username,
                        email: email.toLowerCase(),
                        password: hashPassword(password),
                        name: name || username,
                        role: 'user',
                        createdAt: new Date().toISOString()
                    };
                    data.users.push(newUser);
                    saveUsers();
                    const token = createToken(newUser);
                    const { password: pwd, ...safeUser } = newUser;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, user: safeUser, token }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // OAuth status
        if (apiPath === 'oauth-status' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(Object.entries(OAUTH_CONFIG).map(([name, cfg]) => ({ name, enabled: cfg.enabled }))));
            return;
        }
        
        // Get current user info
        if (apiPath === 'current-user' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'Use login endpoint' }));
            return;
        }

        // Poll Chat - GET messages
        if (apiPath.startsWith('poll-chat/') && req.method === 'GET') {
            const pollId = apiPath.slice(10);
            const messages = data.pollChats[pollId] || [];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(messages));
            return;
        }

        // Poll Chat - POST message
        if (apiPath === 'poll-chat' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { pollId, userId, userName, text } = JSON.parse(body);
                    if (!pollId || !userId || !text || !text.trim()) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'pollId, userId and text required' }));
                        return;
                    }
                    if (!data.pollChats[pollId]) data.pollChats[pollId] = [];
                    const msg = {
                        id: generateId(),
                        userId,
                        userName: userName || 'Anonymous',
                        text: text.trim().slice(0, 500),
                        timestamp: new Date().toISOString()
                    };
                    data.pollChats[pollId].push(msg);
                    // Keep last 200 messages per poll
                    if (data.pollChats[pollId].length > 200) {
                        data.pollChats[pollId] = data.pollChats[pollId].slice(-200);
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: msg }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
        
        // Poll Chat - actions (like, edit, delete, report)
        if (apiPath === 'poll-chat-action' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { pollId, msgId, action, userId, text, reporterName, reportedUser, reportedText, reportedTime, reason } = JSON.parse(body);
                    if (!pollId || !msgId || !action || !userId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'pollId, msgId, action and userId required' }));
                        return;
                    }
                    const msgs = data.pollChats[pollId] || [];
                    const msg = msgs.find(m => m.id === msgId);

                    if (action === 'like') {
                        if (msg) {
                            if (!msg.likedBy) msg.likedBy = [];
                            if (msg.likedBy.includes(userId)) {
                                msg.likedBy = msg.likedBy.filter(id => id !== userId);
                            } else {
                                msg.likedBy.push(userId);
                            }
                            msg.likes = msg.likedBy.length;
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } else if (action === 'edit') {
                        if (!msg || msg.userId !== userId) {
                            res.writeHead(403, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Cannot edit this message' }));
                            return;
                        }
                        msg.text = (text || '').trim().slice(0, 500);
                        msg.edited = true;
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } else if (action === 'delete') {
                        if (!msg || msg.userId !== userId) {
                            res.writeHead(403, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Cannot delete this message' }));
                            return;
                        }
                        data.pollChats[pollId] = msgs.filter(m => m.id !== msgId);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } else if (action === 'report') {
                        const report = {
                            id: generateId(),
                            pollId,
                            msgId,
                            reporterId: userId,
                            reporterName: reporterName || 'Unknown',
                            reportedUser: reportedUser || 'Unknown',
                            reportedText: (reportedText || '').slice(0, 500),
                            reportedTime: reportedTime || '',
                            reason: (reason || '').trim().slice(0, 500),
                            timestamp: new Date().toISOString(),
                            status: 'pending'
                        };
                        data.chatReports.push(report);
                        console.log('[REPORT] @' + report.reporterName + ' reported @' + report.reportedUser + ': ' + report.reason);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } else {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Unknown action' }));
                    }
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // Contact form - POST
        if (apiPath === 'contact' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { name, email, telephone, city, interest } = JSON.parse(body);
                    if (!name || !email) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Nome e email obrigatórios' }));
                        return;
                    }
                    const contact = {
                        id: generateId(),
                        name: name.trim().slice(0, 200),
                        email: email.trim().slice(0, 200),
                        telephone: (telephone || '').trim().slice(0, 50),
                        city: (city || '').trim().slice(0, 100),
                        interest: (interest || '').trim().slice(0, 100),
                        timestamp: new Date().toISOString(),
                        status: 'new'
                    };
                    data.contacts.push(contact);
                    console.log('[CONTACT] ' + contact.name + ' <' + contact.email + '> — ' + contact.interest);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // Admin: list users
        if (apiPath === 'admin/users' && req.method === 'GET') {
            const session = await getSession(req);
            if (!session || session.role !== 'admin') {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Admin required' }));
                return;
            }
            const users = data.users.map(u => ({ id: u.id, username: u.username, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(users));
            return;
        }

        // Admin: delete user
        // Admin: change user role
        if (apiPath.match(/^admin\/user\/.+\/role$/) && req.method === 'PUT') {
            const session = await getSession(req);
            if (!session || session.role !== 'admin') {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Admin required' }));
                return;
            }
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { role } = JSON.parse(body);
                    if (role !== 'admin' && role !== 'user') { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid role' })); return; }
                    const userId = apiPath.split('/')[2];
                    const user = data.users.find(u => u.id === userId);
                    if (!user) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'User not found' })); return; }
                    user.role = role;
                    saveUsers();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
            });
            return;
        }

        if (apiPath.startsWith('admin/user/') && req.method === 'DELETE') {
            const session = await getSession(req);
            if (!session || session.role !== 'admin') {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Admin required' }));
                return;
            }
            const userId = apiPath.slice(11);
            const user = data.users.find(u => u.id === userId);
            if (!user) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'User not found' }));
                return;
            }
            if (user.role === 'admin') {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Cannot delete admin' }));
                return;
            }
            data.users = data.users.filter(u => u.id !== userId);
            saveUsers();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }

        // Admin: list contacts
        if (apiPath === 'admin/contacts' && req.method === 'GET') {
            const session = await getSession(req);
            if (!session || session.role !== 'admin') {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Admin required' }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data.contacts));
            return;
        }

        // Admin: list chat reports
        if (apiPath === 'admin/chat-reports' && req.method === 'GET') {
            const session = await getSession(req);
            if (!session || session.role !== 'admin') {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Admin required' }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data.chatReports));
            return;
        }

        // Logo
        if (apiPath === 'logo' && req.method === 'GET') {
            const logoPaths = [
                path.join(DATA_DIR, 'logo.png'),
                path.join(__dirname, 'web', 'logo.png'),
                path.join(__dirname, 'web', 'logo.jpeg'),
                path.join(DATA_DIR, 'logo.jpeg')
            ];
            for (const logoPath of logoPaths) {
                try {
                    if (fs.existsSync(logoPath)) {
                        const logoData = fs.readFileSync(logoPath);
                        const isPng = logoData.length >= 4 && logoData[0] === 0x89 && logoData[1] === 0x50 && logoData[2] === 0x4E && logoData[3] === 0x47;
                        res.writeHead(200, { 'Content-Type': isPng ? 'image/png' : 'image/jpeg' });
                        res.end(logoData);
                        return;
                    }
                } catch (e) {}
            }
            res.writeHead(404);
            res.end('Logo not found');
            return;
        }
        
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    
    // Serve logo at /logo (outside /api)
    if (url.pathname === '/logo') {
        const logoPaths = [
            path.join(__dirname, 'web', 'logo.jpeg'),
            path.join(__dirname, 'web', 'datatoalha', 'logo.jpeg'),
            path.join(DATA_DIR, 'logo.jpeg'),
            '/Users/raymondturing/Desktop/img_7645.jpeg'
        ];
        for (const logoPath of logoPaths) {
            try {
                if (fs.existsSync(logoPath)) {
                    const logoData = fs.readFileSync(logoPath);
                    const isPng = logoData.length >= 4 && logoData[0] === 0x89 && logoData[1] === 0x50 && logoData[2] === 0x4E && logoData[3] === 0x47;
                    res.writeHead(200, { 'Content-Type': isPng ? 'image/png' : 'image/jpeg' });
                    res.end(logoData);
                    return;
                }
            } catch (e) {}
        }
        res.writeHead(404);
        res.end('Logo not found');
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
    res.end(html);
});

loadData();
loadAllData();
console.log('All data loaded. Votes:', data.votes.length, 'Polls:', data.polls.length, 'PollVotes:', data.pollVotes.length);
server.timeout = 30000;
server.headersTimeout = 10000;
server.maxHeadersCount = 50;
server.listen(PORT, HOST, () => {
    console.log('Data Toalha Web App v2.0 running at http://' + HOST + ':' + PORT);
    console.log('Password encryption: scrypt (N=' + SCRYPT_COST + ', keylen=' + SCRYPT_KEYLEN + ')');
    console.log('OAuth providers: ' + Object.entries(OAUTH_CONFIG).map(([k,v]) => k + '=' + (v.enabled ? 'ON' : 'ready')).join(', '));
    console.log('SOC Watcher API: POST /api/soc-watcher');
    console.log('  Key: ' + SOC_API_KEY);
    console.log('  TOTP Secret (hex): ' + SOC_TOTP_SECRET);
    console.log('  Current TOTP code: ' + totp(SOC_TOTP_SECRET));
    console.log('  IP allowlist: ' + (SOC_ALLOWED_IPS.length ? SOC_ALLOWED_IPS.join(', ') : 'OPEN (set DT_SOC_IPS to restrict)'));
    console.log('  Read: API key only | Write/Manage: API key + MFA + admin_user');
});
