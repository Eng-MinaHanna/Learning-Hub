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
// 🛡️ Security & CORS Config
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
    max: 1000, // زيادة الحد لضمان استقرار التحميل المكثف
    message: { status: "Fail", message: "Too many requests ⛔" }
});
app.use(limiter);

const JWT_SECRET = process.env.JWT_SECRET || "IEEE_ET5_SECRET_KEY_2026";
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const INSTRUCTOR_SECRET = process.env.INSTRUCTOR_SECRET;

// ==========================================
// ☁️ Cloudinary Config
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
        resource_type: 'auto'
    },
});
const upload = multer({ storage });

// ==========================================
// 🗄️ Database Connection (Pool Mode)
// ==========================================
const db = mysql.createPool({
    connectionLimit: 20, // زيادة القنوات لتقليل اللاج
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'ieee_et5_db',
    charset: 'utf8mb4'
});

console.log('✅ Database Pool Active 🚀');

// ==========================================
// 🛡️ Middlewares
// ==========================================
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ status: "Fail", message: "No Token Provided" });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ status: "Fail", message: "Invalid Token" });
        const sql = "SELECT id, role, email, name FROM users WHERE id = ?";
        db.query(sql, [decoded.id], (dbErr, data) => {
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

// ==========================================
// 🔐 Auth & Users APIs
// ==========================================

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.query("SELECT * FROM users WHERE email = ?", [email], async (err, data) => {
        if (err || data.length === 0) return res.json({ status: "Fail", message: "User not found" });
        const isMatch = await bcrypt.compare(password, data[0].password);
        if (!isMatch) return res.json({ status: "Fail", message: "Wrong Password" });
        
        const token = jwt.sign({ id: data[0].id, role: data[0].role }, JWT_SECRET, { expiresIn: '7d' });
        const { password: _, ...user } = data[0];
        res.json({ status: "Success", user, token });
    });
});

// ✅ إصلاح خطأ 404 في جلب المستخدمين
app.get('/api/users', verifyAdmin, (req, res) => {
    db.query("SELECT id, name, email, phone, role, profile_pic FROM users ORDER BY id DESC", (err, data) => {
        if (err) return res.status(500).json([]);
        res.json(data);
    });
});

// ==========================================
// 🎓 Activities & Stats
// ==========================================

app.get('/api/activities/all', verifyToken, (req, res) => {
    const sql = `SELECT activities.*, 
                (SELECT COUNT(*) FROM registrations WHERE registrations.activity_id = activities.id) as registered_count 
                FROM activities ORDER BY id DESC`;
    db.query(sql, (err, data) => {
        if (err) return res.status(500).json([]);
        res.json(data);
    });
});

app.get('/api/stats', verifyAdmin, (req, res) => {
    const sql = `SELECT 
        (SELECT COUNT(*) FROM activities) as total_activities, 
        (SELECT COUNT(*) FROM users WHERE role='student' OR role='user') as total_students, 
        (SELECT COUNT(*) FROM activities WHERE type='workshop') as total_workshops`;
    db.query(sql, (err, data) => {
        if (err) return res.status(500).json({});
        res.json(data[0]);
    });
});

// ✅ إصلاح خطأ 404 في الـ Leaderboard
app.get('/api/leaderboard', verifyToken, (req, res) => {
    const sql = `SELECT id, name, profile_pic, role, job_title,
                (SELECT COUNT(*) FROM video_progress WHERE user_email = users.email AND is_completed=1) * 10 AS points
                FROM users WHERE role NOT IN ('admin', 'company', 'instructor')
                ORDER BY points DESC LIMIT 10`;
    db.query(sql, (err, data) => {
        if (err) return res.status(500).json([]);
        res.json(data);
    });
});

// ==========================================
// 📅 Schedule & Videos
// ==========================================

// ✅ إصلاح خطأ 404 في الجدول الزمني
app.get('/api/schedule/all', verifyToken, (req, res) => {
    const sql = `SELECT v.*, a.title as course_title 
                 FROM course_videos v 
                 JOIN activities a ON v.course_id = a.id 
                 WHERE v.video_date IS NOT NULL ORDER BY v.video_date ASC`;
    db.query(sql, (err, data) => {
        if (err) return res.status(500).json([]);
        res.json(data);
    });
});

app.get('/api/progress/calculate/:courseId/:email', verifyToken, (req, res) => {
    const { courseId, email } = req.params;
    db.query("SELECT COUNT(*) as total FROM course_videos WHERE course_id=?", [courseId], (err, t) => {
        if (err || !t || t[0].total === 0) return res.json({ percent: 0 });
        const sql = "SELECT COUNT(*) as watched FROM video_progress vp JOIN course_videos cv ON vp.video_id = cv.id WHERE vp.user_email=? AND cv.course_id=? AND vp.is_completed=1";
        db.query(sql, [email, courseId], (err, w) => {
            res.json({ percent: Math.round(((w[0]?.watched || 0) / t[0].total) * 100) });
        });
    });
});

// ==========================================
// 🤝 Partners & Sponsors
// ==========================================

app.get('/api/public/sponsors', (req, res) => {
    db.query("SELECT * FROM sponsors_partners", (err, data) => {
        if (err) return res.status(500).json([]);
        res.json(data);
    });
});

// ==========================================
// 🌍 Community & Reactions
// ==========================================

// ✅ إصلاح خطأ 404 في التفاعلات (Reactions)
app.get('/api/reactions', verifyToken, (req, res) => {
    db.query("SELECT * FROM reactions", (err, data) => {
        if (err) return res.status(500).json([]);
        res.json(data);
    });
});

app.get('/api/posts', verifyToken, (req, res) => {
    db.query("SELECT * FROM posts ORDER BY id DESC", (err, data) => {
        if (err) return res.status(500).json([]);
        res.json(data);
    });
});

app.get('/api/notifications/:userId', verifyToken, (req, res) => {
    db.query("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 20", [req.params.userId], (err, data) => {
        res.json(data || []);
    });
});

app.get('/api/team', verifyToken, (req, res) => {
    db.query("SELECT name, role, profile_pic, email FROM users WHERE role IN ('admin', 'instructor') ORDER BY name ASC", (err, data) => {
        res.json(data || []);
    });
});

// ==========================================
// 🚀 Start Server
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}...`));

module.exports = app;
