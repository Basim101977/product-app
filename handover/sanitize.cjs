module.exports=function clean(s){
 for(const id of known)s=s.replaceAll(id,'HATHIR_OWNER_UID_REQUIRED');
 s=s.replace(/AIza[\w-]{30,}/g,'HATHIR_FIREBASE_API_KEY_REQUIRED')
 .replace(/(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]+|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|ya29\.[\w.-]+|1\/\/[\w-]{30,}|eyJ[\w-]{15,}\.[\w-]{15,}\.[\w-]{10,})/g,'REDACTED_CREDENTIAL')
 .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'REDACTED_PRIVATE_KEY')
 .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,m=>/\.(?:local|test|invalid)$|@example\.(?:com|org)|@test\.com|gserviceaccount\.com$/.test(m)?m:'redacted@example.invalid')
 .replace(/C:\\Users\\[\w .-]+/g,'C:\\Users\\USER')
 .replace(/باسم\s+(?:عبد[^\n،.]{0,60}|القرغولي)/g,'[اسم محذوف]');
 return s;
};
const known=["REDACTED_ORIGINAL_UID","REDACTED_ORIGINAL_UID"];
