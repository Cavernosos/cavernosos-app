// Função da Vercel: consulta a API da Ludopedia para preencher a ficha dos jogos.
//
//   GET /api/ludopedia?search=catan  → {jogos: [{id, name, year, thumb}]}
//   GET /api/ludopedia?id=123        → {jogo: {name, year, minPlayers, maxPlayers, time, minAge, publisher,
//                                              designers, mechanics, categories, type, url, image}}
//
// Segurança: só usuários ativos do site (com permissão de cadastrar ou editar jogos) podem usar.
// O token da Ludopedia fica só no servidor.
//
// Variável de ambiente (Vercel → Settings → Environment Variables):
//   LUDOPEDIA_TOKEN   access_token gerado em /api/ludopedia-auth (veja o arquivo ludopedia-auth.js)
const PROJECT_ID = 'pelada-cavernosos';
const API_KEY = 'AIzaSyDciHxLskZdyZ9nWzSAwFmjvwJ2YT26G8A'; // chave pública do app web
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const LUDO = 'https://ludopedia.com.br/api/v1';

async function caller(token){
  const lookup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({idToken: token}),
  });
  if(!lookup.ok) return null;
  const uid = (await lookup.json()).users?.[0]?.localId;
  if(!uid) return null;
  const r = await fetch(`${FIRESTORE}/users/${uid}`, {headers: {Authorization: `Bearer ${token}`}});
  if(!r.ok) return null;
  const f = (await r.json()).fields || {};
  return {
    active: f.active?.booleanValue === true,
    admin: f.role?.stringValue === 'admin',
    perms: (f.perms?.arrayValue?.values || []).map(v=> v.stringValue),
  };
}

// A Ludopedia devolve listas de objetos ({id_mecanica, nm_mecanica}); pega o texto de cada um.
const names = list => (Array.isArray(list) ? list : []).map(x=>
  typeof x === 'string' ? x : x && (Object.entries(x).find(([k, v])=> k.startsWith('nm_') && typeof v === 'string') || [])[1]
).filter(Boolean);
const first = (obj, keys)=> { for(const k of keys) if(obj[k] != null && obj[k] !== '') return obj[k]; return null; };
const int = v => v == null || v === '' || isNaN(v) ? null : Number(v);

async function ludo(path){
  const r = await fetch(LUDO + path, {headers: {Authorization: `Bearer ${process.env.LUDOPEDIA_TOKEN}`}});
  if(r.status === 401 || r.status === 403) throw Object.assign(new Error('O token da Ludopedia expirou ou é inválido. Gere outro em /api/ludopedia-auth.'), {status: 502});
  if(!r.ok) throw Object.assign(new Error(`A Ludopedia respondeu com erro (${r.status}).`), {status: 502});
  return r.json();
}

export default async function handler(req, res){
  if(req.method !== 'GET') return res.status(405).json({error: 'Use GET.'});
  if(!process.env.LUDOPEDIA_TOKEN){
    return res.status(500).json({error: 'A busca na Ludopedia ainda não foi configurada (falta o LUDOPEDIA_TOKEN na Vercel).'});
  }
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const who = token && await caller(token).catch(()=> null);
  if(!who || !who.active) return res.status(401).json({error: 'Faça login de novo.'});
  if(!who.admin && !who.perms.includes('bg.games.create') && !who.perms.includes('bg.games.edit')){
    return res.status(403).json({error: 'Sem permissão para cadastrar jogos.'});
  }

  try{
    const {search, id} = req.query;
    if(search){
      const data = await ludo(`/jogos?search=${encodeURIComponent(String(search).slice(0, 80))}&rows=20`);
      const jogos = (data.jogos || data || []).map(j=> ({
        id: j.id_jogo, name: j.nm_jogo, year: first(j, ['ano_publicacao']),
        thumb: first(j, ['thumb', 'link_thumb', 'img_jogo']),
      }));
      return res.status(200).json({jogos});
    }
    if(id && /^\d{1,9}$/.test(String(id))){
      const j = await ludo(`/jogos/${id}`);
      const thumb = first(j, ['thumb', 'link_thumb', 'img_jogo', 'imagem']);
      // a imagem vem pelo servidor, em base64, para o navegador conseguir redimensionar (sem bloqueio de CORS)
      let image = null;
      if(thumb){
        try{
          const ir = await fetch(thumb);
          if(ir.ok){
            const type = ir.headers.get('content-type') || 'image/jpeg';
            image = `data:${type};base64,${Buffer.from(await ir.arrayBuffer()).toString('base64')}`;
          }
        }catch(e){ /* sem capa, segue o resto da ficha */ }
      }
      const tp = String(first(j, ['tp_jogo']) || '').toLowerCase();
      return res.status(200).json({jogo: {
        id: j.id_jogo, name: j.nm_jogo, year: int(first(j, ['ano_publicacao'])),
        minPlayers: int(first(j, ['qt_jogadores_min'])), maxPlayers: int(first(j, ['qt_jogadores_max'])),
        time: int(first(j, ['vl_tempo_jogo'])), minAge: int(first(j, ['idade_minima'])),
        publisher: names(j.editoras)[0] || first(j, ['nm_editora']) || '',
        designers: names(j.designers), mechanics: names(j.mecanicas), categories: names(j.categorias),
        type: tp.startsWith('e') ? 'expansao' : 'base',
        url: first(j, ['link']) || `https://ludopedia.com.br/jogo/${j.id_jogo}`,
        image,
      }});
    }
    return res.status(400).json({error: 'Informe search ou id.'});
  }catch(e){
    console.error(e);
    return res.status(e.status || 500).json({error: e.message || 'Falha ao consultar a Ludopedia.'});
  }
}
