# البنية المعمارية

## التقنية والإصدارات

الواجهة HTML/CSS وJavaScript تقليدي، بلا React أو Vue وبلا خطوة bundling إلزامية. تجمع index.html بين هيكل الواجهة ومنطق قديم؛ تضيف ملفات لاحقة سلوكاً أو تغلف دوال عامة. ترتيب السكربتات جزء من العقد البرمجي. الخادم JavaScript/CommonJS على Cloud Functions Gen 2، يستهدف Node 22. كان Node الافتراضي 24؛ استُخدم Node 22.23.3 المحلي للتحقق، ونتائج الاختبار الجديد موثقة منفصلة.

| المكوّن | الإصدار المثبت/الموثق | الغرض |
|---|---|---|
| Node | 22؛ المرجع السابق 22.20.0 | التشغيل والاختبارات والخادم |
| firebase-admin | 14.4.0 في package-lock | Auth وFirestore من الخادم |
| firebase-functions | 7.3.2 | callable وtriggers وscheduler |
| web-push | 3.6.7 | إرسال إشعارات المتصفح |
| Firebase browser compat | 10.12.5 | SDK الواجهة المحلي |
| face-api | 1.7.15 | التعرف الوجهي المحلي |
| SheetJS | 0.20.3 | استيراد جداول |
| ExcelJS | 4.4.0 | تصدير الجداول والتنسيق |
| jsPDF | 2.5.1 | إخراج PDF |
| jsQR / qrcode-generator | 1.4.0 / 1.4.4 | فك وتوليد QR |
| Playwright | 1.62.1 في support | Chromium واختبارات الواجهة |
| Firebase CLI | 15.30.0 في support | المحاكاة والإدارة |
| Java / Firestore Emulator | 21 / 1.22.0 | اختبارات القواعد |

ملفات القفل هي المرجع الكامل للاعتمادات المتعدية. توجد تراخيص المكتبات داخل vendor وassets؛ تُحفظ كما هي، بما فيها نسب العمل إلى مؤلفي المكتبات العامة.

## خريطة المستودع

| المسار | المسؤولية |
|---|---|
| app/netlify_site | الواجهة المنشورة؛ الاسم موروث ولا يعني استضافة Netlify |
| app/functions | API والمنطق الخادمي والاختبارات الوحدوية |
| app/firestore_attendance.rules | صلاحيات وصول المتصفح؛ Admin SDK يحتاج تحققاً مستقلاً |
| app/firestore.indexes.json | فهارس الاستعلامات والمهام |
| app/firebase.json و.firebaserc | أهداف ومناطق النشر والحواجز |
| app/tests | اختبارات اصطناعية ومحاكاة الشبكة/المتصفح/القواعد |
| app/tools | فحص النشر وتجميد الأدلة؛ لا تتجاوز الحواجز |
| app/reports | نتائج تاريخية؛ لا تثبت سلامة نسخة عدلت لاحقاً |
| support | تثبيت المحاكي وضبط مسارات الاختبار والمعاينة الآمنة |
| legacy/alternate-163 | مصدر ترقية عامل الخدمة السابق المنقح |
| tools/configure-handover.cjs | توليد إعدادات محلية من متغيرات البيئة |
| handover | التوثيق وسجل الطلبات والجلسات وأدلة التسليم |

النسخ الكثيرة الأصلية وملفات الوسائط والتجارب بقيت محلياً خارج قائمة الرفع. الفروع التاريخية تحمل مصدر استضافة بديلة أقدم، بينما main يحمل حزمة التطوير الحالية.

## المسارات التشغيلية

المتصفح ← Firebase Auth للمصادقة، Firestore للقراءات المسموح بها، Callable Functions للعمليات الحساسة. تحفظ الواجهة حالة وطوابير داخل IndexedDB (`hathir-offline-v1` ضمن التوافق القديم) وCache Storage. يثبت Service Worker الملفات دون مسح الطوابير عند التحديث. `offline-store` و`offline-attendance` مسؤولان عن النسخة المحلية؛ `device-workspace*` و`device-sync-model` و`live-attendance` عن حالة الجهاز والتزامن. `name-qr` و`qr-decoder*` للفك والمطابقة، `name-attendance` للتفاعل اليدوي. `private-share*` و`private-scope-roster` للمشاركة. `consolidation*` للسجل التجميعي.

في الخادم: personal-workspace للاعتماد والمساحات والاستيراد، offline-attendance-batch للدفعات والإيصالات، lecture-session وclosed-lecture-workspace للمحاضرات، cumulative-attendance وweekly-approval للمجاميع وسياسة الأسبوع بتوقيت بغداد، device-live-sync لسجل التغييرات المتتابع، private-roster-share للدعوات والقطع، subject-roster-reset وofficial-correction للاستعادة والتصحيح، support-* وpush-notifications للدعم والإشعارات. `index.js` يربط exports. انظر API_INVENTORY.md لقائمة مستخرجة من المصدر.

## قاعدة البيانات

Cloud Firestore قاعدة وثائق، لا جداول SQL. الهوية في Firebase Auth؛ نسخ Git لا ينقل الحسابات أو السجلات.

| مجموعة/مسار | البيانات والعلاقات |
|---|---|
| attendanceIndividualRequests/{uid} | طلب اعتماد: uid، email، fullName، status، reviewer وأوقات |
| attendanceLegacyAccess/{uid} | استثناءات انتقال إدارية محددة، لا يكتبها العميل |
| attendanceUserWorkspaces/{uid} | مؤشر مساحة المستخدم |
| attendanceWorkspaces/{uid} | ownerUid، primaryOwnerUid، mode، settings |
| .../members، departments، stages | العضوية وبنية التدريس |
| .../cohorts/{id}/students | القائمة المشتركة داخل مساحة المستخدم؛ الاسم والحالة والمعرف |
| .../cohorts/{id}/faceTemplates | قوالب حساسة؛ لا تُصدّر إلى Git |
| .../subjects/{id} | إعدادات المادة والساعات والمدة والنطاق |
| .../subjects/{id}/students وfaceTemplates | توافق مع مصادر قوائم أقدم |
| .../subjects/{id}/lectures/{id}/marks، excuses، scanEvents | الحضور والأعذار وأحداث المسح |
| .../subjects/{id}/attendanceSummaries | المجاميع المشتقة |
| .../subjects/{id}/offlineReceipts وsettingsAudit | منع تكرار العمليات وتتبع تغييرات الإعدادات |
| .../personalStudentSequences وpersonalImportReceipts | أرقام داخلية ومعاملات استيراد قابلة لإعادة المحاولة |
| .../deletedRecords، lectureSnapshots، subjectRosterBackups، recoveryAudit | استعادة محكومة وتدقيق |
| attendanceDeviceSync/{uid}/records وreceipts | تغييرات ذات seq وإيصالات للأجهزة |
| attendanceDeviceCopies | صيغة نسخ سابقة، يقرأها bootstrap للتحويل المحكوم |
| attendancePrivateShares وMailboxes وSignals وQuotas | دعوات خاصة وأجزاء القائمة وإشارات وحصص |
| attendancePushDevices وattendanceServerConfig/webPush | اشتراكات الدفع ومفاتيح VAPID الخاصة خادمياً |
| attendanceSupportThreads وattendanceSupportSignals | الدعم وإشارات القراءة |

توجد مخططات قديمة؛ تفاصيل أولوية cohort مقابل subject وembedded roster في previous/development/docs/DATA-AND-SERVICES.md. لا تعيد ملء قائمة أفرغها المستخدم ولا تدمج مصادر متعارضة تلقائياً. المجموعة الفرعية قد توجد دون مستند أب. القواعد والمصدر الحاليان أعلى أولوية من شرح قديم.

## الخدمات الخارجية

Firebase Hosting وAuthentication وFirestore وFunctions، مع Cloud Scheduler وEventarc خلف المشغلات. المناطق التاريخية متعمدة: مزامنة الدفعات asia-south1 وعمليات عديدة us-central1؛ تُستخرج خيارات كل export من index.js قبل النشر. Web Push يقبل نقاط FCM/Mozilla/Apple المعتمدة. المتصفح يستخدم Camera/MediaDevices وIndexedDB وService Worker وWeb NFC عند دعمه؛ لا يوجد ضمان تشغيل على كل هاتف. مكتبات ونماذج التعرّف المحلية ليست قوالب أشخاص. لم يُستخدم أي API خارجي للذكاء الاصطناعي أثناء نقل هذا الكود.
