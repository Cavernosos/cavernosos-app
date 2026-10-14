// Service worker mínimo: habilita a instalação como app.
// Não guarda cache de propósito — o site sempre carrega a versão mais nova da rede.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cavernosos</title><body style="background:#000;color:#EDEAE3;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><h2>Sem conexão</h2><p>Conecte-se à internet para abrir o Cavernosos.</p></div>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )));
});
