# SMS Gateway

Plateforme d’envoi de SMS via **vos propres téléphones Android** (jusqu’à 2 SIM par appareil). Aucun prestataire d’envoi (Twilio, Brevo, etc.) n’est utilisé pour le transport.

Le système **reste dans les limites de vos forfaits** : débit et quota journalier configurables **par SIM**. Aucune tentative de contournement des règles opérateurs ou d’Android.

Les contacts de campagne doivent disposer du **consentement** nécessaire. Une liste de **désinscription** bloque automatiquement les envois.

## Architecture

```
Dashboard Next.js  →  API Express  →  PostgreSQL / Redis+BullMQ
                                      ↓
                            Android Gateway (SIM 1 / SIM 2)
```

| Dossier | Rôle |
|---|---|
| `backend/` | API, Prisma, files BullMQ, WebSocket / polling |
| `frontend/` | Tableau de bord |
| `android-gateway/` | Application Kotlin « SMS Gateway » |

## Prérequis

- Node.js 22+
- Docker (PostgreSQL + Redis) **ou** instances locales
- Android Studio (pour compiler l’app téléphone)

## Installation

```bash
# 1. Variables d'environnement
cp .env.example .env
cp .env.example backend/.env

# 2. Infrastructure
docker compose up -d postgres redis

# 3. Backend
cd backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed
npm test
npm run dev

# 4. Frontend (autre terminal)
cd frontend
npm install
# créer frontend/.env.local : NEXT_PUBLIC_API_URL=http://localhost:4000
npm run dev
```

Tout-en-un :

```bash
docker compose up --build
```

Compte admin par défaut (à changer) : `ADMIN_EMAIL` / `ADMIN_PASSWORD` dans `.env`.

## Application Android

1. Ouvrir `android-gateway/` dans Android Studio.
2. Compiler et installer sur le téléphone (autoriser SMS, état du téléphone, notifications).
3. Dans le dashboard **Téléphones** → **Enregistrer un téléphone** : copier `ANDROID-00x` et la clé API.
4. Dans l’app : URL du serveur, Device ID, clé API → **Connecter**.

L’app envoie un heartbeat, récupère les tâches (HTTP polling) et envoie les SMS avec `SmsManager` sur la SIM demandée (`getSmsManagerForSubscriptionId`). Les réponses `STOP` / `DESABONNER` sont signalées au serveur.

## Limites SIM

Chaque ligne (`SimLine`) a :

- `dailyLimit` (défaut 80 / jour)
- `ratePerMinute` (défaut 4 / min)
- `enabled`

Réglez ces valeurs **en dessous** des plafonds de votre forfait. Un appareil hors ligne ne reçoit plus de nouveaux SMS.

## Statuts

Campagne : `DRAFT` `SCHEDULED` `RUNNING` `PAUSED` `COMPLETED` `CANCELLED`

SMS : `QUEUED` `SENDING` `SENT` `FAILED` `CANCELLED`

Erreurs : `NO_SIM` `DEVICE_OFFLINE` `SMS_FAILED` `RATE_LIMIT` `INVALID_NUMBER` `UNSUBSCRIBED`

## API

Base : `http://localhost:4000/api`  
Auth dashboard : `Authorization: Bearer <jwt>`  
Auth appareil : `X-API-Key` + `X-Device-Id`

| Méthode | Chemin | Auth |
|---|---|---|
| POST | `/auth/login` | public |
| GET | `/auth/me` | JWT |
| GET | `/contacts` | JWT |
| POST | `/contacts` | JWT |
| POST | `/contacts/import` | JWT (multipart `file`) |
| GET | `/contacts/export` | JWT |
| GET | `/contact-lists` | JWT |
| POST | `/contact-lists` | JWT |
| GET | `/campaigns` | JWT |
| POST | `/campaigns` | JWT |
| GET | `/campaigns/:id` | JWT |
| GET | `/campaigns/:id/preview` | JWT |
| POST | `/campaigns/:id/start` | JWT |
| POST | `/campaigns/:id/pause` | JWT |
| POST | `/campaigns/:id/resume` | JWT |
| POST | `/campaigns/:id/cancel` | JWT |
| GET | `/campaigns/:id/stats` | JWT |
| GET | `/devices` | JWT |
| POST | `/devices/register` | JWT |
| POST | `/devices/:id/heartbeat` | API key |
| GET | `/devices/:id/pending-sms` | API key |
| POST | `/devices/:id/sms-result` | API key |
| POST | `/devices/:id/incoming-sms` | API key |
| POST | `/unsubscribe` | public |
| GET | `/dashboard` | JWT |
| GET | `/health` | public |

WebSocket optionnel : `ws://host:4000/ws/gateway?deviceId=&apiKey=`

### Exemple login

```json
POST /api/auth/login
{ "email": "admin@localhost", "password": "changeme" }
```

### Exemple campagne

```json
POST /api/campaigns
{ "name": "Promo septembre", "message": "Bonjour {prenom}, découvrez notre offre...", "listId": "..." }
POST /api/campaigns/:id/start
```

## Tests

```bash
cd backend
npm test
```

Couverture : import CSV, numéros FR, doublons, désinscription, campagnes, sélection SIM, appareil hors ligne, rate limit, retries, stats.

## Production Bot Hosting (sans Android Studio)

1. Créer une base **Neon** ou **Supabase** (`DATABASE_URL`).
2. Créer un Redis **Upstash** (`REDIS_URL`).
3. Egg Node 22, **1024 Mo RAM**, un port public.
4. Uploader `bothosting/bootstrap.js` → `/home/container/index.js`.
5. Coller `bothosting/env.bothosting` dans `/home/container/.env` (hôte, secrets, URLs).
6. Startup panel : `node index.js`.
7. APK téléphone : GitHub → **Actions** → **Build Android APK** → *Run workflow* → télécharger l’artifact `sms-gateway-apk`.
8. Sur le téléphone : autoriser sources inconnues, installer l’APK, coller l’URL publique du panel (`http://HOTE:PORT`), Device ID et clé API.

Les SMS partent toujours des téléphones, pas du serveur.

## Sécurité

- Mots de passe hashés (bcrypt)
- JWT pour le dashboard
- Clés API d’appareils hashées
- Rate limiting HTTP
- Helmet + CORS (`CORS_ORIGIN`)
- Validation Zod
- Aucun secret dans Git (`.env` ignoré)

## Licence d’usage

Utilisez uniquement des listes consenties, un lien / mot-clé de désinscription, et les volumes autorisés par vos opérateurs.
