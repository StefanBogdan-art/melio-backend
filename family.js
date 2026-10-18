// ═══════════════════════════════════════════════════════════════
// MELIO — family.js  (Express Router: /api/family/*)
// Deploy pe Render: pune fișierul lângă server.js
// Adaugă în server.js (înainte de app.listen):
//   app.use('/api/family', require('./family'));
// ═══════════════════════════════════════════════════════════════

'use strict';
const express = require('express');
const router  = express.Router();
const { createClient } = require('@supabase/supabase-js');

// ── Supabase client (service key — doar pe backend!) ────────────
const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// ── Firebase Admin (lazy init) ──────────────────────────────────
let _admin = null;
function getMessaging() {
  if (_admin) return _admin.messaging();
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) {
    console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT lipsă — notificările push sunt dezactivate');
    return null;
  }
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccount))
      });
    }
    _admin = admin;
    return admin.messaging();
  } catch (e) {
    console.error('❌ Firebase init failed:', e.message);
    return null;
  }
}

// ── Helper: trimite notificare push celorlalți membri ───────────
async function notifyOthers(householdId, senderName, title, body) {
  const messaging = getMessaging();
  if (!messaging) return;

  try {
    const { data: members } = await db
      .from('household_members')
      .select('fcm_token, user_name')
      .eq('household_id', householdId)
      .neq('user_name', senderName)
      .not('fcm_token', 'is', null);

    if (!members || !members.length) return;

    const tokens = members.map(m => m.fcm_token).filter(Boolean);
    if (!tokens.length) return;

    const message = {
      notification: { title, body },
      android: {
        notification: {
          channelId: 'melio_v2',
          sound: 'melio_chime',
          priority: 'high'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'melio_notif.caf',
            badge: 1
          }
        }
      },
      tokens
    };

    const result = await messaging.sendEachForMulticast(message);
    console.log(`📬 Notificări trimise: ${result.successCount}/${tokens.length} succese`);
  } catch (e) {
    console.error('❌ notifyOthers:', e.message);
  }
}

// ════════════════════════════════════════════════════════════════
// POST /api/family/create
// Body: { user_name, user_avatar?, household_name?, fcm_token? }
// ════════════════════════════════════════════════════════════════
router.post('/create', async (req, res) => {
  try {
    const { user_name, user_avatar = '👤', household_name = 'Casa mea', fcm_token } = req.body;
    if (!user_name) return res.status(400).json({ error: 'user_name este obligatoriu' });

    // Generează cod 6 cifre unic
    let code, exists = true;
    while (exists) {
      code = Math.floor(100000 + Math.random() * 900000).toString();
      const { data } = await db.from('households').select('id').eq('code', code).single();
      exists = !!data;
    }

    // Creează gospodăria
    const { data: hh, error: hhErr } = await db
      .from('households')
      .insert({ code, name: household_name })
      .select()
      .single();
    if (hhErr) throw hhErr;

    // Adaugă primul membru
    const { error: memErr } = await db
      .from('household_members')
      .insert({ household_id: hh.id, user_name, user_avatar, fcm_token: fcm_token || null });
    if (memErr) throw memErr;

    console.log(`🏠 Gospodărie creată: ${code} de ${user_name}`);
    res.json({ household_id: hh.id, code: hh.code, name: hh.name });
  } catch (e) {
    console.error('❌ /create:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/family/join
// Body: { code, user_name, user_avatar?, fcm_token? }
// ════════════════════════════════════════════════════════════════
router.post('/join', async (req, res) => {
  try {
    const { code, user_name, user_avatar = '👤', fcm_token } = req.body;
    if (!code || !user_name) return res.status(400).json({ error: 'code și user_name sunt obligatorii' });

    // Găsește gospodăria
    const { data: hh, error: hhErr } = await db
      .from('households')
      .select('*')
      .eq('code', code.trim())
      .single();
    if (hhErr || !hh) return res.status(404).json({ error: 'Cod invalid — gospodăria nu există' });

    // Verifică dacă userul există deja (re-join după reinstalare)
    const { data: existing } = await db
      .from('household_members')
      .select('id')
      .eq('household_id', hh.id)
      .eq('user_name', user_name)
      .single();

    if (existing) {
      // Actualizează FCM token dacă s-a schimbat
      if (fcm_token) {
        await db.from('household_members')
          .update({ fcm_token })
          .eq('id', existing.id);
      }
    } else {
      // Adaugă noul membru
      const { error: memErr } = await db
        .from('household_members')
        .insert({ household_id: hh.id, user_name, user_avatar, fcm_token: fcm_token || null });
      if (memErr) throw memErr;

      // Notifică ceilalți membri
      await notifyOthers(hh.id, user_name, '🏠 Melio Frigider', `${user_name} s-a alăturat gospodăriei!`);
    }

    console.log(`🤝 ${user_name} s-a alăturat: ${code}`);
    res.json({ household_id: hh.id, code: hh.code, name: hh.name });
  } catch (e) {
    console.error('❌ /join:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/family/:id/shopping
// ════════════════════════════════════════════════════════════════
router.get('/:id/shopping', async (req, res) => {
  try {
    const { data, error } = await db
      .from('shopping_items')
      .select('*')
      .eq('household_id', req.params.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/family/:id/shopping
// Body: { name, emoji?, quantity?, added_by }
// ════════════════════════════════════════════════════════════════
router.post('/:id/shopping', async (req, res) => {
  try {
    const { name, emoji = '🛒', quantity, added_by } = req.body;
    if (!name || !added_by) return res.status(400).json({ error: 'name și added_by sunt obligatorii' });

    const { data, error } = await db
      .from('shopping_items')
      .insert({ household_id: req.params.id, name, emoji, quantity: quantity || null, added_by })
      .select()
      .single();
    if (error) throw error;

    // Notifică ceilalți
    await notifyOthers(
      req.params.id, added_by,
      '🛒 Listă cumpărături',
      `${added_by} a adăugat: ${emoji} ${name}`
    );

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// PATCH /api/family/:id/shopping/:itemId
// Body: { checked, checked_by } sau { name, emoji, quantity }
// ════════════════════════════════════════════════════════════════
router.patch('/:id/shopping/:itemId', async (req, res) => {
  try {
    const { checked, checked_by, name, emoji, quantity, later } = req.body;
    const updates = {};

    if (typeof checked !== 'undefined') {
      updates.checked    = checked;
      updates.checked_by = checked ? (checked_by || null) : null;
      updates.checked_at = checked ? new Date().toISOString() : null;
    }
    if (typeof later !== 'undefined') updates.later = !!later;
    if (name)     updates.name     = name;
    if (emoji)    updates.emoji    = emoji;
    if (quantity) updates.quantity = quantity;

    const { data, error } = await db
      .from('shopping_items')
      .update(updates)
      .eq('id', req.params.itemId)
      .eq('household_id', req.params.id)
      .select()
      .single();
    if (error) throw error;

    // Notifică dacă a bifat/debifat
    if (typeof checked !== 'undefined' && checked_by) {
      const action = checked ? 'a bifat' : 'a debifat';
      await notifyOthers(
        req.params.id, checked_by,
        '🛒 Listă cumpărături',
        `${checked_by} ${action}: ${data.emoji} ${data.name}`
      );
    }

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// DELETE /api/family/:id/shopping/:itemId
// Query: ?deleted_by=NumeUser
// ════════════════════════════════════════════════════════════════
router.delete('/:id/shopping/:itemId', async (req, res) => {
  try {
    const { deleted_by } = req.query;

    // Ia numele produsului înainte de ștergere
    const { data: item } = await db
      .from('shopping_items')
      .select('name, emoji')
      .eq('id', req.params.itemId)
      .single();

    const { error } = await db
      .from('shopping_items')
      .delete()
      .eq('id', req.params.itemId)
      .eq('household_id', req.params.id);
    if (error) throw error;

    if (deleted_by && item) {
      await notifyOthers(
        req.params.id, deleted_by,
        '🛒 Listă cumpărături',
        `${deleted_by} a șters: ${item.emoji} ${item.name}`
      );
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/family/:id/members
// ════════════════════════════════════════════════════════════════
router.get('/:id/members', async (req, res) => {
  try {
    const { data, error } = await db
      .from('household_members')
      .select('id, user_name, user_avatar, joined_at')
      .eq('household_id', req.params.id)
      .order('joined_at', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// PATCH /api/family/:id/fcm
// Body: { user_name, fcm_token }
// ════════════════════════════════════════════════════════════════
router.patch('/:id/fcm', async (req, res) => {
  try {
    const { user_name, fcm_token } = req.body;
    if (!user_name || !fcm_token) return res.status(400).json({ error: 'user_name și fcm_token sunt obligatorii' });

    const { error } = await db
      .from('household_members')
      .update({ fcm_token })
      .eq('household_id', req.params.id)
      .eq('user_name', user_name);
    if (error) throw error;

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/family/:id/chat
// Query: ?before=<ISO timestamp>&limit=50  (paginare opțională)
// ════════════════════════════════════════════════════════════════
router.get('/:id/chat', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    let q = db
      .from('chat_messages')
      .select('*')
      .eq('household_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (req.query.before) q = q.lt('created_at', req.query.before);

    const { data, error } = await q;
    if (error) throw error;

    res.json((data || []).reverse());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/family/:id/chat
// Body: { user_name, user_avatar?, message }
// ════════════════════════════════════════════════════════════════
router.post('/:id/chat', async (req, res) => {
  try {
    const { user_name, user_avatar = '👤', message } = req.body;
    if (!user_name || !message || !message.trim()) {
      return res.status(400).json({ error: 'user_name și message sunt obligatorii' });
    }

    const { data, error } = await db
      .from('chat_messages')
      .insert({
        household_id: req.params.id,
        user_name,
        user_avatar,
        message: message.trim().substring(0, 1000)
      })
      .select()
      .single();
    if (error) throw error;

    // Notifică ceilalți membri (mesaj scurt, fără conținut complet pt. discreție)
    await notifyOthers(
      req.params.id, user_name,
      '💬 ' + user_name,
      message.trim().length > 60 ? message.trim().substring(0, 57) + '...' : message.trim()
    );

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
