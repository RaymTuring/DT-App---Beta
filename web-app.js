#!/usr/bin/env node
const http = require('http');
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

// OAuth Config (placeholders - set env vars for production)
const OAUTH_CONFIG = {
  google: { clientId: process.env.GOOGLE_CLIENT_ID || '', enabled: !!process.env.GOOGLE_CLIENT_ID },
  apple: { clientId: process.env.APPLE_CLIENT_ID || '', enabled: !!process.env.APPLE_CLIENT_ID },
  facebook: { clientId: process.env.FACEBOOK_APP_ID || '', enabled: !!process.env.FACEBOOK_APP_ID }
};

// Password hashing with scrypt
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
    if (sig !== expected) return null;
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
                { id: 'admin1', username: 'admin', password: 'admin123', role: 'admin', name: 'Administrator' },
                { id: 'user1', username: 'user', password: 'user123', role: 'user', name: 'Regular User' }
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

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

function generateShareCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array(8).fill(0).map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
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
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Data Toalha - Digital Voting Platform</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; min-height: 100vh; }
        
        .sidebar { position: fixed; left: 0; top: 0; width: 220px; height: 100vh; background: #1e1e1e; color: white; padding: 20px; overflow-y: auto; }
        .sidebar h1 { font-size: 20px; margin-bottom: 30px; color: #4A90D9; }
        .sidebar button { display: block; width: 100%; padding: 12px 15px; margin-bottom: 8px; background: #2d2d2d; border: none; color: white; text-align: left; cursor: pointer; border-radius: 6px; font-size: 14px; }
        .sidebar button:hover { background: #3d3d3d; }
        .sidebar button.active { background: #4A90D9; }
        
        .main { margin-left: 220px; padding: 30px; min-height: 100vh; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; flex-wrap: wrap; gap: 15px; }
        .header h2 { font-size: 28px; color: #333; }
        
        .card { background: white; border-radius: 12px; padding: 25px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .card h3 { font-size: 18px; margin-bottom: 20px; color: #333; }
        
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; margin-bottom: 8px; font-weight: 500; color: #333; }
        .form-group input, .form-group select { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; }
        .form-group input:focus, .form-group select:focus { outline: none; border-color: #4A90D9; }
        
        .btn { padding: 12px 24px; background: #4A90D9; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500; display: inline-block; }
        .btn:hover { background: #357ABD; }
        .btn-secondary { background: #6c757d; }
        .btn-danger { background: #dc3545; }
        .btn-success { background: #28a745; }
        .btn-small { padding: 8px 16px; font-size: 12px; }
        .btn-group { display: flex; gap: 10px; flex-wrap: wrap; }
        
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; }
        .stat-card { background: white; border-radius: 12px; padding: 20px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .stat-card .value { font-size: 36px; font-weight: bold; color: #4A90D9; }
        .stat-card .label { color: #666; margin-top: 8px; }
        
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
        th { font-weight: 600; color: #333; background: #f8f8f8; }
        
        .candidate-row { display: flex; align-items: center; padding: 15px; border: 1px solid #eee; border-radius: 8px; margin-bottom: 10px; cursor: pointer; }
        .candidate-row:hover { background: #f9f9f9; }
        .candidate-row input[type="radio"] { margin-right: 15px; }
        .candidate-info { flex: 1; }
        .candidate-name { font-weight: 600; }
        .candidate-party { color: #666; font-size: 13px; }
        
        .poll-card { background: white; border-radius: 12px; padding: 20px; margin-bottom: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .poll-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px; }
        .share-code { background: #4A90D9; color: white; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-family: monospace; }
        
        .section { display: none; }
        .section.active { display: block; }
        
        .admin-only { display: none; }
        body.admin-mode .admin-only { display: block; }
        
        .search-box { margin-bottom: 15px; }
        .search-box input { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 8px; }
        
        .poll-type-badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
        .badge-political { background: #e3f2fd; color: #1565c0; }
        .badge-community { background: #e8f5e9; color: #2e7d32; }
        
        .voted-badge { background: #28a745; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px; }
        
        .empty-state { text-align: center; padding: 40px; color: #666; }
        
        @media (max-width: 768px) {
            .sidebar { width: 100%; height: auto; position: relative; }
            .main { margin-left: 0; }
        }
    </style>
</head>
<body>
    <!-- LOGIN OVERLAY -->
    <div id="loginOverlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);z-index:2000;display:flex;align-items:center;justify-content:center;">
        <div style="background:white;padding:40px;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center;max-width:420px;width:90%;">
            <img src="/logo" style="max-width:120px;margin-bottom:15px;border-radius:12px;" alt="Data Toalha Logo">
            <h2 style="color:#1a1a2e;margin-bottom:5px;">Data Toalha</h2>
            <p style="color:#666;margin-bottom:20px;font-size:14px;">Plataforma Digital de Votacao</p>

            <!-- Tab Switcher -->
            <div style="display:flex;gap:0;margin-bottom:20px;border-radius:8px;overflow:hidden;border:1px solid #ddd;">
                <button id="loginTab" onclick="switchAuthTab('login')" style="flex:1;padding:10px;border:none;background:#4A90D9;color:white;cursor:pointer;font-weight:600;">Login</button>
                <button id="registerTab" onclick="switchAuthTab('register')" style="flex:1;padding:10px;border:none;background:#f5f5f5;color:#666;cursor:pointer;font-weight:600;">Registrar</button>
            </div>

            <!-- Login Form -->
            <div id="loginForm">
                <div class="form-group">
                    <input type="text" id="loginUsername" placeholder="Username" style="text-align:center;">
                </div>
                <div class="form-group">
                    <input type="password" id="loginPassword" placeholder="Senha" style="text-align:center;">
                </div>
                <button class="btn" onclick="doLogin()" style="width:100%;">Entrar</button>
            </div>

            <!-- Register Form -->
            <div id="registerForm" style="display:none;">
                <div class="form-group">
                    <input type="text" id="regName" placeholder="Nome completo" style="text-align:center;">
                </div>
                <div class="form-group">
                    <input type="text" id="regUsername" placeholder="Username" style="text-align:center;">
                </div>
                <div class="form-group">
                    <input type="password" id="regPassword" placeholder="Senha (min 6 caracteres)" style="text-align:center;">
                </div>
                <button class="btn" onclick="doRegister()" style="width:100%;">Criar Conta</button>
            </div>

            <div id="authError" style="color:#dc3545;font-size:13px;margin-top:10px;display:none;"></div>

            <!-- OAuth Buttons -->
            <div style="margin-top:20px;padding-top:15px;border-top:1px solid #eee;">
                <p style="font-size:12px;color:#999;margin-bottom:12px;">Ou entre com:</p>
                <div style="display:flex;gap:10px;justify-content:center;">
                    <button onclick="oauthLogin('google')" style="padding:10px 20px;border:1px solid #ddd;border-radius:8px;background:white;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:13px;" title="Google">
                        <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                        Google
                    </button>
                    <button onclick="oauthLogin('apple')" style="padding:10px 20px;border:1px solid #ddd;border-radius:8px;background:white;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:13px;" title="Apple">
                        <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#000" d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                        Apple
                    </button>
                    <button onclick="oauthLogin('facebook')" style="padding:10px 20px;border:1px solid #ddd;border-radius:8px;background:white;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:13px;" title="Facebook">
                        <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                        Facebook
                    </button>
                </div>
            </div>
        </div>
    </div>
    
    <div id="appContent" style="display:none;">
    <div class="sidebar">
        <div style="text-align:center;margin-bottom:20px;">
            <img src="/logo" style="max-width:120px;border-radius:8px;" alt="Data Toalha">
        </div>
        <button class="active" onclick="showSection('home')">🏠 Home</button>
        <button onclick="showSection('vote')">🗳️ Cast Vote</button>
        <button onclick="showSection('results')">📊 Results</button>
        <button onclick="showSection('candidates')">👥 Candidates</button>
        <button onclick="showSection('polls')">📝 My Polls</button>
        <button onclick="showSection('products')">🎁 Products</button>
        <button id="adminMenuBtn" class="admin-only" onclick="showSection('admin')">⚙️ Admin Panel</button>
        <div style="margin-top:auto;padding-top:20px;border-top:1px solid #444;">
            <p style="font-size:12px;color:#888;margin-bottom:5px;">Logged in as:</p>
            <p style="font-size:14px;color:#4A90D9;margin-bottom:10px;" id="currentUserName">-</p>
            <button onclick="doLogout()" style="background:#444;width:100%;padding:8px;border:none;color:white;border-radius:6px;cursor:pointer;">Logout</button>
        </div>
    </div>
    
    <div class="main">
        <!-- HOME -->
        <div id="home" class="section active">
            <div class="header">
                <h2>Welcome to Data Toalha</h2>
            </div>
            
            <div class="grid" style="margin-bottom: 30px;">
                <div class="stat-card">
                    <div class="value" id="totalVotes">0</div>
                    <div class="label">Total Votes</div>
                </div>
                <div class="stat-card">
                    <div class="value" id="totalCandidates">0</div>
                    <div class="label">Candidates</div>
                </div>
                <div class="stat-card">
                    <div class="value" id="totalCountries">0</div>
                    <div class="label">Countries</div>
                </div>
                <div class="stat-card">
                    <div class="value" id="totalPolls">0</div>
                    <div class="label">Active Polls</div>
                </div>
            </div>
            
            <div class="card">
                <h3>Quick Actions</h3>
                <div class="btn-group">
                    <button class="btn" onclick="showSection('vote')">🗳️ Cast Your Vote</button>
                    <button class="btn btn-secondary" onclick="showSection('results')">📊 View Results</button>
                    <button class="btn btn-secondary" onclick="showSection('polls')">📝 Create Poll</button>
                </div>
            </div>
        </div>
        
        <!-- VOTE -->
        <div id="vote" class="section">
            <div class="header">
                <h2>Cast Your Vote</h2>
            </div>
            
            <div class="card">
                <h3>Step 1: Select Election Type</h3>
                <div class="form-group">
                    <label>What do you want to vote on?</label>
                    <select id="electionType" onchange="onElectionTypeChange()">
                        <option value="">Select Election Type</option>
                        <option value="political">🏛️ Political Election (President, Governor, etc.)</option>
                        <option value="community">👥 Community Poll</option>
                    </select>
                </div>
            </div>
            
            <div id="politicalSection" style="display:none;">
                <div class="card">
                    <h3>Step 2: Select Position</h3>
                    <div class="form-group">
                        <label>Position *</label>
                        <select id="roleSelect" onchange="onRoleChange()">
                            <option value="">Select Position</option>
                            <option value="President">President (Country-wide)</option>
                            <option value="Senator">Senator (Country-wide)</option>
                            <option value="Governor">Governor (State)</option>
                            <option value="Mayor">Mayor (City)</option>
                            <option value="MP">MP (State)</option>
                            <option value="Deputy">Deputy (State)</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label>Country *</label>
                        <select id="countrySelect" onchange="onCountryChange()">
                            <option value="">Select Country</option>
                        </select>
                    </div>
                    
                    <div class="form-group" id="stateGroup" style="display:none;">
                        <label>State * (type to search)</label>
                        <input type="text" id="stateInput" placeholder="Type state name..." list="statesList" oninput="onStateInput()">
                        <datalist id="statesList"></datalist>
                    </div>
                    
                    <div id="candidatesList"></div>
                </div>
            </div>
            
            <div id="communitySection" style="display:none;">
                <div class="card" id="categorySelectCard">
                    <h3>Step 2: Select Category</h3>
                    <div class="form-group">
                        <select id="categorySelect" onchange="onCategoryChange()">
                            <option value="">Select a Category</option>
                        </select>
                    </div>
                </div>
                
                <div class="card" id="pollListCard" style="display:none;">
                    <h3>Step 3: Available Polls</h3>
                    <button class="btn btn-small btn-secondary" onclick="backToCategories()" style="margin-bottom:15px;">← Back to Categories</button>
                    <div id="availablePollsList"></div>
                </div>
                
                <div class="card" id="pollVotingCard" style="display:none;">
                    <h3>Step 4: Cast Your Vote</h3>
                    <button class="btn btn-small btn-secondary" onclick="backToPollList()" style="margin-bottom:15px;">← Back to Polls</button>
                    <div id="pollVotingOptions"></div>
                </div>
            </div>
            
            <div class="card">
                <p style="color:#666;">Logged in as: <strong id="voterNameDisplay" style="color:#4A90D9;"></strong></p>
                <button class="btn" onclick="submitVote()" style="margin-top: 20px;">Submit Vote</button>
            </div>
        </div>
        
        <!-- RESULTS -->
        <div id="results" class="section">
            <div class="header">
                <h2>Voting Results</h2>
                <button class="btn btn-secondary" onclick="loadResults()">🔄 Refresh</button>
            </div>
            
            <div class="card">
                <h3>Political Elections</h3>
                <div id="politicalResults"></div>
            </div>
            
            <div class="card">
                <h3>Community Polls by Category</h3>
                <div class="form-group">
                    <label>Search by Poll Code:</label>
                    <input type="text" id="pollCodeSearch" placeholder="Enter poll code..." oninput="searchPollByCode()" style="margin-bottom:10px;">
                </div>
                <div id="searchResult"></div>
                <div class="form-group">
                    <label>Select Category:</label>
                    <select id="resultsCategorySelect" onchange="loadCommunityResults()">
                        <option value="">All Categories (General)</option>
                    </select>
                </div>
                <div id="communityResults"></div>
            </div>
        </div>
        
        <!-- CANDIDATES -->
        <div id="candidates" class="section">
            <div class="header">
                <h2>Browse Candidates</h2>
            </div>
            
            <div class="search-box">
                <input type="text" id="candidateSearch" placeholder="Search by name, party, country, position..." oninput="searchCandidates()">
            </div>
            
            <div class="card">
                <div id="candidatesTable"></div>
            </div>
        </div>
        
        <!-- POLLS -->
        <div id="polls" class="section">
            <div class="header">
                <h2>My Polls</h2>
                <button class="btn" onclick="showCreatePollForm()">+ Create Poll</button>
            </div>
            
            <div id="pollsList"></div>
        </div>
        
        <!-- PRODUCTS -->
        <div id="products" class="section">
            <div class="header">
                <h2>🎁 Products & Donations</h2>
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
        
        <!-- ADD PRODUCT MODAL -->
        <div id="addProductModal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;">
            <div style="background:white;max-width:500px;margin:100px auto;padding:30px;border-radius:12px;">
                <h3>Add Product</h3>
                <div class="form-group">
                    <label>Product Name *</label>
                    <input type="text" id="productName" placeholder="e.g., Premium Subscription">
                </div>
                <div class="form-group">
                    <label>Price ($) *</label>
                    <input type="number" id="productPrice" placeholder="9.99" step="0.01">
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <input type="text" id="productDescription" placeholder="Product description">
                </div>
                <div class="form-group">
                    <label>Link to Poll *</label>
                    <select id="productPollSelect"></select>
                </div>
                <div class="btn-group">
                    <button class="btn" onclick="submitProduct()">Add Product</button>
                    <button class="btn btn-secondary" onclick="closeAddProductModal()">Cancel</button>
                </div>
            </div>
        </div>
        
        <!-- BUY GIFT MODAL -->
        <div id="buyGiftModal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;">
            <div style="background:white;max-width:500px;margin:100px auto;padding:30px;border-radius:12px;">
                <h3>🎁 Buy as Gift/Donation</h3>
                <div id="giftProductInfo"></div>
                <div class="form-group">
                    <label>Recipient Name *</label>
                    <input type="text" id="recipientName" placeholder="Friend's name">
                </div>
                <div class="form-group">
                    <label>Recipient Email/Phone *</label>
                    <input type="text" id="recipientContact" placeholder="friend@email.com">
                </div>
                <div class="form-group">
                    <label>Your Message (optional)</label>
                    <input type="text" id="giftMessage" placeholder="Happy birthday!">
                </div>
                <div class="btn-group">
                    <button class="btn" onclick="confirmPurchase()">Confirm Purchase</button>
                    <button class="btn btn-secondary" onclick="closeBuyGiftModal()">Cancel</button>
                </div>
            </div>
        </div>
        
        <!-- CREATE POLL MODAL -->
        <div id="createPollModal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;">
            <div style="background:white;max-width:500px;margin:100px auto;padding:30px;border-radius:12px;">
                <h3>Create Community Poll</h3>
                <div class="form-group">
                    <label>Poll Title *</label>
                    <input type="text" id="newPollTitle" placeholder="e.g., Best Player 2024">
                </div>
                <div class="form-group">
                    <label>Category *</label>
                    <select id="newPollCategory"></select>
                </div>
                <div class="form-group">
                    <label>Description (optional)</label>
                    <input type="text" id="newPollDescription" placeholder="Brief description">
                </div>
                <div class="form-group">
                    <label>Options (comma separated) *</label>
                    <input type="text" id="newPollOptions" placeholder="e.g., Option A, Option B, Option C">
                </div>
                <div class="btn-group">
                    <button class="btn" onclick="submitCreatePoll()">Create Poll</button>
                    <button class="btn btn-secondary" onclick="closeCreatePollModal()">Cancel</button>
                </div>
            </div>
        </div>
        
        <!-- ADMIN -->
        <div id="admin" class="section">
            <div class="header">
                <h2>Admin Panel</h2>
            </div>
            
            <div class="card">
                <h3>📊 Statistics</h3>
                <p>Candidates: <strong id="adminCandidates">0</strong> | Votes: <strong id="adminVotes">0</strong> | Polls: <strong id="adminPolls">0</strong></p>
            </div>
            
            <div class="card">
                <h3>➕ Add Political Candidate</h3>
                <div class="grid" style="gap: 15px;">
                    <div class="form-group">
                        <input type="text" id="newCandidateName" placeholder="Candidate Name *">
                    </div>
                    <div class="form-group">
                        <input type="text" id="newCandidateParty" placeholder="Party *">
                    </div>
                    <div class="form-group">
                        <select id="newCandidateCountry" onchange="loadAdminStates()">
                            <option value="">Select Country *</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <select id="newCandidateState" onchange="loadAdminCities()">
                            <option value="">Select State</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <select id="newCandidateCity">
                            <option value="">Select City</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <select id="newCandidateRole">
                            <option value="President">President</option>
                            <option value="Senator">Senator</option>
                            <option value="Governor">Governor</option>
                            <option value="Mayor">Mayor</option>
                            <option value="MP">MP</option>
                            <option value="Deputy">Deputy</option>
                        </select>
                    </div>
                </div>
                <button class="btn" onclick="addCandidate()">Add Candidate</button>
            </div>
            
            <div class="card">
                <h3>👥 Manage Candidates</h3>
                <div class="search-box">
                    <input type="text" id="adminCandidateSearch" placeholder="Search candidates..." oninput="loadAdminCandidates()">
                </div>
                <div id="adminCandidatesList"></div>
            </div>
            
            <div class="card">
                <h3>📝 Pending Polls (Awaiting Approval)</h3>
                <div id="adminPendingPollsList"></div>
            </div>
            
            <div class="card">
                <h3>📝 Approved Polls</h3>
                <div id="adminPollsList"></div>
            </div>
            
            <div class="card">
                <h3>🏆 Poll Ranking Manager</h3>
                <p style="color:#666;margin-bottom:15px;">Reorder polls to show most relevant first</p>
                <div id="pollRankingList"></div>
            </div>
            
            <div class="card">
                <h3>📦 Product Approvals</h3>
                <div id="adminProductsList"></div>
            </div>
            
            <div class="card">
                <h3>⚠️ Data Management</h3>
                <div class="btn-group">
                    <button class="btn btn-danger" onclick="clearVotes()">Clear All Votes</button>
                    <button class="btn btn-secondary" onclick="exportData()">Export Data</button>
                </div>
            </div>
        </div>
    </div>
    
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
        }
        
        // Detect base path (for proxy/subpath deployments)
        const BASE = (function() {
            const p = window.location.pathname;
            // If served under /app, API calls go to /app/api
            if (p.startsWith('/app')) return '/app';
            return '';
        })();

        async function api(path, method = 'GET', body = null) {
            try {
                const options = { method, headers: { 'Content-Type': 'application/json' } };
                if (body) options.body = JSON.stringify(body);
                const res = await fetch(BASE + '/api' + path, options);
                return res.json();
            } catch (e) {
                console.error('API Error:', e);
                alert('Error: ' + e.message);
                return null;
            }
        }
        
        async function loadStats() {
            const stats = await api('/stats');
            if (!stats) return;
            document.getElementById('totalVotes').textContent = stats.votes;
            document.getElementById('totalCandidates').textContent = stats.candidates;
            document.getElementById('totalCountries').textContent = stats.countries;
            document.getElementById('totalPolls').textContent = stats.polls;
            
            countriesData = await api('/countries');
            if (!countriesData) return;
            
            const select = document.getElementById('countrySelect');
            if (select) {
                select.innerHTML = '<option value="">Select Country</option>';
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
                document.getElementById('categorySelect').innerHTML = '<option value="">Select a Category</option>';
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
            document.getElementById('categorySelect').innerHTML = '<option value="">Select a Category</option>';
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
            
            let html = '<label>Candidates for ' + role + '</label>';
            if (candidates.length === 0) {
                html += '<p style="color:#666;padding:20px;">No candidates found for this selection.</p>';
            } else {
                candidates.forEach(c => {
                    html += '<div class="candidate-row" onclick="selectCandidate(\\'' + c.id + '\\', \\'' + c.name.replace(/'/g, "\\\\'") + '\\')">';
                    html += '<input type="radio" name="candidate" value="' + c.id + '" data-name="' + c.name + '">';
                    html += '<div class="candidate-info">';
                    html += '<div class="candidate-name">' + c.name + '</div>';
                    html += '<div class="candidate-party">' + c.party + '</div>';
                    html += '</div></div>';
                });
            }
            document.getElementById('candidatesList').innerHTML = html;
        }
        
        function selectCandidate(id, name) {
            selectedCandidateId = id;
            selectedCandidateName = name;
            currentPollType = 'political';
            document.querySelectorAll('input[name="candidate"]').forEach(r => {
                r.checked = (r.value === id);
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
                html = '<div class="empty-state"><p>No approved polls in this category yet.</p><p>Create one!</p></div>';
            } else {
                filteredPolls.forEach(p => {
                    const hasVoted = votedPolls.includes(p.id);
                    html += '<div class="poll-card" style="cursor:pointer;" onclick="selectPollForVoting(\\'' + p.id + '\\')">';
                    html += '<div class="poll-header"><h4>' + p.title + '</h4>';
                    if (hasVoted) {
                        html += '<span class="voted-badge">✓ You Voted</span>';
                    }
                    html += '</div>';
                    if (p.description) html += '<p>' + p.description + '</p>';
                    html += '<p>' + p.options.length + ' options | ' + p.votes + ' votes</p>';
                    html += '<p style="color:#4A90D9;font-size:12px;">Click to vote →</p>';
                    html += '</div>';
                });
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
            catSelect.innerHTML = '<option value="">All Categories (General)</option>';
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
            
            let politicalHtml = '<table><tr><th>Country</th><th>Position</th><th>Candidate</th><th>Votes</th><th>%</th></tr>';
            if (Object.keys(stats).length === 0) {
                politicalHtml = '<p>No political votes yet</p>';
            } else {
                Object.entries(stats).sort((a,b) => b[1] - a[1]).forEach(([key, count]) => {
                    const [country, role, name] = key.split(' - ');
                    const percent = politicalVotes.length > 0 ? (count / politicalVotes.length * 100).toFixed(1) : 0;
                    politicalHtml += '<tr><td>' + country + '</td><td>' + role + '</td><td>' + name + '</td><td>' + count + '</td><td>' + percent + '%</td></tr>';
                });
            }
            document.getElementById('politicalResults').innerHTML = politicalHtml;
            
            // Load community results
            loadCommunityResults();
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
            
            let html = '<div class="card">';
            html += '<button class="btn btn-small btn-secondary" onclick="loadCommunityResults()" style="margin-bottom:15px;">← Back to All Polls</button>';
            html += '<h3>' + poll.title + '</h3>';
            if (poll.description) html += '<p>' + poll.description + '</p>';
            html += '<p style="color:#666;">Category: ' + (poll.category || 'Other') + ' | Total Votes: ' + total + '</p>';
            
            poll.options.forEach(opt => {
                const count = pVotes.filter(v => v.optionId === opt.id).length;
                const percent = total > 0 ? (count / total * 100).toFixed(1) : 0;
                html += '<div style="margin:10px 0;">';
                html += '<div style="display:flex;justify-content:space-between;"><span>' + opt.text + '</span><span>' + count + ' votes (' + percent + '%)</span></div>';
                html += '<div style="background:#eee;height:20px;border-radius:10px;overflow:hidden;">';
                html += '<div style="background:#4A90D9;height:100%;width:' + percent + '%;"></div>';
                html += '</div></div>';
            });
            
            if (hasVoted) {
                html += '<div class="voted-badge" style="margin-top:15px;display:inline-block;">✓ You Voted</div>';
            } else {
                html += '<button class="btn" style="margin-top:15px;" onclick="goToVoteCommunity()">Vote Now</button>';
            }
            html += '</div>';
            
            // Add candle chart
            if (poll.options.length >= 2 && total > 0) {
                html += await generateCandleChart(pollId, poll);
            }

            // Add discussion chat
            html += '<div class="card" style="margin-top:20px;">';
            html += '<h3 style="margin-bottom:15px;">💬 Discussion</h3>';
            html += '<div id="chatMessages_' + pollId + '" style="max-height:350px;overflow-y:auto;border:1px solid #eee;border-radius:8px;padding:8px;margin-bottom:12px;background:#fafafa;"></div>';
            html += '<div style="display:flex;gap:8px;">';
            html += '<input type="text" id="chatInput_' + pollId + '" placeholder="Write a message..." style="flex:1;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;" onkeypress="if(event.key===\\x27Enter\\x27)sendChatMessage(\\x27' + pollId + '\\x27)">';
            html += '<button class="btn" onclick="sendChatMessage(\\x27' + pollId + '\\x27)">Send</button>';
            html += '</div></div>';

            document.getElementById('communityResults').innerHTML = html;
            loadPollChat(pollId);
            startChatRefresh(pollId);
        }
        
        function goToVoteCommunity() {
            showSection('vote');
            document.getElementById('electionType').value = 'community';
            document.getElementById('communitySection').style.display = 'block';
            initCommunitySection();
        }
        
        async function loadCandidatesList() {
            const search = document.getElementById('candidateSearch').value;
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
                document.getElementById('candidatesTable').innerHTML = '<p>No candidates found</p>';
                return;
            }
            
            let html = '<table><tr><th>Name</th><th>Party</th><th>Position</th><th>Country</th><th>State</th></tr>';
            candidates.forEach(c => {
                html += '<tr><td>' + c.name + '</td><td>' + c.party + '</td><td>' + c.role + '</td><td>' + c.country + '</td><td>' + c.state + '</td></tr>';
            });
            html += '</table>';
            document.getElementById('candidatesTable').innerHTML = html;
        }
        
        async function loadPolls() {
            const polls = await api('/polls');
            const myVotedPolls = await api('/my-votes');
            
            if (!polls || !myVotedPolls) return;
            
            const votedIds = myVotedPolls.map(v => v.pollId);
            
            let html = '';
            if (polls.length === 0) {
                html = '<p>No polls yet. Create one!</p>';
            } else {
                polls.forEach(p => {
                    const hasVoted = votedIds.includes(p.id);
                    html += '<div class="poll-card">';
                    html += '<div class="poll-header"><h4>' + p.title + '</h4>';
                    html += '<span class="poll-type-badge ' + (p.type === 'political' ? 'badge-political' : 'badge-community') + '">' + (p.type === 'political' ? '🏛️ Political' : '👥 Community') + '</span>';
                    html += '</div>';
                    if (p.description) html += '<p>' + p.description + '</p>';
                    html += '<p>' + p.options.length + ' options | ' + p.votes + ' votes</p>';
                    html += '<div style="margin-top:15px;">';
                    html += '<button class="btn btn-small btn-secondary" onclick="sharePoll(\\'' + p.shareCode + '\\')">📤 Share Poll</button>';
                    html += '</div></div>';
                });
            }
            document.getElementById('pollsList').innerHTML = html;
        }
        
        async function sharePoll(code) {
            const text = 'Vote on this poll! Code: ' + code;
            if (navigator.share) {
                try {
                    await navigator.share({ text: text });
                } catch(e) {
                    await navigator.clipboard.writeText(code);
                    alert('Poll code copied: ' + code);
                }
            } else {
                await navigator.clipboard.writeText(code);
                alert('Poll code copied: ' + code);
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
        
        function closeCreatePollModal() {
            document.getElementById('createPollModal').style.display = 'none';
            document.getElementById('newPollTitle').value = '';
            document.getElementById('newPollCategory').value = '';
            document.getElementById('newPollDescription').value = '';
            document.getElementById('newPollOptions').value = '';
        }
        
        async function submitCreatePoll() {
            const title = document.getElementById('newPollTitle').value.trim();
            const category = document.getElementById('newPollCategory').value;
            const description = document.getElementById('newPollDescription').value.trim();
            const optionsStr = document.getElementById('newPollOptions').value.trim();
            
            if (!title || !category || !optionsStr) {
                alert('Please fill in all required fields');
                return;
            }
            
            const options = optionsStr.split(',').map(o => ({ id: generateId(), text: o.trim(), votes: 0 }));
            const result = await api('/polls', 'POST', { 
                title, 
                category,
                description, 
                options, 
                shareCode: generateShareCode(),
                type: 'community',
                approved: false,
                createdBy: 'User'
            });
            
            if (result && result.success) {
                alert('Poll created! It will be visible after admin approval. Code: ' + (result.shareCode || ''));
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
        
        async function loadAdmin() {
            const stats = await api('/stats');
            if (!stats) return;
            document.getElementById('adminCandidates').textContent = stats.candidates;
            document.getElementById('adminVotes').textContent = stats.votes;
            document.getElementById('adminPolls').textContent = stats.polls;
            
            const countries = await api('/countries');
            if (!countries) return;
            
            const adminSelect = document.getElementById('newCandidateCountry');
            if (adminSelect) {
                adminSelect.innerHTML = '<option value="">Select Country *</option>';
                countries.forEach(c => {
                    adminSelect.innerHTML += '<option value="' + c.name + '">' + c.name + '</option>';
                });
            }
            
            loadAdminCandidates();
            loadAdminPolls();
        }
        
        async function loadAdminStates() {
            const country = document.getElementById('newCandidateCountry').value;
            if (!country) return;
            
            const states = await api('/states?country=' + encodeURIComponent(country));
            if (!states) return;
            
            const stateSelect = document.getElementById('newCandidateState');
            stateSelect.innerHTML = '<option value="">Select State</option>';
            states.forEach(s => {
                stateSelect.innerHTML += '<option value="' + s.name + '">' + s.name + '</option>';
            });
            
            document.getElementById('newCandidateCity').innerHTML = '<option value="">Select City</option>';
        }
        
        async function loadAdminCities() {
            const country = document.getElementById('newCandidateCountry').value;
            const state = document.getElementById('newCandidateState').value;
            if (!country || !state) return;
            
            const cities = await api('/cities?country=' + encodeURIComponent(country) + '&state=' + encodeURIComponent(state));
            if (!cities) return;
            
            const citySelect = document.getElementById('newCandidateCity');
            citySelect.innerHTML = '<option value="">Select City</option>';
            cities.forEach(c => {
                citySelect.innerHTML += '<option value="' + c.name + '">' + c.name + '</option>';
            });
        }
        
        async function loadAdminCandidates() {
            const search = document.getElementById('adminCandidateSearch').value;
            let candidates = await api('/all-candidates');
            if (!candidates) return;
            
            if (search) {
                candidates = candidates.filter(c => 
                    c.name.toLowerCase().includes(search.toLowerCase()) ||
                    c.party.toLowerCase().includes(search.toLowerCase())
                );
            }
            
            if (candidates.length === 0) {
                document.getElementById('adminCandidatesList').innerHTML = '<p>No candidates found</p>';
                return;
            }
            
            let html = '<table><tr><th>Name</th><th>Party</th><th>Position</th><th>Location</th><th>Action</th></tr>';
            candidates.forEach(c => {
                html += '<tr><td>' + c.name + '</td><td>' + c.party + '</td><td>' + c.role + '</td><td>' + c.country + ', ' + c.state + '</td>';
                html += '<td><button class="btn btn-danger btn-small" onclick="removeCandidate(\\'' + c.id + '\\')">Remove</button></td></tr>';
            });
            html += '</table>';
            document.getElementById('adminCandidatesList').innerHTML = html;
        }
        
        async function loadAdminPolls() {
            const polls = await api('/polls');
            if (!polls) return;
            
            const pendingPolls = polls.filter(p => !p.approved);
            const approvedPolls = polls.filter(p => p.approved);
            
            if (pendingPolls.length === 0) {
                document.getElementById('adminPendingPollsList').innerHTML = '<p>No pending polls</p>';
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
                document.getElementById('adminPollsList').innerHTML = '<p>No approved polls</p>';
            } else {
                let html = '<table><tr><th>Title</th><th>Category</th><th>Code</th><th>Votes</th><th>Action</th></tr>';
                approvedPolls.forEach(p => {
                    html += '<tr><td>' + p.title + '</td><td>' + (p.category || 'N/A') + '</td><td>' + p.shareCode + '</td><td>' + p.votes + '</td>';
                    html += '<td><button class="btn btn-danger btn-small" onclick="removePoll(\\'' + p.id + '\\')">Delete</button></td></tr>';
                });
                html += '</table>';
                document.getElementById('adminPollsList').innerHTML = html;
            }
            
            loadPollRanking();
            loadAdminProducts();
        }
        
        async function loadPollRanking() {
            const polls = await api('/polls?type=community&approved=true');
            if (!polls) return;
            
            const rankings = data.pollRankings || {};
            
            polls.sort((a, b) => {
                const rankA = rankings[a.id] !== undefined ? rankings[a.id] : 999;
                const rankB = rankings[b.id] !== undefined ? rankings[b.id] : 999;
                return rankA - rankB;
            });
            
            let html = '<table><tr><th>Rank</th><th>Poll Title</th><th>Votes</th><th>Move</th></tr>';
            polls.forEach((p, index) => {
                const currentRank = rankings[p.id] !== undefined ? rankings[p.id] : index + 1;
                html += '<tr><td>' + currentRank + '</td><td>' + p.title + '</td><td>' + p.votes + '</td>';
                html += '<td><button class="btn btn-small" onclick="movePoll(\\x27' + p.id + '\\x27, -1)">↑</button> ';
                html += '<button class="btn btn-small" onclick="movePoll(\\x27' + p.id + '\\x27, 1)">↓</button></td></tr>';
            });
            html += '</table>';
            document.getElementById('pollRankingList').innerHTML = html;
        }
        
        async function movePoll(pollId, direction) {
            const polls = await api('/polls?type=community&approved=true');
            if (!polls) return;
            
            const rankings = data.pollRankings || {};
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
            
            data.pollRankings = rankings;
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
        
        async function generateCandleChart(pollId, poll) {
            const candleData = await api('/candle-history?pollId=' + pollId);
            
            if (!candleData || !candleData.history || candleData.history.length === 0) {
                return '';
            }
            
            const { option1, option2, history } = candleData;
            let html = '<div class="card" style="margin-top:20px;background:#1a1a2e;color:white;">';
            html += '<h4 style="color:white;">📈 Vote Trend: ' + option1.text + ' vs ' + option2.text + '</h4>';
            html += '<p style="color:#888;font-size:12px;">Winner goes UP, Loser goes DOWN (Forex style)</p>';
            
            const height = 150;
            const width = 600;
            
            html += '<div style="margin-top:15px;overflow-x:auto;">';
            html += '<svg width="' + width + '" height="' + (height + 40) + '" style="background:#0f0f1e;border-radius:8px;">';
            
            html += '<line x1="0" y1="' + (height/2) + '" x2="' + width + '" y2="' + (height/2) + '" stroke="#333" stroke-width="1" stroke-dasharray="5,5"/>';
            
            const candleWidth = Math.max(10, (width - 40) / history.length);
            
            history.forEach((candle, idx) => {
                const x = 20 + idx * candleWidth;
                const centerY = height / 2;
                const pct = candle.closePct / 100;
                const y = centerY - ((pct - 0.5) * height);
                const color = candle.closePct >= 50 ? '#00ff88' : '#ff4444';
                const prevPct = candle.openPct / 100;
                const prevY = centerY - ((prevPct - 0.5) * height);
                
                html += '<line x1="' + (x + candleWidth/2) + '" y1="' + prevY + '" x2="' + (x + candleWidth/2) + '" y2="' + y + '" stroke="' + color + '" stroke-width="2"/>';
                const bodyHeight = Math.max(4, Math.abs(y - prevY));
                const bodyY = Math.min(y, prevY);
                html += '<rect x="' + x + '" y="' + bodyY + '" width="' + (candleWidth - 4) + '" height="' + bodyHeight + '" fill="' + color + '" rx="2"/>';
                
                if (idx === history.length - 1) {
                    html += '<text x="' + (x + candleWidth/2) + '" y="' + (height + 15) + '" fill="' + color + '" font-size="10" text-anchor="middle">' + candle.votes1 + '/' + candle.votes2 + '</text>';
                }
            });
            
            html += '<text x="10" y="15" fill="#00ff88" font-size="11">' + option1.text + '</text>';
            html += '<text x="10" y="30" fill="#888" font-size="10">(' + history[history.length-1].votes1 + ' votes)</text>';
            html += '<text x="10" y="' + (height - 5) + '" fill="#ff4444" font-size="11">' + option2.text + '</text>';
            html += '<text x="10" y="' + (height + 15) + '" fill="#888" font-size="10">(' + history[history.length-1].votes2 + ' votes)</text>';
            
            html += '</svg>';
            html += '</div>';
            
            html += '<div style="margin-top:15px;">';
            html += '<p style="color:#888;font-size:11;">Vote History:</p>';
            history.forEach((candle, idx) => {
                const color = candle.closePct >= 50 ? '#00ff88' : '#ff4444';
                html += '<div style="display:inline-block;margin:3px;padding:5px 10px;background:#333;border-radius:4px;font-size:11;">';
                html += '<span style="color:' + color + ';">' + candle.votes1 + '/' + candle.votes2 + '</span>';
                html += ' (' + candle.total + ' total)';
                html += '</div>';
            });
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
                alert('Please enter name, party and select country');
                return;
            }
            
            const result = await api('/candidates', 'POST', { 
                name, party, 
                country, 
                state: state || 'N/A',
                city: city || 'N/A',
                role, type: 'political'
            });
            
            if (result && result.success) {
                alert('Candidate added!');
                document.getElementById('newCandidateName').value = '';
                document.getElementById('newCandidateParty').value = '';
                loadAdminCandidates();
                loadAdmin();
            }
        }
        
        async function removeCandidate(id) {
            if (!confirm('Remove this candidate?')) return;
            const result = await api('/candidates/' + id, 'DELETE');
            if (result && result.success) {
                loadAdminCandidates();
                loadAdmin();
            }
        }
        
        async function removePoll(id) {
            if (!confirm('Delete this poll?')) return;
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
        
        loadStats();

        let currentUser = null;
        let authToken = localStorage.getItem('dt_app_token') || null;

        function showAuthError(msg) {
            const el = document.getElementById('authError');
            el.textContent = msg;
            el.style.display = 'block';
            setTimeout(() => el.style.display = 'none', 4000);
        }

        function switchAuthTab(tab) {
            document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
            document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
            document.getElementById('loginTab').style.background = tab === 'login' ? '#4A90D9' : '#f5f5f5';
            document.getElementById('loginTab').style.color = tab === 'login' ? 'white' : '#666';
            document.getElementById('registerTab').style.background = tab === 'register' ? '#4A90D9' : '#f5f5f5';
            document.getElementById('registerTab').style.color = tab === 'register' ? 'white' : '#666';
            document.getElementById('authError').style.display = 'none';
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
            } else {
                document.body.classList.remove('admin-mode');
                document.getElementById('adminMenuBtn').style.display = 'none';
            }
            loadStats();
        }

        function doLogin() {
            const username = document.getElementById('loginUsername').value.trim();
            const password = document.getElementById('loginPassword').value;
            if (!username || !password) { showAuthError('Preencha usuario e senha'); return; }

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
            const username = document.getElementById('regUsername').value.trim();
            const password = document.getElementById('regPassword').value;
            if (!username || !password) { showAuthError('Preencha todos os campos'); return; }
            if (password.length < 6) { showAuthError('Senha deve ter no minimo 6 caracteres'); return; }

            fetch(BASE + '/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, name: name || username })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) { handleAuthSuccess(data); }
                else { showAuthError(data.error || 'Erro ao registrar'); }
            })
            .catch(e => showAuthError('Erro de conexao: ' + e.message));
        }

        function oauthLogin(provider) {
            showAuthError(provider.charAt(0).toUpperCase() + provider.slice(1) + ' login em breve - configure OAuth credentials');
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
                    return '<div style="padding:8px 12px;margin:4px 0;background:' + (isMe ? '#e3f2fd' : '#f8f8f8') + ';border-radius:8px;' + (isMe ? 'margin-left:20px;' : 'margin-right:20px;') + '">'
                        + '<div style="display:flex;justify-content:space-between;margin-bottom:2px;">'
                        + '<strong style="font-size:12px;color:' + (isAdm ? '#d32f2f' : '#333') + ';">' + escChat(m.userName) + (isAdm ? ' (Admin)' : '') + '</strong>'
                        + '<span style="font-size:11px;color:#999;">' + time + '</span></div>'
                        + '<div style="font-size:14px;">' + escChat(m.text) + '</div></div>';
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
    </script>
</body>
</html>
`;

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    
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
                    history.push({
                        timestamp: now,
                        openPct: last.closePct,
                        closePct: pct1,
                        highPct: Math.max(last.highPct, pct1, pct2),
                        lowPct: Math.min(last.lowPct, pct1, pct2),
                        votes1: currentVotes1,
                        votes2: currentVotes2,
                        total: totalVotes
                    });
                }
            } else {
                history.push({
                    timestamp: now,
                    openPct: 50,
                    closePct: pct1,
                    highPct: Math.max(pct1, pct2),
                    lowPct: Math.min(pct1, pct2),
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
            
            const key = pollId + '_' + top1.id + '_' + top2.id;
            const history = data.candleHistory[key] || [];
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ type: 'community', option1: top1, option2: top2, history }));
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
            data.polls = data.polls.filter(p => p.id !== id);
            data.pollVotes = data.pollVotes.filter(v => v.pollId !== id);
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
        
        // DELETE candidate
        const candidatesMatch = apiPath.match(/^candidates\/(.+)$/);
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
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { username, password } = JSON.parse(body);
                    const user = data.users.find(u => u.username === username);
                    if (user && verifyPassword(password, user.password)) {
                        // Migrate plaintext password to scrypt hash
                        if (!user.password.startsWith('scrypt:')) {
                            user.password = hashPassword(password);
                            saveUsers();
                        }
                        const token = createToken(user);
                        const { password: pwd, ...safeUser } = user;
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, user: safeUser, token }));
                    } else {
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
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { username, password, name } = JSON.parse(body);
                    if (!username || !password || password.length < 6) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Username and password (min 6 chars) required' }));
                        return;
                    }
                    if (data.users.find(u => u.username === username)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Username already exists' }));
                        return;
                    }
                    const newUser = {
                        id: generateId(),
                        username,
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
        
        // Logo
        if (apiPath === 'logo' && req.method === 'GET') {
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
                        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
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
                    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
                    res.end(logoData);
                    return;
                }
            } catch (e) {}
        }
        res.writeHead(404);
        res.end('Logo not found');
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
});

loadData();
server.listen(PORT, HOST, () => {
    console.log('Data Toalha Web App v2.0 running at http://' + HOST + ':' + PORT);
    console.log('Password encryption: scrypt (N=' + SCRYPT_COST + ', keylen=' + SCRYPT_KEYLEN + ')');
    console.log('OAuth providers: ' + Object.entries(OAUTH_CONFIG).map(([k,v]) => k + '=' + (v.enabled ? 'ON' : 'ready')).join(', '));
});
