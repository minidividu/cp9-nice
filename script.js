// --- CONFIGURATION ---
const SUPABASE_URL = 'https://qqtbaxaomrophaiszwtr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_SqgX_Vzxas58tEQwuvlUaQ_TrXaMNWd';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null, isAdmin = false, allCardsCache = [], ownedIds = [];

// --- INITIALISATION ---
async function initApp() {
    const { data: { session } } = await supabase.auth.getSession();
    currentUser = session?.user || null;
    
    if (currentUser) {
        const { data: p } = await supabase.from('profiles').select('is_admin').eq('id', currentUser.id).single();
        isAdmin = p?.is_admin || false;
    }
    
    updateAuthUI();
    await renderAll();
    await checkScanTicket(); // Déclenche l'ajout si un ?ticket= est présent
}

// --- AFFICHAGE DE LA COLLECTION ---
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

    const backBtn = document.getElementById('back-btn-container');
    if(backBtn) backBtn.style.display = filterBarId ? 'block' : 'none';
    
    const filterTitle = document.getElementById('filter-title');
    if(filterTitle) filterTitle.innerText = filterBarId ? "COLLECTION FILTRÉE" : "TOUTE LA COLLECTION";

    const toDisplay = filterBarId ? allCardsCache.filter(c => c.bar_id === filterBarId || c.type === 'bar') : allCardsCache;

    toDisplay.forEach(card => {
        const active = ownedIds.includes(card.id);
        const div = document.createElement('div');
        div.className = `card-item ${active ? 'active' : ''} type-${card.type}`;
        
        // Utilise l'image GitHub si présente, sinon le placeholder
        const imgName = (card.name === 'Saint-Riquier' || card.id === 'Saint-Riquier') ? 'yavsaintriquier.png' : '';
        const imgSrc = imgName ? imgName : `https://via.placeholder.com/300/111/d4af37?text=${card.name.split(' ')[0]}`;

        div.innerHTML = `
            <span class="rarity-tag ${card.type}">${card.type}</span>
            <img src="${imgSrc}" onerror="this.src='https://via.placeholder.com/300/111/d4af37?text=CARTE'">
            <div class="card-label">${card.name}</div>
        `;

        if (card.type === 'bar') div.onclick = () => renderAll(card.id);
        if (grids[card.type]) grids[card.type].appendChild(div);
    });

    if(document.getElementById('count')) document.getElementById('count').innerText = ownedIds.length;
    if(document.getElementById('total-available')) document.getElementById('total-available').innerText = allCardsCache.length;
    
    renderRewards();
}

// --- LOGIQUE DU TICKET UNIQUE (SCAN) ---
async function checkScanTicket() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('ticket');
    
    if (code) {
        if (!currentUser) {
            // On stocke le ticket pour plus tard et on demande de s'inscrire
            sessionStorage.setItem('pending_ticket', code);
            openRegister();
            return;
        }

        // Récupérer le ticket dans Supabase
        const { data: ticket, error } = await supabase
            .from('qr_tickets')
            .select('*, cards(*)')
            .eq('id', code)
            .single();

        if (error || !ticket) return alert("Ticket invalide ou inexistant.");

        // Vérifier si déjà possédée
        if (ownedIds.includes(ticket.card_id)) {
            alert("Tu as déjà cette carte dans ta collection !");
            cleanUrl();
            return;
        }

        // Ajouter la carte
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
            alert("Erreur d'ajout : " + insErr.message);
        }
    }
}

function cleanUrl() {
    window.history.replaceState({}, '', window.location.pathname);
}

// --- AUTHENTIFICATION CORRIGÉE ---
async function handleAuth() {
    const email = document.getElementById('reg-email').value;
    const pass = document.getElementById('reg-pass').value;

    if (!email || pass.length < 6) {
        return alert("Email valide et mot de passe de 6 caractères minimum requis.");
    }

    // 1. Tenter l'inscription
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password: pass });

    if (signUpError) {
        // 2. Si déjà inscrit, on tente la connexion
        if (signUpError.message.includes("already registered")) {
            const { error: loginError } = await supabase.auth.signInWithPassword({ email, password: pass });
            if (loginError) return alert("Erreur de connexion : " + loginError.message);
        } else {
            return alert("Erreur : " + signUpError.message);
        }
    } else if (data.user && !data.session) {
        // Cas où la confirmation par mail est activée dans Supabase
        return alert("Inscription réussie ! Vérifie tes emails pour confirmer ton compte.");
    }

    // Si on arrive ici, c'est réussi
    location.reload();
}

function updateAuthUI() {
    const ctrl = document.getElementById('auth-controls'), badge = document.getElementById('profile-badge');
    if (currentUser) {
        if(badge) badge.textContent = `Email : ${currentUser.email}`;
        if(ctrl) ctrl.innerHTML = `<button class="pill" onclick="supabase.auth.signOut().then(()=>location.reload())">DÉCONNEXION</button>`;
    } else {
        if(badge) badge.textContent = `Non connecté`;
        if(ctrl) ctrl.innerHTML = `<button class="pill gold" onclick="openRegister()">REJOINDRE</button>`;
    }
}

// --- RÉCOMPENSES ---
async function renderRewards() {
    if (!currentUser) return;
    const { data: rewards } = await supabase.from('rewards').select('*').eq('user_id', currentUser.id).order('claimed_at', { ascending: false });
    const list = document.getElementById('reward-list');
    if(!list) return;
    
    list.innerHTML = rewards?.length ? '' : '<p>Aucune récompense pour le moment.</p>';
    
    rewards?.forEach(r => {
        const div = document.createElement('div');
        div.className = `reward-card ${r.consumed_at ? 'used' : ''}`;
        div.innerHTML = `<span><strong>${r.type}</strong></span>`;
        if (!r.consumed_at && isAdmin) {
            const b = document.createElement('button'); b.className="pill gold"; b.innerText="VALIDER";
            b.onclick = async () => {
                await supabase.from('rewards').update({ consumed_at: new Date().toISOString() }).eq('id', r.id);
                renderRewards();
            };
            div.appendChild(b);
        }
        list.appendChild(div);
    });
}

// --- UI HELPERS ---
function openRegister() { document.getElementById('register-modal').style.display = 'flex'; }
function closeRegister() { document.getElementById('register-modal').style.display = 'none'; }
function closeOverlay() { document.getElementById('reward-overlay').style.display = 'none'; }
function showReward(msg) { 
    document.getElementById('reward-desc').innerText = `Bravo ! Tu as débloqué : ${msg}`;
    document.getElementById('reward-overlay').style.display = 'flex'; 
}

// --- CONFETTI ---
const c = document.getElementById('confetti');
const ctx = c?.getContext('2d');
function resize() { if(c) { c.width = window.innerWidth; c.height = window.innerHeight; } }
window.onresize = resize; resize();
function runConfetti() {
    if(!ctx) return;
    const p = []; for(let i=0; i<100; i++) p.push({x:Math.random()*c.width, y:-20, r:5+Math.random()*5, vx:-2+Math.random()*4, vy:2+Math.random()*5, c:['#d4af37','#0077b6','#fff'][Math.floor(Math.random()*3)]});
    function t() { ctx.clearRect(0,0,c.width,c.height); p.forEach(i => { i.x+=i.vx; i.y+=i.vy; i.vy+=0.02; ctx.fillStyle=i.c; ctx.fillRect(i.x,i.y,i.r,i.r); }); if(p.some(i => i.y < c.height)) requestAnimationFrame(t); }
    t();
}

window.onload = initApp;
