# التثبيت والتشغيل والاختبار

## المتطلبات

Node.js 22 مع npm وJava 21 وGit. من جذر النسخة المستنسخة، في PowerShell:

```powershell
node --version
npm.cmd --version
java -version
npm.cmd ci --prefix support --ignore-scripts --no-audit --no-fund
npm.cmd ci --prefix app/functions --ignore-scripts --no-audit --no-fund
Set-Location support
npx.cmd --no-install playwright install chromium
npm.cmd run install:emulator
# اضبط المسار إلى Java 21 المثبت على جهازك
$env:PERSONAL_TEST_JAVA = Join-Path $env:JAVA_HOME 'bin/java.exe'
npm.cmd run check
npm.cmd test
Set-Location ..
```

على macOS/Linux استخدم npm/npx بدل npm.cmd/npx.cmd وjava بدل java.exe. Java قد يحتاج مسار ASCII على Windows عند تشغيل القواعد داخل مجلد عربي. support/portable-env.cjs صار يشير إلى app الحالي؛ المرجع التاريخي السابق كان يشير إلى سبتمبر. لا تنقل node_modules بين الأجهزة.

اختبارات خادم مستقلة:

```powershell
npm.cmd --prefix app/functions test
```

معاينة اصطناعية، دون تسجيل دخول إنتاج:

```powershell
npm.cmd --prefix support run preview
```

`safe-preview.cjs` أداة Playwright تولد لقطات وتقارير، وليست وعداً بخادم تفاعلي دائم. راجع مخرجاتها. اختبارات المتصفح تحجب الشبكة الخارجية وتستخدم هويات اصطناعية. نجاح المحلي لا يثبت عمل كاميرا أو صوت أو مزامنة هاتف فعلي.

## البناء والإعدادات

المصدر الحالي ثابت في app/netlify_site؛ لا npm build للواجهة. المكتبات المطلوبة مرفقة محلياً مع تراخيصها. الوسائط التعليمية المسجلة مستبعدة للمراجعة الشخصية/الحجم؛ قد تكون روابط المساعدة ناقصة، ولا تستخدم النسخة المنقحة كنشر جاهز. الملف السابق offline-package-manifest وبيانات تجميد الإصدار يوثقان الأصل وليسا ضمان تطابق الحزمة الجديدة.

تعمل اختبارات البيانات الاصطناعية دون أسرار. لربط نسخة معتمدة بخدمات فعلية، يقدم المسؤول القيم خارج Git ثم:

```powershell
Copy-Item .env.example .env
# املأ .env محلياً دون مشاركته
node --env-file=.env tools/configure-handover.cjs
```

هذا الأمر يولد القيم في الشيفرة والقواعد محلياً فقط؛ الملفات الناتجة تصبح حساسة ولا يجوز commit لها. لا ينفذ نشرًا أو اتصالاً. المتصفح لا يقرأ process.env، وقواعد Firestore لا تدعم متغيرات البيئة، لذلك توجد خطوة توليد صريحة. الخادم يقرأ HATHIR_OWNER_UID/HATHIR_OWNER_EMAIL مباشرة في المواضع الداعمة؛ يجب اتساق هوية المالك في القواعد وبقية المكونات. `.env` في الجذر لا يُحمَّل تلقائياً بواسطة Firebase Functions؛ عند نشر معتمد تُمرر إعداداته عبر آلية runtime المراجعة.

| اسم المتغير | الاستخدام |
|---|---|
| HATHIR_FIREBASE_API_KEY | مفتاح إعداد SDK للواجهة؛ أُزيل بناءً على طلب عدم رفع أي مفتاح |
| HATHIR_OWNER_UID | هوية المالك لتطابق الخادم والقواعد والواجهة |
| HATHIR_OWNER_EMAIL | بريد المالك المعتمد، مع UID والتحقق؛ البريد وحده لا يمنح الصلاحية |
| HATHIR_SUPPORT_EMAIL | عنوان الدعم الاختياري |
| HATHIR_RUNTIME_SERVICE_ACCOUNT | حساب تشغيل Functions؛ ليس ملف مفتاح خاص |
| PLAYWRIGHT_MODULE | مسار وحدة Playwright الاختيارية |
| CHROME_PATH | مسار Chromium/Chrome المحلي |
| NAME_QR_GENERATOR_JS / NAME_QR_DECODER_JS | مسارا مكتبات اختبارات QR |
| PERSONAL_TEST_JAVA / PERSONAL_TEST_FIRESTORE_JAR | Java 21 ومحاكي Firestore |
| JAVA_HOME | جذر تثبيت Java في بيئة النظام |
| HATHIR_PRODUCTION_RELEASE | موافقة إصدار صريحة لحارس النشر؛ ليست سراً |
| HATHIR_FREEZE_RELEASE / HATHIR_FREEZE_MANIFEST | اسم الإصدار وملف التجميد؛ لا تضبط لتجاوز الحواجز |

لا تحتاج الاختبارات FIREBASE_TOKEN أو ملف حساب خدمة أو كلمة مرور حقيقية. مفاتيح VAPID تولدها خدمة الدفع وتحفظها في مخزن خادمي محمي؛ لا تنقلها إلى .env.example أو المستودع.

قائمة أسماء متغيرات الأدوات والاختبارات الإضافية، مع مواضع استخدامها ودون قيم، في ENVIRONMENT_INVENTORY.md. ليست جميعها إعدادات مطلوبة لتشغيل البرنامج.

## النشر مستقبلاً

هذه المهمة ترفع إلى GitHub فقط. لا تنشر Firebase من هذه الحزمة قبل مراجعة التنقيح والوسائط والتجزئات، وإعادة الاختبارات، وتجهيز نسخة احتياطية وإثباتاتها، وفحص الهدف والحساب والمناطق. لا تحذف deploy-check ولا تصنع أدلة نجاح. تقارير الإصدارات القديمة محفوظة كما كانت من ناحية الزمن، وليست تقارير تحقق حديثة.
