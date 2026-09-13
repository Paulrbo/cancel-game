# CANCEL ? — le jeu

Jeu multijoueur en temps réel où les joueurs votent "cancel / pas cancel"
sur des personnalités, avec un bonus de points s'ils devinent la bonne
catégorie de scandale (VSS, pédocriminalité, racisme, délit/crime).

## Fichiers

- `index.html` — les écrans du jeu (pseudo, salon, round, révélation, scores)
- `style.css` — l'identité visuelle
- `app.js` — toute la logique de jeu et la synchronisation Firebase
- `firebase-config.js` — tes clés de projet Firebase (à remplacer)
- `data.json` — la base des personnalités utilisées dans les rounds

## Structure des données dans Firebase Realtime Database

```
rooms/
  {nomDuSalon}/
    host: "pseudo du créateur"
    state: "lobby" | "playing" | "reveal" | "final"
    players/
      {pseudo}: { score: 0 }
    currentRoundIndex: 0
    roundOrder: ["Nom Personnalité 1", "Nom Personnalité 2", ...]
    roundStartTime: <timestamp serveur>
    votes/
      {roundIndex}/
        {pseudo}: { vote: "oui"|"non"|null, categories: [...], timeTaken: <ms> }
    lastRoundScores/
      {pseudo}: <points gagnés au dernier round>
```

## Règles de sécurité Firebase (mode démo, à restreindre plus tard)

Dans la console Firebase > Realtime Database > Règles :

```json
{
  "rules": {
    "rooms": {
      ".read": true,
      ".write": true
    }
  }
}
```

Ces règles sont ouvertes (pas d'authentification), suffisant pour un jeu
entre amis. À restreindre si tu ouvres l'app publiquement un jour.

## Pistes d'amélioration futures

- Ajouter plus de personnalités dans `data.json`
- Gérer la déconnexion d'un joueur en cours de partie
- Ajouter un vrai écran d'erreur si le salon est fermé pendant la partie
- Nettoyer les vieux salons dans Firebase après un certain temps
