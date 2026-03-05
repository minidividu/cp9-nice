// --- CONFIGURATION ---
var SUPABASE_URL = 'https://qqtbaxaomrophaiszwtr.supabase.co';
var SUPABASE_KEY = 'sb_publishable_SqgX_Vzxas58tEQwuvlUaQ_TrXaMNWd';
var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

var currentUser = null, isAdmin = false, allCardsCache = [], ownedIds = [];

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
    await checkScanTicket(); // Vérifie si on arrive d'un QR Code
}

// --- AFFICHAGE DE LA COLLECTION ---
async function renderAll(filterBarId = null) {
    // 1. Charger les cartes si pas en cache
    if (allCardsCache.length === 0) {
        const { data } = await supabase.from('cards').select('*').order('slot_index');
        allCardsCache = data || [];
    }

    // 2. Charger les cartes possédées par l'utilisateur
    if (currentUser) {
        const { data } = await supabase.from('user_cards').select('card_id').eq('user_id', currentUser.id);
        ownedIds = data ? data.map(c => c.card_id) : [];
    }

    const grids = { 
        puzzle: document.getElementById('grid-puzzle'), 
        rare: document.getElementById('grid-rare'), 
        bar: document.getElementById('grid-bar') 
    };
    
    // Nettoyage des grilles
    Object.values(grids).forEach(g => { if(g) g.innerHTML = ''; });

    document.getElementById('back-btn-container').style.display = filterBarId ? 'block' : 'none';
    document.getElementById('filter-title').innerText = filterBarId ? "COLLECTION FILTRÉE" : "TOUTE LA COLLECTION";

    const toDisplay = filterBarId ? allCardsCache.filter(c => c.bar_id === filterBarId || c.type === 'bar') : allCardsCache;

    toDisplay.forEach(card => {
        const active = ownedIds.includes(card.id);
        const div = document.createElement('div');
        div.className = `card-item ${active ? 'active' : ''} type-${card.type}`;
        
        // GESTION DE L'IMAGE : Utilise l'image GitHub ou un placeholder
        // Ici on suppose que le nom de l'image est stocké dans card.image_name (ex: "yavsaintriquier.png")
        const imgPath = card.image_name ? card.image_name : 'yavsaintriquier.png';

        div.innerHTML = `
            <span class="rarity-tag ${card.type}">${card.type}</span>
            <img src="${imgPath}" onerror="this.src='https://via.placeholder.com/300/111/d4af37?text=${card.name.split(' ')[0]}'">
            <div class="card-label">${card.name}</div>
        `;

        if (card.type === 'bar') div.onclick = () => renderAll(card.id);
        if (grids[card.type]) grids[card.type].appendChild(div);
    });

    if(document.getElementById('count')) document.getElementById('count').innerText = ownedIds.length;
    if(document.getElementById('total-available')) document.getElementById('total-available').innerText = allCardsCache.length;
    
    renderRewards();
}

// --- LOGIQUE DU SCAN QR CODE ---
async function checkScanTicket() {
    const code = new URLSearchParams(window.location.search).get('ticket');
    
    if (code) {
        // A. Si pas connecté : on sauvegarde le ticket et on force l'inscription
        if (!currentUser) {
            sessionStorage.setItem('pending_ticket', code);
            openRegister();
            return;
        }

        // B. Récupérer les infos du ticket depuis la table qr_tickets
        const { data: ticket, error } = await supabase
            .from('qr_tickets')
            .select('*, cards(*)')
            .eq('id', code)
            .single();

        if (error || !ticket) {
            console.error("Erreur ticket:", error);
            return alert("Code QR invalide.");
        }

        // C. Vérifier si l'utilisateur possède déjà CETTE carte
        const isAlreadyOwned = ownedIds.includes(ticket.card_id);

        if (isAlreadyOwned) {
            alert("Tu possèdes déjà cette carte !");
            // Nettoie l'URL pour éviter les alertes en boucle au refresh
            window.history.replaceState({}, '', window.location.pathname);
            return;
        }

        // D. Ajouter la carte à l'utilisateur
        const { error: insertError } = await supabase
            .from('user_cards')
            .insert([{ user_id: currentUser.id, card_id: ticket.card_id }]);

        if (!insertError) {
            // Si la carte est de type 'rare', on offre une récompense
            if (ticket.cards && ticket.cards.type === 'rare') {
                await supabase.from('rewards').insert([{ user_id: currentUser.id, type: 'VERRE OFFERT' }]);
            }

            runConfetti();
            showReward(ticket.cards ? ticket.cards.name : "Nouvelle Carte");
            await renderAll(); // Rafraîchir la collection visuellement
            
            // Nettoyage de l'URL
            window.history.replaceState({}, '', window.location.pathname);
        } else {
            alert("Erreur lors de l'obtention : " + insertError.message);
        }
    }
}

// --- GESTION DES RÉCOMPENSES ---
async function renderRewards() {
    if (!currentUser) return;
    const { data: rewards } = await supabase.from('rewards').select('*').eq('user_id', currentUser.id).order('claimed_at', { ascending: false });
    const list = document.getElementById('reward-list');
    if(!list) return;
    
    list.innerHTML = rewards?.length ? '' : '<p style="color: #666;">Pas encore de cadeaux.</p>';
    
    rewards?.forEach(r => {
        const div = document.createElement('div');
        div.className = `reward-card ${r.consumed_at ? 'used' : ''}`;
        div.innerHTML = `<div><strong>${r.type}</strong><br><small>${r.consumed_at ? 'Validé le ' + new Date(r.consumed_at).toLocaleDateString() : 'Disponible'}</small></div>`;
        
        if (!r.consumed_at && isAdmin) {
            const b = document.createElement('button'); 
            b.className = "pill gold"; 
            b.innerText = "VALIDER";
            b.onclick = async () => {
                await supabase.from('rewards').update({ consumed_at: new Date().toISOString() }).eq('id', r.id);
                renderRewards();
            }; 
            div.appendChild(b);
        }
        list.appendChild(div);
    });
}

// --- AUTHENTIFICATION ---
async function handleAuth() {
    const email = document.getElementById('reg-email').value;
    const pass = document.getElementById('reg-pass').value;
    
    const { error } = await supabase.auth.signUp({ email, password: pass });
    if (error) {
        // Si le compte existe déjà, on tente la connexion
        const { error: loginError } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (loginError) return alert(loginError.message);
    }
    
    location.reload(); // Recharger pour appliquer la session
}

function updateAuthUI() {
    const ctrl = document.getElementById('auth-controls'), badge = document.getElementById('profile-badge');
    if (currentUser) {
        if(badge) badge.textContent = `Profil: ${currentUser.email}`;
        if(ctrl) ctrl.innerHTML = `<button class="pill" onclick="supabase.auth.signOut().then(()=>location.reload())">DÉCONNEXION</button>`;
    } else {
        if(badge) badge.textContent = `Profil: non inscrit`;
        if(ctrl) ctrl.innerHTML = `<button class="pill gold" onclick="openRegister()">REJOINDRE</button>`;
    }
}

// --- MODALS & UI ---
function openRegister() { document.getElementById('register-modal').style.display = 'flex'; }
function closeRegister() { document.getElementById('register-modal').style.display = 'none'; }
function closeOverlay() { document.getElementById('reward-overlay').style.display = 'none'; }
function showReward(msg) { 
    document.getElementById('reward-desc').innerText = `Tu as débloqué : ${msg}`; 
    document.getElementById('reward-overlay').style.display = 'flex'; 
}

// --- ANIMATION CONFETTI ---
const c = document.getElementById('confetti');
const ctx = c ? c.getContext('2d') : null;
function resize() { if(c) { c.width = window.innerWidth; c.height = window.innerHeight; } }
window.onresize = resize; resize();

function runConfetti() {
    if(!ctx) return;
    const p = []; 
    for(let i=0; i<100; i++) p.push({
        x: Math.random()*c.width, 
        y: -20, 
        r: 5+Math.random()*5, 
        vx: -2+Math.random()*4, 
        vy: 2+Math.random()*5, 
        c: ['#d4af37','#0077b6','#fff'][Math.floor(Math.random()*3)]
    });
    function t() { 
        ctx.clearRect(0,0,c.width,c.height); 
        p.forEach(i => { i.x+=i.vx; i.y+=i.vy; i.vy+=0.02; ctx.fillStyle=i.c; ctx.fillRect(i.x,i.y,i.r,i.r); }); 
        if(p.some(i => i.y < c.height)) requestAnimationFrame(t); 
    }
    t();
}

window.onload = initApp;
