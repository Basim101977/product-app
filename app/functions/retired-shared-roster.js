'use strict';
// Keep a safe endpoint for previously opened clients; never mutate old rosters.
module.exports = ({approvedIdentity, fail}) => async request => {
  await approvedIdentity(request);
  fail('failed-precondition', 'أُلغيت قوائم القسم المشتركة. حدّث البرنامج واستخدم «المزيد ← مشاركة» للمشاركة مباشرة مع زميلك.');
};
