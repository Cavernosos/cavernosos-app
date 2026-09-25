// Função da Vercel: gera o token de acesso da API da Ludopedia (fluxo OAuth, feito uma vez só).
//
// Passo a passo:
//   1. Em https://ludopedia.com.br/aplicativos crie um aplicativo com a URI de retorno
//      https://cavernosos.vercel.app/api/ludopedia-auth
//   2. Na Vercel, cadastre LUDOPEDIA_APP_ID e LUDOPEDIA_APP_KEY com os dados do aplicativo e faça um redeploy.
//   3. Abra https://cavernosos.vercel.app/api/ludopedia-auth, autorize na Ludopedia e copie o token exibido.
//   4. Cadastre o token como LUDOPEDIA_TOKEN na Vercel e faça outro redeploy.
const page = (title, body)=> `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#141210;color:#eee;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.5}
code,textarea{background:#221e19;color:#f2b705;padding:2px 6px}textarea{width:100%;height:90px;border:1px solid #444;padding:8px}a{color:#f2b705}</style></head>
<body><h1>${title}</h1>${body}</body></html>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export default async function handler(req, res){
  const appId = process.env.LUDOPEDIA_APP_ID, appKey = process.env.LUDOPEDIA_APP_KEY;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if(!appId || !appKey){
    return res.status(500).send(page('Falta configurar', '<p>Cadastre <code>LUDOPEDIA_APP_ID</code> e <code>LUDOPEDIA_APP_KEY</code> na Vercel (Settings → Environment Variables) e faça um redeploy.</p>'));
  }
  const redirect = `https://${req.headers.host}/api/ludopedia-auth`;
  const code = req.query.code;
  if(!code){
    const url = `https://ludopedia.com.br/oauth?app_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirect)}`;
    res.writeHead(302, {Location: url});
    return res.end();
  }
  try{
    // a Ludopedia aceita os dados em JSON; se recusar, tenta como formulário
    const body = {code, app_id: appId, app_key: appKey, redirect_uri: redirect};
    let r = await fetch('https://ludopedia.com.br/tokenrequest/', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    let data = await r.json().catch(()=> ({}));
    if(!data.access_token){
      r = await fetch('https://ludopedia.com.br/tokenrequest/', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(body)});
      data = await r.json().catch(()=> ({}));
    }
    if(!data.access_token) throw new Error(JSON.stringify(data).slice(0, 300) || `status ${r.status}`);
    return res.status(200).send(page('Token da Ludopedia gerado',
      `<p>Copie o token abaixo e cadastre na Vercel como <code>LUDOPEDIA_TOKEN</code>. Depois faça um redeploy.</p>
       <textarea readonly onclick="this.select()">${esc(data.access_token)}</textarea>
       <p>Não compartilhe este token. Depois de cadastrar, pode fechar esta página.</p>`));
  }catch(e){
    console.error(e);
    return res.status(500).send(page('Não deu certo', `<p>A Ludopedia não devolveu o token.</p><p><code>${esc(e.message)}</code></p>`));
  }
}
