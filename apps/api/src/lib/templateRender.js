// Phase 49 Track 6: Cross-channel template renderer.
// `renderTemplate(body, data)` — {{var}} placeholders ko data se replace karta hai.
// Missing variable graceful: khali string (koi crash nahi, koi raw {{var}} leak nahi).

function renderTemplate(body, data) {
  if (!body) return '';
  const d = data && typeof data === 'object' ? data : {};
  return String(body).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key) => {
    // Dot-path support: {{member.name}}
    const parts = key.split('.');
    let v = d;
    for (const p of parts) {
      if (v == null || typeof v !== 'object') { v = undefined; break; }
      v = v[p];
    }
    if (v == null) return ''; // missing → khali
    return String(v);
  });
}

// Body se variable names nikalo ({{name}} → ['name']) — preview/validation ke liye.
function extractVariables(body) {
  const vars = new Set();
  if (!body) return [];
  const re = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(body)) !== null) vars.add(m[1]);
  return [...vars];
}

module.exports = { renderTemplate, extractVariables };
