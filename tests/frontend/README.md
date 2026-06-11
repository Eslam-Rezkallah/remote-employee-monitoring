# Test Harness — Frontend

صفحة HTML واحدة self-contained لاختبار الـ backend (login + chat + LiveKit calls) من غير ما تتعملها build أو تلمسي الـ FE الموجود.

## كيف تشغّليها

1. شغّلي السيرفر:
   ```powershell
   npm run dev
   ```
2. افتحي في المتصفح:
   ```
   http://localhost:3000/test/
   ```
   (الـ slash في الآخر مهم — بدونها Express هيرجّع 301 redirect أحياناً)

3. هتشوفي 4 sections: **Login → Chat rooms → Call → Activity log**

## Flow عادي (single user)

1. **Login** بحساب موجود (لو لسه ما عندكش، استخدمي Postman للـ signup + confirm-email).
2. الصفحة هتعمل auto-fetch للـ chat rooms بتاعتك.
3. اضغطي على room من القائمة → الـ call buttons تتفعّل.
4. اضغطي **📹 Video call** — هيحصل التالي تلقائياً:
   - Socket emits `call:initiate`
   - Backend يرجّع `call:initiated` + callId
   - الصفحة تطلب LiveKit token من REST
   - LiveKit بيتصل → الكاميرا/مايك بيتشغلوا → الفيديو يظهر في الـ grid
5. **Hang up** بينهي الـ call ويـ disconnect من LiveKit + يبعت `call:end` للـ socket.

## Flow بـ 2 users (الـ realistic test)

1. **متصفح 1**: سجّلي بـ user A.
2. **متصفح 2** (private/incognito أو متصفح تاني): سجّلي بـ user B.
3. **مهم**: الاتنين لازم يكونوا أعضاء في نفس الـ chat room.
4. من user A: اختاري الـ room → **Video call**.
5. عند user B: هتظهر notification "Incoming video call from A" — اضغطي **Accept**.
6. الاتنين هيتقابلوا في الـ LiveKit room، تشوفوا وتسمعوا بعض ✅.

## Shortcut بدون Socket.IO

لو عندك callId موجود مسبقاً (مثلاً عملتيه بـ `seed-test-call.js`):

1. اختاري الـ room نفس بتاع الـ call.
2. وسّعي **"Already have a callId?"**.
3. الصقي الـ callId → **Join LiveKit room**.

هتدخلي على الـ media مباشرة بدون رنّة.

## الـ Controls المتاحة وقت الـ call

- **🎙 Mute / Unmute** — toggle المايك
- **📷 Camera off / on** — toggle الكاميرا
- **🖥 Share screen** — يبعت screen share على LiveKit (المتصفح هيسأل permission)
- **Hang up** — يقفل كل حاجة

## Troubleshooting

| المشكلة | الـ سبب | الـ حل |
|---|---|---|
| الصفحة فاضية أو الـ scripts ما اشتغلتش | CSP بيـ block الـ CDN | اعملي hard refresh (Ctrl+Shift+R)، تأكدي من الـ Network tab |
| `login failed: 401` | كلمة المرور غلط أو 2FA مفعّل | جربي حساب من غير 2FA |
| `No rooms — join an org first` | الـ user مش عضو في أي org | استخدمي Postman: `POST /auth/org-join` بـ joinCode |
| `503 LiveKit is not configured` | env vars ناقصة | ضيفي LIVEKIT_URL/API_KEY/API_SECRET في `src/config/.env.dev` وعيدي تشغيل |
| الكاميرا/مايك مش بيشتغلوا | المتصفح بلوك الـ permission | اضغطي 🔒 في address bar → اسمحي للـ camera + microphone |
| الصوت بيعمل echo | فاتحة نفس الـ account في 2 tabs بدون mute | استخدمي private/incognito للـ user التاني |
| الـ video بيظهر مقلوب لي شخصياً | ده normal — local video مرآة (selfie mode). الـ remote بيشوفك صح. | — |
| `socket connect_error` | الـ accessToken ناقص أو الـ namespace غلط | لوغ out و login تاني |

## الـ Tech المستخدم (CDN فقط — مفيش build)

- **Tailwind CSS** — `https://cdn.tailwindcss.com`
- **Socket.IO Client** — `https://cdn.socket.io/4.7.5/socket.io.min.js` (matches server 4.x)
- **LiveKit Client SDK** — `https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js`

كل شيء vanilla JavaScript، مفيش React/Vue/Angular، مفيش npm install. الصفحة بتشتغل من المتصفح مباشرة.

## ليه same-origin مهم

الصفحة بتـ served من `http://localhost:3000/test/` ← نفس origin الـ API → مفيش CORS issues. لو فتحتي الـ HTML مباشرة بـ `file://` هتاخدي CORS errors لأن الـ backend `cors()` بيقبل بس الـ `config.app.frontendUrl`.

## التطوير

كل شيء في `index.html` — مفيش source maps ولا bundler. عدّلي الـ HTML مباشرة وعملي refresh.
