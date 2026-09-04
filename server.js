const express=require('express');
const path=require('path');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const {Pool}=require('pg');

const app=express();
const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||'CAMBIA-ESTA-CLAVE-EMPODERARTE';
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:false});

const today=()=>new Date().toISOString().slice(0,10);
const nextMonth=d=>{const x=new Date((d&&d>=today()?d:today())+'T12:00:00');x.setMonth(x.getMonth()+1);return x.toISOString().slice(0,10)};

async function init(){
  if(!process.env.DATABASE_URL) console.warn('DATABASE_URL no configurada: se requiere PostgreSQL para producción.');
  await pool.query(`
CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'recepcion',active INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,last_login TIMESTAMP);
CREATE TABLE IF NOT EXISTS students(id SERIAL PRIMARY KEY,matricula TEXT UNIQUE,name TEXT NOT NULL,last_name TEXT NOT NULL,birth_date TEXT,phone TEXT,email TEXT,tutor TEXT,tutor_phone TEXT,plan TEXT DEFAULT 'Inicial',status TEXT DEFAULT 'Activo',enrollment_date TEXT NOT NULL,monthly_fee NUMERIC DEFAULT 0,due_date TEXT,benefit_level TEXT DEFAULT 'Base',notes TEXT,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS payments(id SERIAL PRIMARY KEY,receipt_no TEXT UNIQUE NOT NULL,student_id INTEGER NOT NULL REFERENCES students(id),amount NUMERIC NOT NULL,method TEXT NOT NULL,concept TEXT DEFAULT 'Mensualidad',paid_at TEXT NOT NULL,period TEXT,notes TEXT,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS attendance(id SERIAL PRIMARY KEY,student_id INTEGER NOT NULL REFERENCES students(id),attended_at TEXT NOT NULL,discipline TEXT,group_name TEXT,status TEXT DEFAULT 'Presente',notes TEXT);
CREATE TABLE IF NOT EXISTS promotions(id SERIAL PRIMARY KEY,name TEXT NOT NULL,description TEXT,discount NUMERIC DEFAULT 0,kind TEXT DEFAULT 'Porcentaje',active INTEGER DEFAULT 1,expires_at TEXT);
CREATE TABLE IF NOT EXISTS benefits(id SERIAL PRIMARY KEY,name TEXT NOT NULL,description TEXT,level TEXT DEFAULT 'Base',active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS audit(id SERIAL PRIMARY KEY,user_id INTEGER,module TEXT,record_id INTEGER,action TEXT NOT NULL,detail TEXT,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
  `);
  const u=await pool.query('SELECT id FROM users WHERE email=$1',['director@empoderarte.local']);
  if(!u.rowCount) await pool.query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)',['Director EmpoderArte','director@empoderarte.local',bcrypt.hashSync('empoderarte',10),'director']);
  const p=await pool.query('SELECT id FROM promotions LIMIT 1');
  if(!p.rowCount) await pool.query('INSERT INTO promotions(name,description,discount,kind) VALUES($1,$2,$3,$4)',['Bienvenida EmpoderArte','Promoción inicial para nuevos alumnos',10,'Porcentaje']);
  const b=await pool.query('SELECT id FROM benefits LIMIT 1');
  if(!b.rowCount){for(const x of ['Base','Plus','Premium','Elite']) await pool.query('INSERT INTO benefits(name,description,level) VALUES($1,$2,$3)',[x,'Beneficios del nivel '+x,x]);}
}

async function matricula(){const y=new Date().getFullYear();const r=await pool.query("SELECT COALESCE(MAX(CAST(SUBSTRING(matricula FROM 10) AS INTEGER)),0) n FROM students WHERE matricula LIKE $1",[`EMP-${y}-%`]);return `EMP-${y}-${String(Number(r.rows[0].n)+1).padStart(5,'0')}`}
async function receipt(){const y=new Date().getFullYear();const r=await pool.query("SELECT COALESCE(MAX(CAST(SUBSTRING(receipt_no FROM 10) AS INTEGER)),0) n FROM payments WHERE receipt_no LIKE $1",[`REC-${y}-%`]);return `REC-${y}-${String(Number(r.rows[0].n)+1).padStart(6,'0')}`}
async function audit(u,a,m,id,d=''){await pool.query('INSERT INTO audit(user_id,action,module,record_id,detail) VALUES($1,$2,$3,$4,$5)',[u.id,a,m,id,d])}
function auth(req,res,next){const t=(req.headers.authorization||'').replace(/^Bearer /,'');try{req.user=jwt.verify(t,JWT_SECRET);next()}catch(e){res.status(401).json({error:'Sesión expirada'})}}
function director(req,res,next){if(req.user.role!=='director')return res.status(403).json({error:'Solo el director puede realizar esta acción'});next()}

app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname,'public')));

app.get('/health',(q,s)=>s.json({ok:true,app:'EmpoderArte',version:'2.1.0'}));
app.post('/api/login',async(q,s)=>{try{const b=q.body||{},r=await pool.query('SELECT * FROM users WHERE email=$1 AND active=1',[b.email||'']);const u=r.rows[0];if(!u||!bcrypt.compareSync(b.password||'',u.password_hash))return s.status(401).json({error:'Usuario o contraseña incorrectos'});await pool.query('UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=$1',[u.id]);s.json({token:jwt.sign({id:u.id,name:u.name,email:u.email,role:u.role},JWT_SECRET,{expiresIn:'8h'}),user:{id:u.id,name:u.name,email:u.email,role:u.role}})}catch(e){console.error(e);s.status(500).json({error:'Error del servidor'})}});
app.get('/api/me',auth,(q,s)=>s.json({user:q.user}));
app.get('/api/dashboard',auth,async(q,s)=>{try{const [total,active,overdue,upcoming,revenue,attendance,exp,recent]=await Promise.all([
 pool.query('SELECT COUNT(*) c FROM students'),pool.query("SELECT COUNT(*) c FROM students WHERE status='Activo'"),pool.query("SELECT COUNT(*) c FROM students WHERE status='Activo' AND due_date IS NOT NULL AND due_date < CURRENT_DATE::text"),pool.query("SELECT COUNT(*) c FROM students WHERE status='Activo' AND due_date IS NOT NULL AND due_date >= CURRENT_DATE::text AND due_date <= (CURRENT_DATE+7)::text"),pool.query("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE paid_at >= date_trunc('month',CURRENT_DATE)::date::text"),pool.query("SELECT COUNT(*) c FROM attendance WHERE attended_at=CURRENT_DATE::text AND status='Presente'"),pool.query("SELECT * FROM students WHERE status='Activo' AND due_date IS NOT NULL AND due_date <= (CURRENT_DATE+7)::text ORDER BY due_date LIMIT 8"),pool.query('SELECT p.*,s.matricula,s.name,s.last_name FROM payments p JOIN students s ON s.id=p.student_id ORDER BY p.id DESC LIMIT 8')]);s.json({total:+total.rows[0].c,active:+active.rows[0].c,overdue:+overdue.rows[0].c,upcoming:+upcoming.rows[0].c,revenue:+revenue.rows[0].total,attendance:+attendance.rows[0].c,exp:exp.rows,recent:recent.rows})}catch(e){console.error(e);s.status(500).json({error:'No se pudo cargar el panel'})}});
app.get('/api/students',auth,async(q,s)=>{try{const x=(q.query.q||'').trim();const r=x?await pool.query('SELECT * FROM students WHERE matricula ILIKE $1 OR name ILIKE $2 OR last_name ILIKE $3 ORDER BY id DESC',[`%${x}%`,`%${x}%`,`%${x}%`]):await pool.query('SELECT * FROM students ORDER BY id DESC');const lim=Date.now()+7*864e5;s.json(r.rows.map(a=>({...a,payment_status:a.due_date&&a.status==='Activo'?(new Date(a.due_date+'T12:00:00')<new Date()?'Vencido':new Date(a.due_date+'T12:00:00').getTime()<=lim?'Próximo':'Al corriente'):'Sin fecha'})))}catch(e){console.error(e);s.status(500).json({error:'No se pudieron cargar los alumnos'})}});
app.post('/api/students',auth,async(q,s)=>{try{const b=q.body||{}
    b.name = b.name ?? b.nombre ?? b.nombres ?? '';
  b.last_name = b.last_name ?? b.apellidos ?? b.apellido ?? '';
  b.birth_date = b.birth_date ?? b.fecha_nacimiento ?? b.fechaNacimiento ?? null;
  b.phone = b.phone ?? b.telefono ?? null;
  b.email = b.email ?? b.correo ?? null;
  b.tutor = b.tutor ?? b.tutor_contacto ?? b.tutorContacto ?? null;
  b.tutor_phone = b.tutor_phone ?? b.telefono_tutor ?? b.telefonoTutor ?? null;
  b.plan = b.plan ?? 'Inicial';
  b.status = b.status ?? b.estado ?? 'Activo';
  b.enrollment_date = b.enrollment_date ?? b.fecha_alta ?? b.fechaAlta ?? today();
  b.monthly_fee = b.monthly_fee ?? b.cuota_mensual ?? b.cuotaMensual ?? 0;
  b.due_date = b.due_date ?? b.primer_vencimiento ?? b.primerVencimiento ?? nextMonth(today());
  b.benefit_level = b.benefit_level ?? b.nivel_beneficio ?? b.nivelBeneficio ?? 'Base';
  b.notes = b.notes ?? b.notas ?? '';;if(!b.name||!b.last_name)return s.status(400).json({error:'Nombre y apellidos son obligatorios'});const m=await matricula();const r=await pool.query(`INSERT INTO students(matricula,name,last_name,birth_date,phone,email,tutor,tutor_phone,plan,status,enrollment_date,monthly_fee,due_date,benefit_level,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[m,b.name,b.last_name,b.birth_date||null,b.phone||null,b.email||null,b.tutor||null,b.tutor_phone||null,b.plan||'Inicial',b.status||'Activo',b.enrollment_date||today(),+b.monthly_fee||0,b.due_date||nextMonth(today()),b.benefit_level||'Base',b.notes||'']);await audit(q.user,'CREATE','ALUMNOS',r.rows[0].id,'Alta '+m);s.status(201).json(r.rows[0])}catch(e){console.error(e);s.status(500).json({error:'No se pudo registrar el alumno'})}});
app.get('/api/students/:id',auth,async(q,s)=>{try{const a=await pool.query('SELECT * FROM students WHERE id=$1',[q.params.id]);if(!a.rowCount)return s.status(404).json({error:'Alumno no encontrado'});const [p,at]=await Promise.all([pool.query('SELECT * FROM payments WHERE student_id=$1 ORDER BY id DESC',[q.params.id]),pool.query('SELECT * FROM attendance WHERE student_id=$1 ORDER BY id DESC LIMIT 20',[q.params.id])]);s.json({...a.rows[0],payments:p.rows,attendance:at.rows})}catch(e){console.error(e);s.status(500).json({error:'No se pudo cargar el expediente'})}});
app.put('/api/students/:id',auth,async(q,s)=>{try{const b=q.body||{},old=await pool.query('SELECT * FROM students WHERE id=$1',[q.params.id]);if(!old.rowCount)return s.status(404).json({error:'Alumno no encontrado'});const ks=['name','last_name','birth_date','phone','email','tutor','tutor_phone','plan','status','enrollment_date','monthly_fee','due_date','benefit_level','notes'],set=[],v=[];for(const k of ks)if(k in b){set.push(`${k}=$${v.length+1}`);v.push(k==='monthly_fee'?+b[k]||0:b[k])}if(set.length){v.push(q.params.id);await pool.query(`UPDATE students SET ${set.join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=$${v.length}` ,v);await audit(q.user,'UPDATE','ALUMNOS',q.params.id,'Actualización de expediente')}const r=await pool.query('SELECT * FROM students WHERE id=$1',[q.params.id]);s.json(r.rows[0])}catch(e){console.error(e);s.status(500).json({error:'No se pudo actualizar el alumno'})}});
app.post('/api/payments',auth,async(q,s)=>{try{const b=q.body||{},a=await pool.query('SELECT * FROM students WHERE id=$1',[b.student_id]);if(!a.rowCount)return s.status(404).json({error:'Alumno no encontrado'});const st=a.rows[0];if(+b.amount<=0)return s.status(400).json({error:'El monto debe ser mayor a cero'});const rec=await receipt();const r=await pool.query('INSERT INTO payments(receipt_no,student_id,amount,method,concept,paid_at,period,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[rec,st.id,+b.amount,b.method||'Efectivo',b.concept||'Mensualidad',b.paid_at||today(),b.period||'',b.notes||'']);if((b.concept||'').toLowerCase().includes('mensual'))await pool.query('UPDATE students SET due_date=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2',[nextMonth(st.due_date),st.id]);await audit(q.user,'CREATE','PAGOS',r.rows[0].id,'Recibo '+rec);const full=await pool.query('SELECT p.*,s.matricula,s.name,s.last_name FROM payments p JOIN students s ON s.id=p.student_id WHERE p.id=$1',[r.rows[0].id]);s.status(201).json(full.rows[0])}catch(e){console.error(e);s.status(500).json({error:'No se pudo registrar el pago'})}});
app.get('/api/payments',auth,async(q,s)=>{try{s.json((await pool.query('SELECT p.*,s.matricula,s.name,s.last_name FROM payments p JOIN students s ON s.id=p.student_id ORDER BY p.id DESC LIMIT 500')).rows)}catch(e){console.error(e);s.status(500).json({error:'No se pudieron cargar los pagos'})}});
app.post('/api/attendance',auth,async(q,s)=>{try{const b=q.body||{};if(!b.student_id)return s.status(400).json({error:'Selecciona un alumno'});const r=await pool.query('INSERT INTO attendance(student_id,attended_at,discipline,group_name,status,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[b.student_id,b.attended_at||today(),b.discipline||'',b.group_name||'',b.status||'Presente',b.notes||'']);await audit(q.user,'CREATE','ASISTENCIA',r.rows[0].id,'Registro de asistencia');s.status(201).json(r.rows[0])}catch(e){console.error(e);s.status(500).json({error:'No se pudo registrar la asistencia'})}});
app.get('/api/attendance',auth,async(q,s)=>{try{s.json((await pool.query('SELECT a.*,s.matricula,s.name,s.last_name FROM attendance a JOIN students s ON s.id=a.student_id ORDER BY a.id DESC LIMIT 500')).rows)}catch(e){console.error(e);s.status(500).json({error:'No se pudo cargar la asistencia'})}});
app.get('/api/promotions',auth,async(q,s)=>s.json((await pool.query('SELECT * FROM promotions ORDER BY id DESC')).rows));
app.post('/api/promotions',auth,director,async(q,s)=>{try{const b=q.body||{};if(!b.name)return s.status(400).json({error:'Nombre obligatorio'});const r=await pool.query('INSERT INTO promotions(name,description,discount,kind,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING *',[b.name,b.description||'',+b.discount||0,b.kind||'Porcentaje',b.expires_at||null]);await audit(q.user,'CREATE','PROMOCIONES',r.rows[0].id,'Nueva promoción');s.status(201).json(r.rows[0])}catch(e){console.error(e);s.status(500).json({error:'No se pudo crear la promoción'})}});
app.get('/api/benefits',auth,async(q,s)=>s.json((await pool.query('SELECT * FROM benefits ORDER BY id')).rows));
app.get('/api/users',auth,director,async(q,s)=>s.json((await pool.query('SELECT id,name,email,role,active,created_at,last_login FROM users ORDER BY id')).rows));
app.post('/api/users',auth,director,async(q,s)=>{try{const b=q.body||{};const r=await pool.query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role',[b.name,b.email,bcrypt.hashSync(b.password,10),b.role||'recepcion']);await audit(q.user,'CREATE','USUARIOS',r.rows[0].id,'Nuevo usuario');s.status(201).json(r.rows[0])}catch(e){console.error(e);s.status(400).json({error:'El correo ya existe'})}});
app.get('/api/audit',auth,director,async(q,s)=>s.json((await pool.query('SELECT a.*,u.name user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500')).rows));
app.get('/api/report',auth,async(q,s)=>{try{const [a,b,c,d]=await Promise.all([pool.query('SELECT COUNT(*) n FROM students'),pool.query("SELECT COUNT(*) n FROM students WHERE status='Activo'"),pool.query("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE paid_at >= date_trunc('month',CURRENT_DATE)::date::text"),pool.query("SELECT COUNT(*) n FROM students WHERE status='Activo' AND due_date < CURRENT_DATE::text")]);s.json({alumnos:+a.rows[0].n,activos:+b.rows[0].n,ingresos:+c.rows[0].n,vencidos:+d.rows[0].n})}catch(e){console.error(e);s.status(500).json({error:'No se pudo generar el reporte'})}});
app.get('*',(q,s)=>s.sendFile(path.join(__dirname,'public','index.html')));

init().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`EmpoderArte V2.1 en puerto ${PORT}`))).catch(e=>{console.error('No se pudo iniciar la base de datos',e);process.exit(1)});
process.on('SIGTERM',async()=>{await pool.end();process.exit(0)});
