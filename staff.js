// مشترك بين admin.html و panel.html: الاتصال بالـ API + بوابة الدخول حسب الدور
const $ = id => document.getElementById(id),
  esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'),
  AR = { pending: 'بانتظار القبول', accepted: 'مقبول', preparing: 'قيد التحضير', ready: 'جاهز', picked_up: 'تم الاستلام',
         on_the_way: 'في الطريق', delivered: 'تم التوصيل', cancelled: 'ملغي' };
let TOKEN = localStorage.t || '', USER = null;
try { USER = JSON.parse(localStorage.u || 'null'); } catch {}

addEventListener('unhandledrejection', e => alert(e.reason?.message || 'خطأ'));

async function api(p, o = {}) {
  const r = await fetch(p, { ...o, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) logout();
  if (!r.ok) throw new Error(d.error || 'خطأ');
  return d;
}
const send = (p, method, body) => api(p, { method, body: JSON.stringify(body || {}) });

function logout() { localStorage.removeItem('t'); localStorage.removeItem('u'); location.reload(); }

function gate(roles, start) {
  if (TOKEN && USER && roles.includes(USER.role)) return start();
  $('app').innerHTML = `<div class="card" style="max-width:340px;margin:40px auto"><h3>تسجيل الدخول</h3>
    <input id="em" type="email" placeholder="البريد الإلكتروني"><input id="pw" type="password" placeholder="كلمة المرور">
    <button class="p" style="width:100%" onclick="staffLogin()">دخول</button></div>`;
  window.staffLogin = async () => {
    const r = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('em').value, password: $('pw').value }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return alert(d.error || 'خطأ');
    if (!roles.includes(d.user.role)) return alert('هذا الحساب لا يملك صلاحية هذه الصفحة');
    localStorage.t = d.token; localStorage.u = JSON.stringify(d.user); location.reload();
  };
}
