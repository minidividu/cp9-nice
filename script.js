// --- CONFIGURATION ---
const SUPABASE_URL = 'https://qqtbaxaomrophaiszwtr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_SqgX_Vzxas58tEQwuvlUaQ_TrXaMNWd';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null, isAdmin = false, allCardsCache = [], ownedIds = [];

// --- 1. INITIALISATION ---
async function initApp() {
    const { data: { session } } = await supabase.auth.getSession();
    currentUser = session?.user || null;
    
    if (currentUser) {
        const { data: p } = await supabase.from('profiles').select('is_admin').eq('id', currentUser.id).single();
        isAdmin = p?.is_admin || false;
    }
    
    updateAuthUI();
    await renderAll();

    const pendingTicket = sessionStorage.getItem('pending_ticket');
    if (pendingTicket && currentUser) {
        sessionStorage.removeItem('pending_ticket');
        await processTicket(pendingTicket);
    } else {
        await checkScanTicket();
    }
}

// --- 2. AFFICHAGE DE LA COLLECTION ---
async function renderAll(filterBarId = null) {
    if (allCardsCache.length === 0) {
        const { data } = await supabase.from('cards').select('*').order('slot_index');
        allCardsCache = data || [];
    }

    if (currentUser) {
        const { data } = await supabase.from('user_cards').select('card_id').eq('user_id', currentUser.id);
        ownedIds = data ? data.map(c => c.card_id) : [];
    }

    const grids = { 
        puzzle: document.getElementById('grid-puzzle'), 
        rare: document.getElementById('grid-rare'), 
        bar: document.getElementById('grid-bar') 
    };
    
    Object.values(grids).forEach(g => { if(g) g.innerHTML = ''; });

    const toDisplay = filterBarId ? allCardsCache.filter(c => c.bar_id === filterBarId || c.type === 'bar') : allCardsCache;

    toDisplay.forEach(card => {
        const active = ownedIds.includes(card.id);
        const div = document.createElement('div');
        div.className = `card-item ${active ? 'active' : 'locked'} type-${card.type}`;
        
        // AMÉLIORATION : Mapping intelligent de l'image
        let imgSrc = `https://via.placeholder.com/300/111/d4af37?text=${card.name.split(' ')[0]}`;
        const normalizedName = card.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        if (normalizedName.includes('riquiert')) {
            imgSrc = 'yavsaintriquier.png';
        }

        div.innerHTML = `
            <span class="rarity-tag ${card.type}">${card.type}</span>
            <div class="img-container">
                <img src="${imgSrc}" onerror="this.src='https://via.placeholder.com/300/111/333?text=CARTE'">
            </div>
            <div class="card-label">${card.name} ${active ? '✅' : '🔒'}</div>
        `;

        if (card.type === 'bar') div.onclick = () => renderAll(card.id);
        if (grids[card.type]) grids[card.type].appendChild(div);
    });

    if(document.getElementById('count')) document.getElementById('count').innerText = ownedIds.length;
    renderRewards();
}

// --- 3. LOGIQUE DU SCAN ---
async function checkScanTicket() {
    const code = new URLSearchParams(window.location.search).get('ticket');
    if (code) await processTicket(code);
}

async function processTicket(code) {
    if (!currentUser) {
        sessionStorage.setItem('pending_ticket', code);
        openRegister();
        return;
    }

    const { data: ticket, error } = await supabase
        .from('qr_tickets')
        .select('*, cards(*)')
        .eq('id', code)
        .single();

    if (error || !ticket) return alert("Ticket invalide ou expiré.");

    if (ownedIds.includes(ticket.card_id)) {
        alert("Vous avez déjà cette carte !");
        cleanUrl();
        return;
    }

    const { error: insErr } = await supabase
        .from('user_cards')
        .insert([{ user_id: currentUser.id, card_id: ticket.card_id }]);

    if (!insErr) {
        if (ticket.cards?.type === 'rare') {
            await supabase.from('rewards').insert([{ user_id: currentUser.id, type: 'VERRE OFFERT' }]);
        }
        runConfetti();
        showCardReveal(ticket.cards);
        await renderAll();
        cleanUrl();
    } else {
        alert("Erreur : " + insErr.message);
    }
}

function cleanUrl() { window.history.replaceState({}, '', window.location.pathname); }

// --- 4. AUTHENTIFICATION ---
function toggleAuthMode() {
    const signupForm = document.getElementById('signup-form');
    const loginForm = document.getElementById('login-form');
    const title = document.getElementById('auth-title');
    const errorDiv = document.getElementById('auth-error');

    errorDiv.style.display = 'none';
    errorDiv.innerHTML = '';

    if (signupForm.style.display === 'none') {
        signupForm.style.display = 'block';
        loginForm.style.display = 'none';
        title.textContent = 'REJOINDRE LA SQUADRA';
    } else {
        signupForm.style.display = 'none';
        loginForm.style.display = 'block';
        title.textContent = 'SE CONNECTER';
    }
}

function showAuthError(message) {
    const errorDiv = document.getElementById('auth-error');
    errorDiv.innerHTML = message;
    errorDiv.style.display = 'block';
    errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function handleSignup() {
    const email = document.getElementById('reg-email').value.trim();
    const pass = document.getElementById('reg-pass').value;
    const passConfirm = document.getElementById('reg-pass-confirm').value;
    const btn = document.getElementById('signup-btn');

    if (!email) return showAuthError('Veuillez entrer un email valide.');
    if (!email.includes('@')) return showAuthError('L\'email n\'est pas valide.');
    if (pass.length < 6) return showAuthError('Le mot de passe doit faire au moins 6 caractères.');
    if (pass !== passConfirm) return showAuthError('Les mots de passe ne correspondent pas.');

    btn.disabled = true;
    btn.textContent = 'INSCRIPTION EN COURS...';

    try {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password: pass });

        if (signUpError) {
            if (signUpError.message.includes('already registered')) {
                showAuthError('Cet email est déjà inscrit. Essaye de te connecter !');
            } else if (signUpError.message.includes('Password')) {
                showAuthError('Le mot de passe ne respecte pas les critères de sécurité.');
            } else {
                showAuthError(`Erreur d'inscription : ${signUpError.message}`);
            }
            btn.disabled = false;
            btn.textContent = 'S\'INSCRIRE';
            return;
        }

        showAuthError('✅ Inscription réussie ! Tu peux maintenant te connecter.');
        setTimeout(() => toggleAuthMode(), 1500);
        document.getElementById('reg-email').value = '';
        document.getElementById('reg-pass').value = '';
        document.getElementById('reg-pass-confirm').value = '';
        btn.disabled = false;
        btn.textContent = 'S\'INSCRIRE';
    } catch (err) {
        showAuthError(`Erreur inattendue : ${err.message}`);
        btn.disabled = false;
        btn.textContent = 'S\'INSCRIRE';
    }
}

async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value;
    const btn = document.getElementById('login-btn');

    if (!email) return showAuthError('Veuillez entrer votre email.');
    if (!pass) return showAuthError('Veuillez entrer votre mot de passe.');

    btn.disabled = true;
    btn.textContent = 'CONNEXION EN COURS...';

    try {
        const { data, error: loginError } = await supabase.auth.signInWithPassword({ email, password: pass });

        if (loginError) {
            if (loginError.message.includes('Invalid login credentials')) {
                showAuthError('Email ou mot de passe incorrect.');
            } else if (loginError.message.includes('Email not confirmed')) {
                showAuthError('Veuillez confirmer votre email avant de vous connecter.');
            } else {
                showAuthError(`Erreur de connexion : ${loginError.message}`);
            }
            btn.disabled = false;
            btn.textContent = 'SE CONNECTER';
            return;
        }

        showAuthError('✅ Connexion réussie ! Chargement de ta collection...');
        setTimeout(() => {
            location.reload();
        }, 1000);
    } catch (err) {
        showAuthError(`Erreur inattendue : ${err.message}`);
        btn.disabled = false;
        btn.textContent = 'SE CONNECTER';
    }
}

// --- 5. UI & ANIMATIONS ---
function updateAuthUI() {
    const ctrl = document.getElementById('auth-controls');
    if (currentUser) {
        const userEmail = currentUser.email || 'Utilisateur';
        ctrl.innerHTML = `
            <div style="display: flex; gap: 10px; align-items: center;">
                <span class="small-text" style="color: #999;">${userEmail}</span>
                <button class="pill" onclick="supabase.auth.signOut().then(()=>location.reload())">DÉCONNEXION</button>
            </div>
        `;
    } else {
        ctrl.innerHTML = `<button class="pill gold" onclick="openAuthModal()">REJOINDRE</button>`;
    }
}

function openAuthModal() {
    document.getElementById('auth-modal').style.display = 'flex';
    document.getElementById('signup-form').style.display = 'block';
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('auth-title').textContent = 'REJOINDRE LA SQUADRA';
    document.getElementById('auth-error').style.display = 'none';
    document.getElementById('auth-error').innerHTML = '';
}

function closeAuthModal() {
    document.getElementById('auth-modal').style.display = 'none';
    document.getElementById('reg-email').value = '';
    document.getElementById('reg-pass').value = '';
    document.getElementById('reg-pass-confirm').value = '';
    document.getElementById('login-email').value = '';
    document.getElementById('login-pass').value = '';
    document.getElementById('auth-error').innerHTML = '';
}
function showReward(msg) {
    document.getElementById('reward-desc').innerText = `Gagné : ${msg}`;
    document.getElementById('reward-overlay').style.display = 'flex';
}
function closeOverlay() { document.getElementById('reward-overlay').style.display = 'none'; }

function showCardReveal(card) {
    const modal = document.getElementById('card-reveal-modal');
    const revealImg = document.getElementById('reveal-img');
    const revealName = document.getElementById('reveal-name');
    const revealRarity = document.getElementById('reveal-rarity');
    const revealMessage = document.getElementById('reveal-message');

    let imgSrc = `https://via.placeholder.com/300/111/d4af37?text=${card.name.split(' ')[0]}`;
    const normalizedName = card.name.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (normalizedName.includes('riquiert')) {
        imgSrc = 'yavsaintriquier.png';
    }

    revealImg.src = imgSrc;
    revealName.textContent = card.name;
    revealRarity.textContent = card.type;
    revealRarity.className = `rarity-tag ${card.type}`;

    let message = '';
    if (card.type === 'rare') {
        message = 'CARTE RARE OBTENUE ! Tu as gagné un verre offert !';
    } else if (card.type === 'puzzle') {
        message = 'PIECE DE PUZZLE OBTENUE ! Continue à collectionner !';
    } else if (card.type === 'bar') {
        message = 'ETABLISSEMENT DEBLOQUE ! Visite-le pour obtenir plus de cartes !';
    }

    revealMessage.textContent = message;
    modal.style.display = 'flex';
}

function closeCardReveal() {
    document.getElementById('card-reveal-modal').style.display = 'none';
}

// RECOMPENSES
async function renderRewards() {
    if (!currentUser) return;
    const { data: rewards } = await supabase.from('rewards').select('*').eq('user_id', currentUser.id).order('claimed_at', { ascending: false });
    const list = document.getElementById('reward-list');
    if(!list) return;
    list.innerHTML = rewards?.length ? '' : '<p>Aucun cadeau pour le moment.</p>';
    rewards?.forEach(r => {
        const div = document.createElement('div');
        div.className = `reward-card ${r.consumed_at ? 'used' : ''}`;
        div.innerHTML = `<strong>${r.type}</strong> ${r.consumed_at ? '(Validé)' : ''}`;
        list.appendChild(div);
    });
}

// CONFETTI (Optimisé)
const c = document.getElementById('confetti');
const ctx = c?.getContext('2d');
function resize() { if(c) { c.width = window.innerWidth; c.height = window.innerHeight; } }
window.onresize = resize; resize();
function runConfetti() {
    if(!ctx) return;
    const p = []; for(let i=0; i<100; i++) p.push({x:Math.random()*c.width, y:-20, r:5+Math.random()*5, vx:-2+Math.random()*4, vy:2+Math.random()*5, c:['#d4af37','#0077b6','#fff'][Math.floor(Math.random()*3)]});
    function t() { 
        ctx.clearRect(0,0,c.width,c.height); 
        p.forEach(i => { i.x+=i.vx; i.y+=i.vy; i.vy+=0.05; ctx.fillStyle=i.c; ctx.fillRect(i.x,i.y,i.r,i.r); }); 
        if(p.some(i => i.y < c.height)) requestAnimationFrame(t); 
    }
    t();
}

window.onload = initApp;
