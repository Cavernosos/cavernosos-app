// Função da Vercel: liga o login com Google a um cadastro que já existe com o mesmo e-mail.
//
// Quando alguém entra com o Google pela primeira vez, o Firebase cria uma conta nova (outro uid),
// e o site não acharia o cadastro feito pelo admin. Esta função:
//   1. confere o token de quem chamou (conta Google, e-mail verificado);
//   2. procura em users um cadastro com o mesmo e-mail (já aprovado: ativo ou inativo, nunca pendente);
//   3. apaga a conta nova do Google (e o cadastro "aguardando aprovação" que ela possa ter criado);
//   4. liga o Google à conta antiga. Na próxima entrada com o Google, a pessoa cai no cadastro de sempre,
//      com o mesmo uid: votos, card, partidas e permissões continuam iguais. A senha, se houver, segue valendo.
//
// Precisa da conta de serviço do Firebase (Vercel → Settings → Environment Variables):
//   FIREBASE_SERVICE_ACCOUNT  o JSON inteiro gerado em Firebase Console → Configurações do projeto →
//                             Contas de serviço → Gerar nova chave privada
import {initializeApp, cert, getApps} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';

function admin(){
  if(!getApps().length) initializeApp({credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))});
  return {auth: getAuth(), db: getFirestore()};
}
const normEmail = s => String(s || '').trim().toLowerCase();
const status = u => u.status || (u.active === false ? 'inactive' : 'active');

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({error: 'Use POST.'});
  if(!process.env.FIREBASE_SERVICE_ACCOUNT) return res.status(501).json({error: 'not-configured'});
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if(!token) return res.status(400).json({error: 'Pedido inválido.'});

  try{
    const {auth, db} = admin();
    // 1. quem chamou: conta só com Google, e-mail verificado
    let decoded;
    try{ decoded = await auth.verifyIdToken(token); }
    catch(e){ return res.status(401).json({error: 'Login inválido.'}); }
    const gUid = decoded.uid;
    const gUser = await auth.getUser(gUid);
    const google = gUser.providerData.find(p=> p.providerId === 'google.com');
    if(!google || gUser.providerData.length !== 1) return res.status(200).json({linked: false, reason: 'not-google-only'});
    const email = normEmail(google.email || gUser.email);
    if(!email || !(gUser.emailVerified || decoded.email_verified)) return res.status(200).json({linked: false, reason: 'email-not-verified'});

    // a conta nova não pode ter cadastro de verdade: no máximo o "aguardando aprovação" criado pelo próprio Google
    const gDoc = await db.collection('users').doc(gUid).get();
    if(gDoc.exists){
      const g = gDoc.data();
      if(!(status(g) === 'pending' && g.selfRegistered && g.authProvider === 'google')){
        return res.status(200).json({linked: false, reason: 'has-profile'});
      }
    }

    // 2. cadastro já aprovado com o mesmo e-mail (um só, para não haver dúvida)
    const snap = await db.collection('users').where('email', '==', email).get();
    const found = snap.docs.filter(d=> d.id !== gUid && status(d.data()) !== 'pending');
    if(found.length !== 1) return res.status(200).json({linked: false, reason: found.length ? 'ambiguous' : 'no-match'});
    const target = found[0], old = target.data();
    let oldAuth;
    try{ oldAuth = await auth.getUser(target.id); }
    catch(e){ return res.status(200).json({linked: false, reason: 'no-auth-account'}); }
    if(oldAuth.providerData.some(p=> p.providerId === 'google.com')) return res.status(200).json({linked: false, reason: 'already-linked'});

    // 3. limpa a conta nova (cadastro pendente + nome de usuário reservado) e apaga o login dela
    if(gDoc.exists){
      const batch = db.batch();
      batch.delete(gDoc.ref);
      const logins = await db.collection('logins').where('uid', '==', gUid).get();
      logins.forEach(l=> batch.delete(l.ref));
      await batch.commit();
    }
    await auth.deleteUser(gUid);

    // 4. liga o Google à conta antiga
    await auth.updateUser(target.id, {
      providerToLink: {providerId: 'google.com', uid: google.uid, email, displayName: google.displayName || undefined, photoURL: google.photoURL || undefined},
    });
    const patch = {googleLinkedAt: new Date().toISOString(), googleEmail: email};
    if(!old.photoURL && google.photoURL) patch.photoURL = google.photoURL;
    await target.ref.update(patch);

    return res.status(200).json({linked: true, username: old.username});
  }catch(e){
    console.error(e);
    return res.status(500).json({error: 'Falha ao vincular a conta Google.'});
  }
}
