> **الحالة الحالية — الإصدار 0.3:** استُعيدت واجهة حاضر الأصلية في المشروع المستقل ونُشرت. اقرأ [CLASSIC_STATUS.md](CLASSIC_STATUS.md) أولًا. المصدر الفعّال: `classic/netlify_site` و`classic/functions`. حساب المالك الحقيقي مسجل ومتحقق ومعتمد. النص أدناه يوثق الإصدار 0.2 السابق ولا يصف الواجهة الحالية.

# حاضر — إعادة بناء مستقلة

المشروع الوحيد: `hathir-rebuild-2026`. المصدر في هذا المجلد، ولا تُستخدم بيانات مشروع الإنتاج أو حساباته.

## تشغيل وفحص

يلزم Node.js 22 وJava 21 للمحاكي. الحزم الأمامية: `pnpm install`. حزم الخادم: `npm ci` من مجلد functions (أو pnpm باستخدام ملف القفل المتاح).

- `pnpm build`: تجميع الواجهة وحفظ المكتبات والنماذج محليًا وتوليد Service Worker.
- `pnpm test`: اختبارات المنطق والطابور والتقارير وQR.
- `pnpm test:integration`: اختبارات الخادم والقواعد، وتتطلب Firestore Emulator على 127.0.0.1:8080.
- `pnpm test:browser`: اختبارات الواجهة عبر Auth/Functions/Firestore/Hosting Emulators، بعد `pnpm exec playwright install chromium webkit`.
- `pnpm test:face`: فحص النموذج بصورة المكتبة الاختبارية في محركي المتصفح.
- `node tests/scanner-browser.mjs`: كاميرا اصطناعية تحمل QR وقارئ بطاقة محاكى.

شغّل Firebase Emulator Suite باستخدام المشروع الجديد فقط. على Windows يسيء Java التعامل مع المسارات العربية في وسيطة rules؛ ملف firebase.emulator.json المحلي يوجه القواعد إلى نسخة مؤقتة بمسار ASCII. هذا الملف للاختبار ولا يستخدم للنشر.

## النشر

`pnpm deploy` يستعمل scripts/deploy.mjs، ويثبّت معرّف المشروع والموقع الجديد ويرفض تمرير هدف بديل. لا تستخدمه قبل مراجعة BUILD_STATUS.md ونجاح اختبارات الإصدار. `.firebaserc` وhosting.site كلاهما يشيران إلى المشروع الجديد.

## حساب المالك

لا يُنشأ حساب المالك آليًا ولا تُولّد له كلمة مرور. ينشئ المستخدم حسابه ويتحقق من بريده، ثم يستعمل المسؤول المعتمد `functions/bootstrap-owner.mjs <uid> <email>` بعد ضبط GCLOUD_PROJECT على المشروع الجديد. السكربت يتحقق من تطابق UID والبريد الموثق وملف الحساب الموجود؛ لا ينشئ مستخدم Auth.

تفاصيل البيانات والتزامن: ARCHITECTURE.md. اختبارات الأجهزة الفعلية المطلوبة: DEVICE_ACCEPTANCE.md. الحالة والأدلة: BUILD_STATUS.md.
