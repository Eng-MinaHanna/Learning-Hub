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
    origin: ["https://learning-hub-web-six.vercel.app", "http://localhost:3000"], 
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
        resource_type: 'auto',
        allowed_formats: ['jpg', 'png', 'jpeg', 'pdf', 'doc', 'docx', 'ppt', 'pptx', 'zip', 'rar', 'mp4'],
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
    else console.log('✅ Server Secured & DB Connected 🚀');
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
// 🔐 Auth APIs
// ==========================================

// تسجيل عادي
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

// إضافة مستخدم بواسطة الأدمن
app.post('/api/admin/add-user', verifyAdmin, async (req, res) => {
    const { name, email, phone, password, role } = req.body;
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = "INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)";
        db.query(sql, [name, email, phone, hashedPassword, role], (err) => {
            if (err) return res.json({ status: "Fail", message: "Email already exists or DB Error" });
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

// ✅✅✅ FIX: Safe Update API (Prevents 500 Error) ✅✅✅
app.put('/api/user/update', verifyToken, upload.single('avatar'), (req, res) => {
    const { id, name, email, phone, oldPassword, newPassword, password, linkedin, cv_link, job_title, role } = req.body;
    
    const passToUpdate = newPassword || password;

    // حماية: التأكد أن المستخدم يعدل بياناته هو فقط أو أنه أدمن
    if (req.user.id != id && req.user.role !== 'admin') {
        return res.status(403).json({ status: "Fail", message: "Unauthorized" });
    }

    // 1. البحث عن المستخدم أولاً
    db.query("SELECT * FROM users WHERE id = ?", [id], async (err, users) => {
        if (err) return res.status(500).json({ status: "Error", message: "Database Error" });
        if (users.length === 0) return res.json({ status: "Fail", message: "User not found" });

        try {
            let finalPassword = users[0].password;
            
            // 2. معالجة تغيير الباسورد
            if (passToUpdate && passToUpdate.trim() !== "") {
                if (req.user.role !== 'admin') {
                    if (!oldPassword) return res.json({ status: "Fail", message: "Old password required" });
                    const isMatch = await bcrypt.compare(oldPassword, users[0].password);
                    if (!isMatch) return res.json({ status: "Fail", message: "Wrong old password" });
                }
                finalPassword = await bcrypt.hash(passToUpdate, 10);
            }

            // 3. تحديد الـ Role (الأدمن بس اللي يقدر يغيره)
            let finalRole = users[0].role;
            if (req.user.role === 'admin' && role) {
                finalRole = role;
            }

            // 4. تجهيز القيم
            const safeLinkedin = linkedin || null;
            const safeCv = cv_link || null;
            const safeJob = job_title || null;

            let sql = "UPDATE users SET name=?, email=?, phone=?, password=?, role=?, linkedin=?, cv_link=?, job_title=?";
            let params = [name, email, phone, finalPassword, finalRole, safeLinkedin, safeCv, safeJob];

            if (req.file) {
                sql += ", profile_pic=?";
                params.push(req.file.path);
            }

            sql += " WHERE id=?";
            params.push(id);

            // 5. تنفيذ التعديل
            db.query(sql, params, (updateErr, result) => {
                if (updateErr) {
                    console.error("SQL Error:", updateErr);
                    if (updateErr.code === 'ER_BAD_FIELD_ERROR') {
                        return res.json({ status: "Fail", message: "Database column missing. Contact Admin." });
                    }
                    return res.json({ status: "Fail", message: "Update Failed" });
                }
                
                if (result.affectedRows === 0) {
                    return res.json({ status: "Fail", message: "No changes made" });
                }

                res.json({ status: "Success", newProfilePic: req.file?.path });
            });

        } catch (serverError) {
            console.error("Server Logic Error:", serverError);
            res.status(500).json({ status: "Error", message: "Internal Server Error" });
        }
    });
});

app.post('/api/check-subscription', verifyToken, (req, res) => {
    const { course_id, student_name } = req.body;
    db.query("SELECT * FROM registrations WHERE activity_id = ? AND student_name = ?", [course_id, student_name], (err, data) => {
        if (err) return res.status(500).json({ status: "Error" });
        res.json({ isSubscribed: data.length > 0 });
    });
});

app.post('/api/subscribe', verifyToken, (req, res) => {
    const { course_id, student_name, student_email } = req.body;
    db.query("INSERT INTO registrations (activity_id, student_name, student_email) VALUES (?, ?, ?)", 
        [course_id, student_name, student_email], 
        (err) => {
            if(err) return res.status(500).json({message: "Error"});
            res.json({ status: "Success" });
        }
    );
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

app.delete('/api/posts/delete/:id', verifyToken, (req, res) => {
    const postId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    db.query("SELECT user_id FROM posts WHERE id = ?", [postId], (err, data) => {
        if (err) return res.status(500).json({ status: "Error", message: "DB Error" });
        if (data.length === 0) return res.status(404).json({ status: "Fail", message: "Post not found" });

        if (data[0].user_id === userId || userRole === 'admin') {
            db.query("DELETE FROM posts WHERE id = ?", [postId], (err) => {
                if (err) return res.status(500).json({ status: "Error", message: "Deletion failed" });
                res.json({ status: "Deleted" });
            });
        } else {
            res.status(403).json({ status: "Fail", message: "Not authorized" });
        }
    });
});

// ---------------------------
// 💬 Comments APIs
// ---------------------------

app.get('/api/comments/:postId', verifyToken, (req, res) => {
    db.query("SELECT * FROM comments WHERE post_id=? ORDER BY created_at ASC", [req.params.postId], (err, data) => res.json(data));
});

app.get('/api/comments/course/:courseId', verifyToken, (req, res) => {
    db.query("SELECT * FROM comments WHERE course_id=? ORDER BY created_at ASC", [req.params.courseId], (err, data) => res.json(data));
});

app.post('/api/comments/add', verifyToken, (req, res) => {
    const { post_id, course_id, user_id, user_name, user_avatar, comment_text } = req.body;
    const uid = user_id || req.user.id;

    if (course_id) {
        const sql = "INSERT INTO comments (course_id, user_id, user_name, user_avatar, comment_text) VALUES (?,?,?,?,?)";
        db.query(sql, [course_id, uid, user_name, user_avatar, comment_text], (err) => {
            if (err) return res.status(500).json({ status: "Fail", message: err.message });
            res.json({ status: "Success" });
        });
    } else {
        const sql = "INSERT INTO comments (post_id, user_id, user_name, user_avatar, comment_text) VALUES (?,?,?,?,?)";
        db.query(sql, [post_id, uid, user_name, user_avatar, comment_text], (err) => {
            if (err) return res.status(500).json({ status: "Fail", message: err.message });
            res.json({ status: "Success" });
        });
    }
});

app.delete('/api/comments/delete/:id', verifyToken, (req, res) => {
    db.query("DELETE FROM comments WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ status: "Fail" });
        res.json({ status: "Deleted" });
    });
});

app.get('/api/users', verifyAdmin, (req, res) => {
    db.query("SELECT id, name, email, phone, role, profile_pic, created_at FROM users ORDER BY created_at DESC", (err, data) => {
        if (err) return res.status(500).json({ status: "Error", message: "Database Error" });
        res.json(data || []); 
    });
});

// ==========================================
// 🎓 Activities & Courses
// ==========================================

app.get('/api/activities/all', verifyToken, (req, res) => {
    const sql = `SELECT activities.*, COUNT(registrations.id) as registered_count FROM activities 
                 LEFT JOIN registrations ON activities.id = registrations.activity_id GROUP BY activities.id ORDER BY event_date DESC`;
    db.query(sql, (err, data) => res.json(data));
});

app.post('/api/activities/add', verifyToken, upload.single('material'), (req, res) => {
    if (req.user.role === 'student') return res.status(403).json({ message: "Unauthorized" });
    const filePath = req.file ? req.file.path : null;
    const { title, description, type, instructor, event_date } = req.body;
    const createdBy = req.user.id;
    const sql = "INSERT INTO activities (title, description, type, instructor, event_date, file_path, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)";
    const params = [title, description, type, instructor, event_date, filePath, createdBy];
    db.query(sql, params, (err) => {
        if (err) return res.status(500).json({ status: "Fail", message: "Database Error" });
        res.json({ status: "Success" });
    });
});

app.put('/api/activities/update/:id', verifyToken, upload.single('material'), (req, res) => {
    if (req.user.role === 'student') return res.status(403).json({ message: "Unauthorized" });
    
    const { title, description, instructor, event_date } = req.body;
    const activityId = req.params.id;

    let sql = "UPDATE activities SET title=?, description=?, instructor=?, event_date=?";
    let params = [title, description, instructor, event_date];

    if (req.file) {
        sql += ", file_path=?";
        params.push(req.file.path); 
    }

    sql += " WHERE id=?";
    params.push(activityId);

    db.query(sql, params, (err) => {
        if (err) return res.status(500).json({ status: "Fail", message: err.message });
        res.json({ status: "Updated", newImagePath: req.file ? req.file.path : null });
    });
});

app.delete('/api/activities/delete/:id', verifyToken, (req, res) => {
    db.query("DELETE FROM activities WHERE id = ?", [req.params.id], (err) => res.json({ status: "Deleted" }));
});

// --- Videos & Progress ---
app.get('/api/videos/:courseId', verifyToken, (req, res) => {
    db.query("SELECT * FROM course_videos WHERE course_id=? ORDER BY video_date ASC", [req.params.courseId], (err, data) => res.json(data));
});

app.post('/api/videos/add', verifyToken, upload.single('video_file'), (req, res) => {
    const videoLink = req.file ? req.file.path : req.body.video_link;
    const sql = "INSERT INTO course_videos (course_id, video_title, video_link, video_date) VALUES (?, ?, ?, ?)";
    db.query(sql, [req.body.course_id, req.body.video_title, videoLink, req.body.video_date], (err, result) => res.json({ status: "Success", id: result.insertId }));
});

app.put('/api/videos/update/:id', verifyToken, upload.single('video_file'), (req, res) => {
    const videoLink = req.file ? req.file.path : req.body.video_link;
    const sql = "UPDATE course_videos SET video_title=?, video_link=?, video_date=? WHERE id=?";
    db.query(sql, [req.body.video_title, videoLink, req.body.video_date, req.params.id], (err) => {
        if (err) return res.status(500).json({ status: "Fail" });
        res.json({ status: "Updated" });
    });
});

app.delete('/api/videos/delete/:id', verifyToken, (req, res) => {
    db.query("DELETE FROM course_videos WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ status: "Fail" });
        res.json({ status: "Deleted" });
    });
});

app.get('/api/schedule/all', verifyToken, (req, res) => {
    const sql = `SELECT v.id, v.course_id, v.video_title, v.video_date, COALESCE(a.title, 'General') as course_title 
                 FROM course_videos v LEFT JOIN activities a ON v.course_id = a.id 
                 WHERE v.video_date IS NOT NULL ORDER BY v.video_date ASC`;
    db.query(sql, (err, data) => res.json(data));
});

app.get('/api/progress/calculate/:courseId/:email', verifyToken, (req, res) => {
    const { courseId, email } = req.params;
    db.query("SELECT COUNT(*) as total FROM course_videos WHERE course_id=?", [courseId], (err, t) => {
        if (!t || t[0].total === 0) return res.json({ percent: 0 });
        db.query("SELECT COUNT(*) as watched FROM video_progress vp JOIN course_videos cv ON vp.video_id = cv.id WHERE vp.user_email=? AND cv.course_id=? AND vp.is_completed=1",
            [email, courseId], (err, w) => res.json({ percent: Math.round((w[0].watched / t[0].total) * 100) }));
    });
});

app.post('/api/progress/mark-watched', verifyToken, (req, res) => {
    db.query("INSERT IGNORE INTO video_progress (user_email, video_id, is_completed) VALUES (?, ?, 1)", [req.body.user_email, req.body.video_id], () => res.json({ status: "Success" }));
});

app.get('/api/progress/status/:courseId/:videoId/:email', verifyToken, (req, res) => {
    const { courseId, videoId, email } = req.params;
    db.query("SELECT * FROM video_progress WHERE user_email = ? AND video_id = ?", [email, videoId], (err, videoData) => {
        db.query("SELECT COUNT(*) as count, MAX(score) as best_score FROM quiz_attempts WHERE user_email = ? AND course_id = ?", [email, courseId], (err, attemptData) => {
            res.json({ isWatched: (videoData && videoData.length > 0), attempts: attemptData[0]?.count || 0, bestScore: attemptData[0]?.best_score || 0 });
        });
    });
});

// ==========================================
// 🛠️ Quizzes & Materials
// ==========================================

app.get('/api/quiz/:courseId', verifyToken, (req, res) => {
    db.query("SELECT * FROM quiz_questions WHERE course_id = ?", [req.params.courseId], (err, data) => res.json(data));
});

app.post('/api/quiz/add', verifyToken, (req, res) => {
    const sql = "INSERT INTO quiz_questions (course_id, question_text, option_a, option_b, option_c, option_d, correct_answer) VALUES (?, ?, ?, ?, ?, ?, ?)";
    db.query(sql, [req.body.course_id, req.body.question_text, req.body.option_a, req.body.option_b, req.body.option_c, req.body.option_d, req.body.correct_answer], () => res.json({ status: "Success" }));
});

app.delete('/api/quiz/delete/:id', verifyToken, (req, res) => {
    db.query("DELETE FROM quiz_questions WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ status: "Fail" });
        res.json({ status: "Deleted" });
    });
});

app.post('/api/quiz/attempt', verifyToken, (req, res) => {
    const { user_email, course_id, score } = req.body;
    const sql = "INSERT INTO quiz_attempts (user_email, course_id, score) VALUES (?, ?, ?)";
    db.query(sql, [user_email, course_id, score], () => res.json({ status: "Success" }));
});

app.get('/api/materials/:courseId', verifyToken, (req, res) => {
    db.query("SELECT * FROM course_materials WHERE course_id = ?", [req.params.courseId], (err, data) => res.json(data));
});

app.post('/api/materials/add', verifyToken, (req, res) => {
    const { course_id, title, link } = req.body; 

    if (!course_id || !title || !link) {
        return res.status(400).json({ status: "Fail", message: "Missing fields" });
    }

    db.query("INSERT INTO course_materials (course_id, title, file_path) VALUES (?, ?, ?)", 
        [course_id, title, link], 
        (err) => {
            if (err) {
                console.error("DB Error:", err);
                return res.status(500).json({ status: "Fail", message: "Database Error" });
            }
            res.json({ status: "Success" });
        }
    );
});

app.delete('/api/materials/delete/:id', verifyToken, (req, res) => {
    db.query("DELETE FROM course_materials WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ status: "Fail" });
        res.json({ status: "Deleted" });
    });
});

// ==========================================
// 🛠️ Admin & Leaderboard
// ==========================================

app.get('/api/stats', verifyAdmin, (req, res) => {
    const sql = `SELECT (SELECT COUNT(*) FROM activities) as total_activities, (SELECT COUNT(*) FROM registrations) as total_students, (SELECT COUNT(*) FROM activities WHERE type='workshop') as total_workshops`;
    db.query(sql, (err, data) => res.json(data[0]));
});

app.get('/api/leaderboard', verifyToken, (req, res) => {
    const sql = `SELECT u.id, u.name, u.profile_pic, u.role, u.linkedin, u.cv_link, u.job_title,
        (SELECT COUNT(*) FROM video_progress vp WHERE vp.user_email = u.email AND vp.is_completed = 1) * 10 AS video_points,
        COALESCE((SELECT SUM(score) FROM quiz_attempts qa WHERE qa.user_email = u.email), 0) AS quiz_points,
        (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) * 5 AS post_points,
        (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) * 2 AS comment_points
        FROM users u 
        WHERE u.role NOT IN ('admin', 'company', 'instructor') 
        ORDER BY (video_points + quiz_points + post_points + comment_points) DESC 
        LIMIT 10`;

    db.query(sql, (err, data) => {
        if (err) {
            console.error(err); 
            return res.status(500).json({ status: "Error", message: "DB Error" });
        }
        res.json(data);
    });
});

app.get('/api/team', verifyToken, (req, res) => {
    const sql = `SELECT name, role, profile_pic, email FROM users 
                 WHERE role IN ('admin', 'instructor') 
                 ORDER BY FIELD(role, 'admin', 'instructor'), name ASC`;
    db.query(sql, (err, data) => {
        if (err) return res.status(500).json({ status: "Error" });
        res.json(data);
    });
});

// ==========================================
// 📝 Tasks & Submissions APIs
// ==========================================

app.post('/api/tasks/submit', verifyToken, (req, res) => {
    const { course_id, video_id, task_link } = req.body;
    const user_id = req.user.id;

    db.query("INSERT INTO task_submissions (user_id, course_id, video_id, task_link) VALUES (?, ?, ?, ?)", 
        [user_id, course_id, video_id, task_link], 
        (err) => {
            if (err) return res.status(500).json({ status: "Fail", message: "DB Error" });
            res.json({ status: "Success" });
        }
    );
});

app.get('/api/tasks/my/:videoId', verifyToken, (req, res) => {
    const user_id = req.user.id;
    const video_id = req.params.videoId;
    db.query("SELECT * FROM task_submissions WHERE user_id = ? AND video_id = ? ORDER BY submitted_at DESC LIMIT 1", 
        [user_id, video_id], 
        (err, data) => res.json(data)
    );
});

app.get('/api/tasks/all/:videoId', verifyToken, (req, res) => {
    const video_id = req.params.videoId;
    const user_id = req.user.id;
    const user_role = req.user.role;

    const checkCourseSql = "SELECT a.created_by FROM activities a JOIN course_videos v ON a.id = v.course_id WHERE v.id = ?";
    
    db.query(checkCourseSql, [video_id], (err, courseData) => {
        if (err || courseData.length === 0) return res.status(404).json({ message: "Course not found" });

        const instructorId = courseData[0].created_by;

        if (user_role === 'admin' || user_id === instructorId) {
            const sql = `SELECT t.*, u.name as student_name, u.profile_pic 
                         FROM task_submissions t 
                         JOIN users u ON t.user_id = u.id 
                         WHERE t.video_id = ? ORDER BY t.submitted_at DESC`;
            db.query(sql, [video_id], (err, data) => res.json(data));
        } else {
            res.status(403).json({ message: "Unauthorized: You are not the instructor" });
        }
    });
});

// ==========================================
// 🤝 Partners & Sponsors APIs
// ==========================================

// 1. إضافة راعي أو شريك جديد (للأدمن فقط)
app.post('/api/admin/sponsors/add', verifyAdmin, upload.single('logo'), (req, res) => {
    const { name, type, website_link } = req.body;
    
    // لو الأدمن رفع ملف، نستخدمه. لو مرفعش وحط لينك مباشر، نستخدم اللينك (اختياري)
    const logoUrl = req.file ? req.file.path : req.body.logo_url;

    if (!name || !type || !logoUrl) {
        return res.status(400).json({ status: "Fail", message: "Name, Type, and Logo are required" });
    }

    const sql = "INSERT INTO sponsors_partners (name, type, logo_url, website_link) VALUES (?, ?, ?, ?)";
    db.query(sql, [name, type, logoUrl, website_link], (err) => {
        if (err) return res.status(500).json({ status: "Error", message: err.message });
        res.json({ status: "Success" });
    });
});

// 2. حذف (للأدمن فقط)
app.delete('/api/admin/sponsors/delete/:id', verifyAdmin, (req, res) => {
    db.query("DELETE FROM sponsors_partners WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ status: "Error" });
        res.json({ status: "Deleted" });
    });
});

// 3. جلب الكل (متاح للجميع - للصفحة الرئيسية ولوحة التحكم)
app.get('/api/public/sponsors', (req, res) => {
    db.query("SELECT * FROM sponsors_partners ORDER BY created_at DESC", (err, data) => {
        if (err) return res.status(500).json({ status: "Error" });
        res.json(data);
    });
});

// ==========================================
// 🚀 Start
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}...`));

module.exports = app;
