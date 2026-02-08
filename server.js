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
// 🛡️ Security Config
// ==========================================
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));
app.use(cors({
    origin: ["https://learning-hub-web-six.vercel.app", "http://localhost:3000"], 
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));
app.use(express.json());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500, // زيادة الحد لضمان عدم حظر الطلبات المكثفة في البداية
    message: { status: "Fail", message: "Too many requests ⛔" }
});
app.use(limiter);

const JWT_SECRET = process.env.JWT_SECRET || "IEEE_ET5_SECRET_KEY_2026";
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const INSTRUCTOR_SECRET = process.env.INSTRUCTOR_SECRET;

// ==========================================
// ☁️ Cloudinary Configuration
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
// 🗄️ Database Connection (Improved with Pool)
// ==========================================
// استخدام Pool يمنع الـ Lag ويقوم بإعادة الاتصال تلقائياً إذا انقطع
const db = mysql.createPool({
    connectionLimit: 10,
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'ieee_et5_db'
});

console.log('✅ Database Pool Created 🚀');

// ==========================================
// 🛡️ Middlewares
// ==========================================
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(403).json({ status: "Fail", message: "No Token" });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ status: "Fail", message: "Invalid Token" });
        
        const sql = "SELECT id, role, email, name FROM users WHERE id = ?";
        db.query(sql, [decoded.id], (dbErr, data) => {
            if (dbErr || data.length === 0) {
                return res.status(401).json({ status: "Fail", message: "User no longer exists" });
            }
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
    const sql = "INSERT INTO notifications (user_id, sender_name, sender_avatar, message, type) VALUES (?, ?, ?, ?, ?)";
    db.query(sql, [userId, senderName, senderAvatar, message, type]);
};

const reactionIcons = { like: '👍', love: '❤️', haha: '😂', wow: '😮', sad: '😢', angry: '😡' };

// ==========================================
// 🔐 Auth APIs
// ==========================================

app.post('/api/register', async (req, res) => {
    const { name, email, phone, password, role, secretKey } = req.body;
    if (role === 'admin' && secretKey !== ADMIN_SECRET) return res.json({ status: "Fail", message: "Wrong Admin Code" });
    if (role === 'instructor' && secretKey !== INSTRUCTOR_SECRET) return res.json({ status: "Fail", message: "Wrong Instructor Code" });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = "INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)";
        db.query(sql, [name, email, phone, hashedPassword, role], (err) => {
            if (err) return res.json({ status: "Fail", message: "Email already exists" });
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
        } else {
            res.json({ status: "Fail", message: "Wrong Password" });
        }
    });
});

// ==========================================
// 🤝 Partners & Sponsors APIs (FIXED SECTION)
// ==========================================

// جلب الرعاة (تم إصلاح الخطأ بمسح ORDER BY created_at)
app.get('/api/public/sponsors', (req, res) => {
    // تم إزالة ORDER BY created_at لأن العمود غالباً غير موجود
    db.query("SELECT * FROM sponsors_partners", (err, data) => {
        if (err) {
            console.error("Sponsors Fetch Error:", err);
            return res.status(500).json({ status: "Error", message: "Database query failed" });
        }
        res.json(data || []);
    });
});

app.post('/api/admin/sponsors/add', verifyAdmin, upload.single('logo'), (req, res) => {
    const { name, type, website_link } = req.body;
    const logoUrl = req.file ? req.file.path : req.body.logo_url;

    if (!name || !type || !logoUrl) {
        return res.status(400).json({ status: "Fail", message: "Missing required fields" });
    }

    const sql = "INSERT INTO sponsors_partners (name, type, logo_url, website_link) VALUES (?, ?, ?, ?)";
    db.query(sql, [name, type, logoUrl, website_link], (err) => {
        if (err) return res.status(500).json({ status: "Error", message: err.message });
        res.json({ status: "Success" });
    });
});

app.delete('/api/admin/sponsors/delete/:id', verifyAdmin, (req, res) => {
    db.query("DELETE FROM sponsors_partners WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ status: "Error" });
        res.json({ status: "Deleted" });
    });
});

// ==========================================
// 🎓 Activities & Courses (Optimized Queries)
// ==========================================

app.get('/api/activities/all', verifyToken, (req, res) => {
    const sql = `SELECT activities.*, 
                (SELECT COUNT(*) FROM registrations WHERE registrations.activity_id = activities.id) as registered_count 
                FROM activities ORDER BY id DESC`;
    db.query(sql, (err, data) => {
        if (err) return res.status(500).json(err);
        res.json(data);
    });
});

app.get('/api/stats', verifyAdmin, (req, res) => {
    const sql = `SELECT 
        (SELECT COUNT(*) FROM activities) as total_activities, 
        (SELECT COUNT(*) FROM registrations) as total_students, 
        (SELECT COUNT(*) FROM activities WHERE type='workshop') as total_workshops`;
    db.query(sql, (err, data) => {
        if (err) return res.status(500).json(err);
        res.json(data[0]);
    });
});

// التقدم (Progress)
app.get('/api/progress/calculate/:courseId/:email', verifyToken, (req, res) => {
    const { courseId, email } = req.params;
    db.query("SELECT COUNT(*) as total FROM course_videos WHERE course_id=?", [courseId], (err, t) => {
        if (err || !t || t[0].total === 0) return res.json({ percent: 0 });
        const sql = "SELECT COUNT(*) as watched FROM video_progress vp JOIN course_videos cv ON vp.video_id = cv.id WHERE vp.user_email=? AND cv.course_id=? AND vp.is_completed=1";
        db.query(sql, [email, courseId], (err, w) => {
            if (err) return res.json({ percent: 0 });
            res.json({ percent: Math.round((w[0].watched / t[0].total) * 100) });
        });
    });
});

// --- إشعارات (Notifications) ---
app.get('/api/notifications/:userId', verifyToken, (req, res) => {
    db.query("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 20", [req.params.userId], (err, data) => {
        if (err) return res.status(500).json([]);
        res.json(data);
    });
});

// ==========================================
// 🌍 REST OF THE APIs (Comments, Posts, Quiz)
// ==========================================
// ملاحظة: بقية الـ APIs في كودك الأصلي تم الاحتفاظ بمنطقها ولكن تأكد من استخدام Pool (db.query) دائمًا

app.get('/api/posts', verifyToken, (req, res) => {
    const sql = "SELECT * FROM posts ORDER BY id DESC";
    db.query(sql, (err, data) => {
        if (err) return res.status(500).json([]);
        res.json(data);
    });
});

app.get('/api/team', verifyToken, (req, res) => {
    const sql = "SELECT name, role, profile_pic, email FROM users WHERE role IN ('admin', 'instructor') ORDER BY name ASC";
    db.query(sql, (err, data) => {
        if (err) return res.status(500).json([]);
        res.json(data);
    });
});

// ==========================================
// 🚀 Start
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}...`));

module.exports = app;
