# تسليم مشروع «حاضر» إلى جهاز جديد

تاريخ التسليم: ٢٢ سبتمبر ٢٠٢٦. هذا الملف نقطة المرجع للمطور، وليس دليل استخدام للتدريسي. اقرأ أولًا `START_HERE.md`، ثم الوثائق داخل `docs`.

## ١. النسخة المعتمدة وحدود الحزمة

الموقع المعتمد هو https://hathir.web.app/، والمشروع السحابي هو `alqar-student-attendance-2026`. الإصدار المعتمد `v2026.09.22-personal-upgrade-1`، ونُشر في ٢٢ سبتمبر ٢٠٢٦. **نقل الملفات لا ينقل قاعدة البيانات ولا ينشئ برنامجًا سحابيًا آخر.**

المصدر الذي يجب تطويره داخل الحزمة:

```text
source/work/hathir-production-upgrade-20260922/app
```

نُسخت الملفات الفعلية، بما فيها الملفات المخفية الضرورية وملف قفل المكتبات والاختبارات والموارد. لم يُعتمد على تصدير Git؛ لم يكن المجلد الحالي مستودع Git صالحًا عند الفحص. لذلك لا نفترض وجود فرع أو رقم commit. تجزئات الملفات تثبت النسخة المنقولة وتلتقط التعديلات المحلية الموجودة، سواء حُفظت في Git أم لا.

**استثناء موثّق بموافقة المستخدم:** نسخة التسليم من `netlify_site/index.html` منقّحة من ٣٤ اسمًا/معرّفًا ثابتًا وبيانات ٧ حسابات محلية افتراضية، مع استبدالها بقيم اصطناعية. نُقّحت العينة التاريخية المستخدمة في الاختبارات بالطريقة المحدودة نفسها. واستُبدل بريد وكلمة مرور محليان في سطر بيانات اختبار واحد من `tests/personal-ui-regression.cjs` بالقيم الاصطناعية المقابلة، دون تغيير شروط الاختبار أو تدفقه. لم تتغير ملفات المشروع الأصلية أو الموقع المنشور. لا تُعتبر هذه المشتقات نسخ استرجاع مطابقة حرفيًا للأصول. بيان `evidence/privacy-transform.json` يسجّل التجزئات والأعداد دون القيم المحذوفة؛ و`PACKAGE-VERIFICATION.md` يبين نتيجة الاختبار وحدودها. بقيت الوظائف وقواعد الأمن ومنطق المزامنة وملفات القفل وبقية الاختبارات الأصلية دون تعديل.

المجلد التالي **مرجع تاريخي للاختبار فقط، وليس التطبيق الذي يجب نشره**:

```text
source/work/hathir-mobile-actions-20260919/candidate/netlify_site
```

احتُفظ بهذا المسار النسبي لأن اختبارات انتقال التخزين وعامل الخدمة تستخدم عامل الخدمة والتخزين من النسخة الأصلية فعلًا، مع عينة HTML تاريخية منقّحة فقط وفق الاستثناء أعلاه. أدوات `support` إضافات خاصة بالنقل لتثبيت متطلبات الاختبارات وتشغيلها على جهاز آخر؛ لم تُعدّل بها ملفات التطبيق الأصلي.

## ٢. فكرة البرنامج والمستخدمون

برنامج ويب لتسجيل حضور الطلبة ومتابعة الساعات والغياب، بالعربية والإنجليزية، مع تثبيت اختياري كتطبيق ويب والعمل المحلي ثم المزامنة.

النموذج الحالي هو **مساحة خاصة لكل تدريسي**. يقوم التدريسي المعتمد بإنشاء مواده واختيار القسم والمرحلة والسنة، وإضافة قوائم الطلبة بالأسماء أو استيرادها، وتعديل طلبته وحالاتهم، وتسجيل الحضور وتصحيحه وإلغائه، والتصدير والاستعادة ضمن مساحته. لا يصل إلى بيانات زملائه.

المالك يدير الموافقات على الحسابات. نموذج إدارة الأقسام المشتركة والمخولين الذي نوقش سابقًا **ليس نموذج هذه النسخة**. لا تُعد إليه تلقائيًا اعتمادًا على ملفات تاريخية أو أفكار قديمة.

التسجيل الجديد يتطلب البريد الإلكتروني واسمًا من ثلاثة أجزاء وكلمة مرور قوية؛ يتحقق الخادم من الهوية، ويحتاج الحساب الجديد إلى تأكيد البريد وموافقة المالك. لا تعتبر وجود بريد مكتوب دليلًا على ملكيته.

عند الترقية بقيت الحسابات الأصلية الـ٢٨ في خدمة Auth نفسها، بلا استبدال كلمات المرور. الحسابات القديمة المعتمدة لها استثناء خادمي محدد من شرط تأكيد البريد، وليس إعفاءً عامًا لكل حساب قديم أو تعطيلًا للأمن. تغيير البريد أو سحب الموافقة يخضع للتحقق مجددًا. لا يوجد في الحزمة جدول الهويات المستثناة.

## ٣. الإمكانيات الحالية

- واجهة تسجيل الدخول وإنشاء الحساب، إظهار/إخفاء كلمة المرور، انتظار التأكيد والموافقة، وفتح المساحة الشخصية.
- إدارة المواد، القسم والمرحلة والسنة الدراسية والساعات، وأنظمة التدريس وحدود التنبيه والإنذار والرسوب القابلة للضبط لكل مادة.
- إضافة الأسماء واستيراد القوائم، إنشاء معرّفات تقنية داخلية، وبطاقات حضور تحمل اسم الطالب دون إظهار رقمه في الجداول أو التصدير.
- رمز حضور مختصر ثابت مشتق من الاسم المطبّع. تُراعى فروق كتابية عربية محددة؛ التشابه غير المحسوم يُرفض، ولا تُدمج سجلات طالبين تلقائيًا.
- الماسح الذكي لرمز QR أو الوجه المسجل، التسجيل اليدوي، وقارئ RFID الذي يكتب كلوحة مفاتيح. يوجد NFC ضمن حدود الأجهزة والمتصفحات المدعومة؛ ليس وعدًا بالعمل على كل هاتف أو كل بطاقة جامعية.
- المحاضرة تبدأ من أول تسجيل، وتغلق يدويًا أو بانتهاء مدتها، ويمكن إلغاؤها. تسجيل مجموعة لاحقة يبدأ جلسة مستقلة، حتى في اليوم نفسه وللمادة نفسها. لا تقسيم إلزامي إلى شعب في حساب الحضور الحالي.
- الحفظ المحلي وطابور عمليات للمزامنة؛ تشمل العمليات الحضور والتصحيح والإلغاء وحالة المحاضرة. ظهور السجل على الشاشة لا يثبت رفعه إلى الخادم؛ التأكيد الخادمي هو المرجع للمزامنة.
- الحالات الدراسية مستقلة لكل مادة، وتدار منفصلة عن الموقف المحسوب للغياب. توجد حالة فارغة، ومستوفي، وغير مستوفي، ومحمل؛ لا يُخلط هذا الحقل مع قرار الرسوب الناتج عن الغياب.
- التصدير، بطاقات الحضور، الاستعادة المتاحة، الإعدادات واللغة ودليل HTML. البريد المخصص للدعم غير مفعّل؛ شراء النطاق والبريد كان مؤجلًا.

هذه قائمة مستمدة من الكود، وليست شهادة اختبار لكل جهاز. راجع `docs/KNOWN-ISSUES.md` للاختبارات غير المنجزة والقيود الحالية.

## ٤. القرارات المهمة التي لا تُغيّر ضمنيًا

١. لا ترحيل لحسابات الإنتاج إلى مشروع الاختبار؛ تبقى الهوية وكلمة المرور ومساحة المستخدم الأصلية.

٢. لا إعادة ترقيم للطلبة القدماء ولا نقل تلقائي لقوائمهم. تتعايش مصادر قوائم قديمة مع النموذج الأحدث، ويجب احترام القائمة الفارغة أو الممسوحة كيلا تُبعث بيانات محذوفة.

٣. التخزين المحلي الأصلي `hathir-offline-v1` ومعرّف التطبيق المثبت `/` باقيان. لا تمسح IndexedDB أو بيانات الموقع لمعالجة مشكلة تحديث أو مزامنة، ولا تحذف عمليات لم يؤكدها الخادم.

٤. بطاقات الاسم المختصرة تستخدم صيغة `H2:`؛ تبقى بطاقات الاسم الأقدم مقبولة، كما يقبل مسار توافق الإنتاج رقمًا قديمًا فقط إذا طابق طالبًا واحدًا ضمن القائمة الكاملة الحالية. لا يجوز تفسير رمز مشوّه باعتباره رقمًا آخر.

٥. تصحيح المزامنة لا يعني إعادة إنشاء مادة حذفها المستخدم. يوجد في تاريخ الاختبار حذف متعمد لمادة، ورفض المستخدم استعادتها. لا تستعد مادة أو قائمة محذوفة تلقائيًا.

٦. مرجع المقارنة هو أعلى حضور تراكمي، لكن قسمة نسبة الغياب على الساعات المقررة للمادة، وليست على هذا المرجع. التسوية الأسبوعية تؤجل الحكم على من لم يحضر بعد، عند نهاية الخميس بتوقيت بغداد. الصيغة الفعلية والتفاصيل بالدقائق وحالات الأعذار موثقة من المصدر في `docs/DATA-AND-SERVICES.md`؛ لا تعِد اختراعها من هذا الملخص.

٧. مادة قديمة بلا سنة/مرحلة رقمية لا تُعطى سنة مخمّنة. تتطلب الإضافة إليها إعدادًا صريحًا آمنًا؛ الحضور الموجود لا يحتاج إعادة رفع الطلاب. تُرفض عملية إضافة قد تعيد استخدام معرّف قديم أو مؤرشف.

## ٥. التقنيات وبنية الملفات

واجهة HTML/CSS وJavaScript دون سلسلة بناء واجهة إلزامية. ملف `index.html` كبير ويحتوي جزءًا مهمًا من المنطق القديم؛ لا تفترض وجود React أو Vite. تُستخدم حزم متصفح خارجية مثبتة في الروابط، وخدمات Firebase للهوية والبيانات والاستضافة والوظائف.

| المسار داخل التطبيق | دوره |
|---|---|
| `netlify_site/index.html` | الهيكل الرئيسي والماسح والجداول والحسابات والتحميل ومنطق التوافق |
| `netlify_site/personal-ui.js` | واجهة النموذج الشخصي والتسجيل والمواد والقوائم والتكامل مع الخادم |
| `netlify_site/runtime-config.js` | إعدادات Firebase العامة وهوية البيئة والمالك؛ **ليس ملف أسرار** |
| `netlify_site/offline-store.js` | التخزين المحلي المستمر |
| `netlify_site/offline-attendance.js` | طابور الحضور والتصحيح والمزامنة وإقرارات الخادم |
| `netlify_site/name-qr.js` | تطبيع الاسم وترميز البطاقات ومطابقتها |
| `netlify_site/card-readers.js` | RFID وNFC |
| `netlify_site/service-worker.js` | حفظ غلاف التطبيق والموارد للعمل دون اتصال |
| `netlify_site/settings-ui.*` | واجهة الإعدادات |
| `netlify_site/guide.html` | الدليل العام المتاح داخل البرنامج |
| `functions/` | وظائف الخادم والحسابات والاستيراد وحساب الغياب والتصحيح والاستعادة |
| `functions/package-lock.json` | الإصدارات المحلولة الفعلية لاعتماديات الخادم |
| `firestore_attendance.rules` | قواعد وصول العميل وعزل المساحات |
| `firestore.indexes.json` | الفهارس المطلوبة المصرّح بها في المصدر |
| `.firebaserc` و`firebase.json` | المشروع الافتراضي ووجهات النشر؛ الإعداد الحالي **إنتاج** |
| `tests/` | اختبارات اصطناعية محلية؛ لا تستخدم بيانات الطلبة الحقيقية |
| `tools/` | قفل النشر وتجميد تجزئات الإصدار |

الاسم `netlify_site` تاريخي؛ الاستضافة الفعلية Firebase Hosting، وليست Netlify. لا تنشر إلى Netlify لأن ملفًا تاريخيًا يحمل اسمه. التفاصيل ومكتبات المتصفح في `docs/ARCHITECTURE.md`.

## ٦. تدفق البيانات

يدخل المستخدم عبر Firebase Auth، ثم تُراجع الموافقة وملكية المساحة في الخادم وقواعد Firestore. تُحمّل موادّه وقوائمه فقط، مع القراءة المحلية عند تجهيزها مسبقًا. يسجل الماسح أو الإدخال اليدوي حدثًا، فتُحفظ العملية محليًا ثم تُرسل عبر الوظائف المناسبة. يتحقق الخادم من الحساب والمادة والطالب وإصدار السجل وحدود المحاضرة، ويكتب نتيجة مع إيصال يمنع تكرار الأثر عند إعادة المحاولة. تُحدّث القراءة والملخصات من النتيجة المؤكدة، دون افتراض أن ظهور الأرقام يعني نجاح الرفع.

تُدار الملخصات والعدادات وإيصالات المزامنة والسجلات المحمية على الخادم. الوظائف المجدولة تغلق المحاضرات المستحقة وتراجع التسويات؛ العمل المحلي لا يُغني عن تحقق الخادم. علاقة المجموعات والحقول والأمثلة الوهمية في وثيقة البيانات.

## ٧. إعداد النوتبوك والعمل الآمن

الأوامر الدقيقة والإصدارات المثبتة في `docs/SETUP-AND-TESTS.md`. المسار المختصر:

١. فك الحزمة، وافحص `FILE-MANIFEST.json` بالأداة المرفقة قبل تثبيت أي مكتبة.

٢. ثبّت Node.js وJava بالإصدارات/المتطلبات الموثقة؛ أعد تثبيت مكتبات الخادم وأدوات الاختبار باستخدام ملفات القفل. لا تنقل `node_modules` من هذا الجهاز.

٣. شغّل الاختبارات المحلية والمعاينة الاصطناعية دون تسجيل الدخول إلى السحابة. لا تخدم `netlify_site` مباشرة ظنًا أنه معزول؛ إعداداته تشير إلى الإنتاج.

٤. عند الحاجة للوصول السحابي سجّل الدخول إلى Firebase CLI بحساب Google المخوّل نفسه أو بحساب مُنح الصلاحيات رسميًا. استخدم MFA المعتاد، ولا تنسخ رموز الجلسة من هذا الكمبيوتر. عضوية المستخدم داخل التطبيق لا تعني امتلاك صلاحية نشر المشروع.

٥. نفّذ اختبارات الهاتف والكاميرا وNFC والبريد والتحقق الفعلي من المزامنة ضمن خطة اختبار مصرح بها قبل أي تحسين جديد.

## ٨. بيئات النشر وخطواته

| البيئة | المشروع والموقع | التعامل الصحيح |
|---|---|---|
| الإنتاج المعتمد | `alqar-student-attendance-2026` / `hathir.web.app` | المصدر الرئيسي في هذه الحزمة |
| الاختبار الشخصي السابق | `project-b8a82f28-cf64-4798-9f2` / `hathir-personal-20260922.web.app` | مشروع منفصل بهوية ومالك وتخزين مختلف؛ ليس مجرد اسم مستعار للإنتاج |
| اختبار أقدم | `hathir-test-20260921.web.app` | ليس النسخة المعتمدة للتطوير الحالي |

لا تُغيّر المشروع بتعديل `.firebaserc` وحده. يجب أن تتوافق إعدادات المتصفح والمالك وقواعد الأمن وحساب التشغيل ومناطق الوظائف وهوية التخزين مع البيئة المقصودة. هذه النسخة لا تملك مولّد إعدادات موحدًا آمنًا لكل البيئات بعد.

تحتاج عملية النشر إلى موافقة محددة ونسخة احتياطية جديدة وفحوص ناجحة. قفل `tools/deploy-check.cjs` يعتمد على إثبات النسخة الاحتياطية خارج `app` وتجزئات الإصدار؛ **حزمة النقل لا تتضمن النسخة الخاصة، لذلك النشر ليس جاهزًا بنقرة واحدة، وهذا مقصود**. لا تُنشئ ملف إثبات وهميًا ولا تعطل القفل. على المطور إعداد إجراء نسخة احتياطية معتمد على الجهاز الجديد ثم تحديث أدلة الإصدار بصورة موثقة.

بعد تحقيق هذه الشروط فقط، تكون أوامر النشر الأساسية من مجلد التطبيق على النحو التالي، باستخدام مسار CLI المثبت في مجلد `support`:

```powershell
# أمثلة أوامر نشر، ليست جزءًا من البدء السريع ولا تُنفّذ تلقائيًا.
# عرّف $Bundle بمسار مجلد الحزمة و$App بمسار التطبيق الكامل.
$Cli = Join-Path $Bundle 'support\node_modules\firebase-tools\lib\bin\firebase.js'
Set-Location $App
node $Cli login
node $Cli projects:list
# افحص المشروع والإعدادات والنسخة الاحتياطية واختبارات الإصدار أولًا.
# استخدم إصدارًا معتمدًا يطابق قفل النشر وتجزئات الملفات، وليس قيمة عشوائية.
$env:HATHIR_PRODUCTION_RELEASE = 'v2026.09.22-personal-upgrade-1'
node tools/deploy-check.cjs
# لا تتابع إذا فشل أي شرط أو اختلف الملف بعد تجميده.
$Metadata = Get-Content 'reports\function-metadata-static.json' -Raw | ConvertFrom-Json
$Targets = ($Metadata.endpoints | ForEach-Object { 'functions:' + $_.name }) -join ','
node $Cli deploy --project alqar-student-attendance-2026 --config firebase.json --only $Targets --non-interactive
node $Cli deploy --project alqar-student-attendance-2026 --config firebase.json --only firestore:rules --non-interactive
node $Cli deploy --project alqar-student-attendance-2026 --config firebase.json --only hosting --non-interactive
```

هذه أمثلة لشكل أوامر النشر بعد استيفاء الشروط، وليست وصفة لإعادة نشر نسخة التسليم المنقّحة تحت تجزئات الإصدار الأصلي. ملف HTML المنقّح يختلف عمدًا عن القفل الأصلي؛ لذلك لا يمكن إعادة نشر الإصدار المجمّد منه دون تغيير. نشر نسخة مشتقة يحتاج موافقة منفصلة وإجراء إصدار معتمدًا، وترقيمًا واختبارات وتجميدًا جديدًا؛ لا تعِد توليد القفل فقط لإخفاء فرق غير معتمد. لا تنشر الفهارس أو تحذف وظائف أو تستخدم `--force` لمجرد تجاوز رسالة. عند النشر السابق نجحت الوظائف ثم أعادت CLI رمز خطأ بسبب غياب سياسة تنظيف صور الحاويات؛ جرى التحقق منفصلًا من أن جميع الوظائف فعالة. راجع القيود قبل معالجة هذه السياسة، لأنها قد تحذف صورًا لازمة للاسترجاع.

## ٩. التطابق والاختبارات والحدود

تحتوي `evidence` على أدلة التحقق والتجزئات؛ راجع `PACKAGE-VERIFICATION.md` لنتيجة فحص النقل الحالي. فُحصت الملفات العامة وقواعد Firestore ومصادر الوظائف المنشورة، وليس اسم الإصدار وحده. الملفات الأصلية المحلية المجمّدة للإصدار عددها ٦٣. قارَن الفحص المصدر الأصلي بالمنشور، **قبل تنقيح نسخة التسليم**؛ توجد فروق مقصودة في HTML المنقول وبيانات سطر اختبار الدخول المحلي كما موثق أعلاه. ملفات الاختبار والوثائق الإضافية تُنقل أيضًا وتُسجّل في بيان الحزمة. أبقينا بيان تجزئات الإصدار المنشور الأصلي دون تغيير؛ لذلك يُظهر الفروق المقصودة ولا ينبغي تزويره لإخفائها.

عند الإصدار نجح ٣٩٤ اختبارًا محليًا، منها محاكي حقيقي لقواعد Firestore، وانتقال عامل الخدمة والبيانات المحلية بين النسختين، مع بيانات اصطناعية. نجحت أيضًا فحوص ملفات عامة ومسار المزامنة ورفض الطلبات غير المصرّح بها. هذه ليست اختبارات دخول لحسابات حقيقية ولا إثباتًا بأن الكاميرا والصوت يعملان على آيفون المستخدم.

لم ننقل تسجيلات الطلبة أو بصماتهم أو بيانات الحسابات. لم نختبر استعادة شاملة للنسخة المشفرة. لم نشتر نطاق البريد المؤجل. لا ندّعي أن المزامنة تعمل والتطبيق مغلق تمامًا في كل نظام؛ لا بد من احترام قيود المتصفح وإعادة فتحه لمواصلة العمليات عند الحاجة.

## ١٠. أولويات التطوير التالي

١. اختبار قبول عملي للحسابات القديمة والجديدة، والصوت والكاميرا والمزامنة بعد العودة من الخلفية على الآيفون الفعلي.

٢. تقليل تعقيد الملف الرئيسي تدريجيًا، مع تثبيت اختبارات عدم فقدان البيانات قبل إعادة هيكلة منطق المزامنة أو القوائم.

٣. إعداد بيئة اختبار واضحة بقيم بيئية متسقة دون لمس بيانات الإنتاج، وأتمتة بناء/اختبار مستقل عن مسارات الكمبيوتر القديمة.

٤. التعامل المنظم مع القوائم التاريخية غير المعتادة، والمراقبة التشخيصية قليلة البيانات، وسياسة تكلفة صور الحاويات والنسخ الاحتياطية.

٥. إكمال النطاق والبريد الخاص بالدعم فقط عند تجديد موافقة الشراء، ثم اختبار الإرسال والاستقبال قبل تفعيل زر البريد.

لا تبدأ بإعادة تصميم الصلاحيات أو احتساب الغياب أو بنقل حسابات إلى مشروع آخر؛ هذه قرارات وظيفية تتطلب طلبًا جديدًا.

## تحديث 24 سبتمبر 2026 — فيديوهات الهاتف (الإصدار 29)

نُشر `v2026.09.24-mobile-help-29` على Hosting فقط بتفويض المستخدم: 11 فيديو عموديًا بواجهة هاتف 390×838، مؤشر لمس وحركات واجهة، وضبط توقيت صوت عبد الله. مركز المساعدة يستخدم `assets/help-v4` ومشغّلًا عموديًا. حافظ الإصدار على تحسينات الأداء في الإصدار 28. نجح 484 اختبارًا وتشغيل المقاطع محليًا والتشغيل والتقديم عند الطلب من الموقع بعرضي الهاتف والكمبيوتر. التصوير بمحاكاة متصفح هاتف وبيانات وكاميرا تعليمية، وليس تسجيل هاتف مادي. الأدلة والتوقيت وحدود الاختبار في `../review-20260924/mobile-help/REPORT.md` وملفات JSON المجاورة. لا تعدّل بصمة إصدار قديم؛ البيان الجديد `reports/release-source-manifest-mobile-help-29.json`.


## تحديث 24 سبتمبر 2026 — القوائم المشتركة (الإصدار 30)

نُشرت ميزة مشاركة أسماء الطلبة الاختيارية للأدمن في `v2026.09.24-shared-rosters-30`، مع اعتماد منفصل ومراجعة للتحديثات في مساحة التدريسي. الأسماء فقط، دون الحالات والحضور والبصمات. لا تصبح قائمة الأدمن منشورة بمجرد استيرادها، ولا ينعكس تغييرها في مساحته تلقائيًا على المنشور. نطاق المؤسسة الواحدة يطابق القسم ورقم المرحلة. النشر حاليًا من قائمة المادة المختارة عبر زر في سجل الحضور، بحد 300 اسم للقائمة المنشورة. لم تُنشر أسماء حقيقية أثناء التطوير.

المصدر الجديد: `functions/shared-rosters.js` و`netlify_site/shared-rosters.js` وCSS المقابل؛ وظيفة واحدة جديدة `sharedStudentRoster` في المنطقة الأصلية `us-central1`. قواعد Firestore تحمي مؤشر الاشتراك وتبقي المستندات المشتركة وسجلات الاعتماد خلف الخادم. لا تغيّر منطقة المزامنة `asia-south1`.

اجتاز الإصدار 506 اختبارات، بما فيها 99 حالة قواعد في المحاكي و6 حالات واجهة للمشاركة. بيان الإصدار `reports/release-source-manifest-shared-rosters-30.json`. الأدلة وطريقة التشغيل في `../review-20260924/shared-rosters/REPORT.md`، والتحقق المنشور في `live-verification.json` المجاور عند اكتماله. إنشاء الوظيفة نجح وتأكدت حالتها ACTIVE؛ أعاد CLI تحذير سياسة تنظيف صور الحاويات القديمة في asia-south1، ولم تُغيّر هذه السياسة. نشر Hosting والقواعد نجح مستقلًا.


## 2026-09-24 — EL-PH default department release 31
Published v2026.09.24-el-ph-31 to https://hathir.web.app/.
- Added قسم الالكترونيك-هواتف ذكية (EL-PH), stable department ID electronics_smartphones, five default stages.
- Existing workspaces receive an additive transaction once on organization loading. Existing data/settings are preserved; migration marker respects later deliberate deletion.
- New subjects remain name-based. Legacy student-code allocation maps unchanged.
- Shared roster callable recognizes the department as a canonical institution scope. Department name editing accepts its existing EL-PH abbreviation.
- 510 local synthetic tests passed, including migration/data preservation/deletion checks and new subject coverage.
- Fresh encrypted backup: 2151 documents, 42 functions, 216 Hosting files. No production student test writes.
- sharedStudentRoster updated successfully; CLI exit 1 concerns pre-existing asia-south1 artifact cleanup policy, which was not modified. Independent verification confirms ACTIVE.
- Hosting published and changed public asset hashes verified; Firestore rules unchanged and verified, unauthenticated callable rejected.
- No physical-phone test. Existing workspace migration executes on the next online organization load.

Evidence: review-20260924/el-ph/REPORT.md and live-verification.json.


## 2026-09-24 — Administrative account controls release 32
Published v2026.09.24-admin-accounts-32 to https://hathir.web.app/.

- Owner-only administrative approval explicitly waives email verification in the server-protected registration record; Firebase Auth emailVerified remains honest. Current matching approval and pinned reviewer are required in callable access and Firestore rules.
- Requests UI offers administrative approval with confirmation, and account deletion with typed matching email. Rejected accounts can be reconsidered.
- Deletion first changes registration to deleting, blocking access including verified stale tokens, then deletes Auth identity, then retains a deleted tombstone. Failed deletion remains visible and retryable. Pinned owner is protected. No actual account was approved or deleted during delivery.
- Old workspace data remains retained; registering again produces a new private workspace. No data purge or automatic old-data transfer.
- 520 local synthetic checks passed (84 backend, 104 actual emulator rules checks), covering privileges, approval revocation, deletion retry, data preservation, forged markers and cross-account denial; browser checks cover available buttons and cancel paths.
- Deployed all 42 existing functions for consistent authorization, rules and Hosting. Independent check confirms 42 ACTIVE functions, changed public asset hashes, exact rules and unauthenticated callable denial.
- Functions CLI exits 1 after successful deployment because of existing asia-south1 artifact cleanup policy; no cleanup policy was changed.
- Existing verified encrypted backup remains within the 24-hour deployment gate. No real account deletion or mail delivery acceptance test was performed.

Evidence: regression.log, functions-verification.json, live-verification.json, deploy-backend.log, deploy-hosting.log. Frozen manifest: reports/release-source-manifest-admin-accounts-32.json.


## 2026-09-24 — Account action confirmation fix release 33
Published v2026.09.24-account-actions-33 to https://hathir.web.app/ (Hosting only).

Evidence: read-only Cloud logs contained successful account-action responses; registration records contained recent administrative approvals, with no deletion tombstones at inspection. User confirmed that no dialog or message appears. The original native confirm/prompt path could exit silently. No live account was modified during investigation or testing.

Replaced browser-native confirmation with an accessible in-page dialog. Typed email mismatch is visible, cancellation is safe, duplicate actions are guarded, authorization is rechecked after confirmation, and server success/error is displayed and scrolled into view. Backend semantics and rules unchanged.

522 local synthetic tests passed, including real delegated button clicks (not only direct helper calls), cancel/wrong-email paths, administrative approval payload and visible success, mobile deletion failure/retry and row removal. No native dialogs are allowed in these regression cases. Public changed-file hashes and deployed rules/callable were independently verified. Real deletion was not tested on user accounts.

Evidence: regression.log, browser.log, live-verification.json, deploy-hosting.log. Frozen manifest: reports/release-source-manifest-account-actions-33.json.
