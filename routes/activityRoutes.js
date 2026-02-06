const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activityController');
const upload = require('../middleware/multerConfig'); // هنبرمجه الخطوة الجاية

// مسار إضافة نشاط (مع دعم رفع ملف واحد)
router.post('/add', upload.single('material'), activityController.addActivity);

// مسار عرض كل الأنشطة
router.get('/all', activityController.getAllActivities);

module.exports = router;