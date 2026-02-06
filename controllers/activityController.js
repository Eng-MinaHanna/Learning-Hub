const db = require('../config/db');

// إضافة نشاط جديد (كورس، سيشن، وركشوب)
exports.addActivity = async (req, res) => {
    try {
        const { title, description, type, instructor, committee_id, video_link, event_date } = req.body;

        // لو فيه ملف ارفع مساره، لو مفيش يبقى null
        const file_path = req.file ? req.file.path : null;

        const sql = `INSERT INTO activities (title, description, type, instructor, committee_id, file_path, video_link, event_date) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

        const [result] = await db.execute(sql, [title, description, type, instructor, committee_id, file_path, video_link, event_date]);

        res.status(201).json({ message: "تمت الإضافة بنجاح! ✅", id: result.insertId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// جلب كل الأنشطة
exports.getAllActivities = async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM activities ORDER BY event_date DESC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};