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

    // AMÉLIORATION : Gérer le ticket mis en attente pendant l'inscription
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

    // Récupération sécurisée
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
        showReward(ticket.cards?.name || "Nouvelle carte !");
        await renderAll();
        cleanUrl();
    } else {
        alert("Erreur : " + insErr.message);
    }
}

function cleanUrl() { window.history.replaceState({}, '', window.location.pathname); }

// --- 4. AUTHENTIFICATION ---
async function handleAuth() {
    const email = document.getElementById('reg-email').value;
    const pass = document.getElementById('reg-pass').value;

    if (!email || pass.length < 6) return alert("Email valide et 6 caractères min pour le mot de passe.");

    const { data, error: signUpError } = await supabase.auth.signUp({ email, password: pass });

    if (signUpError) {
        // AMÉLIORATION : Connexion auto si déjà inscrit
        if (signUpError.message.includes("already registered")) {
            const { error: loginError } = await supabase.auth.signInWithPassword({ email, password: pass });
            if (loginError) return alert("Erreur : " + loginError.message);
        } else {
            return alert("Erreur : " + signUpError.message);
        }
    } else if (data.user && !data.session) {
        return alert("Inscription réussie ! Vérifie tes emails (ou désactive 'Confirm Email' dans Supabase).");
    }
    location.reload();
}

// --- 5. UI & ANIMATIONS ---
function updateAuthUI() {
    const ctrl = document.getElementById('auth-controls');
    if (currentUser) {
        ctrl.innerHTML = `<button class="pill" onclick="supabase.auth.signOut().then(()=>location.reload())">DÉCONNEXION</button>`;
    } else {
        ctrl.innerHTML = `<button class="pill gold" onclick="openRegister()">REJOINDRE</button>`;
    }
}

function openRegister() { document.getElementById('register-modal').style.display = 'flex'; }
function closeRegister() { document.getElementById('register-modal').style.display = 'none'; }
function showReward(msg) { 
    document.getElementById('reward-desc').innerText = `Gagné : ${msg}`; 
    document.getElementById('reward-overlay').style.display = 'flex'; 
}
function closeOverlay() { document.getElementById('reward-overlay').style.display = 'none'; }

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
