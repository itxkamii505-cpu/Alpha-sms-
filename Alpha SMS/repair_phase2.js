import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');

console.log('--- STARTING IDEMPOTENT PHASE 2 DATA REPAIR ---');

function readJson(filename) {
  const p = path.join(DATA_DIR, filename);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(filename, data) {
  const p = path.join(DATA_DIR, filename);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

// 1. Remove duplicate 'admin' Owner from users.json (Fix 10)
const users = readJson('users.json');
const initialUserCount = users.length;
const filteredUsers = users.filter(u => !(String(u.username).toLowerCase() === 'admin' && String(u.role).toLowerCase() === 'owner'));
if (filteredUsers.length !== initialUserCount) {
  console.log(`[Fix 10] Removed duplicate 'admin' Owner record from users.json. Count: ${initialUserCount} -> ${filteredUsers.length}`);
  writeJson('users.json', filteredUsers);
} else {
  console.log('[Fix 10] users.json already has only one Owner (Kamran_Bhatti).');
}

// 2. Agents & Managers lookup
const agents = readJson('agents.json');
const agentMap = new Map();
agents.forEach(a => agentMap.set(Number(a.id), a));

// 3. Backfill clients lacking manager_id (Fix 3)
const clients = readJson('clients.json');
let clientsModified = 0;
clients.forEach(c => {
  if (!c.manager_id && c.agent_id && agentMap.has(Number(c.agent_id))) {
    const parentAgent = agentMap.get(Number(c.agent_id));
    if (parentAgent && parentAgent.manager_id) {
      c.manager_id = Number(parentAgent.manager_id);
      clientsModified++;
    }
  }
});
if (clientsModified > 0) {
  console.log(`[Fix 3] Backfilled manager_id for ${clientsModified} client(s) in clients.json.`);
  writeJson('clients.json', clients);
} else {
  console.log('[Fix 3] clients.json manager_id backfill already complete.');
}

// 4. Backfill numbers with agent_id but no manager_id, and reset anomalous assigned numbers (Fix 3)
const numbers = readJson('numbers.json');
let numbersManagerBackfilled = 0;
let numbersReset = 0;

numbers.forEach(n => {
  // If number has agent_id but no manager_id, lookup agent's manager_id
  if (n.agent_id && !n.manager_id && agentMap.has(Number(n.agent_id))) {
    const parentAgent = agentMap.get(Number(n.agent_id));
    if (parentAgent && parentAgent.manager_id) {
      n.manager_id = Number(parentAgent.manager_id);
      numbersManagerBackfilled++;
    }
  }

  // Reset any "assigned" non-test number with no owner (no manager, agent, or client) back to active/unallocated
  const isTest = Boolean(n.fixed_for_test || n.is_test_panel);
  const hasOwner = Boolean(n.manager_id || n.agent_id || n.client_id);
  if (n.status === 'assigned' && !isTest && !hasOwner) {
    console.log(`[Fix 3] Resetting orphaned assigned number #${n.id} (${n.number}) back to active/unallocated.`);
    n.status = 'active';
    n.user = '';
    n.client_name = '';
    n.client_username = '';
    n.notes = '';
    numbersReset++;
  }
});

if (numbersManagerBackfilled > 0 || numbersReset > 0) {
  console.log(`[Fix 3] numbers.json updated: ${numbersManagerBackfilled} numbers backfilled with manager_id, ${numbersReset} numbers reset to active.`);
  writeJson('numbers.json', numbers);
} else {
  console.log('[Fix 3] numbers.json allocation chains already consistent.');
}

// 5. Backfill old sms_log rows with missing chain IDs from numbers.json by exact number (Fix 2)
const smsLog = readJson('sms_log.json');
const numByDigits = new Map();
numbers.forEach(n => {
  const digits = String(n.number || '').replace(/\D/g, '');
  if (digits) numByDigits.set(digits, n);
});

let smsBackfilled = 0;
smsLog.forEach(s => {
  const digits = String(s.number || '').replace(/\D/g, '');
  const matched = numByDigits.get(digits);
  if (matched) {
    let changed = false;
    if (s.manager_id === undefined || s.manager_id === null) {
      if (matched.manager_id) { s.manager_id = matched.manager_id; changed = true; }
    }
    if (s.agent_id === undefined || s.agent_id === null) {
      if (matched.agent_id) { s.agent_id = matched.agent_id; changed = true; }
    }
    if (s.client_id === undefined || s.client_id === null) {
      if (matched.client_id) { s.client_id = matched.client_id; changed = true; }
    }
    if (changed) smsBackfilled++;
  }
});

if (smsBackfilled > 0) {
  console.log(`[Fix 2] Backfilled chain IDs for ${smsBackfilled} row(s) in sms_log.json.`);
  writeJson('sms_log.json', smsLog);
} else {
  console.log('[Fix 2] sms_log.json chain IDs already aligned with numbers.json.');
}

// 6. Delete stored third-party session cookies (Fix 13)
const sessionsDir = path.join(DATA_DIR, 'sessions');
if (fs.existsSync(sessionsDir)) {
  const files = fs.readdirSync(sessionsDir);
  let deletedCookies = 0;
  for (const f of files) {
    if (f.startsWith('cookie_') || f.endsWith('.txt')) {
      fs.unlinkSync(path.join(sessionsDir, f));
      deletedCookies++;
    }
  }
  console.log(`[Fix 13] Deleted ${deletedCookies} stored session cookie file(s) under data/sessions.`);
}

console.log('--- PHASE 2 DATA REPAIR COMPLETE ---');
