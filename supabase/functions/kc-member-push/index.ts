// KC Mitglieder-Push: Freischaltung OHNE Login über den persönlichen Link (Token aus kc_wm_spruch_einladung).
// Verwendet die VAPID-Schlüssel des KC Communicators: Der Communicator (kc-communication-dispatch)
// beliefert diese Geräte, wenn ein Push-Auftrag Empfänger als {personId} enthält.
// Aktionen mit Token: subscribe (+ Bestätigungs-Push), ensure (stille Selbstreparatur), status, test, unsubscribe.
// Aktion 'danke' (Zeitplan kc-wm-push-5min, cronSecret):
//   1) einmaliger Danke-Push an alle, die abgestimmt UND Push freigeschaltet haben
//   2) Meldung an Hansi (KC-P-002) je neuer Abstimmung, sobald die Person 3 Minuten nichts mehr geändert hat
// Aktion 'nachricht' (cronSecret): Rundnachricht an alle aktiven Push-Geräte (optional nur personIds,
//   Testpersonen KC-P-TEST* ausgenommen). {vorname} im Text wird persönlich ersetzt.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const PUSH_OPTIONS = { TTL: 86400, urgency: 'high' as const };
const PUSH_URL = 'https://sire65.github.io/KC-Spruchauswahl/push.html';
const ADMIN_PERSON = 'KC-P-002';
const WAHL: Record<string, string> = { A: 'Version A', B: 'Version B', gleich: 'beide gleich', kein_interesse: 'kein Interesse' };
const DARST: Record<string, string> = {
  vorname_spruch: 'Vorname', vorname_spruch_foto: 'Vorname + Foto',
  vollname_spruch: 'voller Name', vollname_spruch_foto: 'voller Name + Foto', keine: 'erscheint nicht',
};
const sha256 = async (v: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))))
    .map((x) => x.toString(16).padStart(2, '0')).join('');

async function secret(db: any, name: string) {
  const { data, error } = await db.rpc('kc_communication_get_server_secret', { p_name: name });
  if (error) return '';
  return String(data || '');
}

async function senden(admin: any, s: { id: string; subscription: any }, personId: string, anlass: string, title: string, body: string) {
  const now = new Date().toISOString();
  let status = 'sent', code: string | null = null;
  try {
    await webpush.sendNotification(s.subscription, JSON.stringify({ title, body, data: { url: PUSH_URL, anlass } }), PUSH_OPTIONS);
    await admin.from('kc_member_push_subscriptions').update({ last_success_at: now, last_error: null }).eq('id', s.id);
  } catch (e) {
    status = 'failed';
    code = String(Number((e as any)?.statusCode) || 'push_error');
    await admin.from('kc_member_push_subscriptions').update({ last_error: code, active: ![404, 410].includes(Number(code)), updated_at: now }).eq('id', s.id);
  }
  await admin.from('kc_member_push_messages').insert({ person_id: personId, subscription_id: s.id, anlass, title, body, status, error_code: code });
  return { status, code };
}

async function abgegebenePersonen(admin: any) {
  const [{ data: fb }, { data: sp }] = await Promise.all([
    admin.from('kc_wm_presentation_feedback').select('person_id, choice').not('person_id', 'is', null),
    admin.from('kc_wm_spruch_auswahl').select('person_id, spruch_id, darstellung'),
  ]);
  return { fb: fb || [], sp: sp || [], ids: new Set([...(fb || []), ...(sp || [])].map((x: any) => x.person_id)) };
}

async function namen(admin: any, ids: string[]) {
  if (!ids.length) return new Map();
  const { data } = await admin.from('kc_core_people').select('person_id, display_name, given_name, preferred_name').in('person_id', ids);
  return new Map((data || []).map((p: any) => [p.person_id, p]));
}

async function dankeVersand(admin: any, abg: any) {
  const [{ data: subs }, { data: schon }] = await Promise.all([
    admin.from('kc_member_push_subscriptions').select('id, person_id, subscription').eq('active', true),
    admin.from('kc_member_push_messages').select('person_id').eq('anlass', 'danke').eq('status', 'sent'),
  ]);
  const erledigt = new Set((schon || []).map((x: any) => x.person_id));
  const ziele = (subs || []).filter((s: any) => abg.ids.has(s.person_id) && !erledigt.has(s.person_id));
  if (!ziele.length) return { personen: 0, gesendet: 0, fehler: 0 };
  const leute = await namen(admin, [...new Set(ziele.map((s: any) => s.person_id))] as string[]);
  let gesendet = 0, fehler = 0;
  for (const s of ziele) {
    const p: any = leute.get(s.person_id) || {};
    const r = await senden(admin, s, s.person_id, 'danke', 'Köcheclub Werne – Danke! 🙏',
      `Hallo ${p.preferred_name || p.given_name || p.display_name || ''}, danke – deine Antworten sind eingegangen.`);
    if (r.status === 'sent') gesendet++; else fehler++;
  }
  return { personen: new Set(ziele.map((s: any) => s.person_id)).size, gesendet, fehler };
}

async function adminMeldungen(admin: any, abg: any) {
  const { data: gemeldet } = await admin.from('kc_wm_admin_meldungen').select('person_id');
  const schon = new Set((gemeldet || []).map((x: any) => x.person_id));
  const neu = [...abg.ids].filter((id: any) => !schon.has(id)) as string[];
  if (!neu.length) return { gemeldet: 0 };

  // erst melden, wenn die Person 3 Minuten nichts mehr geändert hat (Bewertung + Spruch vollständig)
  const { data: prot } = await admin.from('kc_wm_umfrage_protokoll').select('person_id, created_at').in('person_id', neu);
  const letzte = new Map<string, number>();
  for (const p of prot || []) letzte.set(p.person_id, Math.max(letzte.get(p.person_id) || 0, new Date(p.created_at).getTime()));
  const reif = neu.filter((id) => Date.now() - (letzte.get(id) || 0) > 3 * 60 * 1000);
  if (!reif.length) return { gemeldet: 0, wartet: neu.length };

  const { data: adminSubs } = await admin.from('kc_member_push_subscriptions').select('id, subscription').eq('person_id', ADMIN_PERSON).eq('active', true);
  if (!adminSubs?.length) return { gemeldet: 0, grund: 'hansi_ohne_push' };

  const leute = await namen(admin, reif);
  let gemeldetAnz = 0;
  for (const id of reif) {
    const p: any = leute.get(id) || {};
    const f: any = abg.fb.find((x: any) => x.person_id === id);
    const s: any = abg.sp.find((x: any) => x.person_id === id);
    const teile: string[] = [];
    if (f) teile.push(WAHL[f.choice] || f.choice);
    if (s?.spruch_id) teile.push(`Spruch Nr. ${s.spruch_id}`);
    if (s?.darstellung) teile.push(DARST[s.darstellung] || s.darstellung);
    else if (f && f.choice !== 'kein_interesse') teile.push('noch kein Spruch');
    const text = `${p.display_name || id}: ${teile.join(' · ')}`;
    let ok = false;
    for (const sub of adminSubs) {
      const r = await senden(admin, sub, ADMIN_PERSON, 'admin_abstimmung', '📊 Neue Abstimmung', text);
      if (r.status === 'sent') ok = true;
    }
    if (ok) { await admin.from('kc_wm_admin_meldungen').insert({ person_id: id, text }); gemeldetAnz++; }
  }
  return { gemeldet: gemeldetAnz };
}

async function rundnachricht(admin: any, body: any) {
  const titel = String(body.title || '').slice(0, 120);
  const text = String(body.body || '').slice(0, 500);
  const anlass = String(body.anlass || 'rundnachricht').slice(0, 60);
  if (!titel || !text) return { ok: false, grund: 'text_fehlt' };
  let q = admin.from('kc_member_push_subscriptions').select('id, person_id, subscription').eq('active', true).not('person_id', 'like', 'KC-P-TEST%');
  if (Array.isArray(body.personIds) && body.personIds.length) q = q.in('person_id', body.personIds.map(String));
  const { data: subs } = await q;
  const liste = subs || [];
  const leute = await namen(admin, [...new Set(liste.map((s: any) => s.person_id))] as string[]);
  let gesendet = 0, fehler = 0;
  for (const s of liste) {
    const p: any = leute.get(s.person_id) || {};
    const vn = p.preferred_name || p.given_name || p.display_name || '';
    const r = await senden(admin, s, s.person_id, anlass, titel, text.replaceAll('{vorname}', vn));
    if (r.status === 'sent') gesendet++; else fehler++;
  }
  return { ok: true, personen: [...new Set(liste.map((s: any) => (leute.get(s.person_id) as any)?.display_name || s.person_id))], gesendet, fehler };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const [pub, priv, subj] = await Promise.all([
    secret(admin, 'kc_communication_vapid_public_key'),
    secret(admin, 'kc_communication_vapid_private_key'),
    secret(admin, 'kc_communication_vapid_subject'),
  ]);
  const subject = subj || 'mailto:admin@koecheclub-werne.de';
  if (req.method === 'GET') return json({ ok: !!(pub && priv), vapidPublicKey: pub, system: 'kc-communicator' });

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, grund: 'ungueltige_anfrage' }, 400); }
  const action = String(body.action || '');

  // --- Zeitplan / Rundnachricht: nur mit Geheimnis ---
  if (action === 'danke' || action === 'nachricht') {
    const { data: cred } = await admin.from('kc_automation_credentials').select('token_sha256, active').eq('name', 'wm_danke_push').maybeSingle();
    if (!cred?.active || await sha256(String(body.cronSecret || '')) !== cred.token_sha256) return json({ ok: false, grund: 'nicht_berechtigt' }, 403);
    await admin.from('kc_automation_credentials').update({ last_used_at: new Date().toISOString() }).eq('name', 'wm_danke_push');
    if (!pub || !priv) return json({ ok: false, grund: 'vapid_fehlt' }, 503);
    webpush.setVapidDetails(subject, pub, priv);
    if (action === 'nachricht') return json(await rundnachricht(admin, body));
    const abg = await abgegebenePersonen(admin);
    const danke = await dankeVersand(admin, abg);
    const meldung = await adminMeldungen(admin, abg);
    return json({ ok: true, danke, meldung });
  }

  const token = String(body.token || '');
  if (!/^[0-9a-f]{20,80}$/.test(token)) return json({ ok: false, grund: 'link_ungueltig' }, 403);

  const hash = await sha256(token);
  const { data: inv } = await admin.from('kc_wm_spruch_einladung').select('person_id').eq('token_hash', hash).maybeSingle();
  if (!inv) return json({ ok: false, grund: 'link_ungueltig' }, 403);
  const { data: person } = await admin.from('kc_core_people')
    .select('person_id, display_name, given_name, preferred_name, active').eq('person_id', inv.person_id).maybeSingle();
  if (!person || !person.active) return json({ ok: false, grund: 'link_ungueltig' }, 403);
  const vorname = person.preferred_name || person.given_name || person.display_name;

  if (action === 'unsubscribe') {
    const endpoint = String(body.endpoint || '');
    let q = admin.from('kc_member_push_subscriptions')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('person_id', person.person_id);
    // Mit Endpoint nur dieses Gerät abschalten; ohne Endpoint alle Push-Anmeldungen
    // dieser Person. Der persönliche Token ist bereits geprüft.
    if (endpoint) q = q.eq('endpoint', endpoint);
    const { data: abgeschaltet, error } = await q.select('id');
    if (error) return json({ ok: false, grund: 'deaktivieren', detail: error.message }, 500);
    return json({ ok: true, deaktiviert: (abgeschaltet || []).length });
  }

  if (action === 'status') {
    const endpoint = String(body.endpoint || '');
    if (!endpoint) return json({ ok: false, grund: 'endpoint_fehlt' }, 400);
    const { data: row, error } = await admin.from('kc_member_push_subscriptions')
      .select('active, last_success_at, last_error, updated_at')
      .eq('person_id', person.person_id)
      .eq('endpoint', endpoint)
      .maybeSingle();
    if (error) return json({ ok: false, grund: 'status', detail: error.message }, 500);
    return json({
      ok: true,
      found: !!row,
      active: !!row?.active,
      lastSuccessAt: row?.last_success_at || null,
      lastError: row?.last_error || null,
      updatedAt: row?.updated_at || null,
    });
  }

  if (!pub || !priv) return json({ ok: false, grund: 'vapid_fehlt' }, 503);
  webpush.setVapidDetails(subject, pub, priv);

  if (action === 'test') {
    let q = admin.from('kc_member_push_subscriptions').select('id, subscription').eq('person_id', person.person_id).eq('active', true);
    if (body.endpoint) q = q.eq('endpoint', String(body.endpoint));
    const { data: subs } = await q.limit(10);
    if (!subs?.length) return json({ ok: false, grund: 'nicht_freigeschaltet' });
    let sent = 0;
    for (const s of subs) {
      const r = await senden(admin, s, person.person_id, 'test', 'Köcheclub Werne – Test ✅',
        `Hallo ${vorname}, das ist eine Test-Nachricht. Wenn du sie siehst, funktionieren die Push-Nachrichten.`);
      if (r.status === 'sent') sent++;
    }
    return json({ ok: sent > 0, gesendet: sent, grund: sent ? null : 'push_fehlgeschlagen' });
  }

  if (!['subscribe', 'ensure'].includes(action)) return json({ ok: false, grund: 'unbekannte_aktion' }, 400);
  const sub = body.subscription;
  if (!sub?.endpoint || !/^https:\/\//.test(String(sub.endpoint)) || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return json({ ok: false, grund: 'subscription_fehlt' }, 400);
  }

  const now = new Date().toISOString();
  const { data: vorher } = await admin.from('kc_member_push_subscriptions')
    .select('active, last_error')
    .eq('endpoint', String(sub.endpoint))
    .maybeSingle();

  const { data: saved, error } = await admin.from('kc_member_push_subscriptions').upsert({
    person_id: person.person_id, endpoint: String(sub.endpoint), subscription: sub,
    user_agent: String(body.userAgent || '').slice(0, 500), quelle: String(body.quelle || '').slice(0, 60),
    active: true, updated_at: now,
  }, { onConflict: 'endpoint' }).select('id').single();
  if (error || !saved) return json({ ok: false, grund: 'speichern', detail: error?.message }, 500);

  if (action === 'ensure') {
    const hard = ['404', '410', '403'].includes(String(vorher?.last_error || ''));
    return json({ ok: true, active: true, repaired: !!vorher && (!vorher.active || hard) });
  }

  const { data: wahl } = await admin.from('kc_wm_spruch_zuordnung').select('spruch')
    .eq('person_id', person.person_id).maybeSingle();
  const text = wahl?.spruch
    ? `Hallo ${vorname}, ab jetzt bekommst du kurze Infos vom Köcheclub. Diesen Spruch hast du dir ausgesucht: „${wahl.spruch}“`
    : `Hallo ${vorname}, ab jetzt bekommst du kurze Infos vom Köcheclub – z. B. wenn sich dein Dienstplan ändert oder das nächste Treffen ansteht.`;
  const r = await senden(admin, { id: saved.id, subscription: sub }, person.person_id, 'push_bestaetigung', 'Köcheclub Werne – Push ist aktiv ✅', text);
  return json({ ok: r.status === 'sent', grund: r.status === 'sent' ? null : 'push_fehlgeschlagen', code: r.code });
});
