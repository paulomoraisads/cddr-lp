// Cloudflare Pages Function — Meta Conversions API (CAPI)
// Recebe eventos do navegador e envia server-side pra Meta, com o mesmo event_id (dedup).
// O token fica em variável secreta (env.META_CAPI_TOKEN), nunca no código público.

const PIXEL_ID = '969317068370656';
const API_VERSION = 'v21.0';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const token = env.META_CAPI_TOKEN;
    if (!token) {
      return json({ error: 'META_CAPI_TOKEN não configurado' }, 200);
    }

    const user_data = {};

    // Eventos do navegador: anexa IP/UA reais do visitante.
    // Eventos manuais/server (body.manual=true): NÃO usa IP/UA do servidor
    // (seria o IP do Cloudflare, não o do comprador) — usa só advanced matching.
    if (!body.manual) {
      user_data.client_ip_address = request.headers.get('CF-Connecting-IP') || '';
      user_data.client_user_agent = request.headers.get('User-Agent') || '';
    }
    if (body.fbp) user_data.fbp = body.fbp;
    if (body.fbc) user_data.fbc = body.fbc;

    // Advanced matching (já hasheado SHA-256 pelo emissor): em, ph, fn, ln
    for (const k of ['em', 'ph', 'fn', 'ln']) {
      if (body[k]) user_data[k] = Array.isArray(body[k]) ? body[k] : [body[k]];
    }

    const event = {
      event_name: body.event_name,
      event_time: body.event_time || Math.floor(Date.now() / 1000),
      event_id: body.event_id,
      event_source_url: body.event_source_url,
      action_source: body.action_source || 'website',
      user_data,
      custom_data: body.custom_data || {}
    };

    const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [event] })
    });
    const result = await res.json();
    return json(result, 200);
  } catch (e) {
    return json({ error: String(e) }, 200);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
