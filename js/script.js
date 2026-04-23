const SAMPLE = [
  {"role":"system","content":"You are a concise, helpful assistant."},
  {"role":"user","content":"What is the capital of Japan?"},
  {"role":"assistant","content":"Tokyo."},
  {"role":"user","content":"What's the population of the greater Tokyo area?"},
  {"role":"assistant","content":"Around 37–38 million people, making it the most populous metropolitan area in the world."},
  {"role":"user","content":"Write a short Python script to print it."},
  {"role":"assistant","content":"Here you go:\n\n```python\ncapital = \"Tokyo\"\npopulation = 37000000\nprint(f\"{capital} has a population of {population}.\")\n```"}
];

let dataset = []; // Array of conversation arrays
let currentIndex = 0;

// -- Drag & Drop --
function dzOver(e) { e.preventDefault(); document.getElementById('drop-zone').classList.add('over'); }
function dzLeave(e) { document.getElementById('drop-zone').classList.remove('over'); }
function dzDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f) readFile(f);
}
function loadFile(inp) { if (inp.files[0]) readFile(inp.files[0]); }
function readFile(f) {
  const r = new FileReader();
  r.onload = e => { document.getElementById('json-input').value = e.target.result; processInput(); };
  r.readAsText(f);
}
function loadSample() {
  document.getElementById('json-input').value = JSON.stringify(SAMPLE, null, 2);
  processInput();
}

// -- Error Handling --
function showError(msg) {
  const el = document.getElementById('error-box');
  el.textContent = msg; el.style.display = 'block';
}
function clearError() { document.getElementById('error-box').style.display = 'none'; }

// -- Parsing --
function processInput() {
  clearError();
  const raw = document.getElementById('json-input').value.trim();
  if (!raw) { showError('Nothing to render — paste some ChatML JSON first.'); return; }
  
  dataset = [];
  currentIndex = 0;

  try {
    // Attempt standard JSON
    let data = JSON.parse(raw);
    dataset = [extractMessages(data)];
  } catch(e) {
    // Fallback: Attempt JSONL
    try {
      let lines = raw.split('\n');
      for (let line of lines) {
        if (!line.trim()) continue;
        dataset.push(extractMessages(JSON.parse(line)));
      }
      if (dataset.length === 0) throw new Error("Empty JSONL");
    } catch(err) {
      showError('Invalid format. Must be valid JSON or JSONL.\nError: ' + err.message);
      return;
    }
  }
  
  renderConversation();
}

function extractMessages(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.messages)) return data.messages;
  if (data && typeof data.text === 'string') return textFieldToMessages(data.text);
  return [data]; // Graceful fallback
}

// -- {"text":"..."} support --
// Tries to parse the text value as structured chat turns; falls back to a
// plain user message so the record always renders as something useful.

function textFieldToMessages(text) {
  return parseImTokens(text) || parseHumanAssistantTurns(text) || [{ role: 'user', content: text }];
}

function parseImTokens(text) {
  // Handles <|im_start|>role\ncontent<|im_end|> tokens (e.g. ChatML fine-tune format)
  const re = /<\|im_start\|>([\s\S]*?)<\|im_end\|>/g;
  const messages = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const block = m[1];
    const nl = block.indexOf('\n');
    if (nl === -1) continue;
    const role    = block.slice(0, nl).trim();
    const content = block.slice(nl + 1).trim();
    if (role) messages.push({ role, content });
  }
  return messages.length ? messages : null;
}

function parseHumanAssistantTurns(text) {
  // Handles "Human: …\nAssistant: …" style turn markers
  const re = /(?:^|\n)(Human|User|Assistant|System)\s*:\s*/gi;
  const roleMap = { human: 'user', user: 'user', assistant: 'assistant', system: 'system' };
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) matches.push({ label: m[1], index: m.index + m[0].indexOf(m[1]) });
  if (matches.length < 2) return null;
  const messages = [];
  for (let i = 0; i < matches.length; i++) {
    const role    = roleMap[matches[i].label.toLowerCase()];
    if (!role) return null;
    const start   = text.indexOf(':', matches[i].index) + 1;
    const end     = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const content = text.slice(start, end).trim();
    messages.push({ role, content });
  }
  return messages.length ? messages : null;
}

// -- Formatting & Helpers --
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatMarkdown(text) {
  let s = esc(text);

  // --- Block-level (process before inline so we can protect <pre> content) ---

  // Fenced code blocks  ```lang\ncode```
  // Stash them so inner content is never touched by inline rules.
  const stash = [];
  s = s.replace(/```([\s\S]*?)```/g, (_, inner) => {
    stash.push('<pre><code>' + inner + '</code></pre>');
    return '\x00STASH' + (stash.length - 1) + '\x00';
  });

  // Headings  # H1  ## H2  ### H3  (mapped to h3/h4/h5 to stay below page h1)
  s = s.replace(/^######\s+(.+)$/gm, '<h8>$1</h8>');
  s = s.replace(/^#####\s+(.+)$/gm,  '<h7>$1</h7>');
  s = s.replace(/^####\s+(.+)$/gm,   '<h6>$1</h6>');
  s = s.replace(/^###\s+(.+)$/gm,    '<h5>$1</h5>');
  s = s.replace(/^##\s+(.+)$/gm,     '<h4>$1</h4>');
  s = s.replace(/^#\s+(.+)$/gm,      '<h3>$1</h3>');

  // Horizontal rules  --- / ***
  s = s.replace(/^(?:---+|\*\*\*+)\s*$/gm, '<hr>');

  // Unordered lists  - item  or  * item  (consecutive lines → <ul>)
  s = s.replace(/((?:^[ \t]*[-*]\s+.+\n?)+)/gm, block => {
    const items = block.trim().split(/\n/).map(l => '<li>' + l.replace(/^[ \t]*[-*]\s+/, '') + '</li>');
    return '<ul>' + items.join('') + '</ul>';
  });

  // Ordered lists  1. item
  s = s.replace(/((?:^[ \t]*\d+\.\s+.+\n?)+)/gm, block => {
    const items = block.trim().split(/\n/).map(l => '<li>' + l.replace(/^[ \t]*\d+\.\s+/, '') + '</li>');
    return '<ol>' + items.join('') + '</ol>';
  });

  // Blockquote  > text
  s = s.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');

  // --- Inline ---

  // Inline code  `code`  (stash so inner content is untouched)
  s = s.replace(/`([^`]+)`/g, (_, inner) => {
    stash.push('<code>' + inner + '</code>');
    return '\x00STASH' + (stash.length - 1) + '\x00';
  });

  // Bold+italic  ***text***  or  ___text___
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/___(.+?)___/g,            '<strong><em>$1</em></strong>');

  // Bold  **text**  or  __text__
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(.+?)__/g,        '<strong>$1</strong>');

  // Italic  *text*  or  _text_  (avoid false positives on lone underscores)
  s = s.replace(/\*(?!\s)(.+?)(?<!\s)\*/g, '<em>$1</em>');
  s = s.replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '<em>$1</em>');

  // Strikethrough  ~~text~~
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Newlines → <br> (outside block elements)
  s = s.replace(/\n/g, '<br>');

  // Restore stashed blocks (after <br> conversion so pre/code stay clean)
  s = s.replace(/\x00STASH(\d+)\x00/g, (_, i) => stash[+i]);

  return s;
}

function getContent(msg) {
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (c === null || c === undefined) {
    if (msg.tool_calls && msg.tool_calls.length) {
      return msg.tool_calls.map(tc => {
        const name = tc.function?.name || tc.name || '?';
        let args = tc.function?.arguments || tc.input || {};
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch(e) {} }
        return '[tool call: ' + name + ']\n' + JSON.stringify(args, null, 2);
      }).join('\n\n');
    }
    return '';
  }
  if (Array.isArray(c)) {
    return c.map(p => {
      if (typeof p === 'string') return p;
      if (!p || typeof p !== 'object') return String(p);
      switch (p.type) {
        case 'text': return p.text || '';
        case 'image_url': return '[image: ' + (p.image_url?.url || '').substring(0, 60) + '...]';
        case 'image': return '[image]';
        case 'tool_use': return '[tool: ' + (p.name || '?') + ']\n' + JSON.stringify(p.input || {}, null, 2);
        case 'tool_result': return '[tool result' + (p.tool_use_id ? ' ' + p.tool_use_id : '') + ']\n' + (typeof p.content === 'string' ? p.content : JSON.stringify(p.content, null, 2));
        default: return JSON.stringify(p);
      }
    }).join('\n');
  }
  return JSON.stringify(c, null, 2);
}

function roleInfo(role) {
  switch ((role || '').toLowerCase()) {
    case 'user':      return { label: 'User',      cls: 'msg-user' };
    case 'assistant': return { label: 'Assistant', cls: 'msg-assistant' };
    case 'system':    return { label: 'System',    cls: 'msg-system' };
    case 'tool':      return { label: 'Tool',      cls: 'msg-tool' };
    case 'function':  return { label: 'Function',  cls: 'msg-function' };
    default:          return { label: role || '?', cls: 'msg-other' };
  }
}

// -- Rendering --
function renderConversation() {
  const data = dataset[currentIndex];
  if (!data || !data.length) { showError('Conversation is empty.'); return; }

  const conv = document.getElementById('conversation');
  conv.innerHTML = '';
  const counts = {};
  let prevRole = null;

  data.forEach((msg, i) => {
    const role = (msg.role || 'unknown').toLowerCase();
    const rawContent = getContent(msg);
    const { label, cls } = roleInfo(role);
    counts[role] = (counts[role] || 0) + 1;

    if (prevRole !== null && prevRole !== role) {
      const sp = document.createElement('div'); sp.className = 'spacer'; conv.appendChild(sp);
    }
    
    // Formatting & Clamping
    const htmlContent = formatMarkdown(rawContent);
    const needsClamping = rawContent.length > 500 && role !== 'system'; // System often needs to be fully read or ignored, but adjust as needed
    const wrapperClass = needsClamping ? 'content-wrapper clamped' : 'content-wrapper';
    
    const g = document.createElement('div');
    g.className = 'msg-group ' + cls;
    
    // Construct inner HTML
    let innerHTML = `<div class="role-label">${esc(label)}</div>
                     <div class="bubble">
                       <button class="copy-btn" onclick="copyText(this, \`${encodeURIComponent(rawContent)}\`)">Copy</button>
                       <div class="${wrapperClass}">${htmlContent}</div>`;
                       
    if (needsClamping) {
      innerHTML += `<button class="expand-btn" onclick="toggleExpand(this)">Show More</button>`;
    }
    innerHTML += `</div>`;
    
    g.innerHTML = innerHTML;
    conv.appendChild(g);
    prevRole = role;
  });

  // Update Stats Bar
  const bar = document.getElementById('stats-bar');
  bar.innerHTML = Object.entries(counts).map(([r,n]) =>
    '<span><b>' + n + '</b> ' + esc(r) + '</span>'
  ).join('') + '<span style="margin-left:auto"><b>' + data.length + '</b> messages total</span>';

  // UI State toggles
  document.getElementById('input-panel').style.display = 'none';
  conv.style.display = 'flex';
  bar.style.display = 'flex';
  
  // Header controls
  document.getElementById('nav-controls').style.display = 'flex';
  document.getElementById('subtitle').style.display = 'none';
  
  if (dataset.length > 1) {
    document.getElementById('pagination').style.display = 'flex';
    document.getElementById('page-indicator').textContent = `${currentIndex + 1} / ${dataset.length}`;
  } else {
    document.getElementById('pagination').style.display = 'none';
  }

  window.scrollTo(0, 0);
}

// -- Interactive Features --
function toggleExpand(btn) {
  const wrapper = btn.previousElementSibling;
  if (wrapper.classList.contains('clamped')) {
    wrapper.classList.remove('clamped');
    btn.textContent = 'Show Less';
  } else {
    wrapper.classList.add('clamped');
    btn.textContent = 'Show More';
  }
}

function copyText(btn, encodedText) {
  const text = decodeURIComponent(encodedText);
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = original, 1500);
  });
}

function nextConv() {
  if (currentIndex < dataset.length - 1) { currentIndex++; renderConversation(); }
}
function prevConv() {
  if (currentIndex > 0) { currentIndex--; renderConversation(); }
}

function resetView() {
  document.getElementById('input-panel').style.display = 'block';
  document.getElementById('conversation').style.display = 'none';
  document.getElementById('stats-bar').style.display = 'none';
  document.getElementById('nav-controls').style.display = 'none';
  document.getElementById('subtitle').style.display = 'inline';
  clearError();
  window.scrollTo(0, 0);
}

// -- Event Listeners --
document.getElementById('json-input').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') processInput();
});

window.addEventListener('scroll', () => {
  const sc = document.getElementById('scroll-controls');
  if (window.scrollY > 300) {
    sc.classList.add('visible');
  } else {
    sc.classList.remove('visible');
  }
});