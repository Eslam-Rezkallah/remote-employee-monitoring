# Naming convention — file names

التوحيد ده **forward-only**: الملفات الجديدة لازم تتبعه. الـ legacy files المخالفة موثقة تحت — تتعالج في PR rename منفصل (آمن من تغييرات لوجيكية تخلطها).

## القاعدة

```
<feature>.<role>.js
```

| الـ role | الـ Examples |
|---|---|
| `controller` | route mounting + middlewares wiring فقط |
| `service`    | business logic |
| `validation` | Joi schemas |
| `model`      | Mongoose schema + indexes |
| `middleware` | Express middleware |
| `event`      | EventEmitter listeners |
| `socket`     | Socket.IO namespace handlers |
| `job`        | cron / background jobs |
| `permissions`| access-control helpers |
| `util`       | pure utilities |

## نظام الـ `<feature>`

- **kebab-case للـ multi-word**: `task-dates.service.js` (لا `task.dates.service.js`)
- **camelCase للـ JS identifiers** بس، **مش للـ file names**: `worksession.model.js` ❌ → `work-session.model.js` ✅
- لو الـ feature في multiple files، نفس الـ prefix:
  - `chat.controller.js` + `chat.service.js` + `chat.validation.js` (مش `chat.room.controller.js` + `chat.service.js`)

## Legacy violations (rename في PR مخصص)

| الحالي | المطلوب | المخاطر |
|---|---|---|
| `src/modules/chatroom/chat.room.controller.js` | `chat.controller.js` (أو rename الـ folder لـ `chat-room`) | imports في `App.controller.js` |
| `src/DB/Model/worksession.model.js` | `work-session.model.js` | imports في ~10 ملفات |
| `src/modules/task/service/task.dates.service.js` | `task-dates.service.js` | imports في 2 ملفات |
| `src/modules/task/service/task.query.service.js` | `task-query.service.js` | imports في 1 ملف |
| `src/modules/chatroom/service/chat.room.validation.js` | `chat.validation.js` | imports في الـ controller |

## الـ folder conventions

```
src/
├── DB/Model/                 ← models (camelCase OR kebab-case for multi-word)
├── modules/<feature>/         ← features (kebab-case folder)
│   ├── service/               ← services
│   ├── <feature>.controller.js
│   ├── <feature>.validation.js
│   └── <feature>.routes.js     (إن وُجد)
├── middleware/                 ← shared middleware
├── utils/<category>/           ← utilities
└── config/                     ← env + Joi schema
```

## الـ identifier naming (داخل الكود)

| الـ kind | الـ convention | example |
|---|---|---|
| Variables / parameters | camelCase | `userId`, `chatRoomId` |
| Functions | camelCase verb-noun | `createTask`, `requireOrgMember` |
| Classes | PascalCase | `AppError`, `BadRequestError` |
| Constants (exported enums) | UPPER_SNAKE_CASE | `SESSION_STATUS.ACTIVE` |
| Constants (config keys) | camelCase | `config.app.frontendUrl` |
| Booleans | is/has/can prefix | `isDeleted`, `hasPermission`, `canEdit` |
| Async functions | verb in present | `loadTask` not `loadingTask` |

## Pre-commit check (optional)

لو هتعملي ESLint config لاحقاً، الـ rule المهمة:
```json
{
  "rules": {
    "unicorn/filename-case": ["error", { "case": "kebabCase" }]
  }
}
```
