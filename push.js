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
  const istTablet = /iPad/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
    (/Android/i.test(navigator.userAgent) && !/Mobile/i.test(navigator.userAgent));
  const istHandy = !istTablet && (istIOS || /Android|Mobile|iPhone|iPod/i.test(navigator.userAgent));
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
  .kcpush .test{margin-top:14px}
  .kcpush button.zweit{background:#fff;color:#7a1f2b;border:2px solid #7a1f2b;font-size:16px;padding:12px}
  .kcpush .tst{margin-top:8px;font-weight:600;min-height:1.2em}.kcpush .tst.ok{color:#2f6b3a}.kcpush .tst.fehler{color:#a3202e}
  .kcpush .ios{display:grid;gap:10px;margin-top:4px}
  .kcpush .schritt{display:flex;align-items:center;gap:14px;padding:12px 14px;background:#fff;border:1px solid #e6ddd0;border-radius:12px;font-size:18px;font-weight:400;color:#2a2220}
  .kcpush .schritt .nr{flex:none;width:34px;height:34px;border-radius:50%;background:#7a1f2b;color:#fff;font-weight:700;display:grid;place-items:center}
  .kcpush .schritt .bild{flex:none;width:36px;display:grid;place-items:center}
  .kcpush .schritt .bild img{border-radius:8px}
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

  // iPhone: nur 3 große Schritte mit Bild, kaum Text.
  const ICON_TEILEN = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#0a7aff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
  const ICON_PLUS = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#2a2220" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
  function iosAnleitung() {
    const icon = BASE + 'icon-192.png';
    return `<div class="ios">
        <div class="schritt"><span class="nr">1</span><span class="bild">${ICON_TEILEN}</span><span>Unten auf <strong>Teilen</strong> tippen</span></div>
        <div class="schritt"><span class="nr">2</span><span class="bild">${ICON_PLUS}</span><span><strong>„Zum Home-Bildschirm“</strong> tippen</span></div>
        <div class="schritt"><span class="nr">3</span><span class="bild"><img src="${icon}" alt="" width="32" height="32"></span><span><strong>Köcheclub</strong> auf dem Home-Bildschirm öffnen</span></div>
      </div>`;
  }

  async function freischalten(box, token, quelle) {
    const knopf = box.querySelector('button'), st = box.querySelector('.st');
    const zeige = (text, art) => { st.className = 'st ' + (art || ''); st.innerHTML = text; };

    if (istIOS && !istApp) {
      // iPhone im Browser: direkt zur Push-Seite, dort stehen die 3 Schritte
      if (!/push\.html$/.test(location.pathname)) { location.href = BASE + 'push.html?t=' + encodeURIComponent(token); return; }
      zeige(iosAnleitung()); return;
    }
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
        testBereich(box, token, sub.endpoint);
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

  // Test-Nachricht: nach der Freischaltung und wenn Push auf diesem Gerät schon an ist
  function testBereich(box, token, endpoint) {
    if (box.querySelector('.test')) return;
    const t = document.createElement('div'); t.className = 'test';
    t.innerHTML = `<p class="klein">Keine Nachricht bekommen? Schau oben in die Benachrichtigungsleiste – oder:</p>
      <button type="button" class="zweit">Test-Nachricht senden</button><div class="tst"></div>`;
    box.querySelector('.st').after(t);
    const k = t.querySelector('button'), st = t.querySelector('.tst');
    k.addEventListener('click', async () => {
      k.disabled = true; st.className = 'tst'; st.textContent = 'Wird gesendet …';
      try {
        const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'test', token, endpoint }) });
        const d = await r.json().catch(() => ({}));
        if (d.ok) { st.className = 'tst ok'; st.textContent = '✅ Test-Nachricht ist unterwegs – schau aufs Handy.'; }
        else { st.className = 'tst fehler'; st.textContent = 'Das hat nicht geklappt. Bitte tippe oben noch einmal auf „Push freischalten“.'; }
      } catch { st.className = 'tst fehler'; st.textContent = 'Keine Verbindung. Bitte später noch einmal versuchen.'; }
      setTimeout(() => { k.disabled = false; }, 5000);
    });
  }

  async function schonAn(box, token) {
    if (!kannPush || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker.getRegistration(BASE);
      const sub = reg && await reg.pushManager.getSubscription();
      if (!sub) return;
      const st = box.querySelector('.st');
      st.className = 'st ok'; st.textContent = '✅ Push ist auf diesem Gerät schon an.';
      testBereich(box, token, sub.endpoint);
    } catch {}
  }

  async function amPc(box, token, alsZusatz) {
    const link = BASE + 'push.html?t=' + encodeURIComponent(token);
    if (alsZusatz) {
      box.className = '';
      box.querySelectorAll('p')[0].remove();
      box.querySelectorAll('p')[0].innerHTML = '<strong>Lieber aufs Handy?</strong> Dann scanne diesen QR-Code mit dem Handy:';
    } else {
      box.querySelectorAll('p')[1].innerHTML = 'Die Push-Nachrichten kommen aufs <strong>Handy</strong> – deshalb wird die Freischaltung dort gemacht:';
    }
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
      if (istIOS && !istApp && /push\.html$/.test(location.pathname)) {
        box.querySelectorAll('p')[1].innerHTML = '<strong>So geht es auf dem iPhone:</strong>';
        const schritte = document.createElement('div'); schritte.innerHTML = iosAnleitung();
        box.querySelector('button').replaceWith(schritte);
        const danach = document.createElement('p'); danach.style.marginTop = '12px';
        danach.innerHTML = 'Dort dann auf <strong>„Push freischalten“</strong> tippen – fertig.';
        schritte.after(danach);
        return;
      }
      if (istTablet) {
        // Tablet: auf diesem Gerät freischalten ODER per QR-Code aufs Handy
        const knopf = box.querySelector('button');
        knopf.textContent = 'Push auf diesem Tablet freischalten';
        knopf.addEventListener('click', () => freischalten(box, token, quelle || ''));
        const extra = document.createElement('div');
        extra.style.cssText = 'margin-top:18px;padding-top:14px;border-top:1px dashed #d8c9a8';
        box.querySelector('.st').after(extra);
        const kopie = box.cloneNode(false); kopie.innerHTML = '<p></p><p></p><button></button>';
        extra.appendChild(kopie);
        amPc(kopie, token, true);
        schonAn(box, token);
        return;
      }
      if (!istHandy) { amPc(box, token); return; }
      box.querySelector('button').addEventListener('click', () => freischalten(box, token, quelle || ''));
      schonAn(box, token);
    }
  };
})();
