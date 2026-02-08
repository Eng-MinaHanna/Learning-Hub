require('dotenv').config();
const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();

// ==========================================
// 🛡️ Security Config (حسب كودك)
// ==========================================
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));
app.use(cors({
    origin: ["https://learning-hub-web-six.vercel.app", "http://localhost:3000", "https://learning-hub-et5.vercel.app"], 
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));
app.use(express.json());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000, 
    message: { status: "Fail", message: "Too many requests ⛔" }
});
app.use(limiter);

const JWT_SECRET = process.env.JWT_SECRET || "IEEE_ET5_SECRET_KEY_2026";
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const INSTRUCTOR_SECRET = process.env.INSTRUCTOR_SECRET;

// ==========================================
// ☁️ Cloudinary Configuration (حسب كودك)
// ==========================================
cloudinary.config({
    cloud_name: 'ddgp71uok',
    api_key: '581267836978872',
    api_secret: '-jLxAlPA7tQ587Xdd38nYJ0H4lA'
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'ieee_et5_main',
        resource_type: 'auto',
        allowed_formats: ['jpg', 'png', 'jpeg', 'pdf', 'doc', 'docx', 'ppt', 'pptx', 'zip', 'rar', 'mp4'],
    },
});
const upload = multer({ storage });

// ==========================================
// 🗄️ Database Connection (الـ Pool الصحيح لمنع التقل)
// ==========================================
const db = mysql.createPool({
    connectionLimit: 15,
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'ieee_et5_db',
    charset: 'utf8mb4',
    waitForConnections: true
});

// اختبار الاتصال
db.getConnection((err, conn) => {
    if (err) console.error('❌ DB Error:', err.message);
    else { console.log('✅ Connected to DB Pool 🚀'); conn.release(); }
});

// ==========================================
// 🛡️ Middlewares (نسخة كودك الأصلية)
// ==========================================
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(403).json({ status: "Fail", message: "No Token" });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ status: "Fail", message: "Invalid Token" });
        db.query("SELECT id, role, email, name FROM users WHERE id = ?", [decoded.id], (dbErr, data) => {
            if (dbErr || data.length === 0) return res.status(401).json({ status: "Fail", message: "User not found" });
            req.user = data[0]; 
            next();
        });
    });
};

const verifyAdmin = (req, res, next) => {
    verifyToken(req, res, () => {
        if (req.user && req.user.role === 'admin') next();
        else res.status(403).json({ status: "Fail", message: "Admin Only" });
    });
};

const createNotification = (userId, senderName, senderAvatar, message, type) => {
    db.query("INSERT INTO notifications (user_id, sender_name, sender_avatar, message, type) VALUES (?, ?, ?, ?, ?)", 
    [userId, senderName, senderAvatar, message, type]);
};

// ==========================================
// 🔐 Auth APIs (كل اللي كان في كودك)
// ==========================================

app.post('/api/register', async (req, res) => {
    const { name, email, phone, password, role, secretKey } = req.body;
    if (role === 'admin' && secretKey !== ADMIN_SECRET) return res.json({ status: "Fail", message: "Wrong Admin Code" });
    if (role === 'instructor' && secretKey !== INSTRUCTOR_SECRET) return res.json({ status: "Fail", message: "Wrong Instructor Code" });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.query("INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)", 
        [name, email, phone, hashedPassword, role], (err) => {
            if (err) return res.json({ status: "Fail", message: "Email exists" });
            res.json({ status: "Success" });
        });
    } catch (e) { res.status(500).json({ status: "Error" }); }
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.query("SELECT * FROM users WHERE email = ?", [email], async (err, data) => {
        if (err || data.length === 0) return res.json({ status: "Fail", message: "Invalid Credentials" });
        const isMatch = await bcrypt.compare(password, data[0].password);
        if (isMatch) {
            const token = jwt.sign({ id: data[0].id, role: data[0].role }, JWT_SECRET, { expiresIn: '7d' });
            const { password: _, ...user } = data[0];
            res.json({ status: "Success", user, token });
        } else { res.json({ status: "Fail", message: "Wrong Password" }); }
    });
});

// ==========================================
// 🌍 Community & Posts (Fixed 500)
// ==========================================

app.get('/api/posts', verifyToken, (req, res) => {
    db.query("SELECT * FROM posts ORDER BY id DESC", (err, data) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(data);
    });
});

app.post('/api/posts/add', verifyToken, upload.single('image'), (req, res) => {
    const { user_id, user_name, user_role, user_avatar, content } = req.body;
    const img = req.file ? req.file.path : null;
    db.query("INSERT INTO posts (user_id, user_name, user_role, user_avatar, content, post_image) VALUES (?,?,?,?,?,?)",
        [user_id, user_name, user_role, user_avatar, content, img], () => res.json({ status: "Success" }));
});

// ==========================================
// 💬 Comments & Reactions
// ==========================================

app.get('/api/comments/:postId', verifyToken, (req, res) => {
    db.query("SELECT * FROM comments WHERE post_id=? ORDER BY created_at ASC", [req.params.postId], (err, data) => res.json(data));
});

app.post('/api/comments/add', verifyToken, (req, res) => {
    const { post_id, course_id, user_id, user_name, user_avatar, comment_text } = req.body;
    const uid = user_id || req.user.id;
    const sql = course_id ? "INSERT INTO comments (course_id, user_id, user_name, user_avatar, comment_text) VALUES (?,?,?,?,?)" : "INSERT INTO comments (post_id, user_id, user_name, user_avatar, comment_text) VALUES (?,?,?,?,?)";
    db.query(sql, [course_id || post_id, uid, user_name, user_avatar, comment_text], () => res.json({ status: "Success" }));
});

app.get('/api/reactions', verifyToken, (req, res) => {
    db.query("SELECT * FROM reactions", (err, data) => res.json(data || []));
});

// ==========================================
// 🎓 Activities & Videos
// ==========================================

app.get('/api/activities/all', verifyToken, (req, res) => {
    db.query("SELECT * FROM activities ORDER BY id DESC", (err, data) => res.json(data));
});

app.get('/api/stats', verifyAdmin, (req, res) => {
    const sql = `SELECT (SELECT COUNT(*) FROM activities) as total_activities, (SELECT COUNT(*) FROM registrations) as total_students, (SELECT COUNT(*) FROM activities WHERE type='workshop') as total_workshops`;
    db.query(sql, (err, data) => res.json(data[0]));
});

app.get('/api/progress/calculate/:courseId/:email', verifyToken, (req, res) => {
    const { courseId, email } = req.params;
    db.query("SELECT COUNT(*) as total FROM course_videos WHERE course_id=?", [courseId], (err, t) => {
        if (!t || t[0].total === 0) return res.json({ percent: 0 });
        db.query("SELECT COUNT(*) as watched FROM video_progress vp JOIN course_videos cv ON vp.video_id = cv.id WHERE vp.user_email=? AND cv.course_id=? AND vp.is_completed=1",
            [email, courseId], (err, w) => res.json({ percent: Math.round((w[0].watched / t[0].total) * 100) }));
    });
});

// ==========================================
// 🛠️ Quizzes & Tasks (اللي أنت كنت خايف أنساهم)
// ==========================================

app.post('/api/quiz/attempt', verifyToken, (req, res) => {
    const { user_email, course_id, score } = req.body;
    db.query("INSERT INTO quiz_attempts (user_email, course_id, score) VALUES (?, ?, ?)", [user_email, course_id, score], () => res.json({ status: "Success" }));
});

app.post('/api/tasks/submit', verifyToken, (req, res) => {
    const { course_id, video_id, task_link } = req.body;
    db.query("INSERT INTO task_submissions (user_id, course_id, video_id, task_link) VALUES (?, ?, ?, ?)", 
    [req.user.id, course_id, video_id, task_link], (err) => res.json({ status: err ? "Fail" : "Success" }));
});

// ==========================================
// 🤝 Sponsors (Fixed ORDER BY)
// ==========================================

app.get('/api/public/sponsors', (req, res) => {
    db.query("SELECT * FROM sponsors_partners", (err, data) => res.json(data || []));
});

// جلب المستخدمين للأدمن
app.get('/api/users', verifyAdmin, (req, res) => {
    db.query("SELECT id, name, email, role, profile_pic FROM users ORDER BY id DESC", (err, data) => {
        if (err) return res.status(500).json([]);
        res.json(data);
    });
});

// Leaderboard
app.get('/api/leaderboard', verifyToken, (req, res) => {
    db.query("SELECT id, name, profile_pic, role FROM users WHERE role='student' LIMIT 10", (err, data) => res.json(data));
});

app.get('/api/team', verifyToken, (req, res) => {
    db.query("SELECT name, role, profile_pic FROM users WHERE role IN ('admin', 'instructor')", (err, data) => res.json(data));
});

// ==========================================
// 🚀 Start
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));

module.exports = app;
