// Função da Vercel: envia o e-mail de "cadastro aprovado".
//
// Segurança: quem chama precisa mandar o token de login do Firebase. A função
// confere o token, lê o cadastro de quem chamou e só continua se for um Admin
// ativo. O destinatário vem do cadastro aprovado no banco (não do pedido), então
// ninguém consegue usar esta função para mandar e-mail para qualquer endereço.
//
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   GMAIL_USER          conta Gmail que envia (ex.: peladacavernosos@gmail.com)
//   GMAIL_APP_PASSWORD  senha de app dessa conta (16 letras, gerada no Google)
import nodemailer from 'nodemailer';

const PROJECT_ID = 'pelada-cavernosos';
const API_KEY = 'AIzaSyDciHxLskZdyZ9nWzSAwFmjvwJ2YT26G8A'; // chave pública do app web
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Converte um documento do Firestore REST ({fields:{x:{stringValue}}}) em objeto simples.
function plain(doc){
  const out = {};
  for(const [k, v] of Object.entries(doc.fields || {})){
    out[k] = v.stringValue ?? v.booleanValue ?? v.integerValue ?? v.timestampValue ?? null;
  }
  return out;
}
async function getDoc(path, token){
  const r = await fetch(`${FIRESTORE}/${path}`, {headers: {Authorization: `Bearer ${token}`}});
  if(r.status === 404) return null;
  if(!r.ok) throw new Error(`firestore ${r.status}`);
  return plain(await r.json());
}
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({error: 'Use POST.'});
  if(!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD){
    return res.status(500).json({error: 'Envio de e-mail não configurado (GMAIL_USER / GMAIL_APP_PASSWORD).'});
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const userId = body.userId;
  if(!token || !userId || !/^[A-Za-z0-9]{10,40}$/.test(userId)){
    return res.status(400).json({error: 'Pedido inválido.'});
  }

  try{
    // 1. O token é válido? De quem é?
    const lookup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({idToken: token}),
    });
    if(!lookup.ok) return res.status(401).json({error: 'Login inválido.'});
    const callerUid = (await lookup.json()).users?.[0]?.localId;
    if(!callerUid) return res.status(401).json({error: 'Login inválido.'});

    // 2. Quem chamou é Admin ativo?
    const caller = await getDoc(`users/${callerUid}`, token);
    if(!caller || caller.role !== 'admin' || caller.active !== true){
      return res.status(403).json({error: 'Só administradores podem aprovar cadastros.'});
    }

    // 3. O cadastro existe, está ativo e ainda não recebeu o aviso?
    const user = await getDoc(`users/${userId}`, token);
    if(!user || user.active !== true || !user.email){
      return res.status(400).json({error: 'Cadastro não encontrado ou ainda não aprovado.'});
    }
    if(user.approvalEmailSentAt){
      return res.status(200).json({ok: true, alreadySent: true});
    }

    // 4. Envia o e-mail
    const approver = user.approvedBy || caller.username;
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD},
    });
    await transporter.sendMail({
      from: `"Cavernosos" <${process.env.GMAIL_USER}>`,
      to: user.email,
      subject: 'Seu cadastro no site dos Cavernosos foi aprovado',
      text: `Olá, ${user.username}!\n\n${approver} (admin) aprovou seu cadastro no site dos Cavernosos.\n\nJá pode entrar com seu usuário e senha: ${origin}\n\nToda quinta, 21h às 22h30 · Sargento Wolf, Afogados`,
      html: `
        <div style="font-family:Arial,sans-serif; background:#12100D; padding:32px 16px;">
          <div style="max-width:480px; margin:0 auto; background:#1B1712; border:1px solid #372C1B; padding:28px; color:#EDEAE3;">
            <div style="color:#F2B705; font-size:12px; letter-spacing:2px; text-transform:uppercase;">Toda quinta</div>
            <h1 style="margin:4px 0 20px; font-size:24px; letter-spacing:1px; text-transform:uppercase;">Cavernosos</h1>
            <p style="font-size:15px; line-height:1.5;">Olá, <b>${escapeHtml(user.username)}</b>!</p>
            <p style="font-size:15px; line-height:1.5;"><b>${escapeHtml(approver)}</b> (admin) aprovou seu cadastro no site dos Cavernosos.</p>
            <p style="font-size:15px; line-height:1.5;">Já pode entrar com seu usuário e senha.</p>
            <p style="margin:24px 0;"><a href="${escapeHtml(origin)}" style="background:#F2B705; color:#191305; padding:12px 20px; text-decoration:none; font-weight:bold;">Entrar no site</a></p>
            <p style="font-size:12px; color:#A79C87;">Quinta-feira, 21h às 22h30 · Sargento Wolf, Afogados</p>
          </div>
        </div>`,
    });

    // 5. Marca como enviado (evita e-mail repetido). Se falhar, o e-mail já foi.
    await fetch(`${FIRESTORE}/users/${userId}?updateMask.fieldPaths=approvalEmailSentAt`, {
      method: 'PATCH',
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({fields: {approvalEmailSentAt: {stringValue: new Date().toISOString()}}}),
    }).catch(()=>{});

    return res.status(200).json({ok: true});
  }catch(e){
    console.error(e);
    return res.status(500).json({error: 'Falha ao enviar o e-mail.'});
  }
}
