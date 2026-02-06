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
// ✅ المكتبات السحابية
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();

// ==========================================
// 🛡️ Security Config
// ==========================================
app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));

app.use(cors({
    origin: "https://learning-hub-web-six.vercel.app",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

app.use(express.json());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
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
        allowed_formats: ['jpg', 'png', 'jpeg', 'pdf'],
    },
});
const upload = multer({ storage });

// ==========================================
// 🗄️ Database Connection
// ==========================================
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'ieee_et5_db'
});

db.connect((err) => {
    if (err) console.error('❌ Database Connection Failed:', err.message);
    else console.log('✅ DB Connected & Cloudinary Ready 🚀');
});

// ==========================================
// 🛡️ Middlewares
// ==========================================
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(403).json({ status: "Fail", message: "No Token" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ status: "Fail", message: "Invalid Token" });
        req.user = user;
        next();
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
// 🔐 Auth & User Update
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

app.put('/api/user/update', verifyToken, upload.single('avatar'), (req, res) => {
    const { id, name, email, phone, oldPassword, newPassword } = req.body;
    if (req.user.id != id && req.user.role !== 'admin') return res.status(403).json({ status: "Fail" });

    db.query("SELECT * FROM users WHERE id = ?", [id], async (err, users) => {
        if (err || users.length === 0) return res.json({ status: "Fail" });
        let finalPassword = users[0].password;
        if (newPassword && newPassword.trim() !== "") {
            const isMatch = await bcrypt.compare(oldPassword, users[0].password);
            if (!isMatch) return res.json({ status: "Fail", message: "Wrong old password" });
            finalPassword = await bcrypt.hash(newPassword, 10);
        }
        let sql = "UPDATE users SET name=?, email=?, phone=?, password=?";
        let params = [name, email, phone, finalPassword];

        if (req.file) {
            sql += ", profile_pic=?";
            params.push(req.file.path); // Cloudinary URL
        }

        sql += " WHERE id=?"; params.push(id);
        db.query(sql, params, () => res.json({ status: "Success", newProfilePic: req.file?.path }));
    });
});

// ==========================================
// 🌍 Community APIs
// ==========================================

app.get('/api/posts', verifyToken, (req, res) => {
    const sql = `SELECT posts.*, COUNT(DISTINCT comments.id) AS comment_count, COUNT(DISTINCT reactions.id) AS reaction_count 
                 FROM posts LEFT JOIN comments ON posts.id = comments.post_id 
                 LEFT JOIN reactions ON posts.id = reactions.post_id GROUP BY posts.id ORDER BY posts.created_at DESC`;
    db.query(sql, (err, data) => {
        if (err) return res.status(500).json({ status: "Error" });
        res.json(data);
    });
});

app.post('/api/posts/add', verifyToken, upload.single('image'), (req, res) => {
    const { user_id, user_name, user_role, user_avatar, content } = req.body;
    const img = req.file ? req.file.path : null;
    db.query("INSERT INTO posts (user_id, user_name, user_role, user_avatar, content, post_image) VALUES (?,?,?,?,?,?)",
        [user_id, user_name, user_role, user_avatar, content, img], () => res.json({ status: "Success" }));
});

// ... (باقي دوال الـ Post React و الـ Comments كما هي في كودك) ...
app.post('/api/posts/react', verifyToken, (req, res) => {
    const { post_id, user_id, reaction_type } = req.body;
    db.query("SELECT name, profile_pic FROM users WHERE id=?", [user_id], (err, u) => {
        if (!u || u.length === 0) return;
        const senderName = u[0].name; const senderAvatar = u[0].profile_pic;
        db.query("SELECT * FROM reactions WHERE post_id=? AND user_id=?", [post_id, user_id], (err, data) => {
            if (data.length > 0) {
                if (data[0].reaction_type === reaction_type) db.query("DELETE FROM reactions WHERE id=?", [data[0].id], () => res.json({ status: "Removed" }));
                else db.query("UPDATE reactions SET reaction_type=? WHERE id=?", [reaction_type, data[0].id], () => res.json({ status: "Updated" }));
            } else {
                db.query("INSERT INTO reactions (post_id, user_id, reaction_type) VALUES (?,?,?)", [post_id, user_id, reaction_type], () => {
                    db.query("SELECT user_id FROM posts WHERE id=?", [post_id], (err, p) => {
                        if (p && p.length > 0 && p[0].user_id !== user_id) createNotification(p[0].user_id, senderName, senderAvatar, `reacted ${reactionIcons[reaction_type]} to your post`, "react");
                    });
                    res.json({ status: "Added" });
                });
            }
        });
    });
});

app.get('/api/reactions', verifyToken, (req, res) => {
    db.query("SELECT post_id, user_id, reaction_type FROM reactions", (err, data) => {
        if (err) return res.status(500).json({ status: "Error" });
        res.json(data);
    });
});

app.get('/api/comments/:postId', verifyToken, (req, res) => {
    db.query("SELECT * FROM comments WHERE post_id=? ORDER BY created_at ASC", [req.params.postId], (err, data) => res.json(data));
});

app.post('/api/comments/add', verifyToken, (req, res) => {
    const { post_id, user_id, user_name, user_avatar, comment_text } = req.body;
    db.query("INSERT INTO comments (post_id, user_id, user_name, user_avatar, comment_text) VALUES (?,?,?,?,?)",
        [post_id, user_id, user_name, user_avatar, comment_text], () => {
            db.query("SELECT user_id FROM posts WHERE id=?", [post_id], (err, p) => {
                if (p && p.length > 0 && p[0].user_id !== user_id) createNotification(p[0].user_id, user_name, user_avatar, "commented on your post", "comment");
            });
            res.json({ status: "Success" });
        });
});

// ==========================================
// 🎓 Activities & Courses (المعدلة)
// ==========================================

app.get('/api/activities/all', verifyToken, (req, res) => {
    const sql = `SELECT activities.*, COUNT(registrations.id) as registered_count FROM activities 
                 LEFT JOIN registrations ON activities.id = registrations.activity_id GROUP BY activities.id ORDER BY event_date DESC`;
    db.query(sql, (err, data) => res.json(data));
});

// ✅ التعديل هنا: استخدام أسماء الحقول الصحيحة وتنسيق SQL سليم
app.post('/api/activities/add', verifyToken, upload.single('material'), (req, res) => {
    if (req.user.role === 'student') return res.status(403).json({ message: "Unauthorized" });

    const filePath = req.file ? req.file.path : null;
    const { title, description, type, instructor, event_date, user_id } = req.body;
    
    // تأكدنا من إن created_by بياخد ID الشخص اللي باعت الطلب لو الـ body فاضي
    const creatorId = user_id || req.user.id;

    const sql = "INSERT INTO activities (title, description, type, instructor, event_date, file_path, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)";
    const values = [title, description, type, instructor, event_date, filePath, creatorId];

    db.query(sql, values, (err) => {
        if (err) {
            console.error("DB Error:", err);
            return res.status(500).json({ status: "Fail", message: "Database Error" });
        }
        res.json({ status: "Success" });
    });
});

app.delete('/api/activities/delete/:id', verifyToken, (req, res) => {
    db.query("DELETE FROM activities WHERE id = ?", [req.params.id], (err) => res.json({ status: "Deleted" }));
});

// ==========================================
// 🛠️ Quizzes & Materials
// ==========================================

app.post('/api/materials/add', verifyToken, upload.single('file'), (req, res) => {
    const filePath = req.file ? req.file.path : null;
    db.query("INSERT INTO course_materials (course_id, title, file_path) VALUES (?, ?, ?)", [req.body.course_id, req.body.title, filePath], () => res.json({ status: "Success" }));
});

// ... (باقي كود الـ Quizzes والـ Stats والـ Leaderboard كما هو في كودك) ...
app.get('/api/stats', verifyAdmin, (req, res) => {
    const sql = `SELECT (SELECT COUNT(*) FROM activities) as total_activities, (SELECT COUNT(*) FROM registrations) as total_students, (SELECT COUNT(*) FROM activities WHERE type='workshop') as total_workshops`;
    db.query(sql, (err, data) => res.json(data[0]));
});

app.get('/api/leaderboard', verifyToken, (req, res) => {
    const sql = `SELECT u.id, u.name, u.profile_pic, u.role,
        (SELECT COUNT(*) FROM video_progress vp WHERE vp.user_email = u.email AND vp.is_completed = 1) * 10 AS video_points,
        COALESCE((SELECT SUM(score) FROM quiz_attempts qa WHERE qa.user_email = u.email), 0) AS quiz_points,
        (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) * 5 AS post_points,
        (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) * 2 AS comment_points
        FROM users u WHERE u.role != 'admin' ORDER BY (video_points + quiz_points + post_points + comment_points) DESC LIMIT 10`;
    db.query(sql, (err, data) => res.json(data));
});

// ==========================================
// 🚀 Deployment & Start
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server ready on port ${PORT}...`));

module.exports = app;
