// npm run seed — حسابات تجريبية + متاجر ومنتجات. كلمات المرور عشوائية وتُطبع مرة واحدة فقط.
const { Pool } = require('pg'), bcrypt = require('bcryptjs'), crypto = require('crypto');
const db = new Pool({ connectionString: process.env.DATABASE_URL });

const DATA = [
  ['food', 'مطعم الأصالة', 'جليز، مراكش', 31.6347, -8.0089, [['برغر دجاج', 35], ['بيتزا مارغريتا', 45], ['شاورما لحم', 30], ['عصير برتقال', 12]]],
  ['food', 'طاكوس الساحة', 'جامع الفنا، مراكش', 31.6258, -7.9891, [['طاكوس دجاج', 28], ['طاكوس مشكل', 34]]],
  ['grocery', 'سوبر ماركت السلام', 'المسيرة، مراكش', 31.6459, -8.0505, [['حليب 1 لتر', 8], ['خبز', 2], ['بيض (12)', 22], ['زيت زيتون 1 لتر', 55]]],
  ['pharmacy', 'صيدلية الشفاء', 'جليز، مراكش', 31.6381, -8.0133, [['باراسيتامول', 9], ['فيتامين C', 35], ['كمامات (50)', 25]]],
];

(async () => {
  const user = async (role, name, email, phone) => {
    const pw = crypto.randomBytes(5).toString('hex');
    const { rows: [u] } = await db.query(
      'INSERT INTO users(role,full_name,email,phone,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [role, name, email, phone, await bcrypt.hash(pw, 10)]);
    console.log(role.padEnd(12), email.padEnd(22), pw);
    return u.id;
  };
  await user('admin', 'المدير', 'admin@demo.test', '0600000001');
  await user('courier', 'يوسف السائق', 'courier@demo.test', '0600000002');
  await user('customer', 'أحمد الزبون', 'customer@demo.test', '0600000003');
  const owner = await user('store_owner', 'صاحب المتجر', 'store@demo.test', '0600000004');
  for (const [cat, name, addr, lat, lng, ps] of DATA) {
    const { rows: [s] } = await db.query(
      'INSERT INTO stores(owner_id,name,category,address,lat,lng) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
      [owner, name, cat, addr, lat, lng]);
    for (const [pn, price] of ps)
      await db.query('INSERT INTO products(store_id,name,price) VALUES($1,$2,$3)', [s.id, pn, price]);
  }
  await db.end();
})().catch(e => { console.error(e.message); process.exit(1); });
