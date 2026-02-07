import React, { useState, useEffect } from 'react';
import API from './api'; 
import ReactPlayer from 'react-player';
import CertificateModal from './CertificateModal';

const CourseDetailsModal = ({ course, onClose, currentUser }) => {

    // ==========================================
    // 1. States & Variables
    // ==========================================
    const [editData, setEditData] = useState({
        title: course?.title || '',
        description: course?.description || ''
    });

    const [isSubscribed, setIsSubscribed] = useState(false);
    const [videos, setVideos] = useState([]);
    const [comments, setComments] = useState([]);
    const [questions, setQuestions] = useState([]);
    const [userAnswers, setUserAnswers] = useState({});
    const [quizScore, setQuizScore] = useState(null);
    const [newQuestion, setNewQuestion] = useState({ text: '', a: '', b: '', c: '', d: '', correct: 'a' });
    const [materials, setMaterials] = useState([]);
    const [newMaterial, setNewMaterial] = useState({ title: '', file: null });

    const [isVideoWatched, setIsVideoWatched] = useState(false);
    const [attemptsCount, setAttemptsCount] = useState(0);
    const [bestScore, setBestScore] = useState(null);
    const [showCertificate, setShowCertificate] = useState(false);
    const [progressPercent, setProgressPercent] = useState(0);

    const [activeVideo, setActiveVideo] = useState(null);
    const [activeTab, setActiveTab] = useState('lesson');
    const [isEditing, setIsEditing] = useState(false);

    const [editingVideoId, setEditingVideoId] = useState(null);
    const [newVideoLink, setNewVideoLink] = useState({ title: '', link: '', date: '', file: null });
    const [newComment, setNewComment] = useState("");

    const [realVideoEnded, setRealVideoEnded] = useState(false);

    // ✅ حساس الموبايل (عشان التصميم يظبط)
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const isOwner = currentUser && course && course.created_by === currentUser.id;
    const isAdmin = currentUser && currentUser.role === 'admin';
    const isUnlocked = isSubscribed || isAdmin || isOwner;
    const canEdit = isAdmin || isOwner;

    // ==========================================
    // 2. Helpers
    // ==========================================
    const isDriveLink = (url) => url && url.includes("drive.google.com");
    const isYouTubeLink = (url) => url && (url.includes("youtube.com") || url.includes("youtu.be"));

    const getDriveEmbedUrl = (url) => {
        if (!url) return "";
        let id = null;
        const pathMatch = url.match(/\/d\/(.*?)(?:\/|$)/);
        if (pathMatch) id = pathMatch[1];
        else {
            const queryMatch = url.match(/[?&]id=([^&]+)/);
            if (queryMatch) id = queryMatch[1];
        }
        return id ? `https://drive.google.com/file/d/${id}/preview` : url;
    };

    const getLocalVideoUrl = (link) => {
        if (!link) return "";
        return link; 
    };

    const formatDateTime = (ds) => { 
        if (!ds) return 'Soon'; 
        const d = new Date(ds); 
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); 
    };

    // ==========================================
    // 3. Data Fetching
    // ==========================================
    useEffect(() => {
        if (currentUser && course) {
            checkSubscription();
            fetchVideos();
            fetchComments();
            fetchQuiz();
            fetchMaterials();
            fetchCourseProgress();
        }
    }, [course, currentUser]);

    useEffect(() => {
        if (currentUser && activeVideo) {
            fetchVideoStatus();
            setRealVideoEnded(false);
        }
    }, [activeVideo, currentUser]);

    const fetchVideoStatus = () => { 
        if(!activeVideo?.id) return;
        API.get(`/progress/status/${course.id}/${activeVideo.id}/${currentUser.email}`)
            .then(res => { 
                setIsVideoWatched(res.data.isWatched); 
                setAttemptsCount(res.data.attempts || 0); 
                setBestScore(res.data.bestScore || 0); 
            }).catch(err => console.log(err)); 
    };

    const fetchCourseProgress = () => { API.get(`/progress/calculate/${course.id}/${currentUser.email}`).then(res => setProgressPercent(res.data.percent)); };
    const checkSubscription = () => { API.post('/check-subscription', { course_id: course.id, student_name: currentUser.name }).then(res => setIsSubscribed(res.data.isSubscribed)); };
    
    const fetchVideos = () => { 
        API.get(`/videos/${course.id}`).then(res => { 
            const data = Array.isArray(res.data) ? res.data : [];
            setVideos(data); 
            const validVideos = data.filter(v => canEdit || !v.video_date || new Date(v.video_date) <= new Date()); 
            if (validVideos.length > 0 && !activeVideo) setActiveVideo(validVideos[0]); 
        }); 
    };

    const fetchComments = () => { API.get(`/comments/${course.id}`).then(res => setComments(res.data)); };
    const fetchQuiz = () => { API.get(`/quiz/${course.id}`).then(res => setQuestions(res.data)); };
    const fetchMaterials = () => { API.get(`/materials/${course.id}`).then(res => setMaterials(res.data)); };

    // ==========================================
    // 4. Handlers (Actions)
    // ==========================================
    const handleSubscribe = () => { API.post('/subscribe', { course_id: course.id, student_name: currentUser.name, student_email: currentUser.email }).then(() => { alert("تم الاشتراك! 🚀"); setIsSubscribed(true); }); };

    const handleVideoEnd = () => {
        setRealVideoEnded(true);
        handleMarkWatched(true);
    };

    const handleMarkWatched = (auto = false) => {
        if (!activeVideo) return;
        const isDrive = isDriveLink(activeVideo?.video_link);
        if (!auto && !realVideoEnded && !canEdit && !isDrive) {
            alert("⚠️ Please watch the full video to mark it as completed.");
            return;
        }
        API.post('/progress/mark-watched', {
            user_email: currentUser.email,
            video_id: activeVideo.id
        }).then(() => {
            setIsVideoWatched(true);
            if (!auto) alert("Marked as Completed ✅");
            fetchCourseProgress();
        });
    };

    // --- Quiz Handlers ---
    const handleSubmitQuiz = () => { 
        if (attemptsCount >= 2) return alert("No attempts left."); 
        let score = 0; 
        questions.forEach(q => { if (userAnswers[q.id] === q.correct_answer) score++; }); 
        setQuizScore(score); 
        API.post('/quiz/attempt', { user_email: currentUser.email, course_id: course.id, score: score })
           .then(() => { 
               setAttemptsCount(prev => prev + 1); 
               alert(`Score: ${score}/${questions.length}`); 
           }); 
    };
    
    const handleRetakeQuiz = () => { if (attemptsCount >= 2) return; setUserAnswers({}); setQuizScore(null); };
    const handleOptionSelect = (qId, opt) => { if (quizScore !== null || attemptsCount >= 2) return; setUserAnswers({ ...userAnswers, [qId]: opt }); };

    const handleAddQuestion = (e) => { 
        e.preventDefault(); 
        API.post('/quiz/add', { 
            course_id: course.id, 
            question_text: newQuestion.text, 
            option_a: newQuestion.a, 
            option_b: newQuestion.b, 
            option_c: newQuestion.c, 
            option_d: newQuestion.d, 
            correct_answer: newQuestion.correct 
        }).then(() => { 
            alert("Added"); 
            setNewQuestion({ text: '', a: '', b: '', c: '', d: '', correct: 'a' }); 
            fetchQuiz(); 
        }); 
    };

    // ✅ مسح السؤال
    const handleDeleteQuestion = (id) => { 
        if (window.confirm("Delete Question?")) {
            API.delete(`/quiz/delete/${id}`).then(() => fetchQuiz()); 
        }
    };

    // --- Comment Handlers ---
    const handleAddComment = (e) => { 
        e.preventDefault(); 
        if(!newComment.trim()) return; 
        API.post('/comments/add', { course_id: course.id, user_name: currentUser.name, comment_text: newComment })
           .then(() => { setNewComment(""); fetchComments(); }); 
    };

    // ✅ مسح الكومنت
    const handleDeleteComment = (id) => {
        if(window.confirm("Delete Comment?")) {
            API.delete(`/comments/delete/${id}`).then(() => fetchComments());
        }
    };

    // --- Materials Handlers ---
    const handleAddMaterial = (e) => { 
        e.preventDefault(); 
        if (!newMaterial.file || !newMaterial.title) return alert("Please fill all fields"); 
        
        const formData = new FormData(); 
        formData.append('course_id', course.id); 
        formData.append('title', newMaterial.title); 
        formData.append('file', newMaterial.file); 
        
        API.post('/materials/add', formData).then(() => { 
            alert("Material Uploaded! 📄"); 
            setNewMaterial({ title: '', file: null }); 
            fetchMaterials(); 
        }).catch(err => alert("Upload failed")); 
    };

    const handleDeleteMaterial = (id) => { 
        if (window.confirm("Delete File?")) {
            API.delete(`/materials/delete/${id}`).then(() => fetchMaterials()); 
        }
    };

    // --- Video/Course Editing ---
    const handleSaveChanges = async () => { 
        try { 
            await API.put(`/activities/update/${course.id}`, { 
                ...course, 
                title: editData.title, 
                description: editData.description, 
                event_date: course.event_date.split('T')[0] 
            }); 
            setIsEditing(false); 
        } catch (error) { alert("Error"); } 
    };

    const startEditingVideo = (vid) => { 
        setEditingVideoId(vid.id); 
        let formattedDate = ''; 
        if (vid.video_date) { 
            const d = new Date(vid.video_date); 
            d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); 
            formattedDate = d.toISOString().slice(0, 16); 
        } 
        setNewVideoLink({ title: vid.video_title, link: vid.video_link, date: formattedDate, file: null }); 
    };

    const handleSaveVideo = async (e) => { 
        e.preventDefault(); 
        if (!newVideoLink.date) { alert("⚠️ Date needed"); return; } 
        
        const formData = new FormData();
        formData.append('course_id', course.id);
        formData.append('video_title', newVideoLink.title);
        formData.append('video_date', newVideoLink.date);
        
        if (newVideoLink.file) formData.append('video_file', newVideoLink.file);
        else formData.append('video_link', newVideoLink.link);

        try {
            if (editingVideoId) await API.put(`/videos/update/${editingVideoId}`, formData); 
            else await API.post('/videos/add', formData); 
            
            setNewVideoLink({ title: '', link: '', date: '', file: null }); 
            setEditingVideoId(null); 
            fetchVideos(); 
            alert("Video Saved! 🎬");
        } catch(err) { alert("Error saving video"); }
    };

    const handleDeleteVideo = async (videoId) => { 
        if (window.confirm("Delete Video?")) { 
            await API.delete(`/videos/delete/${videoId}`); 
            fetchVideos(); 
        } 
    };

    const visibleVideos = Array.isArray(videos) ? videos.filter(vid => canEdit || !vid.video_date || new Date(vid.video_date) <= new Date()) : [];

    // ==========================================
    // 5. Render
    // ==========================================
    return (
        <div style={styles.fullScreenOverlay}>
            <div style={styles.headerStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <button onClick={onClose} style={styles.backBtnStyle}>🔙 Exit</button>
                    {isEditing ? 
                        <input value={editData.title} onChange={e => setEditData({ ...editData, title: e.target.value })} style={styles.headerInput} /> 
                        : 
                        <h2 style={{ margin: 0, color: 'white', fontSize: isMobile ? '1rem' : '1.2rem' }}>{editData.title}</h2>
                    }
                </div>
                {canEdit && <button onClick={() => isEditing ? handleSaveChanges() : setIsEditing(true)} style={styles.editBtn}>{isEditing ? '💾 Save' : '⚙️ Edit'}</button>}
            </div>

            {/* ✅ Layout: يقلب عمودي في الموبايل */}
            <div style={{ ...styles.mainLayout, flexDirection: isMobile ? 'column' : 'row' }}>
                
                {/* Content Area (Video & Tabs) */}
                <div style={{ ...styles.contentAreaStyle, order: isMobile ? -1 : 0 }}>
                    {!isUnlocked ? (
                        <div style={styles.lockScreenStyle}>
                            <h1>🔒 Locked</h1>
                            <button onClick={handleSubscribe} style={styles.bigSubscribeBtn}>Subscribe Now</button>
                        </div>
                    ) : (
                        <>
                            <div style={{ ...styles.tabsWrapper, padding: isMobile ? '0 10px' : '0 20px' }}>
                                <div style={{ ...styles.tabsContainer, gap: isMobile ? '10px' : '20px', overflowX: 'auto' }}>
                                    <button onClick={() => setActiveTab('lesson')} style={activeTab === 'lesson' ? styles.activeTabBtn : styles.tabBtn}>📺 Lesson</button>
                                    <button onClick={() => setActiveTab('quiz')} style={activeTab === 'quiz' ? styles.activeTabBtn : styles.tabBtn}>🧩 Quiz ({questions.length})</button>
                                    <button onClick={() => setActiveTab('materials')} style={activeTab === 'materials' ? styles.activeTabBtn : styles.tabBtn}>📁 Files</button>
                                    <button onClick={() => setActiveTab('comments')} style={activeTab === 'comments' ? styles.activeTabBtn : styles.tabBtn}>💬 Chat</button>
                                </div>
                            </div>

                            <div style={{ ...styles.tabContent, padding: isMobile ? '15px' : '30px' }}>
                                
                                {/* --- Tab: Lesson --- */}
                                {activeTab === 'lesson' && (
                                    <div style={styles.fadeIn}>
                                        <div style={styles.playerContainer}>
                                            {activeVideo ? (
                                                isDriveLink(activeVideo.video_link) ? (
                                                    <iframe src={getDriveEmbedUrl(activeVideo.video_link)} width="100%" height="100%" style={{ border: 'none', borderRadius: '16px' }} allow="autoplay; encrypted-media; allowFullScreen" allowFullScreen title="Drive Video"></iframe>
                                                ) : isYouTubeLink(activeVideo.video_link) ? (
                                                    <ReactPlayer url={activeVideo.video_link} width="100%" height="100%" controls={true} onEnded={handleVideoEnd} style={{ borderRadius: '16px', overflow: 'hidden' }} />
                                                ) : (
                                                    <video src={getLocalVideoUrl(activeVideo.video_link)} controls onEnded={handleVideoEnd} style={{ width: '100%', height: '100%', borderRadius: '16px', backgroundColor: 'black' }} controlsList="nodownload">Your browser does not support the video tag.</video>
                                                )
                                            ) : <div style={{ color: '#aaa', textAlign: 'center', marginTop: '50px' }}>Select a video from the playlist</div>}
                                        </div>

                                        {activeVideo && (
                                            <div style={{ marginTop: '20px', padding: '15px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center', justifyContent: 'space-between', gap: '15px' }}>
                                                <div style={{ textAlign: isMobile ? 'center' : 'left' }}>
                                                    <h4 style={{ margin: 0, color: 'white' }}>Video Status:</h4>
                                                    <span style={{ color: isVideoWatched ? '#00e676' : '#f59e0b', fontWeight: 'bold' }}>{isVideoWatched ? "✅ Completed" : "⏳ Watching..."}</span>
                                                </div>
                                                {!isVideoWatched && (
                                                    <button onClick={() => handleMarkWatched(false)} style={{ ...styles.markWatchedBtn, width: isMobile ? '100%' : 'auto', opacity: (realVideoEnded || canEdit || isDriveLink(activeVideo.video_link)) ? 1 : 0.5 }}>
                                                        {(realVideoEnded || canEdit) ? "Mark Completed ✅" : "Finish video 🔒"}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                        <div style={{ marginTop: '20px', color: '#ccc', lineHeight: '1.6', fontSize: isMobile ? '0.9rem' : '1rem' }}>{editData.description}</div>
                                    </div>
                                )}

                                {/* --- Tab: Quiz --- */}
                                {activeTab === 'quiz' && (
                                    <div style={styles.fadeIn}>
                                        {!isVideoWatched && !canEdit ? (
                                            <div style={styles.lockedQuizState}>
                                                <h3>🔒 Locked</h3>
                                                <p>Watch the video first to unlock the quiz.</p>
                                                <button onClick={() => setActiveTab('lesson')} style={styles.secondaryBtn}>Go to Video</button>
                                            </div>
                                        ) : (
                                            <>
                                                {canEdit && (
                                                    <div style={styles.adminCard}>
                                                        <h4>Add Question</h4>
                                                        <input value={newQuestion.text} onChange={e => setNewQuestion({ ...newQuestion, text: e.target.value })} style={styles.descInput} placeholder="Question" />
                                                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                                                            <input placeholder="A" value={newQuestion.a} onChange={e => setNewQuestion({ ...newQuestion, a: e.target.value })} style={styles.sidebarInput} />
                                                            <input placeholder="B" value={newQuestion.b} onChange={e => setNewQuestion({ ...newQuestion, b: e.target.value })} style={styles.sidebarInput} />
                                                            <input placeholder="C" value={newQuestion.c} onChange={e => setNewQuestion({ ...newQuestion, c: e.target.value })} style={styles.sidebarInput} />
                                                            <input placeholder="D" value={newQuestion.d} onChange={e => setNewQuestion({ ...newQuestion, d: e.target.value })} style={styles.sidebarInput} />
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                                            <label style={{ color: '#aaa' }}>Correct:</label>
                                                            <select value={newQuestion.correct} onChange={e => setNewQuestion({ ...newQuestion, correct: e.target.value })} style={styles.sidebarInput}>
                                                                <option value="a">A</option><option value="b">B</option><option value="c">C</option><option value="d">D</option>
                                                            </select>
                                                            <button onClick={handleAddQuestion} style={styles.actionBtn}>Add</button>
                                                        </div>
                                                    </div>
                                                )}

                                                <div style={{ marginBottom: '20px', color:'#ffd700' }}>Attempts: {attemptsCount || 0}/2 | Best Score: {bestScore || 0}</div>
                                                
                                                {/* ✅ حماية الكويز من الشاشة البيضاء + زر الحذف */}
                                                {Array.isArray(questions) && questions.length > 0 ? questions.map((q, idx) => (
                                                    <div key={q.id || idx} style={styles.questionCard}>
                                                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                                                            <h4 style={{marginTop:0}}>Q{idx + 1}: {q.question_text}</h4>
                                                            {canEdit && <button onClick={() => handleDeleteQuestion(q.id)} style={{...styles.deleteBtn, padding:'5px 10px'}}>🗑️</button>}
                                                        </div>
                                                        {['a', 'b', 'c', 'd'].map(o => (
                                                            <label key={o} style={{ display: 'block', padding: '10px', cursor:'pointer' }}>
                                                                <input type="radio" name={`q-${q.id}`} onChange={() => handleOptionSelect(q.id, o)} disabled={(attemptsCount || 0) >= 2 || quizScore !== null} /> 
                                                                <span style={{marginLeft:'10px'}}>{q[`option_${o}`]}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                )) : <p style={{color:'#666', textAlign:'center'}}>No questions available yet.</p>}

                                                {(attemptsCount || 0) < 2 && quizScore === null && questions.length > 0 && 
                                                    <button onClick={handleSubmitQuiz} style={{...styles.bigSubscribeBtn, width:'100%'}}>Submit Quiz</button>
                                                }
                                                {((attemptsCount || 0) >= 2 || quizScore !== null) && 
                                                    <div style={{textAlign:'center', marginTop:'20px'}}>
                                                        {(attemptsCount || 0) < 2 ? <button onClick={handleRetakeQuiz} style={styles.secondaryBtn}>Retake Quiz</button> : <span style={{color:'#ff6b6b'}}>No attempts left</span>}
                                                    </div>
                                                }
                                            </>
                                        )}
                                    </div>
                                )}

                                {/* --- Tab: Materials --- */}
                                {activeTab === 'materials' && (
                                    <div style={styles.fadeIn}>
                                        {canEdit && (
                                            <div style={styles.adminCard}>
                                                <h4 style={{ color: '#4facfe', margin: '0 0 15px 0' }}>📤 Upload Material</h4>
                                                <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '10px' }}>
                                                    <input placeholder="Title" value={newMaterial.title} onChange={e => setNewMaterial({ ...newMaterial, title: e.target.value })} style={styles.commentInput} />
                                                    <input type="file" onChange={e => setNewMaterial({ ...newMaterial, file: e.target.files[0] })} style={{ color: 'white' }} />
                                                </div>
                                                <button onClick={handleAddMaterial} style={{ ...styles.actionBtn, background: '#4facfe', marginTop: '10px', width: isMobile ? '100%' : 'auto' }}>Upload</button>
                                            </div>
                                        )}
                                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px', marginTop: '20px' }}>
                                            {materials.map(m => (
                                                <div key={m.id} style={styles.materialCard}>
                                                    <div style={{ fontSize: '2rem' }}>📄</div>
                                                    <div style={{ fontWeight: 'bold', margin: '10px 0' }}>{m.title}</div>
                                                    <a href={m.file_path} target="_blank" rel="noreferrer" style={styles.downloadBtn}>Download</a>
                                                    {canEdit && <button onClick={() => handleDeleteMaterial(m.id)} style={{ ...styles.deleteBtn, marginTop: '10px' }}>Delete</button>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* --- Tab: Comments --- */}
                                {activeTab === 'comments' && (
                                    <div style={styles.fadeIn}>
                                        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                                            <input value={newComment} onChange={e => setNewComment(e.target.value)} style={styles.commentInput} placeholder="Write a comment..." />
                                            <button onClick={handleAddComment} style={styles.sendCommentBtn}>Post</button>
                                        </div>
                                        {comments.map(c => (
                                            <div key={c.id} style={styles.commentItem}>
                                                <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                                                    <div>
                                                        <b style={{color:'#4facfe'}}>{c.user_name}</b>: <span style={{marginLeft:'5px'}}>{c.comment_text}</span>
                                                    </div>
                                                    {/* ✅ زر حذف الكومنت */}
                                                    {(canEdit || c.user_id === currentUser.id) && (
                                                        <button onClick={() => handleDeleteComment(c.id)} style={{background:'none', border:'none', cursor:'pointer', color:'#ff6b6b', fontSize:'1.1rem'}}>×</button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Sidebar (Playlist) */}
                <div style={{ ...styles.sidebarStyle, width: isMobile ? '100%' : '300px', height: isMobile ? '350px' : 'auto', borderRight: isMobile ? 'none' : styles.sidebarStyle.borderRight, borderTop: isMobile ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                    <div style={styles.sidebarHeader}><h3 style={{ margin: 0, color: '#ecf0f1', fontSize: '1rem' }}>▶️ Playlist</h3></div>
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        {visibleVideos.map((vid, index) => (
                            <div key={vid.id} onClick={() => { if (!isEditing) { setActiveVideo(vid); setActiveTab('lesson'); } }}
                                style={{ ...styles.videoItemStyle, backgroundColor: activeVideo?.id === vid.id ? 'rgba(79, 172, 254, 0.15)' : 'transparent', borderLeft: activeVideo?.id === vid.id ? '4px solid #4facfe' : '4px solid transparent', opacity: activeVideo?.id === vid.id ? 1 : 0.7 }}>
                                <div style={{ width: '100%' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span style={{ color: activeVideo?.id === vid.id ? '#4facfe' : '#666', fontWeight: 'bold' }}>{index + 1}</span>
                                        <span style={{ color: 'white' }}>{vid.video_title}</span>
                                    </div>
                                    <small style={{ color: '#888', marginLeft: '20px', display: 'block' }}>{formatDateTime(vid.video_date)}</small>
                                </div>
                                {isEditing && (
                                    <div style={{ display: 'flex', gap: '5px' }}>
                                        <button onClick={(e) => { e.stopPropagation(); startEditingVideo(vid); }} style={{ ...styles.iconBtn, color: '#fde047' }}>✏️</button>
                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteVideo(vid.id); }} style={{ ...styles.iconBtn, color: '#ff6b6b' }}>🗑️</button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                    {isEditing && (
                        <div style={styles.addVideoForm}>
                            <h4 style={{ color: '#4facfe', margin: '0 0 10px 0' }}>{editingVideoId ? '✏️ Edit Video' : '➕ Add Video'}</h4>
                            <input placeholder="Title" value={newVideoLink.title} onChange={e => setNewVideoLink({ ...newVideoLink, title: e.target.value })} style={styles.sidebarInput} />
                            <input type="datetime-local" value={newVideoLink.date} onChange={e => setNewVideoLink({ ...newVideoLink, date: e.target.value })} style={{ ...styles.sidebarInput, marginTop: '5px', colorScheme: 'dark' }} />
                            
                            <div style={{marginTop:'8px'}}>
                                <input placeholder="Link (YT/Drive)" value={newVideoLink.link} onChange={e => setNewVideoLink({ ...newVideoLink, link: e.target.value, file: null })} style={styles.sidebarInput} />
                                <div style={{textAlign:'center', color:'#555', margin:'5px 0', fontSize:'10px'}}>OR</div>
                                <input type="file" accept="video/*" onChange={e => setNewVideoLink({ ...newVideoLink, file: e.target.files[0], link: '' })} style={{fontSize:'10px', color:'#aaa'}} />
                            </div>

                            <button onClick={handleSaveVideo} style={{ ...styles.addVideoBtn, marginTop: '10px' }}>{editingVideoId ? 'Update' : 'Add'}</button>
                        </div>
                    )}
                </div>

            </div>
            {showCertificate && <CertificateModal studentName={currentUser?.name} courseName={course?.title} date={new Date().toLocaleDateString()} onClose={() => setShowCertificate(false)} />}
        </div>
    );
};

// --- Styles ---
const styles = {
    fullScreenOverlay: { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: '#0f172a', zIndex: 9999, display: 'flex', flexDirection: 'column', fontFamily: "'Cairo', 'Segoe UI', sans-serif" },
    headerStyle: { height: '60px', backgroundColor: 'rgba(15, 23, 42, 0.95)', padding: '0 25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)' },
    backBtnStyle: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', padding: '8px 16px', borderRadius: '20px', cursor: 'pointer' },
    editBtn: { background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' },
    headerInput: { fontSize: '1.2rem', padding: '5px', borderRadius: '5px', border: '1px solid #4facfe', background: 'transparent', color: 'white' },
    mainLayout: { flex: 1, display: 'flex', overflow: 'hidden' },
    sidebarStyle: { width: '300px', backgroundColor: '#1e293b', color: 'white', display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.05)' },
    sidebarHeader: { padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.05)' },
    videoItemStyle: { padding: '15px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    contentAreaStyle: { flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#0f172a', position: 'relative', overflowY: 'auto' },
    tabsWrapper: { position: 'sticky', top: 0, zIndex: 10, backgroundColor: '#0f172a', padding: '0 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
    tabsContainer: { display: 'flex', gap: '20px', paddingTop: '15px' },
    tabBtn: { padding: '12px', border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', fontWeight: '500' },
    activeTabBtn: { padding: '12px', border: 'none', background: 'transparent', cursor: 'pointer', color: '#4facfe', borderBottom: '3px solid #4facfe', fontWeight: 'bold' },
    tabBadge: { marginLeft: '6px', fontSize: '0.75rem', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '10px' },
    tabContent: { padding: '30px', maxWidth: '1000px', margin: '0 auto', width: '100%' },
    playerContainer: { width: '100%', aspectRatio: '16/9', backgroundColor: 'black', borderRadius: '16px', overflow: 'hidden' },
    fadeIn: { animation: 'fadeIn 0.3s ease-in' },
    markWatchedBtn: { background: '#00e676', color: '#0f172a', border: 'none', padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', transition: '0.3s' },
    lockedQuizState: { textAlign: 'center', padding: '40px', border: '2px dashed #444', borderRadius: '20px', color: '#aaa' },
    questionCard: { backgroundColor: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '16px', marginBottom: '20px', border: '1px solid rgba(255,255,255,0.05)' },
    bigSubscribeBtn: { padding: '15px 40px', background: '#4facfe', color: '#0f172a', border: 'none', borderRadius: '50px', fontWeight: 'bold', cursor: 'pointer' },
    secondaryBtn: { background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer' },
    commentInput: { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'white' },
    sendCommentBtn: { padding: '8px 20px', background: '#4facfe', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },
    commentItem: { padding: '15px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', marginBottom: '10px' },
    materialCard: { backgroundColor: 'rgba(30, 41, 59, 0.6)', padding: '20px', borderRadius: '10px', textAlign: 'center' },
    downloadBtn: { display: 'inline-block', color: '#4facfe', textDecoration: 'none', border: '1px solid #4facfe', padding: '5px 15px', borderRadius: '20px', fontSize: '0.9rem' },
    lockScreenStyle: { height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'white' },
    adminCard: { backgroundColor: 'rgba(30, 41, 59, 0.6)', padding: '20px', borderRadius: '15px', marginBottom: '20px', border: '1px solid rgba(255,255,255,0.05)' },
    sidebarInput: { width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.3)', color: 'white', outline: 'none' },
    descInput: { width: '100%', padding: '15px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.3)', color: 'white', outline: 'none' },
    actionBtn: { padding: '8px 16px', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' },
    addVideoForm: { padding: '20px', backgroundColor: 'rgba(15, 23, 42, 0.8)', borderTop: '1px solid rgba(255,255,255,0.1)' },
    addVideoBtn: { width: '100%', padding: '10px', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' },
    iconBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '5px' },
    deleteBtn: { background: 'rgba(255, 99, 99, 0.1)', border: 'none', color: '#ff6b6b', cursor: 'pointer', padding: '5px 8px', borderRadius: '6px' },
};

export default CourseDetailsModal;
