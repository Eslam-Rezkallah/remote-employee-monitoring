# فحص تكامل Jira + Slack — مشروع REM

## الهدف
المشروع يدمج **Jira-like** (مهام، سبرنتات، مشاريع، فرق، تعليقات، إشعارات) مع **Slack-like** (غرف دردشة، رسائل، تفاعلات، سوكيت مباشر). هذا الملف يلخص الحالة الحالية والثغرات والتحسينات المقترحة.

---

## 1) ما يعمل حالياً

### جانب Jira
| الموديول | المسارات | الملاحظات |
|----------|----------|-----------|
| **Tasks** | `/org/:orgId/spaces/:spaceId/tasks` | إنشاء، تحديث، backlog، due-date، تعيين |
| **Sprints** | `/org/:orgId/spaces/:spaceId/sprints`, `/sprints` | إنشاء، تغيير الحالة (Planned/Active/Closed) |
| **Projects** | `/org/:orgId/projects` | CRUD، أعضاء، مدير، حالة |
| **Spaces** | `/org/:orgId/spaces` | مساحات (Project/Team/Personal)، summary، backlog، timeline، calendar |
| **Comments** | `/tasks/:taskId/comments` | تعليقات على المهام فقط، ردود، @mentions |
| **Notifications** | `/notifications` | إشعارات (تعليق، مهمة، مشروع، فريق، سبرنت)؛ تُحفظ في DB وتُرسل عبر Socket للغرفة `user_<userId}` |
| **Teams** | `/teams` | فرق عامة، أعضاء، مديرون |
| **Organizations** | `/org` | إنشاء، دعوات، قبول، حذف |

### جانب Slack
| الموديول | المسارات / السوكيت | الملاحظات |
|----------|---------------------|-----------|
| **ChatRooms** | `/chat/rooms` | DM، قناة، فريق، منظمة، مجموعة؛ مع join/leave وإدارة أعضاء |
| **Messages** | `/chat/rooms/:roomId/messages` | نص، صوت، صور، ملفات (Cloudinary)، رد، seen/delivered، تعديل/حذف خلال ساعة |
| **Reactions** | `.../messages/:messageId/reactions` | إيموجي مسموح (👍 ❤️ 😂 …) |
| **Socket** | Namespace `/chat` | join_room, send_message, typing, message_seen, add_reaction, edit_message, delete_message, online/offline |

### مشترك
- **Auth:** نفس JWT (REST + Socket namespaces).
- **User / Member:** نفس نموذج المستخدم والعضوية في المنظمة.
- **الاستجابات والأخطاء:** `success.response`, `error.response`, `asyncHandler`.
- **DB وملفات:** `db.service`, `file.model` يدعم Task و Message.

---

## 2) إصلاح تم تطبيقه

- **الإشعارات لا تصل:** الإشعارات كانت تُرسل إلى `io.to('user_<userId>')` بينما الـ socket في الـ default namespace لم يكن ينضم لهذه الغرفة. تم في `auth.service.js` إضافة `socket.join('user_'+userId)` بعد المصادقة حتى تصل الإشعارات فعلياً للمستخدم.

---

## 3) ثغرات تكامل Jira + Slack (مقترحة للمرحلة القادمة)

### أ) ربط القنوات بالمشاريع/المساحات
- **الوضع:** غرف الدردشة تدعم `organizationId`, `teamId`, `projectId` لكن لا يوجد flow واضح "قناة لهذا المشروع" أو "قناة لهذه المساحة".
- **اقتراح:**  
  - إما endpoint من نوع: إنشاء قناة مرتبطة بـ project/space مع تعبئة `projectId` أو إضافة حقل `spaceId` للغرفة.  
  - أو في الواجهة: عند فتح مشروع/مساحة عرض قناة مرتبطة أو اقتراح إنشائها.

### ب) أحداث Jira → قنوات Slack
- **الوضع:** إشعارات المهام/السبرنت/المشروع تذهب فقط إلى **المستخدمين** (غرفة `user_<userId>`)، ولا يُنشر شيء تلقائياً في **قناة دردشة**.
- **اقتراح:**  
  - اختياري: ربط مشروع/فريق/مساحة بقناة (مثلاً حقل `linkedChatRoomId` على Project أو Space).  
  - عند حدث معين (مثلاً مهمة أُنجزت، سبرنت اكتمل): إرسال رسالة نظام (system message) للقناة المرتبطة أو إشعار في الـ chat namespace.

### ج) @mentions في الدردشة
- **الوضع:** التعليقات على المهام تدعم mentions وإشعارات؛ الرسائل في الدردشة لا تدعم تحليل @user ولا إشعار للمُشار إليه.
- **اقتراح:**  
  - في `message.service` (وإن أمكن في Socket): استخراج من `content` أي `@userId` أو @username.  
  - إنشاء إشعار (أو نظام notification) للمُشار إليه وربطها بـ `entityType: "Message"`, `entityId: messageId`.

### د) تناسق صلاحيات القنوات مع Member
- **الوضع:** `createChannel` يتحقق من `["owner", "admin", "manager"]`؛ في `member.model` الأدوار هي `owner`, `admin`, `member` فقط (لا يوجد `manager` كدور عضوية).
- **اقتراح:**  
  - إما إضافة دور `manager` في المنظمة إن كان مطلوباً، أو استبدال التحقق ليكون فقط `owner` و `admin` لإنشاء قنوات المنظمة، وترك "مدير القناة" لاحقاً كصلاحية منفصلة داخل الغرفة (مثلاً `admins` في الـ ChatRoom).

### هـ) مسار التعليقات vs مسار المهام
- **الوضع:** التعليقات على `/tasks/:taskId/comments` (بدون orgId/spaceId في المسار)، بينما المهام تحت `/org/:orgId/spaces/:spaceId/tasks`. نفس المهمة يُشار إليها بـ `taskId` فقط في التعليقات.
- **اقتراح:**  
  - إما توحيد المسار مثل: `/org/:orgId/spaces/:spaceId/tasks/:taskId/comments` ليكون واضحاً أن التعليقات تابعة لمساحة معينة، أو الإبقاء على الوضع الحالي مع التأكد أن الـ authorization يتحقق من أن المستخدم له حق الوصول للمهمة قبل أي عملية على التعليقات.

### و) Boards وواجهة الجاهزية
- **الوضع:** لا يوجد REST مخصص لـ "board"؛ الـ views موجودة في `spaceView.model` (summary, timeline, backlog, sprints, calendar).
- **اقتراح:** إن رغبت في واجهة Jira-board كاملة، إضافة endpoints لإنشاء/تحديث/جلب board (view) أو الاعتماد على الـ summary/backlog الحالية وتوثيقها كـ "board" في الـ API docs.

---

## 4) هيكل الملفات (مرجع سريع)

```
src/
├── App.controller.js          # تجميع كل المسارات
├── middleware/
│   ├── auth.middleware.js     # REST auth
│   └── socket/auth.middleware.js  # Socket /chat auth
├── modules/
│   ├── auth, user, organization, team, project
│   ├── task, sprint, space, comment, notification   # Jira-like
│   ├── chatroom, message, reaction                  # Slack-like
│   └── socket/ (auth.service, chat.socket)
├── DB/Model/
│   ├── user, member, organization, invitation
│   ├── task, sprint, project, space, spaceView, comment, notification, file
│   └── chatroom, message, reaction
└── utils/events/notification.event.js   # إشعارات Jira → Socket
```

---

## 5) خلاصة

- **التكامل الحالي:** نفس المستخدم ونفس المصادقة والعضوية لكل من Jira و Slack؛ الإشعارات تعمل بعد إصلاح انضمام الـ socket لغرفة `user_<userId>`.
- **لتحقيق تكامل أعمق (Jira + Slack):** ربط القنوات بمشاريع/مساحات، نشر أحداث Jira في قنوات (اختياري)، دعم @mentions في الدردشة، وتوحيد صلاحيات إنشاء القنوات مع أدوار Member.
