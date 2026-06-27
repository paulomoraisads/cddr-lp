// Cloudflare Pages Function — Receptor de Webhook da Hotmart (v2.0.0)
// Recebe a notificação de venda, valida o Hottok e dispara o evento Purchase
// pra Meta Conversions API (mesmo pixel da LP), com advanced matching.
//
// URL do webhook na Hotmart: https://codigodasduasrodas.pages.dev/hotmart
// Secrets necessários (Cloudflare Pages): HOTMART_HOTTOK, META_CAPI_TOKEN

const PIXEL_ID = '969317068370656';
const API_VERSION = 'v21.0';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const raw = await request.text();
    let body;
    try { body = JSON.parse(raw); } catch { body = {}; }

    // --- Valida o Hottok (header X-HOTMART-HOTTOK ou no corpo) ---
    const hottok = request.headers.get('X-HOTMART-HOTTOK') || body.hottok || '';
    if (env.HOTMART_HOTTOK && hottok !== env.HOTMART_HOTTOK) {
      return json({ ok: false, error: 'hottok inválido' }, 401);
    }

    const event = body.event || '';
    const data = body.data || {};

    // Só dispara Purchase em "Compra aprovada" (evita duplicar com outros eventos).
    if (event !== 'PURCHASE_APPROVED') {
      return json({ ok: true, ignored: event || 'sem evento' }, 200);
    }

    const buyer = data.buyer || {};
    const purchase = data.purchase || {};
    const product = data.product || {};
    const price = purchase.price || purchase.full_price || {};

    const value = Number(price.value || 0);
    const currency = (price.currency_value || 'BRL');

    // event_time = data de aprovação (ms → s). Cai pra agora se ausente.
    const approvedMs = purchase.approved_date || purchase.order_date || Date.now();
    const event_time = Math.floor(Number(approvedMs) / 1000);

    // event_id = id da transação → dedup se a Hotmart reenviar o mesmo evento.
    const event_id = 'hm-' + (purchase.transaction || body.id || String(approvedMs));

    // --- Advanced matching (hasheado SHA-256) ---
    const user_data = {};
    const email = (buyer.email || '').trim().toLowerCase();
    if (email) user_data.em = [await sha256(email)];

    const phoneDigits = onlyDigits(buyer.checkout_phone || buyer.phone || '');
    if (phoneDigits) user_data.ph = [await sha256(normalizePhone(phoneDigits))];

    const fullName = (buyer.name || '').trim().toLowerCase();
    if (fullName) {
      const parts = fullName.split(/\s+/);
      user_data.fn = [await sha256(parts[0])];
      if (parts.length > 1) user_data.ln = [await sha256(parts[parts.length - 1])];
    }

    const metaEvent = {
      event_name: 'Purchase',
      event_time,
      event_id,
      action_source: 'website',
      event_source_url: 'https://codigodasduasrodas.pages.dev/',
      user_data,
      custom_data: {
        currency,
        value,
        content_name: product.name || 'Código das Duas Rodas',
        content_type: 'product'
      }
    };

    const token = env.META_CAPI_TOKEN;
    if (!token) return json({ ok: false, error: 'META_CAPI_TOKEN não configurado' }, 200);

    const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [metaEvent] })
    });
    const result = await res.json();

    return json({ ok: true, event_id, value, meta: result }, 200);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 200);
  }
}

// Hotmart pode fazer um GET de teste ao salvar o webhook.
export async function onRequestGet() {
  return json({ ok: true, msg: 'Webhook CDDR ativo' }, 200);
}

function onlyDigits(s) { return String(s).replace(/\D/g, ''); }

// Garante DDI 55 (Brasil) se vier sem.
function normalizePhone(d) {
  if (d.length <= 11 && !d.startsWith('55')) return '55' + d;
  return d;
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
