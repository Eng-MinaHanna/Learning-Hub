require('dotenv').config();
const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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
    origin: ["https://learning-hub-web-six.vercel.app", "http://localhost:3000", "https://learning-hub-et5.vercel.app"], 
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));
app.use(express.json());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2000, 
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
    cloud_name: 'ddgp71uok', api_key: '581267836978872', api_secret: '-jLxAlPA7tQ587Xdd38nYJ0H4lA'
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
// 🗄️ Database Connection (Safe Pool for Free Tier)
// ==========================================
const db = mysql.createPool({
    connectionLimit: 4, // نترك اتصالاً واحداً لـ DBeaver
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'ieee_et5_db',
    charset: 'utf8mb4',
    waitForConnections: true,
    queueLimit: 0,
    connectTimeout: 30000
});

console.log('✅ Robust Connection Pool Ready 🚀');

// ==========================================
// 🛡️ Middlewares
// ==========================================
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ status: "Fail", message: "No Token Provided" });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ status: "Fail", message: "Invalid Token" });
        // فحص سريع من الـ Pool؛ لو الداتا بيز معلقة، نعتمد على بيانات التوكن
        db.query("SELECT id, role, email, name FROM users WHERE id = ?", [decoded.id], (dbErr, data) => {
            if (dbErr || !data || data.length === 0) {
                req.user = { id: decoded.id, role: decoded.role }; 
                return next();
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
    db.query("INSERT INTO notifications (user_id, sender_name, sender_avatar, message, type) VALUES (?, ?, ?, ?, ?)", [userId, senderName, senderAvatar, message, type]);
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
        db.query("INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)", [name, email, phone, hashedPassword, role], (err) => {
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
        } else { res.json({ status: "Fail", message: "Wrong Password" }); }
    });
});

app.put('/api/user/update', verifyToken, upload.single('avatar'), (req, res) => {
    const { id, name, email, phone, linkedin, cv_link, job_title, role, newPassword } = req.body;
    db.query("SELECT * FROM users WHERE id = ?", [id], async (err, users) => {
        if (err || users.length === 0) return res.status(500).json({ status: "Fail" });
        let finalPassword = users[0].password;
        if (newPassword && newPassword.trim() !== "") finalPassword = await bcrypt.hash(newPassword, 10);
        let sql = "UPDATE users SET name=?, email=?, phone=?, password=?, role=?, linkedin=?, cv_link=?, job_title=?";
        let params = [name, email, phone, finalPassword, role || users[0].role, linkedin, cv_link, job_title];
        if (req.file) { sql += ", profile_pic=?"; params.push(req.file.path); }
        sql += " WHERE id=?"; params.push(id);
        db.query(sql, params, () => res.json({ status: "Success", newProfilePic: req.file?.path }));
    });
});

app.post('/api/check-subscription', verifyToken, (req, res) => {
    db.query("SELECT id FROM registrations WHERE activity_id = ? AND student_name = ? LIMIT 1", [req.body.course_id, req.body.student_name], (err, data) => {
        if (err) return res.json({ isSubscribed: false });
        res.json({ isSubscribed: data?.length > 0 });
    });
});

app.post('/api/subscribe', verifyToken, (req, res) => {
    db.query("INSERT INTO registrations (activity_id, student_name, student_email) VALUES (?, ?, ?)", [req.body.course_id, req.body.student_name, req.body.student_email], () => res.json({ status: "Success" }));
});

// ==========================================
// 🌍 Community APIs (Fixed Performance)
// ==========================================
app.get('/api/posts', verifyToken, (req, res) => {
    // استخدام JOIN مجمع لتسريع العملية ومنع الـ 500
    const sql = `SELECT p.*, COUNT(DISTINCT c.id) AS comment_count, COUNT(DISTINCT r.id) AS reaction_count 
                 FROM posts p LEFT JOIN comments c ON p.id = c.post_id LEFT JOIN reactions r ON p.id = r.post_id 
                 GROUP BY p.id ORDER BY p.id DESC`;
    db.query(sql, (err, data) => {
        if (err) return db.query("SELECT * FROM posts ORDER BY id DESC", (err2, data2) => res.json(data2 || []));
        res.json(data || []);
    });
});

app.post('/api/posts/add', verifyToken, upload.single('image'), (req, res) => {
    const { user_id, user_name, user_role, user_avatar, content } = req.body;
    db.query("INSERT INTO posts (user_id, user_name, user_role, user_avatar, content, post_image) VALUES (?,?,?,?,?,?)", [user_id, user_name, user_role, user_avatar, content, req.file?.path || null], () => res.json({ status: "Success" }));
});

app.post('/api/posts/react', verifyToken, (req, res) => {
    const { post_id, user_id, reaction_type } = req.body;
    db.query("SELECT name, profile_pic FROM users WHERE id=? LIMIT 1", [user_id], (err, u) => {
        if (err || !u || u.length === 0) return res.json({status:"Fail"});
        db.query("SELECT * FROM reactions WHERE post_id=? AND user_id=? LIMIT 1", [post_id, user_id], (err, data) => {
            if (data?.length > 0) {
                if (data[0].reaction_type === reaction_type) db.query("DELETE FROM reactions WHERE id=?", [data[0].id], () => res.json({ status: "Removed" }));
                else db.query("UPDATE reactions SET reaction_type=? WHERE id=?", [reaction_type, data[0].id], () => res.json({ status: "Updated" }));
            } else {
                db.query("INSERT INTO reactions (post_id, user_id, reaction_type) VALUES (?,?,?)", [post_id, user_id, reaction_type], () => {
                    db.query("SELECT user_id FROM posts WHERE id=?", [post_id], (err, p) => {
                        if (p?.length > 0 && p[0].user_id !== user_id) createNotification(p[0].user_id, u[0].name, u[0].profile_pic, `reacted ${reactionIcons[reaction_type]} to your post`, "react");
                    });
                    res.json({ status: "Added" });
                });
            }
        });
    });
});

app.get('/api/reactions', verifyToken, (req, res) => db.query("SELECT * FROM reactions", (err, data) => res.json(data || [])));

// ==========================================
// 💬 Comments APIs
// ==========================================
app.get('/api/comments/:postId', verifyToken, (req, res) => db.query("SELECT * FROM comments WHERE post_id=? ORDER BY id ASC", [req.params.postId], (err, data) => res.json(data || [])));
app.get('/api/comments/course/:courseId', verifyToken, (req, res) => db.query("SELECT * FROM comments WHERE course_id=? ORDER BY created_at ASC", [req.params.courseId], (err, data) => res.json(data || [])));
app.post('/api/comments/add', verifyToken, (req, res) => {
    const { post_id, course_id, user_id, user_name, user_avatar, comment_text } = req.body;
    const sql = course_id ? "INSERT INTO comments (course_id, user_id, user_name, user_avatar, comment_text) VALUES (?,?,?,?,?)" : "INSERT INTO comments (post_id, user_id, user_name, user_avatar, comment_text) VALUES (?,?,?,?,?)";
    db.query(sql, [course_id || post_id, user_id || req.user.id, user_name, user_avatar, comment_text], (err) => res.json({ status: err ? "Fail" : "Success" }));
});

// ==========================================
// 🎓 Activities & Courses
// ==========================================
app.get('/api/activities/all', verifyToken, (req, res) => db.query(`SELECT activities.*, (SELECT COUNT(*) FROM registrations WHERE activity_id = activities.id) as registered_count FROM activities ORDER BY id DESC`, (err, data) => res.json(data || [])));
app.post('/api/activities/add', verifyToken, upload.single('material'), (req, res) => {
    const { title, description, type, instructor, event_date } = req.body;
    db.query("INSERT INTO activities (title, description, type, instructor, event_date, file_path, created_by) VALUES (?,?,?,?,?,?,?)", [title, description, type, instructor, event_date, req.file?.path, req.user.id], () => res.json({status:"Success"}));
});

// ==========================================
// 🎥 Videos & Progress
// ==========================================
app.get('/api/videos/:courseId', verifyToken, (req, res) => db.query("SELECT * FROM course_videos WHERE course_id=? ORDER BY video_date ASC", [req.params.courseId], (err, data) => res.json(data || [])));
app.post('/api/videos/add', verifyToken, upload.single('video_file'), (req, res) => {
    const link = req.file ? req.file.path : req.body.video_link;
    db.query("INSERT INTO course_videos (course_id, video_title, video_link, video_date) VALUES (?,?,?,?)", [req.body.course_id, req.body.video_title, link, req.body.video_date], (err, result) => res.json({status:"Success", id: result?.insertId}));
});
app.get('/api/schedule/all', verifyToken, (req, res) => db.query(`SELECT v.id, v.course_id, v.video_title, v.video_date, COALESCE(a.title, 'General') as course_title FROM course_videos v LEFT JOIN activities a ON v.course_id = a.id WHERE v.video_date IS NOT NULL ORDER BY v.video_date ASC`, (err, data) => res.json(data || [])));

app.get('/api/progress/calculate/:courseId/:email', verifyToken, (req, res) => {
    db.query("SELECT COUNT(*) as total FROM course_videos WHERE course_id=?", [req.params.courseId], (err, t) => {
        if (err || !t || t[0].total === 0) return res.json({ percent: 0 });
        db.query("SELECT COUNT(*) as watched FROM video_progress vp JOIN course_videos cv ON vp.video_id = cv.id WHERE vp.user_email=? AND cv.course_id=? AND vp.is_completed=1", [req.params.email, req.params.courseId], (err, w) => res.json({ percent: Math.round(((w[0]?.watched || 0) / t[0].total) * 100) }));
    });
});
app.post('/api/progress/mark-watched', verifyToken, (req, res) => db.query("INSERT IGNORE INTO video_progress (user_email, video_id, is_completed) VALUES (?, ?, 1)", [req.body.user_email, req.body.video_id], () => res.json({ status: "Success" })));

// ==========================================
// 🛠️ Quizzes & Materials & Tasks
// ==========================================
app.get('/api/quiz/:courseId', verifyToken, (req, res) => db.query("SELECT * FROM quiz_questions WHERE course_id = ?", [req.params.courseId], (err, data) => res.json(data || [])));
app.post('/api/quiz/attempt', verifyToken, (req, res) => db.query("INSERT INTO quiz_attempts (user_email, course_id, score) VALUES (?,?,?)", [req.body.user_email, req.body.course_id, req.body.score], () => res.json({status:"Success"})));
app.get('/api/materials/:courseId', verifyToken, (req, res) => db.query("SELECT * FROM course_materials WHERE course_id = ?", [req.params.courseId], (err, data) => res.json(data || [])));
app.post('/api/tasks/submit', verifyToken, (req, res) => db.query("INSERT INTO task_submissions (user_id, course_id, video_id, task_link) VALUES (?,?,?,?)", [req.user.id, req.body.course_id, req.body.video_id, req.body.task_link], (err) => res.json({status: err ? "Fail" : "Success"})));

// ==========================================
// 📊 Stats & Team & Admin (Restored)
// ==========================================
app.get('/api/stats', verifyAdmin, (req, res) => {
    const sql = `SELECT (SELECT COUNT(id) FROM activities) as total_activities, (SELECT COUNT(id) FROM registrations) as total_students, (SELECT COUNT(id) FROM activities WHERE type='workshop') as total_workshops`;
    db.query(sql, (err, data) => {
        if (err) return res.json({ total_activities: 0, total_students: 0, total_workshops: 0 });
        res.json(data[0] || { total_activities: 0, total_students: 0, total_workshops: 0 });
    });
});

app.get('/api/leaderboard', verifyToken, (req, res) => db.query(`SELECT id, name, profile_pic, role, job_title, (SELECT COUNT(*) FROM video_progress WHERE user_email = users.email AND is_completed=1) * 10 AS points FROM users WHERE role NOT IN ('admin', 'company', 'instructor') ORDER BY points DESC LIMIT 10`, (err, data) => res.json(data || [])));
app.get('/api/users', verifyAdmin, (req, res) => db.query("SELECT id, name, email, phone, role, profile_pic FROM users ORDER BY id DESC", (err, data) => res.json(data || [])));
app.get('/api/team', verifyToken, (req, res) => db.query("SELECT name, role, profile_pic, email FROM users WHERE role IN ('admin', 'instructor') ORDER BY name ASC", (err, data) => res.json(data || [])));
app.get('/api/notifications/:userId', verifyToken, (req, res) => db.query("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30", [req.params.userId], (err, data) => res.json(data || [])));

// ==========================================
// 🤝 Sponsors & Partners
// ==========================================
app.get('/api/public/sponsors', (req, res) => db.query("SELECT * FROM sponsors_partners", (err, data) => res.json(data || [])));
app.post('/api/admin/sponsors/add', verifyAdmin, upload.single('logo'), (req, res) => db.query("INSERT INTO sponsors_partners (name, type, logo_url, website_link) VALUES (?,?,?,?)", [req.body.name, req.body.type, req.file?.path || req.body.logo_url, req.body.website_link], () => res.json({status:"Success"})));

// ==========================================
// 🚀 Start
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Stable System Online on port ${PORT}...`));

module.exports = app;
