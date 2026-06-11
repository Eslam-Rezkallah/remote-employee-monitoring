# Postman tests — LiveKit integration

Three files:

| File                                  | الدور                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| `REM-LiveKit.postman_collection.json` | Collection فيها كل الـ requests (Health → Auth → Chat → Calls → LiveKit)             |
| `REM-Local.postman_environment.json`  | Environment بـ baseUrl محلي + placeholders للـ tokens والـ IDs                       |
| `seed-test-call.js`                   | Script يـ insert Call doc مباشرة في Mongo عشان تختبر `/livekit-token` بدون Socket.IO |

---

## Setup (مرة واحدة)

1. **افتح Postman** → File → Import → اختار الملفين الـ JSON.
2. في الـ top-right اختار environment **"REM Local"**.
3. عدّل القيم دي حسب بيئتك:
   - `baseUrl` → `http://localhost:3000` (أو الـ port اللي بتشغّل عليه)
   - `testEmail` → ايميل حقيقي تقدر تستلم عليه OTP
   - `testPassword` → باسورد قوي

4. تأكد إن السيرفر شغّال محلياً:
   ```powershell
   npm run dev
   ```
   ولازم تشوف في الـ logs:
   ```
   LiveKit webhook receiver mounted   path: /calls/livekit/webhook
   http server listening              port: 3000
   ```
   لو شفت بدلها `LiveKit disabled` يبقى الـ env vars مش متضافة في `.env.dev`.

---

## الـ Flow الكامل (step by step)

### Step 1 — Health checks

شغّل `1. Health → GET /healthz` و `GET /readyz`.

- المتوقع: 200 على `/healthz`، 200 (أو 503 لو Redis مش شغّال) على `/readyz`.

### Step 2 — Signup + Confirm + Login

> لو عندك حساب جاهز ومُأكَّد، اقفز للـ Login.

1. `2. Auth → POST /auth/signup` — هيرجع 200 ويبعت OTP على الإيميل.
2. افتح الإيميل → خد الـ OTP → الصقه في body بتاع `PATCH /auth/confirm-email` → شغّل.
3. `2. Auth → POST /auth/login`
   - الـ test script في الـ request هيحفظ **`accessToken`** و **`userId`** تلقائياً في الـ environment.
   - لو الحساب عليه 2FA الـ response هيكون `{ requiresOTP: true }` — استخدم `POST /auth/validate-login-otp` (مش في الـ collection — ضيفه يدوياً لو محتاجه).

### Step 3 — اعرف الـ roomId

شغّل `3. Chat rooms → GET /chat/rooms`.

- لو ليك أي rooms، الـ test script هيحفظ أول واحد في **`roomId`** تلقائياً.
- لو مفيش، اعمل group room من Postman يدوياً:

  ```http
  POST {{baseUrl}}/chat/rooms/group
  Authorization: Bearer {{accessToken}}
  Content-Type: application/json

  { "name": "LiveKit Test Room", "memberIds": [] }
  ```

  ثم أعد `GET /chat/rooms`.

### Step 4 — اعمل Call doc بـ seed script

الـ `/livekit-token` endpoint محتاج Call موجود فعلاً. عشان كده عندك خياران:

**A) الطريقة السريعة (مُستحسنة) — seed script:**

```powershell
node tests/postman/seed-test-call.js lk-test@example.com
```

(بدّل الإيميل بالـ `testEmail` بتاعك)

الـ output هيبقى زي:

```
✓ created Call doc
  callId        = 6612abc...
  callerId      = 6612def...
  participants  = 2

Paste these into the Postman environment:
  roomId = 6612xyz...
  callId = 6612abc...
```

افتح environment "REM Local" في Postman والصق الـ `callId` في الـ variable.

**B) الطريقة الكاملة — من Socket.IO:**

استخدم client زي [socket.io-client tester](https://amritb.github.io/socketio-client-tool/) أو الـ FE الفعلي:

1. اتصل بـ `ws://localhost:3000/chat` مع header `authorization: Bearer <accessToken>`.
2. ابعت event `call:initiate` بـ `{ roomId: "<roomId>" , type: "video" }`.
3. هيرجع لك event `call:initiated` فيه `callId` — استخدمه.

### Step 5 — جرّب الـ LiveKit endpoint ✨

شغّل `5. LiveKit → POST /chat/rooms/:roomId/calls/:callId/livekit-token`.

**المتوقع (200 OK):**

```json
{
  "success": true,
  "message": "LiveKit token issued",
  "data": {
    "url": "wss://rem-...livekit.cloud",
    "token": "eyJhbGciOi...", // JWT
    "identity": "<userId>__postman-desktop-1",
    "room": "call_<callId>",
    "ttl": "4h",
    "callId": "<callId>",
    "provider": "livekit"
  }
}
```

الـ test scripts المرفقة هتتأكد إن:

- الـ token JWT صحيح (3 parts)
- `payload.video.roomJoin === true`
- `payload.video.room === room`
- الـ `identity` بشكل `<userId>__<deviceId>` (multi-device safe)

كذلك هتحفظ `livekitToken` + `livekitUrl` في الـ environment لاستخدام تاني.

### Step 6 — اختبار سلبي (negative test)

شغّل `5. LiveKit → POST /livekit-token (negative: not a participant)`.

- المتوقع: **404 Call not found** — لإن callId مش موجود في الـ DB.

### Step 7 — Webhook (sanity check فقط)

شغّل `6. LiveKit webhook → POST /calls/livekit/webhook (no signature)`.

**المتوقع: 401** (signature verification failed) — ده الـ correct behavior.

- 200/2xx = security bug، الـ endpoint بيقبل webhooks مزوّرة.
- 404 = الـ route مش متركّب (يعني `LIVEKIT_*` env vars ناقصة).

> الـ webhook الحقيقي مش هينفع تختبره من Postman لإن LiveKit بيوقّع الـ body بـ HMAC. لاختبار حقيقي:
>
> 1. شغّل `ngrok http 3000` أو `cloudflared tunnel --url localhost:3000`.
> 2. خد الـ public URL → روح LiveKit Cloud → Project Settings → Webhooks → Add.
> 3. URL = `https://<ngrok-id>.ngrok.io/calls/livekit/webhook`.
> 4. اعمل أي حركة (join room من LiveKit playground) وشوف الـ server logs.

---

## استخدام الـ token الفعلي للـ join (اختياري)

عندك الـ token + url من Step 5. عشان تتأكد إن LiveKit بيقبله:

**أسرع طريقة — LiveKit playground:**

1. روح <https://meet.livekit.io/?tab=custom>
2. الصق:
   - LiveKit URL: `{{livekitUrl}}`
   - Token: `{{livekitToken}}`
3. اضغط Connect — لو دخلت room اسمه `call_<callId>`، الـ token صحيح ✅

**من command line بـ livekit-cli:**

```powershell
livekit-cli join-room --url <livekitUrl> --token <livekitToken>
```

---

## Troubleshooting

| الـ symptom                                           | الـ سبب الأرجح                                        | الـ حل                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `503 LiveKit is not configured`                       | env vars ناقصة                                        | ضيف `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` في `src/config/.env.dev`        |
| `401 Authorization header is missing`                 | `accessToken` فاضي في الـ env                         | شغّل Login تاني — أو شوف الـ Tests tab وارجع الـ console                                   |
| `404 Call not found` على الـ token endpoint           | الـ `callId` غلط أو الـ call اتقفل                    | شغّل `seed-test-call.js` تاني وحدّث الـ env                                                |
| `409 Call is ended; cannot join`                      | حالة الـ call مش `ringing`/`active`                   | seed call جديدة                                                                            |
| `403 Not a participant in this call`                  | الـ user مش في الـ `participants` array بتاع الـ call | seed كانت بـ user تاني — استخدم نفس الـ user اللي بتسجل بيه                                |
| الـ webhook بيرجع 404                                 | الـ env vars مش متضافة وقت boot                       | restart السيرفر بعد ما تضيفهم                                                              |
| `connection refused` على Mongo في seed                | Mongo مش شغّال                                        | `mongod` أو start MongoDB service                                                          |
| الـ JWT في الـ response لكن LiveKit playground بيرفضه | الـ `LIVEKIT_API_SECRET` غلط أو متفلتر                | اتأكد من الـ secret في الـ LiveKit dashboard، وإن `.env.dev` ما فيهوش whitespace آخر السطر |

---

## Cleanup بعد ما تخلص

```js
// في mongo shell:
db.calls.deleteMany({
  "participants.userId": ObjectId("<userId>"),
  status: "ringing",
});
```

أو سيب الـ idle cron job يـ recover الـ orphans بعد ساعة (`recoverOrphanedSessions`).
