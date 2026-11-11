// Password screen: decrypts data.js (window.ENC) in the browser, then starts the app.
(function () {
  const KEY = 'crease-pw';
  const form = document.getElementById('gate');
  const input = document.getElementById('pw');
  const msg = document.getElementById('gate-msg');
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  async function decrypt(pw) {
    const E = window.ENC;
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: bytes(E.salt), iterations: E.iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(E.iv) }, key, bytes(E.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  function start(data) {
    window.DATA = data;
    form.remove();
    document.body.classList.remove('locked');
    const s = document.createElement('script');
    s.src = 'app.js' + ((document.getElementById('gate-script').src.match(/\?v=[^&]*/) || [''])[0]);
    document.body.appendChild(s);
  }

  async function attempt(pw, remember) {
    try {
      const data = await decrypt(pw);
      try { if (remember) localStorage.setItem(KEY, pw); } catch (e) { /* storage unavailable */ }
      start(data);
      return true;
    } catch (e) {
      return false;
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = 'Checking…';
    const ok = await attempt(input.value, document.getElementById('remember').checked);
    if (!ok) { msg.textContent = 'Wrong password.'; input.select(); }
  });

  (async () => {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { /* storage unavailable */ }
    if (saved && (await attempt(saved, false))) return;
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    form.hidden = false;
    input.focus();
  })();
})();
