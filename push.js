// KC Mitglieder-Push: Baustein "Push freischalten" für Bestätigungsseiten und push.html.
// Aufruf: KCPush.anbieten(containerElement, persoenlicherToken, quelle)
(() => {
  const BASE = new URL('./', document.currentScript.src).href;           // .../KC-Spruchauswahl/
  const FN = 'https://ptblnpiroqftcvlsrhac.supabase.co/functions/v1/kc-member-push';

  const istIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const istApp = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const kannPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // Push soll aufs HANDY. Am PC zeigen wir deshalb einen QR-Code zum Abscannen statt des Knopfs.
  const istHandy = istIOS || /Android|Mobile|iPhone|iPod/i.test(navigator.userAgent);
  const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.js';

  function ladeQrLib() {
    if (window.qrcode) return Promise.resolve();
    return new Promise((ok, fehler) => {
      const s = document.createElement('script'); s.src = QR_LIB; s.onload = ok; s.onerror = fehler; document.head.appendChild(s);
    });
  }

  const CSS = `
  .kcpush{margin:22px 0 0;padding:18px;border:2px solid #b8913a;border-radius:12px;background:#fffaf0;text-align:left;
    font:16px/1.55 "Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;color:#2a2220}
  .kcpush h2{margin:0 0 8px;font-size:20px;color:#7a1f2b}
  .kcpush p{margin:0 0 10px}
  .kcpush button{display:block;width:100%;margin:6px 0 0;padding:15px;border:0;border-radius:10px;background:#7a1f2b;color:#fff;
    font:inherit;font-weight:700;font-size:18px;cursor:pointer}
  .kcpush button:disabled{background:#b8aca6;cursor:default}
  .kcpush .st{margin-top:12px;font-weight:600;min-height:1.2em}
  .kcpush .st.ok{color:#2f6b3a}.kcpush .st.fehler{color:#a3202e}
  .kcpush .klein{font-size:14px;color:#6b5f5a;margin-top:12px}
  .kcpush ol{margin:6px 0 10px;padding-left:22px}
  .kcpush .qr{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin:8px 0 4px}
  .kcpush .qr .code{background:#fff;padding:8px;border:1px solid #e6ddd0;border-radius:8px;line-height:0}
  .kcpush .qr .code svg{width:170px;height:170px}
  .kcpush .qr ol{flex:1;min-width:200px;margin:0}`;

  function stil() {
    if (document.getElementById('kcpush-css')) return;
    const s = document.createElement('style'); s.id = 'kcpush-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  function b64ToBytes(b64) {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  function aktiv(reg) {
    if (reg.active) return Promise.resolve(reg);
    return new Promise((ok) => {
      const w = reg.installing || reg.waiting;
      if (!w) return ok(reg);
      w.addEventListener('statechange', () => { if (w.state === 'activated') ok(reg); });
    });
  }

  function iosAnleitung(token) {
    const aufPushSeite = /push\.html$/.test(location.pathname);
    const link = BASE + 'push.html?t=' + encodeURIComponent(token);
    return `<p><strong>Auf dem iPhone geht das nur über den Home-Bildschirm:</strong></p>
      <ol>
        ${aufPushSeite ? '' : `<li>Öffne diese Seite: <a href="${link}">Push-Seite öffnen</a></li>`}
        <li>Tippe unten auf <strong>Teilen</strong> (Quadrat mit Pfeil nach oben).</li>
        <li>Wähle <strong>„Zum Home-Bildschirm“</strong> und tippe auf „Hinzufügen“.</li>
        <li>Öffne <strong>„Köcheclub“</strong> auf deinem Home-Bildschirm und tippe dort auf <strong>„Push freischalten“</strong>.</li>
      </ol>`;
  }

  async function freischalten(box, token, quelle) {
    const knopf = box.querySelector('button'), st = box.querySelector('.st');
    const zeige = (text, art) => { st.className = 'st ' + (art || ''); st.innerHTML = text; };

    if (istIOS && !istApp) { zeige(iosAnleitung(token)); return; }
    if (!kannPush) {
      zeige('Dieser Browser kann leider keine Push-Nachrichten empfangen. Bitte öffne den Link in <strong>Chrome</strong> (Android) ' +
        'bzw. <strong>Safari</strong> (iPhone) – z. B. über „⋮ → Im Browser öffnen“. Oder melde dich bei Hansi.', 'fehler');
      return;
    }
    knopf.disabled = true;
    zeige('Einen Moment …');
    try {
      const erlaubt = await Notification.requestPermission();
      if (erlaubt !== 'granted') {
        zeige('Die Mitteilungen wurden nicht erlaubt. Du kannst sie später in den Handy-Einstellungen für den Browser erlauben ' +
          '– oder Hansi schaltet sie mit dir zusammen frei.', 'fehler');
        knopf.disabled = false; return;
      }
      const reg = await aktiv(await navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE }));
      const cfg = await (await fetch(FN)).json();
      if (!cfg.vapidPublicKey) throw new Error('kein Schlüssel');
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.vapidPublicKey) });
      const r = await fetch(FN, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'subscribe', token, subscription: sub.toJSON(), userAgent: navigator.userAgent, quelle })
      });
      const d = await r.json().catch(() => ({}));
      if (d.ok) {
        zeige('✅ Push ist freigeschaltet! Deine erste Nachricht vom Köcheclub ist unterwegs.', 'ok');
        knopf.textContent = 'Push ist freigeschaltet';
      } else if (d.grund === 'link_ungueltig') {
        zeige('Dein persönlicher Link ist nicht gültig. Bitte melde dich bei Hansi.', 'fehler'); knopf.disabled = false;
      } else {
        zeige('Die Freischaltung ist gespeichert, aber die erste Nachricht kam nicht an. Bitte melde dich bei Hansi.', 'fehler');
        knopf.disabled = false;
      }
    } catch (e) {
      zeige('Das hat leider nicht geklappt. Bitte versuche es noch einmal oder melde dich bei Hansi.', 'fehler');
      knopf.disabled = false;
    }
  }

  async function amPc(box, token) {
    const link = BASE + 'push.html?t=' + encodeURIComponent(token);
    box.querySelectorAll('p')[1].innerHTML = 'Die Push-Nachrichten kommen aufs <strong>Handy</strong> – deshalb wird die Freischaltung dort gemacht:';
    const knopf = box.querySelector('button');
    const qr = document.createElement('div'); qr.className = 'qr';
    qr.innerHTML = `<div class="code">QR-Code wird geladen …</div>
      <ol>
        <li>Öffne am Handy die <strong>Kamera</strong> und halte sie auf den QR-Code.</li>
        <li>Tippe auf den Link, der erscheint.</li>
        <li>Tippe auf dem Handy auf <strong>„Push freischalten“</strong> – fertig.</li>
      </ol>`;
    knopf.replaceWith(qr);
    const hinweis = document.createElement('p'); hinweis.className = 'klein';
    hinweis.innerHTML = 'Kein QR-Code-Scanner zur Hand? Kein Problem – Hansi schickt dir den Link auch per WhatsApp aufs Handy.';
    qr.after(hinweis);
    try {
      await ladeQrLib();
      const q = window.qrcode(0, 'M'); q.addData(link); q.make();
      qr.querySelector('.code').innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch {
      qr.querySelector('.code').innerHTML = `<a href="${link}" style="line-height:1.4">${link}</a>`;
    }
  }

  window.KCPush = {
    anbieten(ziel, token, quelle) {
      if (!ziel || !token) return;
      stil();
      ziel.innerHTML = `
        <div class="kcpush">
          <h2>&#128276; Push-Nachrichten vom Köcheclub</h2>
          <p>Möchtest du vom Köcheclub Push-Nachrichten auf deinem Handy empfangen? Dann bekommst du kurze Texte,
             z. B. wenn sich dein Dienstplan geändert hat, wenn das nächste Treffen ansteht usw.</p>
          <p>Dazu klicke jetzt auf <strong>„Push freischalten“</strong> – dann werden die Einstellungen übernommen
             und du erhältst deine erste Push-Nachricht vom Köcheclub.</p>
          <button type="button">Push freischalten</button>
          <div class="st"></div>
          <p class="klein">Wenn du noch Fragen dazu hast, wende dich gerne an Hansi.
             Wir können die Push-Nachrichten auch später noch für dich freischalten.</p>
        </div>`;
      const box = ziel.querySelector('.kcpush');
      if (!istHandy) { amPc(box, token); return; }
      box.querySelector('button').addEventListener('click', () => freischalten(box, token, quelle || ''));
    }
  };
})();
