// ====== CONSTANTES DE JEU ======
const ROUND_DURATION_MS = 15000; // 15s pour repondre
const SCORE_MAX = 1000;
const SCORE_MIN = 100;
let selectedRoundCount = 10;

// ====== ETAT LOCAL ======
let myPseudo = null;
let roomId = null;
let isHost = false;
let poolData = [];
let currentRoomData = null;
let renderedRoundIndex = -1;
let renderedState = null;
let hasVotedThisRound = false;
let localRoundStart = 0;
let timerInterval = null;
let hostRoundTimeout = null;
let revealTriggeredForRound = -1;

// ====== UTILITAIRES ======
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.body.classList.toggle('in-game', id === 'screen-round' || id === 'screen-reveal');
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadPool() {
  const res = await fetch('data.json');
  poolData = await res.json();
}

// ====== ECRAN PSEUDO ======
document.getElementById('btn-pseudo-valider').addEventListener('click', () => {
  const val = document.getElementById('pseudo-input').value.trim();
  if (!val) {
    document.getElementById('pseudo-error').textContent = "Choisis un pseudo.";
    return;
  }
  myPseudo = val;
  document.getElementById('hello-pseudo').textContent = myPseudo;
  showScreen('screen-lobby-choice');
});

// ====== ECRAN CREER / REJOINDRE ======
document.getElementById('btn-create-room').addEventListener('click', async () => {
  const name = document.getElementById('create-room-input').value.trim();
  const errorEl = document.getElementById('lobby-error');
  errorEl.textContent = '';
  if (!name) { errorEl.textContent = "Donne un nom de salon."; return; }

  const snap = await db.ref('rooms/' + name).once('value');
  if (snap.exists()) {
    errorEl.textContent = "Ce salon existe déjà, choisis un autre nom.";
    return;
  }
  await db.ref('rooms/' + name).set({
    host: myPseudo,
    state: 'lobby',
    players: { [myPseudo]: { score: 0 } },
    createdAt: firebase.database.ServerValue.TIMESTAMP
  });
  roomId = name;
  isHost = true;
  enterRoom();
});

document.getElementById('btn-join-room').addEventListener('click', async () => {
  const name = document.getElementById('join-room-input').value.trim();
  const errorEl = document.getElementById('lobby-error');
  errorEl.textContent = '';
  if (!name) { errorEl.textContent = "Donne le nom du salon à rejoindre."; return; }

  const snap = await db.ref('rooms/' + name).once('value');
  if (!snap.exists()) {
    errorEl.textContent = "Ce salon n'existe pas.";
    return;
  }
  const roomData = snap.val();
  if (roomData.state !== 'lobby') {
    errorEl.textContent = "Cette partie a déjà commencé.";
    return;
  }
  await db.ref(`rooms/${name}/players/${myPseudo}`).set({ score: 0 });
  roomId = name;
  isHost = false;
  enterRoom();
});

// ====== ENTREE DANS LE SALON ======
function enterRoom() {
  document.getElementById('waiting-room-name').textContent = roomId;
  db.ref('rooms/' + roomId).on('value', onRoomUpdate);
}

function onRoomUpdate(snapshot) {
  const data = snapshot.val();
  if (!data) return; // salon supprimé
  currentRoomData = data;

  renderPlayersList(data.players);

  switch (data.state) {
    case 'lobby':
      showScreen('screen-waiting');
      document.getElementById('btn-start-game').style.display = isHost ? 'block' : 'none';
      document.getElementById('round-count-selector').style.display = isHost ? 'block' : 'none';
      document.getElementById('waiting-hint').style.display = isHost ? 'none' : 'block';
      break;
    case 'playing':
      showScreen('screen-round');
      if (renderedState !== 'playing' || renderedRoundIndex !== data.currentRoundIndex) {
        renderedRoundIndex = data.currentRoundIndex;
        startRoundUI(data);
      }
      break;
    case 'reveal':
      showScreen('screen-reveal');
      if (renderedState !== 'reveal' || renderedRoundIndex !== data.currentRoundIndex) {
        showRevealUI(data);
      }
      break;
    case 'final':
      showScreen('screen-final');
      showFinalUI(data);
      break;
  }
  renderedState = data.state;
}

function renderPlayersList(players) {
  const ul = document.getElementById('players-list');
  ul.innerHTML = '';
  Object.keys(players || {}).forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${p}${p === currentRoomData.host ? ' 👑' : ''}</span><span>${players[p].score || 0} pts</span>`;
    ul.appendChild(li);
  });
}

// ====== LANCEMENT DE LA PARTIE (HOTE) ======
document.querySelectorAll('.round-count-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.round-count-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedRoundCount = parseInt(btn.dataset.rounds, 10);
  });
});

document.getElementById('btn-start-game').addEventListener('click', async () => {
  await loadPool();
  const ouiItems = shuffle(poolData.filter(p => p.cancel === 'oui'));
  const nonItems = shuffle(poolData.filter(p => p.cancel === 'non'));

  const guaranteedCount = Math.min(Math.max(3, Math.round(selectedRoundCount * 0.35)), ouiItems.length);
  const guaranteedOui = ouiItems.slice(0, guaranteedCount);
  const rest = shuffle([...ouiItems.slice(guaranteedOui.length), ...nonItems])
    .slice(0, selectedRoundCount - guaranteedOui.length);
  const roundOrder = shuffle([...guaranteedOui, ...rest]).map(p => p.nom);

  await db.ref('rooms/' + roomId).update({
    state: 'playing',
    currentRoundIndex: 0,
    roundOrder,
    roundStartTime: firebase.database.ServerValue.TIMESTAMP,
    votes: null
  });
});

// ====== PHOTOS (via API Wikipedia, à la volée) ======
const photoCache = {}; // nom -> url ou null (pas trouvée)

async function fetchWikipediaPhoto(nom) {
  if (nom in photoCache) return photoCache[nom];

  // Nettoie les noms avec parenthèses, ex: "DSK (Dominique Strauss-Kahn)" -> "Dominique Strauss-Kahn"
  const cleanName = nom.includes('(') ? nom.match(/\(([^)]+)\)/)?.[1] || nom.split('(')[0].trim() : nom;

  const tryFetch = async (name, lang) => {
    try {
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, '_'))}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return data.thumbnail?.source || null;
    } catch {
      return null;
    }
  };

  let photoUrl = await tryFetch(cleanName, 'fr');
  if (!photoUrl) photoUrl = await tryFetch(cleanName, 'en');
  if (!photoUrl && cleanName !== nom) photoUrl = await tryFetch(nom, 'fr');

  photoCache[nom] = photoUrl;
  return photoUrl;
}

function setPhoto(imgEl, url) {
  if (url) {
    imgEl.src = url;
    imgEl.classList.remove('hidden');
  } else {
    imgEl.classList.add('hidden');
    imgEl.src = '';
  }
}

// ====== ECRAN ROUND ======
function startRoundUI(data) {
  if (poolData.length === 0) { loadPool().then(() => startRoundUI(data)); return; }

  const nom = data.roundOrder[data.currentRoundIndex];
  const item = poolData.find(p => p.nom === nom);
  if (!item) return;

  document.getElementById('round-counter').textContent = `Round ${data.currentRoundIndex + 1} / ${data.roundOrder.length}`;
  document.getElementById('personality-name').textContent = item.nom;
  document.getElementById('personality-milieu').textContent = item.milieu;

  const photoImg = document.getElementById('personality-photo');
  photoImg.classList.add('hidden');
  fetchWikipediaPhoto(item.nom).then(url => setPhoto(photoImg, url));

  document.getElementById('waiting-others').classList.add('hidden');
  document.getElementById('answer-grid').classList.remove('hidden');
  document.querySelectorAll('.answer-pill, .answer-clean').forEach(b => b.disabled = false);

  hasVotedThisRound = false;
  localRoundStart = Date.now();
  revealTriggeredForRound = -1;

  runTimer(data);
  attachAnswerHandlers(data);

  if (isHost) {
    clearTimeout(hostRoundTimeout);
    hostRoundTimeout = setTimeout(() => triggerReveal(data), ROUND_DURATION_MS + 1500);
    listenVotesForHost(data);
  }
}

function runTimer(data) {
  clearInterval(timerInterval);
  const bar = document.getElementById('timer-bar');
  const serverStart = data.roundStartTime || Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - serverStart;
    const remaining = Math.max(0, ROUND_DURATION_MS - elapsed);
    bar.style.width = (remaining / ROUND_DURATION_MS * 100) + '%';
    if (remaining <= 0) {
      clearInterval(timerInterval);
      if (!hasVotedThisRound) autoSubmitNoAnswer();
    }
  }, 150);
}

function attachAnswerHandlers(data) {
  document.querySelectorAll('.answer-pill, .answer-clean').forEach(btn => {
    btn.onclick = () => submitAnswer(btn.dataset.answer);
  });
}

function submitAnswer(answer) {
  if (hasVotedThisRound) return;
  hasVotedThisRound = true;
  document.getElementById('answer-grid').classList.add('hidden');
  document.getElementById('waiting-others').classList.remove('hidden');

  const timeTaken = Date.now() - localRoundStart;
  db.ref(`rooms/${roomId}/votes/${currentRoomData.currentRoundIndex}/${myPseudo}`).set({
    answer, timeTaken
  });
}

function autoSubmitNoAnswer() {
  hasVotedThisRound = true;
  document.getElementById('answer-grid').classList.add('hidden');
  document.getElementById('waiting-others').classList.remove('hidden');
  db.ref(`rooms/${roomId}/votes/${currentRoomData.currentRoundIndex}/${myPseudo}`).set({
    answer: null, timeTaken: ROUND_DURATION_MS
  });
}

// ====== SUIVI DES VOTES ET CALCUL (HOTE UNIQUEMENT) ======
function listenVotesForHost(data) {
  const roundIdx = data.currentRoundIndex;
  db.ref(`rooms/${roomId}/votes/${roundIdx}`).on('value', snap => {
    const votes = snap.val() || {};
    const nbPlayers = Object.keys(currentRoomData.players || {}).length;
    if (Object.keys(votes).length >= nbPlayers) {
      triggerReveal(currentRoomData);
    }
  });
}

async function triggerReveal(data) {
  const roundIdx = data.currentRoundIndex;
  if (revealTriggeredForRound === roundIdx) return;
  revealTriggeredForRound = roundIdx;
  clearTimeout(hostRoundTimeout);

  const votesSnap = await db.ref(`rooms/${roomId}/votes/${roundIdx}`).once('value');
  const votes = votesSnap.val() || {};
  const playersSnap = await db.ref(`rooms/${roomId}/players`).once('value');
  const players = playersSnap.val() || {};

  const nom = data.roundOrder[roundIdx];
  const item = poolData.find(p => p.nom === nom);
  const trueCats = item.categorie ? item.categorie.split(',').map(s => s.trim()) : [];

  const roundScores = {};
  for (const pseudo of Object.keys(players)) {
    const v = votes[pseudo];
    if (!v || !v.answer) { roundScores[pseudo] = 0; continue; }

    const correct = item.cancel === 'oui' ? trueCats.includes(v.answer) : v.answer === 'clean';

    let score = 0;
    if (correct) {
      const frac = 1 - Math.min(1, v.timeTaken / ROUND_DURATION_MS);
      score = Math.round(SCORE_MIN + (SCORE_MAX - SCORE_MIN) * frac);
    }
    roundScores[pseudo] = score;
  }

  const updates = {};
  Object.keys(players).forEach(pseudo => {
    updates[`players/${pseudo}/score`] = (players[pseudo].score || 0) + (roundScores[pseudo] || 0);
  });
  updates['state'] = 'reveal';
  updates['lastRoundScores'] = roundScores;

  await db.ref('rooms/' + roomId).update(updates);
}

// ====== ECRAN REVELATION ======
const CATEGORY_LABELS = {
  'VSS': 'VSS — Violences sexistes et sexuelles',
  'pedocriminalite': 'Pédocriminalité',
  'racisme': 'Racisme',
  'delit/crime': 'Délit / crime'
};

function showRevealUI(data) {
  renderedRoundIndex = data.currentRoundIndex;
  const nom = data.roundOrder[data.currentRoundIndex];
  const item = poolData.find(p => p.nom === nom);

  document.getElementById('reveal-verdict').textContent = item.cancel === 'oui' ? '❌ CANCEL CONFIRMÉ' : '✅ PAS CANCEL';
  document.getElementById('reveal-name').textContent = item.nom;
  document.getElementById('reveal-explication').textContent = item.raison;

  const revealPhotoImg = document.getElementById('reveal-photo');
  revealPhotoImg.classList.add('hidden');
  fetchWikipediaPhoto(item.nom).then(url => setPhoto(revealPhotoImg, url));

  const badge = document.getElementById('category-badge');
  badge.className = 'category-badge'; // reset
  const cats = item.categorie ? item.categorie.split(',').map(c => c.trim()) : [];
  if (cats.length > 0 && item.cancel === 'oui') {
    const labels = cats.map(c => CATEGORY_LABELS[c] || c).join(' + ');
    badge.textContent = labels;
    const cssClass = 'cat-' + cats[0].replace('/', '-');
    badge.classList.add(cssClass);
  } else {
    badge.classList.add('hidden');
  }

  const ul = document.getElementById('round-scores');
  ul.innerHTML = '';
  const scores = data.lastRoundScores || {};
  Object.keys(scores)
    .sort((a, b) => scores[b] - scores[a])
    .forEach(p => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${p}</span><span>+${scores[p]} pts</span>`;
      ul.appendChild(li);
    });

  document.getElementById('btn-next-round').style.display = isHost ? 'block' : 'none';
  document.getElementById('reveal-hint').style.display = isHost ? 'none' : 'block';
}

document.getElementById('btn-next-round').addEventListener('click', async () => {
  const nextIndex = currentRoomData.currentRoundIndex + 1;
  if (nextIndex >= currentRoomData.roundOrder.length) {
    await db.ref('rooms/' + roomId).update({ state: 'final' });
  } else {
    await db.ref('rooms/' + roomId).update({
      state: 'playing',
      currentRoundIndex: nextIndex,
      roundStartTime: firebase.database.ServerValue.TIMESTAMP,
      votes: null
    });
  }
});

// ====== ECRAN FINAL ======
function showFinalUI(data) {
  const ul = document.getElementById('final-scores');
  ul.innerHTML = '';
  const players = data.players || {};
  Object.keys(players)
    .sort((a, b) => (players[b].score || 0) - (players[a].score || 0))
    .forEach((p, i) => {
      const li = document.createElement('li');
      const medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '';
      li.innerHTML = `<span>${medal}${p}</span><span>${players[p].score || 0} pts</span>`;
      ul.appendChild(li);
    });
}

document.getElementById('btn-replay').addEventListener('click', () => {
  db.ref('rooms/' + roomId).off();
  roomId = null;
  isHost = false;
  showScreen('screen-lobby-choice');
});

// ====== INIT ======
loadPool();
