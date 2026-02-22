#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 18792;
const DATA_DIR = '/Users/raymondturing/Documents/Data-Toalha';

let data = {
    candidates: [],
    votes: [],
    polls: [],
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
    
    const candidatesFile = path.join(process.env.HOME || '/Users/raymondturing', 'Library/Application Support/DataToalha/candidates.json');
    try {
        if (fs.existsSync(candidatesFile)) {
            data.candidates = JSON.parse(fs.readFileSync(candidatesFile, 'utf8'));
        } else {
            data.candidates = [
                { id: '1', name: 'João Silva', country: 'Brazil', state: 'São Paulo', city: 'São Paulo', role: 'President', party: 'PT' },
                { id: '2', name: 'Maria Santos', country: 'Brazil', state: 'São Paulo', city: 'São Paulo', role: 'President', party: 'PSDB' },
                { id: '3', name: 'Pedro Oliveira', country: 'Brazil', state: 'Rio de Janeiro', city: 'Rio de Janeiro', role: 'President', party: 'PL' }
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

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

function generateShareCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array(8).fill(0).map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
}

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
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
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
        .btn-small { padding: 8px 16px; font-size: 12px; }
        .btn-group { display: flex; gap: 10px; }
        
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
        .poll-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
        .share-code { background: #4A90D9; color: white; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-family: monospace; }
        
        .section { display: none; }
        .section.active { display: block; }
        
        .admin-only { display: none; }
        body.admin-mode .admin-only { display: block; }
        
        .search-box { margin-bottom: 15px; }
        .search-box input { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 8px; }
        
        .action-buttons { display: flex; gap: 8px; margin-top: 10px; }
        
        @media (max-width: 768px) {
            .sidebar { width: 100%; height: auto; position: relative; }
            .main { margin-left: 0; }
        }
    </style>
</head>
<body>
    <div class="sidebar">
        <h1>📊 Data Toalha</h1>
        <button class="active" onclick="showSection('home')">🏠 Home</button>
        <button onclick="showSection('vote')">🗳️ Cast Vote</button>
        <button onclick="showSection('results')">📊 Results</button>
        <button onclick="showSection('candidates')">👥 Candidates</button>
        <button onclick="showSection('polls')">📝 My Polls</button>
        <button class="admin-only" onclick="showSection('admin')">⚙️ Admin Panel</button>
        <button onclick="toggleAdminMode()" style="margin-top: 30px; background: #444;">🔒 Admin Mode</button>
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
                <div class="form-group">
                    <label>Your Name *</label>
                    <input type="text" id="voterName" placeholder="Enter your name">
                </div>
                
                <div class="form-group">
                    <label>Country *</label>
                    <select id="countrySelect" onchange="onCountryChange()">
                        <option value="">Select Country</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>State * (type to search)</label>
                    <input type="text" id="stateInput" placeholder="Type state name..." list="statesList" oninput="filterCities()">
                    <datalist id="statesList"></datalist>
                </div>
                
                <div class="form-group">
                    <label>City (Optional)</label>
                    <select id="citySelect">
                        <option value="">Select City</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Position *</label>
                    <select id="roleSelect" onchange="loadCandidates()">
                        <option value="">Select Position</option>
                        <option value="President">President</option>
                        <option value="Governor">Governor</option>
                        <option value="Mayor">Mayor</option>
                        <option value="MP">MP</option>
                        <option value="Deputy">Deputy</option>
                        <option value="Senator">Senator</option>
                    </select>
                </div>
                
                <div id="candidatesList"></div>
                
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
                <div id="resultsTable"></div>
            </div>
        </div>
        
        <!-- CANDIDATES -->
        <div id="candidates" class="section">
            <div class="header">
                <h2>Browse Candidates</h2>
            </div>
            
            <div class="search-box">
                <input type="text" id="candidateSearch" placeholder="Search by name, party, country..." oninput="searchCandidates()">
            </div>
            
            <div class="card">
                <div id="candidatesTable"></div>
            </div>
        </div>
        
        <!-- POLLS -->
        <div id="polls" class="section">
            <div class="header">
                <h2>My Polls</h2>
                <button class="btn" onclick="showCreatePoll()">+ Create Poll</button>
            </div>
            
            <div id="pollsList"></div>
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
                <h3>➕ Add Candidate</h3>
                <div class="grid" style="gap: 15px;">
                    <div class="form-group">
                        <input type="text" id="newCandidateName" placeholder="Candidate Name *">
                    </div>
                    <div class="form-group">
                        <input type="text" id="newCandidateParty" placeholder="Party *">
                    </div>
                    <div class="form-group">
                        <select id="newCandidateCountry">
                            <option value="">Select Country</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <input type="text" id="newCandidateState" placeholder="State">
                    </div>
                    <div class="form-group">
                        <input type="text" id="newCandidateCity" placeholder="City">
                    </div>
                    <div class="form-group">
                        <select id="newCandidateRole">
                            <option value="President">President</option>
                            <option value="Governor">Governor</option>
                            <option value="Mayor">Mayor</option>
                            <option value="MP">MP</option>
                            <option value="Deputy">Deputy</option>
                            <option value="Senator">Senator</option>
                        </select>
                    </div>
                </div>
                <button class="btn" onclick="addCandidate()">Add Candidate</button>
            </div>
            
            <div class="card">
                <h3>👥 Manage Candidates</h3>
                <div class="search-box">
                    <input type="text" id="adminCandidateSearch" placeholder="Search candidates to remove..." oninput="loadAdminCandidates()">
                </div>
                <div id="adminCandidatesList"></div>
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
        
        function showSection(id) {
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            document.getElementById(id).classList.add('active');
            document.querySelectorAll('.sidebar button').forEach(b => b.classList.remove('active'));
            event.target.classList.add('active');
            
            if (id === 'home') loadStats();
            if (id === 'results') loadResults();
            if (id === 'candidates') loadCandidatesList();
            if (id === 'polls') loadPolls();
            if (id === 'admin') loadAdmin();
        }
        
        async function api(path, method = 'GET', body = null) {
            const options = { method, headers: { 'Content-Type': 'application/json' } };
            if (body) options.body = JSON.stringify(body);
            const res = await fetch('/api' + path, options);
            return res.json();
        }
        
        async function loadStats() {
            const stats = await api('/stats');
            document.getElementById('totalVotes').textContent = stats.votes;
            document.getElementById('totalCandidates').textContent = stats.candidates;
            document.getElementById('totalCountries').textContent = stats.countries;
            document.getElementById('totalPolls').textContent = stats.polls;
            
            // Load countries
            countriesData = await api('/countries');
            const select = document.getElementById('countrySelect');
            select.innerHTML = '<option value="">Select Country</option>';
            countriesData.forEach(c => {
                select.innerHTML += '<option value="' + c.name + '">' + c.name + '</option>';
            });
            
            // Also load for admin
            const adminSelect = document.getElementById('newCandidateCountry');
            if (adminSelect) {
                adminSelect.innerHTML = '<option value="">Select Country</option>';
                countriesData.forEach(c => {
                    adminSelect.innerHTML += '<option value="' + c.name + '">' + c.name + '</option>';
                });
            }
        }
        
        async function onCountryChange() {
            const country = document.getElementById('countrySelect').value;
            const stateInput = document.getElementById('stateInput');
            const citySelect = document.getElementById('citySelect');
            
            stateInput.value = '';
            citySelect.innerHTML = '<option value="">Select City</option>';
            
            if (!country) return;
            
            // Load states for this country
            const states = await api('/states?country=' + encodeURIComponent(country));
            const dataList = document.getElementById('statesList');
            dataList.innerHTML = '';
            states.forEach(s => {
                dataList.innerHTML += '<option value="' + s.name + '">';
            });
        }
        
        async function filterCities() {
            const country = document.getElementById('countrySelect').value;
            const state = document.getElementById('stateInput').value;
            const citySelect = document.getElementById('citySelect');
            
            if (!country || !state) return;
            
            const cities = await api('/cities?country=' + encodeURIComponent(country) + '&state=' + encodeURIComponent(state));
            citySelect.innerHTML = '<option value="">Select City</option>';
            cities.forEach(c => {
                citySelect.innerHTML += '<option value="' + c.name + '">' + c.name + '</option>';
            });
        }
        
        async function loadCandidates() {
            const country = document.getElementById('countrySelect').value;
            const state = document.getElementById('stateInput').value;
            const role = document.getElementById('roleSelect').value;
            
            if (!country || !state || !role) {
                document.getElementById('candidatesList').innerHTML = '';
                return;
            }
            
            const candidates = await api('/candidates?country=' + encodeURIComponent(country) + '&state=' + encodeURIComponent(state) + '&role=' + encodeURIComponent(role));
            
            let html = '<label>Select Candidate</label>';
            candidates.forEach(c => {
                html += '<div class="candidate-row" onclick="selectCandidate(\\'' + c.id + '\\', \\'' + c.name.replace(/'/g, "\\\\'") + '\\')">';
                html += '<input type="radio" name="candidate" value="' + c.id + '" data-name="' + c.name + '">';
                html += '<div class="candidate-info">';
                html += '<div class="candidate-name">' + c.name + '</div>';
                html += '<div class="candidate-party">' + c.party + '</div>';
                html += '</div></div>';
            });
            document.getElementById('candidatesList').innerHTML = html || '<p>No candidates found</p>';
        }
        
        let selectedCandidateId = null;
        let selectedCandidateName = null;
        
        function selectCandidate(id, name) {
            selectedCandidateId = id;
            selectedCandidateName = name;
            document.querySelectorAll('input[name="candidate"]').forEach(r => {
                r.checked = (r.value === id);
            });
        }
        
        async function submitVote() {
            const voterName = document.getElementById('voterName').value.trim();
            const country = document.getElementById('countrySelect').value;
            const state = document.getElementById('stateInput').value.trim();
            const city = document.getElementById('citySelect').value;
            const role = document.getElementById('roleSelect').value;
            
            if (!voterName || !country || !state || !role || !selectedCandidateId) {
                alert('Please fill in all required fields (name, country, state, position) and select a candidate');
                return;
            }
            
            const result = await api('/vote', 'POST', {
                voterName,
                country,
                state,
                city,
                role,
                candidateId: selectedCandidateId,
                candidateName: selectedCandidateName
            });
            
            alert('Vote submitted successfully!');
            document.getElementById('voterName').value = '';
            document.getElementById('countrySelect').value = '';
            document.getElementById('stateInput').value = '';
            document.getElementById('citySelect').innerHTML = '<option value="">Select City</option>';
            document.getElementById('roleSelect').value = '';
            document.getElementById('candidatesList').innerHTML = '';
            selectedCandidateId = null;
            selectedCandidateName = null;
            showSection('home');
        }
        
        async function loadResults() {
            const votes = await api('/votes');
            const candidates = await api('/all-candidates');
            
            const stats = {};
            votes.forEach(v => {
                v.choices.forEach(c => {
                    stats[c.candidateName] = (stats[c.candidateName] || 0) + 1;
                });
            });
            
            const total = votes.length;
            let html = '<table><tr><th>Candidate</th><th>Party</th><th>Position</th><th>Votes</th><th>%</th></tr>';
            
            Object.entries(stats).sort((a,b) => b[1] - a[1]).forEach(([name, count]) => {
                const cand = candidates.find(c => c.name === name);
                const party = cand ? cand.party : '-';
                const role = cand ? cand.role : '-';
                const percent = total > 0 ? (count / total * 100).toFixed(1) : 0;
                html += '<tr><td>' + name + '</td><td>' + party + '</td><td>' + role + '</td><td>' + count + '</td><td>' + percent + '%</td></tr>';
            });
            
            html += '</table>';
            if (Object.keys(stats).length === 0) html = '<p>No votes yet</p>';
            document.getElementById('resultsTable').innerHTML = html;
        }
        
        async function loadCandidatesList() {
            const search = document.getElementById('candidateSearch').value;
            const candidates = await api('/all-candidates');
            
            const filtered = search ? candidates.filter(c => 
                c.name.toLowerCase().includes(search.toLowerCase()) ||
                c.party.toLowerCase().includes(search.toLowerCase()) ||
                c.country.toLowerCase().includes(search.toLowerCase()) ||
                c.state.toLowerCase().includes(search.toLowerCase())
            ) : candidates;
            
            let html = '<table><tr><th>Name</th><th>Party</th><th>Position</th><th>Country</th><th>State</th></tr>';
            filtered.forEach(c => {
                html += '<tr><td>' + c.name + '</td><td>' + c.party + '</td><td>' + c.role + '</td><td>' + c.country + '</td><td>' + c.state + '</td></tr>';
            });
            html += '</table>';
            document.getElementById('candidatesTable').innerHTML = html;
        }
        
        function searchCandidates() {
            loadCandidatesList();
        }
        
        async function loadPolls() {
            const polls = await api('/polls');
            let html = '';
            polls.forEach(p => {
                html += '<div class="poll-card">';
                html += '<div class="poll-header"><h4>' + p.title + '</h4><span class="share-code">' + p.shareCode + '</span></div>';
                if (p.description) html += '<p>' + p.description + '</p>';
                html += '<p>' + p.options.length + ' options | ' + p.votes + ' votes</p>';
                html += '</div>';
            });
            html = html || '<p>No polls yet.</p>';
            document.getElementById('pollsList').innerHTML = html;
        }
        
        async function showCreatePoll() {
            const title = prompt('Poll title:');
            if (!title) return;
            const description = prompt('Description (optional):') || '';
            const options = prompt('Options (comma separated, e.g. Yes,No,Maybe):');
            if (!options) return;
            
            const optionList = options.split(',').map(o => ({ id: generateId(), text: o.trim(), votes: 0 }));
            await api('/polls', 'POST', { 
                title, 
                description, 
                options: optionList, 
                shareCode: generateShareCode(),
                createdBy: 'User'
            });
            alert('Poll created!');
            loadPolls();
        }
        
        function generateId() {
            return Math.random().toString(36).substr(2, 9);
        }
        
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
            document.getElementById('adminCandidates').textContent = stats.candidates;
            document.getElementById('adminVotes').textContent = stats.votes;
            document.getElementById('adminPolls').textContent = stats.polls;
            loadAdminCandidates();
        }
        
        async function loadAdminCandidates() {
            const search = document.getElementById('adminCandidateSearch').value;
            let candidates = await api('/all-candidates');
            
            if (search) {
                candidates = candidates.filter(c => 
                    c.name.toLowerCase().includes(search.toLowerCase()) ||
                    c.party.toLowerCase().includes(search.toLowerCase())
                );
            }
            
            let html = '<table><tr><th>Name</th><th>Party</th><th>Position</th><th>Location</th><th>Action</th></tr>';
            candidates.forEach(c => {
                html += '<tr><td>' + c.name + '</td><td>' + c.party + '</td><td>' + c.role + '</td><td>' + c.country + ', ' + c.state + '</td>';
                html += '<td><button class="btn btn-danger btn-small" onclick="removeCandidate(\\'' + c.id + '\\')">Remove</button></td></tr>';
            });
            html += '</table>';
            document.getElementById('adminCandidatesList').innerHTML = html;
        }
        
        async function addCandidate() {
            const name = document.getElementById('newCandidateName').value.trim();
            const party = document.getElementById('newCandidateParty').value.trim();
            const country = document.getElementById('newCandidateCountry').value;
            const state = document.getElementById('newCandidateState').value.trim();
            const city = document.getElementById('newCandidateCity').value.trim();
            const role = document.getElementById('newCandidateRole').value;
            
            if (!name || !party) {
                alert('Please enter name and party');
                return;
            }
            
            await api('/candidates', 'POST', { 
                name, 
                party, 
                country: country || 'Unknown',
                state: state || 'Unknown',
                city: city || 'Unknown',
                role 
            });
            
            alert('Candidate added!');
            document.getElementById('newCandidateName').value = '';
            document.getElementById('newCandidateParty').value = '';
            loadAdminCandidates();
            loadStats();
        }
        
        async function removeCandidate(id) {
            if (!confirm('Are you sure you want to remove this candidate?')) return;
            
            await api('/candidates/' + id, 'DELETE');
            alert('Candidate removed!');
            loadAdminCandidates();
            loadStats();
        }
        
        async function clearVotes() {
            if (!confirm('Are you sure you want to clear ALL votes? This cannot be undone.')) return;
            await api('/votes', 'DELETE');
            alert('All votes cleared!');
            loadAdmin();
        }
        
        async function exportData() {
            const data = await api('/export');
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'datatoalha_export_' + new Date().toISOString().split('T')[0] + '.json';
            a.click();
        }
        
        loadStats();
    </script>
</body>
</html>
`;

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    
    if (url.pathname.startsWith('/api/')) {
        const path = url.pathname.slice(5);  // Remove '/api/' prefix
        const pathParts = path.split('/');
        
        // Stats
        if (path === 'stats' && req.method === 'GET') {
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
        if (path === 'countries' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data.countries.map(c => ({ name: c.name }))));
            return;
        }
        
        // States
        if (path === 'states' && req.method === 'GET') {
            const country = url.searchParams.get('country');
            const states = data.states.filter(s => s.countryName.toLowerCase() === country.toLowerCase());
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([...new Set(states.map(s => s.name))].map(name => ({ name }))));
            return;
        }
        
        // Cities
        if (path === 'cities' && req.method === 'GET') {
            const country = url.searchParams.get('country');
            const state = url.searchParams.get('state');
            const cities = data.cities.filter(c => 
                c.countryName.toLowerCase() === country.toLowerCase() && 
                c.stateName.toLowerCase() === state.toLowerCase()
            );
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([...new Set(cities.map(c => c.name))].map(name => ({ name }))));
            return;
        }
        
        // Candidates
        if (path === 'candidates' && req.method === 'GET') {
            const country = url.searchParams.get('country');
            const state = url.searchParams.get('state');
            const role = url.searchParams.get('role');
            let candidates = data.candidates;
            if (country) candidates = candidates.filter(c => c.country.toLowerCase() === country.toLowerCase());
            if (state) candidates = candidates.filter(c => c.state.toLowerCase() === state.toLowerCase());
            if (role) candidates = candidates.filter(c => c.role === role);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(candidates));
            return;
        }
        
        // All candidates
        if (path === 'all-candidates' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data.candidates));
            return;
        }
        
        // Votes
        if (path === 'votes' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data.votes));
            return;
        }
        
        // POST vote
        if (path === 'vote' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                const vote = JSON.parse(body);
                vote.id = generateId();
                vote.timestamp = new Date().toISOString();
                vote.choices = [{ candidateName: vote.candidateName, role: vote.role }];
                data.votes.push(vote);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            });
            return;
        }
        
        // DELETE votes
        if (path === 'votes' && req.method === 'DELETE') {
            data.votes = [];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }
        
        // Polls
        if (path === 'polls' && req.method === 'GET') {
            const polls = data.polls.map(p => ({ 
                ...p, 
                votes: data.pollVotes ? data.pollVotes.filter(pv => pv.pollId === p.id).length : 0 
            }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(polls));
            return;
        }
        
        // POST poll
        if (path === 'polls' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                const poll = JSON.parse(body);
                poll.id = generateId();
                poll.createdAt = new Date().toISOString();
                if (!data.pollVotes) data.pollVotes = [];
                data.polls.push(poll);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            });
            return;
        }
        
        // POST candidate
        if (path === 'candidates' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                const candidate = JSON.parse(body);
                candidate.id = generateId();
                data.candidates.push(candidate);
                saveCandidates();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            });
            return;
        }
        
        // DELETE candidate
        if (pathParts[1] === 'candidates' && pathParts[2] && req.method === 'DELETE') {
            const id = pathParts[2];
            data.candidates = data.candidates.filter(c => c.id !== id);
            saveCandidates();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }
        
        // Export
        if (path === 'export' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                candidates: data.candidates,
                votes: data.votes,
                polls: data.polls,
                exportDate: new Date().toISOString()
            }));
            return;
        }
        
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
});

loadData();
server.listen(PORT, () => {
    console.log('Data Toalha Web App running at http://localhost:' + PORT);
});
