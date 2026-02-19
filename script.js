var SUPABASE_URL = 'https://qqtbaxaomrophaiszwtr.supabase.co';
var SUPABASE_KEY = 'sb_publishable_SqgX_Vzxas58tEQwuvlUaQ_TrXaMNWd';
var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

var currentUser = null, isAdmin = false, allCardsCache = [], ownedIds = [];

async function initApp() {
    const { data: { session } } = await supabase.auth.getSession();
    currentUser = session?.user || null;
    if (currentUser) {
        const { data: p } = await supabase.from('profiles').select('is_admin').eq('id', currentUser.id).single();
        isAdmin = p?.is_admin || false;
    }
    updateAuthUI();
    await renderAll();
    checkScanTicket();
}

async function renderAll(filterBarId = null) {
    if (allCardsCache.length === 0) {
        const { data } = await supabase.from('cards').select('*').order('slot_index');
        allCardsCache = data || [];
    }
    if (currentUser) {
        const { data } = await supabase.from('user_cards').select('card_id').eq('user_id', currentUser.id);
        ownedIds = data ? data.map(c => c.card_id) : [];
    }

    const grids = { puzzle: document.getElementById('grid-puzzle'), rare: document.getElementById('grid-rare'), bar: document.getElementById('grid-bar') };
    Object.values(grids).forEach(g => { if(g) g.innerHTML = ''; });

    document.getElementById('back-btn-container').style.display = filterBarId ? 'block' : 'none';
    document.getElementById('filter-title').innerText = filterBarId ? "COLLECTION FILTRÉE" : "TOUTE LA COLLECTION";

    const toDisplay = filterBarId ? allCardsCache.filter(c => c.bar_id === filterBarId || c.type === 'bar') : allCardsCache;

    toDisplay.forEach(card => {
        const active = ownedIds.includes(card.id);
        const div = document.createElement('div');
        div.className = `card-item ${active ? 'active' : ''} type-${card.type}`;
        div.innerHTML = `<span class="rarity-tag ${card.type}">${card.type}</span>
                         <img src="https://via.placeholder.com/300/111/d4af37?text=${card.name.split(' ')[0]}">
                         <div class="card-label">${card.name}</div>`;
        if (card.type === 'bar') div.onclick = () => renderAll(card.id);
        if (grids[card.type]) grids[card.type].appendChild(div);
    });

    document.getElementById('count').innerText = ownedIds.length;
    document.getElementById('total-available').innerText = allCardsCache.length;
    renderRewards();
}

async function renderRewards() {
    if (!currentUser) return;
    const { data: rewards } = await supabase.from('rewards').select('*').eq('user_id', currentUser.id).order('claimed_at', { ascending: false });
    const list = document.getElementById('reward-list');
    if(!list) return;
    list.innerHTML = rewards?.length ? '' : '<p style="color: #666;">Pas encore de cadeaux.</p>';
    rewards?.forEach(r => {
        const div = document.createElement('div');
        div.className = `reward-card ${r.consumed_at ? 'used' : ''}`;
        div.innerHTML = `<div><strong>${r.type}</strong><br><small>${r.consumed_at ? 'Validé' : 'Disponible'}</small></div>`;
        if (!r.consumed_at && isAdmin) {
            const b = document.createElement('button'); b.className = "pill gold"; b.innerText = "VALIDER";
            b.onclick = () => validateReward(r.id); div.appendChild(b);
        }
        list.appendChild(div);
    });
}

async function checkScanTicket() {
    const code = new URLSearchParams(window.location.search).get('ticket');
    if (code) {
        if (!currentUser) return (sessionStorage.setItem('pending_ticket', code), openRegister());
        const { data: t } = await supabase.from('qr_tickets').select('*, cards(*)').eq('id', code).single();
        if (!t || t.is_used) return alert("Code invalide ou utilisé.");
        const { error } = await supabase.from('user_cards').insert([{ user_id: currentUser.id, card_id: t.card_id }]);
        if (!error) {
            await supabase.from('qr_tickets').update({ is_used: true, used_by: currentUser.id }).eq('id', code);
            if (t.cards.type === 'rare') await supabase.from('rewards').insert([{ user_id: currentUser.id, type: 'VERRE OFFERT' }]);
            runConfetti(); showReward(t.cards.name); await renderAll();
            window.history.replaceState({}, '', window.location.pathname);
        }
    }
}

async function handleAuth() {
    const email = document.getElementById('reg-email').value, pass = document.getElementById('reg-pass').value;
    const { error } = await supabase.auth.signUp({ email, password: pass });
    if (error) await supabase.auth.signInWithPassword({ email, password: pass });
    location.reload();
}

function updateAuthUI() {
    const ctrl = document.getElementById('auth-controls'), badge = document.getElementById('profile-badge');
    if (currentUser) {
        if(badge) badge.textContent = `Profil: ${currentUser.email}`;
        if(ctrl) ctrl.innerHTML = `<button class="pill" onclick="supabase.auth.signOut().then(()=>location.reload())">DECO</button>`;
    } else {
        if(badge) badge.textContent = `Profil: non inscrit`;
        if(ctrl) ctrl.innerHTML = `<button class="pill gold" onclick="openRegister()">REJOINDRE</button>`;
    }
}

function openRegister() { document.getElementById('register-modal').style.display = 'flex'; }
function closeRegister() { document.getElementById('register-modal').style.display = 'none'; }
function closeOverlay() { document.getElementById('reward-overlay').style.display = 'none'; }
function showReward(msg) { document.getElementById('reward-desc').innerText = `Tu as débloqué : ${msg}`; document.getElementById('reward-overlay').style.display = 'flex'; }

const c = document.getElementById('confetti'), ctx = c.getContext('2d');
function resize() { if(c) { c.width = window.innerWidth; c.height = window.innerHeight; } }
window.onresize = resize; resize();
function runConfetti() {
    const p = []; for(let i=0; i<100; i++) p.push({x:Math.random()*c.width, y:-20, r:5+Math.random()*5, vx:-2+Math.random()*4, vy:2+Math.random()*5, c:['#d4af37','#0077b6','#fff'][Math.floor(Math.random()*3)]});
    function t() { ctx.clearRect(0,0,c.width,c.height); p.forEach(i => { i.x+=i.vx; i.y+=i.vy; i.vy+=0.02; ctx.fillStyle=i.c; ctx.fillRect(i.x,i.y,i.r,i.r); }); if(p.some(i => i.y < c.height)) requestAnimationFrame(t); }
    t();
}
window.onload = initApp;
