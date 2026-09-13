// ====== CONSTANTES DE JEU ======
const ROUND_DURATION_MS = 15000; // 15s pour voter
const ROUNDS_PER_GAME = 10;
const BASE_MAX = 500;
const BASE_MIN = 100;
const BONUS_MAX = 1000;

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
document.getElementById('btn-start-game').addEventListener('click', async () => {
  await loadPool();
  const ouiItems = shuffle(poolData.filter(p => p.cancel === 'oui'));
  const nonItems = shuffle(poolData.filter(p => p.cancel === 'non'));

  const guaranteedOui = ouiItems.slice(0, Math.min(4, ouiItems.length));
  const rest = shuffle([...ouiItems.slice(guaranteedOui.length), ...nonItems])
    .slice(0, ROUNDS_PER_GAME - guaranteedOui.length);
  const roundOrder = shuffle([...guaranteedOui, ...rest]).map(p => p.nom);

  await db.ref('rooms/' + roomId).update({
    state: 'playing',
    currentRoundIndex: 0,
    roundOrder,
    roundStartTime: firebase.database.ServerValue.TIMESTAMP,
    votes: null
  });
});

// ====== ECRAN ROUND ======
function startRoundUI(data) {
  if (poolData.length === 0) { loadPool().then(() => startRoundUI(data)); return; }

  const nom = data.roundOrder[data.currentRoundIndex];
  const item = poolData.find(p => p.nom === nom);
  if (!item) return;

  document.getElementById('round-counter').textContent = `Round ${data.currentRoundIndex + 1} / ${data.roundOrder.length}`;
  document.getElementById('personality-name').textContent = item.nom;
  document.getElementById('personality-milieu').textContent = item.milieu;

  document.getElementById('bonus-block').classList.add('hidden');
  document.getElementById('waiting-others').classList.add('hidden');
  document.querySelectorAll('#bonus-block input[type=checkbox]').forEach(cb => cb.checked = false);
  document.querySelectorAll('.stamp').forEach(b => b.disabled = false);

  hasVotedThisRound = false;
  localRoundStart = Date.now();
  revealTriggeredForRound = -1;

  runTimer(data);
  attachVoteHandlers(data);

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

function attachVoteHandlers(data) {
  document.querySelectorAll('.stamp').forEach(btn => {
    btn.onclick = () => {
      const vote = btn.dataset.vote;
      if (vote === 'oui') {
        document.querySelectorAll('.stamp').forEach(b => b.disabled = true);
        document.getElementById('bonus-block').classList.remove('hidden');
      } else {
        submitVote('non', []);
      }
    };
  });
  document.getElementById('btn-valider-bonus').onclick = () => {
    const checked = [...document.querySelectorAll('#bonus-block input[type=checkbox]:checked')].map(cb => cb.value);
    submitVote('oui', checked);
  };
}

function submitVote(vote, categories) {
  if (hasVotedThisRound) return;
  hasVotedThisRound = true;
  document.querySelectorAll('.stamp').forEach(b => b.disabled = true);
  document.getElementById('bonus-block').classList.add('hidden');
  document.getElementById('waiting-others').classList.remove('hidden');

  const timeTaken = Date.now() - localRoundStart;
  db.ref(`rooms/${roomId}/votes/${currentRoomData.currentRoundIndex}/${myPseudo}`).set({
    vote, categories, timeTaken
  });
}

function autoSubmitNoAnswer() {
  hasVotedThisRound = true;
  document.querySelectorAll('.stamp').forEach(b => b.disabled = true);
  document.getElementById('bonus-block').classList.add('hidden');
  document.getElementById('waiting-others').classList.remove('hidden');
  db.ref(`rooms/${roomId}/votes/${currentRoomData.currentRoundIndex}/${myPseudo}`).set({
    vote: null, categories: [], timeTaken: ROUND_DURATION_MS
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
    if (!v || v.vote === null) { roundScores[pseudo] = 0; continue; }

    let score = 0;
    const baseCorrect = v.vote === item.cancel;
    if (baseCorrect) {
      const frac = 1 - Math.min(1, v.timeTaken / ROUND_DURATION_MS);
      score += Math.round(BASE_MIN + (BASE_MAX - BASE_MIN) * frac);
    }
    if (v.vote === 'oui') {
      const unit = trueCats.length > 0 ? BONUS_MAX / trueCats.length : 250;
      let bonus = 0;
      (v.categories || []).forEach(c => {
        bonus += trueCats.includes(c) ? unit : -unit;
      });
      score += Math.max(0, Math.round(bonus));
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
function showRevealUI(data) {
  renderedRoundIndex = data.currentRoundIndex;
  const nom = data.roundOrder[data.currentRoundIndex];
  const item = poolData.find(p => p.nom === nom);

  document.getElementById('reveal-verdict').textContent = item.cancel === 'oui' ? '❌ CANCEL CONFIRMÉ' : '✅ PAS CANCEL';
  document.getElementById('reveal-name').textContent = item.nom;
  document.getElementById('reveal-explication').textContent = item.raison;

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
