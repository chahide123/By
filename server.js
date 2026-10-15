// npm start  (يقرأ المتغيرات من .env)
const path = require('path'), express = require('express'), { Pool } = require('pg'), bcrypt = require('bcryptjs'),
  jwt = require('jsonwebtoken'), cors = require('cors'), rate = require('express-rate-limit');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) throw new Error('JWT_SECRET مطلوب (16 حرفاً على الأقل)');
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const FEE = 10, app = express();
const t = (v, n = 300) => String(v ?? '').trim().slice(0, n);

app.disable('x-powered-by');
app.use(cors(), express.json({ limit: '50kb' }), (req, _, next) => { req.body ??= {}; next(); });
app.use(express.static(path.join(__dirname, 'public')));
app.use('/auth', rate({ windowMs: 15 * 60 * 1000, limit: 20, skipSuccessfulRequests: true }));

const sign = u => ({
  token: jwt.sign({ id: u.id, role: u.role }, SECRET, { algorithm: 'HS256', expiresIn: '12h' }),
  user: { name: u.full_name, role: u.role },
});

const auth = (...roles) => async (req, res, next) => {
  try {
    const u = jwt.verify((req.headers.authorization || '').slice(7), SECRET, { algorithms: ['HS256'] });
    if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: 'غير مسموح' });
    const { rows } = await db.query('SELECT 1 FROM users WHERE id=$1 AND is_active', [u.id]);
    if (!rows.length) return res.status(401).json({ error: 'الحساب معطّل' });
    req.user = u;
    next();
  } catch { res.status(401).json({ error: 'سجّل الدخول أولاً' }); }
};

/* ---------- Auth ---------- */
app.post(['/auth/register', '/auth/reg'], async (req, res) => {
  const { full_name, email, phone, password } = req.body, pw = String(password || '');
  if (!t(full_name) || !t(email) || !t(phone) || pw.length < 8)
    return res.status(400).json({ error: 'بيانات ناقصة (كلمة المرور 8 أحرف على الأقل)' });
  const { rows: [u] } = await db.query(
    "INSERT INTO users(role,full_name,email,phone,password_hash) VALUES('customer',$1,$2,$3,$4) RETURNING id,role,full_name",
    [t(full_name, 100), t(email, 200).toLowerCase(), t(phone, 30), await bcrypt.hash(pw, 10)]);
  res.status(201).json(sign(u));
});

app.post('/auth/login', async (req, res) => {
  const { rows: [u] } = await db.query(
    'SELECT id,role,full_name,password_hash FROM users WHERE email=$1 AND is_active',
    [t(req.body.email, 200).toLowerCase()]);
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.password_hash)))
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  res.json(sign(u));
});

/* ---------- عام ---------- */
app.get('/stores', async (req, res) => res.json((await db.query(
  `SELECT id,name,category,address,is_open FROM stores
   WHERE is_active AND ($1::text IS NULL OR category=$1) ORDER BY is_open DESC,name`,
  [req.query.category || null])).rows));

app.get('/stores/:id/products', async (req, res) => res.json((await db.query(
  'SELECT id,store_id,name,description,price,image_url FROM products WHERE store_id=$1 AND is_available ORDER BY name',
  [req.params.id])).rows));

/* ---------- الزبون ---------- */
app.post('/orders', auth('customer'), async (req, res) => {
  const { store_id, items, delivery_address, pickup_address, description } = req.body;
  if (!t(delivery_address)) return res.status(400).json({ error: 'عنوان التوصيل مطلوب' });
  const lines = []; let cents = 0;
  if (store_id) {
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'السلة فارغة' });
    const { rows: st } = await db.query('SELECT 1 FROM stores WHERE id=$1 AND is_active AND is_open', [store_id]);
    if (!st.length) return res.status(400).json({ error: 'المتجر غير متاح' });
    const { rows: ps } = await db.query('SELECT id,name,price FROM products WHERE store_id=$1 AND is_available', [store_id]);
    for (const i of items) {
      const p = ps.find(x => x.id === i.product_id), qty = Math.min(50, Math.max(1, parseInt(i.qty) || 1));
      if (!p) return res.status(400).json({ error: 'منتج غير متاح' });
      lines.push({ product_id: p.id, name: p.name, qty, unit_price: p.price });
      cents += Math.round(p.price * 100) * qty;
    }
  } else if (!t(description) || !t(pickup_address))
    return res.status(400).json({ error: 'أكمل بيانات الطلب' });

  const { rows: [o] } = await db.query(
    `WITH o AS (INSERT INTO orders(customer_id,store_id,items,subtotal,delivery_fee,total,delivery_address,pickup_address,description)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,status)
     INSERT INTO order_tracking(order_id,status) SELECT id,status FROM o RETURNING order_id AS id`,
    [req.user.id, store_id || null, JSON.stringify(lines), cents / 100, FEE, (cents + FEE * 100) / 100,
     t(delivery_address), t(pickup_address) || null, t(description, 500) || null]);
  res.status(201).json(o);
});

app.get('/orders/my', auth('customer'), async (req, res) => res.json((await db.query(
  `SELECT o.id,o.status,o.total,o.created_at,COALESCE(s.name,'أي شيء') AS store,co.full_name AS courier
   FROM orders o LEFT JOIN stores s ON s.id=o.store_id LEFT JOIN users co ON co.id=o.courier_id
   WHERE o.customer_id=$1 ORDER BY o.created_at DESC LIMIT 20`, [req.user.id])).rows));

// ملاحظة: المسارات الثابتة قبل /orders/:id
app.get('/orders/available', auth('courier'), async (req, res) => res.json((await db.query(
  `SELECT o.id,COALESCE(s.name,'أي شيء') AS store,s.address AS pickup,o.pickup_address,o.delivery_address,o.description,o.total
   FROM orders o LEFT JOIN stores s ON s.id=o.store_id
   WHERE o.courier_id IS NULL AND ((o.store_id IS NULL AND o.status='pending') OR o.status IN ('accepted','preparing','ready'))
   ORDER BY o.created_at`)).rows));

app.get('/orders/:id', auth(), async (req, res) => {
  const { rows: [o] } = await db.query(
    `SELECT o.*,s.name AS store,s.owner_id,co.full_name AS courier,co.last_lat,co.last_lng
     FROM orders o LEFT JOIN stores s ON s.id=o.store_id LEFT JOIN users co ON co.id=o.courier_id WHERE o.id=$1`,
    [req.params.id]);
  const u = req.user;
  if (!o || !(u.role === 'admin' || o.customer_id === u.id || o.courier_id === u.id || o.owner_id === u.id))
    return res.status(404).json({ error: 'غير موجود' });
  const { rows: history } = await db.query(
    'SELECT status,created_at FROM order_tracking WHERE order_id=$1 AND status IS NOT NULL ORDER BY created_at', [o.id]);
  res.json({ ...o, history });
});

/* ---------- تحديث الحالة (JWT + صلاحيات حسب الدور) ---------- */
const CAN = {
  customer: ['cancelled'],
  store_owner: ['accepted', 'preparing', 'ready', 'cancelled'],
  courier: ['accepted', 'picked_up', 'on_the_way', 'delivered'], // accepted = استلام الطلب من السائق
  admin: ['pending', 'accepted', 'preparing', 'ready', 'picked_up', 'on_the_way', 'delivered', 'cancelled'],
};

app.patch('/orders/:id/status', auth(), async (req, res) => {
  const { status } = req.body, u = req.user, id = req.params.id;
  if (!CAN[u.role]?.includes(status)) return res.status(403).json({ error: 'غير مسموح' });
  const claim = u.role === 'courier' && status === 'accepted';
  let sql, args;
  if (claim) {
    sql = `UPDATE orders SET courier_id=$1,updated_at=now() WHERE id=$2 AND courier_id IS NULL
           AND status NOT IN ('delivered','cancelled') AND (store_id IS NULL OR status<>'pending')`;
    args = [u.id, id];
  } else if (u.role === 'courier') {
    sql = 'UPDATE orders SET status=$1,updated_at=now() WHERE id=$2 AND courier_id=$3'; args = [status, id, u.id];
  } else if (u.role === 'store_owner') {
    sql = 'UPDATE orders o SET status=$1,updated_at=now() FROM stores s WHERE o.id=$2 AND s.id=o.store_id AND s.owner_id=$3';
    args = [status, id, u.id];
  } else if (u.role === 'customer') {
    sql = "UPDATE orders SET status=$1,updated_at=now() WHERE id=$2 AND customer_id=$3 AND status='pending'";
    args = [status, id, u.id];
  } else { sql = 'UPDATE orders SET status=$1,updated_at=now() WHERE id=$2'; args = [status, id]; }

  const r = await db.query(sql, args);
  if (!r.rowCount) return res.status(409).json({ error: 'لا يمكن تنفيذ العملية' });
  await db.query('INSERT INTO order_tracking(order_id,status,note) VALUES($1,$2,$3)',
    [id, claim ? null : status, claim ? 'courier_assigned' : null]);
  res.json({ ok: true });
});

/* ---------- السائق ---------- */
app.get('/courier/orders', auth('courier'), async (req, res) => res.json((await db.query(
  `SELECT o.id,o.status,o.total,COALESCE(s.name,'أي شيء') AS store,s.address AS pickup,o.pickup_address,
          o.delivery_address,o.description,cu.full_name AS customer,cu.phone
   FROM orders o LEFT JOIN stores s ON s.id=o.store_id JOIN users cu ON cu.id=o.customer_id
   WHERE o.courier_id=$1 AND o.status NOT IN ('delivered','cancelled') ORDER BY o.created_at`,
  [req.user.id])).rows));

app.post('/orders/:id/tracking', auth('courier'), async (req, res) => {
  const { lat, lng } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number') return res.status(400).json({ error: 'إحداثيات غير صالحة' });
  const r = await db.query(
    `INSERT INTO order_tracking(order_id,courier_lat,courier_lng)
     SELECT id,$2::numeric,$3::numeric FROM orders WHERE id=$1 AND courier_id=$4`,
    [req.params.id, lat, lng, req.user.id]);
  if (!r.rowCount) return res.status(403).json({ error: 'غير مسموح' });
  await db.query('UPDATE users SET last_lat=$1,last_lng=$2 WHERE id=$3', [lat, lng, req.user.id]);
  res.json({ ok: true });
});

app.post('/orders/:id/reject', auth('courier'), (req, res) => res.json({ ok: true })); // يبقى متاحاً لسائقين آخرين

/* ---------- المتجر ---------- */
app.get('/store/mine', auth('store_owner'), async (req, res) => res.json((await db.query(
  'SELECT id,name,is_open FROM stores WHERE owner_id=$1 AND is_active ORDER BY name', [req.user.id])).rows));

app.get('/store/orders', auth('store_owner'), async (req, res) => res.json((await db.query(
  `SELECT o.id,o.status,o.items,o.total,o.created_at FROM orders o JOIN stores s ON s.id=o.store_id
   WHERE s.owner_id=$1 AND o.status NOT IN ('delivered','cancelled') ORDER BY o.created_at DESC`,
  [req.user.id])).rows));

app.patch('/stores/:id/open', auth('store_owner'), async (req, res) => {
  const r = await db.query('UPDATE stores SET is_open=$1 WHERE id=$2 AND owner_id=$3',
    [!!req.body.is_open, req.params.id, req.user.id]);
  r.rowCount ? res.json({ ok: true }) : res.status(403).json({ error: 'غير مسموح' });
});

app.post('/stores/:id/products', auth('store_owner'), async (req, res) => {
  const { name, description, price, image_url } = req.body, pr = Number(price);
  if (!t(name) || price === '' || price == null || !(pr >= 0)) return res.status(400).json({ error: 'الاسم والسعر مطلوبان' });
  const r = await db.query(
    `INSERT INTO products(store_id,name,description,price,image_url)
     SELECT id,$2::text,$3::text,$4::numeric,$5::text FROM stores WHERE id=$1 AND owner_id=$6 RETURNING id`,
    [req.params.id, t(name, 150), t(description, 500) || null, pr, t(image_url, 500) || null, req.user.id]);
  r.rowCount ? res.status(201).json(r.rows[0]) : res.status(403).json({ error: 'غير مسموح' });
});

/* ---------- الإدارة ---------- */
const adm = auth('admin');
app.get('/admin/orders/active', adm, async (_, res) => res.json((await db.query(
  `SELECT o.id,COALESCE(s.name,'أي شيء') AS store,cu.full_name AS customer,co.full_name AS courier,o.status,o.total
   FROM orders o LEFT JOIN stores s ON s.id=o.store_id JOIN users cu ON cu.id=o.customer_id
   LEFT JOIN users co ON co.id=o.courier_id
   WHERE o.status NOT IN ('delivered','cancelled') ORDER BY o.created_at DESC`)).rows));
app.get('/admin/stores', adm, async (_, res) =>
  res.json((await db.query('SELECT id,name,is_active FROM stores ORDER BY name')).rows));
app.get('/admin/couriers', adm, async (_, res) =>
  res.json((await db.query("SELECT id,full_name,is_active FROM users WHERE role='courier' ORDER BY full_name")).rows));
const toggle = tbl => async (req, res) => {
  const r = await db.query(`UPDATE ${tbl} SET is_active=$1 WHERE id=$2${tbl === 'users' ? " AND role<>'admin'" : ''}`,
    [!!req.body.is_active, req.params.id]);
  r.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'غير موجود' });
};
app.patch('/admin/stores/:id', adm, toggle('stores'));
app.patch('/admin/users/:id', adm, toggle('users'));

/* ---------- أخطاء ---------- */
app.use((e, req, res, next) => {
  const m = { 23505: [409, 'البريد أو الهاتف مسجّل مسبقاً'], '22P02': [400, 'قيمة غير صالحة'] }[e.code] || [e.status || 500, 'خطأ في الخادم'];
  if (m[0] >= 500) console.error(e);
  res.status(m[0]).json({ error: m[1] });
});

app.listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)));
