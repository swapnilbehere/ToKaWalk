// Update this URL after Railway deployment; localhost fallback for local dev.
const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:8000'
  : 'https://tokawalk-api.up.railway.app';

// Persist session across page refreshes so history context is maintained.
let sessionId = sessionStorage.getItem('session_id');
if (!sessionId) {
  sessionId = crypto.randomUUID();
  sessionStorage.setItem('session_id', sessionId);
}

const history = [];
const messagesEl = document.getElementById('messages');
const form = document.getElementById('chat-form');
const input = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');

// ── Latency probe ────────────────────────────────────────────────────────────

async function measureLatency() {
  try {
    const t = Date.now();
    await fetch(`${API_BASE}/health`, { method: 'HEAD', cache: 'no-store' });
    return Date.now() - t;
  } catch {
    return 9999;
  }
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendBubble(role, text = '') {
  const el = document.createElement('div');
  el.className = `bubble ${role}`;
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollBottom();
  return el;
}

function addCursor(el) {
  const c = document.createElement('span');
  c.className = 'cursor';
  el.appendChild(c);
  return c;
}

function attachMeta(bubbleEl, modelId, turnId) {
  const meta = document.createElement('div');
  meta.className = 'bubble-meta';

  const badge = document.createElement('span');
  badge.className = 'model-badge';
  badge.textContent = modelId.includes('local') ? 'local' : 'groq';

  const fbWrap = document.createElement('div');
  fbWrap.className = 'feedback-btns';

  for (const [emoji, rating] of [['👍', 1], ['👎', -1]]) {
    const btn = document.createElement('button');
    btn.className = 'fb-btn';
    btn.textContent = emoji;
    btn.setAttribute('aria-label', rating === 1 ? 'Thumbs up' : 'Thumbs down');
    btn.onclick = async () => {
      if (btn.dataset.sent) return;
      btn.dataset.sent = '1';
      btn.classList.add('selected');
      try {
        await fetch(`${API_BASE}/api/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ turn_id: turnId, rating }),
        });
      } catch { /* fire-and-forget */ }
    };
    fbWrap.appendChild(btn);
  }

  meta.appendChild(badge);
  meta.appendChild(fbWrap);
  bubbleEl.appendChild(meta);
}

// ── Core send ────────────────────────────────────────────────────────────────

async function sendMessage(text) {
  history.push({ role: 'user', content: text });
  appendBubble('user', text);

  const bubble = appendBubble('assistant');
  const cursor = addCursor(bubble);

  sendBtn.disabled = true;
  input.value = '';

  const latency = await measureLatency();

  try {
    const resp = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        session_id: sessionId,
        history: history.slice(0, -1),   // exclude the turn we just added
        network_latency_ms: latency,
      }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let fullText = '';
    let turnId = null;
    let modelUsed = GROQ_MODEL_LABEL;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();       // keep any incomplete last line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);

        if (data.startsWith('[DONE]')) {
          try {
            const meta = JSON.parse(data.slice(7));
            turnId = meta.turn_id;
            modelUsed = meta.model || modelUsed;
          } catch { /* malformed payload — ignore */ }

        } else if (data.startsWith('[ERROR]')) {
          bubble.textContent = '⚠ ' + data.slice(8).trim();

        } else {
          fullText += data;
          bubble.textContent = fullText;
          scrollBottom();
        }
      }
    }

    cursor.remove();
    if (turnId) attachMeta(bubble, modelUsed, turnId);
    if (fullText) history.push({ role: 'assistant', content: fullText });

  } catch (err) {
    cursor.remove();
    bubble.textContent = '⚠ Could not reach Nova. Check your connection.';
    console.error(err);
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

const GROQ_MODEL_LABEL = 'groq/llama-3.1-8b-instant';

form.addEventListener('submit', e => {
  e.preventDefault();
  const text = input.value.trim();
  if (text && !sendBtn.disabled) sendMessage(text);
});

// ── Stats modal ──────────────────────────────────────────────────────────────

document.getElementById('stats-btn').addEventListener('click', async () => {
  const modal = document.getElementById('stats-modal');
  const content = document.getElementById('stats-content');
  modal.classList.remove('hidden');
  content.innerHTML = 'Loading…';

  try {
    const data = await fetch(`${API_BASE}/api/stats`).then(r => r.json());
    const rows = [
      ['Total sessions',  data.total_sessions],
      ['Total turns',     data.total_turns],
      ['Online (Groq)',   `${data.online_pct}%`],
      ['Local model',     `${data.local_pct}%`],
      ['p50 latency',     `${data.p50_latency_ms} ms`],
      ['p95 latency',     `${data.p95_latency_ms} ms`],
      ['Error rate',      `${data.error_rate}%`],
    ];
    content.innerHTML = rows.map(([label, val]) =>
      `<div class="stat-row"><span>${label}</span><span class="stat-val">${val}</span></div>`
    ).join('');
  } catch {
    content.textContent = 'Failed to load stats.';
  }
});

document.getElementById('close-stats').addEventListener('click', () => {
  document.getElementById('stats-modal').classList.add('hidden');
});
