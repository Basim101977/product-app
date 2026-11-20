# الخدمات والوصول والأسرار

لا تتضمن هذه الحزمة كلمات مرور أو ملف حساب خدمة أو مفتاح إدارة أو رمز جلسة. الحساب داخل تطبيق «حاضر» لا يمنح تلقائيًا صلاحيات Firebase CLI. اطلب من المالك إضافة المطور إلى المشروع بأقل صلاحية لازمة، وسجّل الدخول بنفسك مع MFA؛ لا تنقل جلسة المتصفح أو `firebase-tools.json` من جهاز المالك.

| الخدمة | الغرض | اللوحة/الرابط |
|---|---|---|
| Firebase Console، مشروع `alqar-student-attendance-2026` | Auth، Firestore، Functions، Hosting، قواعد وفهارس | https://console.firebase.google.com/project/alqar-student-attendance-2026/overview |
| Firebase Hosting، الموقع `hathir` | التطبيق الرسمي | https://hathir.web.app/ ؛ لوحة الاستضافة من Firebase Console |
| Google Cloud Console | صلاحيات IAM وسجلات وظائف ومناطق التشغيل والفوترة عند الحاجة | https://console.cloud.google.com/home/dashboard?project=alqar-student-attendance-2026 |
| ElevenLabs | استُخدم أو نوقش لتوليد صوت «عبد الله» في مواد الشرح؛ لا توجد مفاتيح أو إثبات ترخيص داخل الحزمة | https://elevenlabs.io/app/speech-synthesis/text-to-speech |

## ملفات الإعداد ومتغيرات البيئة

- `project/source/work/hathir-production-upgrade-20260922/app/.firebaserc` يحدد alias المشروع الحقيقي؛ `firebase.json` يحدد موقع `hathir` ومصدر الوظائف والقواعد. `netlify_site/runtime-config.js` يحوي إعدادات عميل Firebase العامة (بما فيها Web API key العامة الخاصة بتهيئة العميل)، **ليست مفتاح Admin**. لا تُحوّلها إلى مشروع تجريبي بتغيير ملف واحد.
- `HATHIR_OWNER_UID`, `HATHIR_OWNER_EMAIL`: تثبيت هوية المالك في `functions/personal-workspace.js`. توجد قيم افتراضية في المصدر؛ ليست سرًا بديلًا عن تحقق Auth والقواعد. راجع تطابقها مع مالك المشروع عند إعادة إعداد البيئة، ولا تضع كلمة مرور في الملف.
- `HATHIR_RUNTIME_SERVICE_ACCOUNT`: اسم حساب الخدمة لتشغيل الوظائف في `functions/index.js`. القيمة الافتراضية المضمنة عنوان حساب خدمة، **وليست مفتاحه الخاص**؛ تحقق من IAM دون نسخ مفاتيح JSON.
- `HATHIR_PRODUCTION_RELEASE`: علم إصدار صريح يطلبه `tools/deploy-check.cjs` للنشر. `HATHIR_FREEZE_RELEASE` و`HATHIR_FREEZE_MANIFEST`: اسما الإصدار وملف بيان التجميد في `tools/freeze-release.cjs`. `GCLOUD_PROJECT` إن كان مضبوطًا يجب أن يطابق مشروع الإنتاج.
- `PERSONAL_TEST_JAVA`, `JAVA_HOME`, `PERSONAL_TEST_FIRESTORE_JAR`, `CHROME_PATH`, `PLAYWRIGHT_MODULE`, `NAME_QR_GENERATOR_JS`, `NAME_QR_DECODER_JS`: مسارات أدوات الاختبار المحلية، لا أسرار. وثقتها `project/docs/SETUP-AND-TESTS.md`.
- `project/.env.example` نموذج إعدادات محلية. افحص القيم قبل استعماله؛ لم تُنسخ ملفات `.env` فعلية إلى الحزمة.

## ملفات مستبعدة وحساسية بيانات

استُبعدت `.private/`، وملفات النسخ الاحتياطية المشفرة ومفاتيحها، و`node_modules/`، و`.firebase/` المؤقتة، وأي ملفات `.key`, `.pem`, `.p12`, `.pfx`, `.enc`. نسخ استعادة التطبيق في Firestore **ليست داخل ZIP**. لا تضع بيانات اعتماد Google أو مفاتيح ElevenLabs أو صور وجوه الطلبة أو سجلاتهم الحية في Git أو في تذكرة دعم.

فحص أسماء الملفات وأنماط الأسرار في المصدر أظهر مواضع تتطلب مراجعة بشرية دون إظهار القيم: `netlify_site/runtime-config.js` (إعداد عميل عام)، `netlify_site/index.html` (عينات/بيانات قديمة منقحة وفق `project/evidence/privacy-transform.json`)، `functions/index.js` (عنوان حساب الخدمة)، وملفات اختبار `tests/personal-ui-regression.cjs` و`tests/offline-harness.cjs` (قيم اختبار اصطناعية). **لم أجد ملف مفتاح خاص ضمن الملفات المنسوخة بهذا الفحص، لكن هذا ليس تدقيقًا أمنيًا شاملًا.** إذا ظهر اعتماد حقيقي في أي ملف لاحقًا، دوّن مساره وانقل السر إلى خدمة أسرار مع تدويره؛ لا تطبع قيمته في سجل أو تقرير.

قبل النشر: احصل على نسخة احتياطية جديدة بمسار خارج الحزمة، تحقق من SHA256 وإمكان الاستعادة وفق `tools/deploy-check.cjs`، ثم نفّذ QA وتجميدًا وإذن نشر مناسبًا. لا تُعدل حاجز النشر لإخفاء غياب النسخة أو تغيّر التجزئات.
