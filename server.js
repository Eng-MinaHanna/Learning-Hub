import React, { useEffect, useState } from 'react';
import API from './api'; 
import './App.css'; 
import AddCourseModal from './AddCourseModal';
import CourseDetailsModal from './CourseDetailsModal';
import EditActivityModal from './EditActivityModal';
import AuthPage from './AuthPage';
import LandingPage from './LandingPage';
import CalendarView from './CalendarView';
import CommunityView from './CommunityView';
import NotificationsModal from './NotificationsModal';
import SponsorsPartnersBoard from './SponsorsPartnersBoard'; 
import AdminUsersView from './AdminUsersView';
import SettingsView from './SettingsView';
import LeaderboardView from './LeaderboardView';
import Sidebar from './Sidebar';
import LoadingEffect from './LoadingEffect';

function App() {
  const [user, setUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('ieee_user');
      return savedUser ? JSON.parse(savedUser) : null;
    } catch (e) { return null; }
  });

  const [activities, setActivities] = useState([]); 
  const [stats, setStats] = useState({ total_activities: 0, total_students: 0, total_workshops: 0 });
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [editingActivity, setEditingActivity] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentView, setCurrentView] = useState(() => localStorage.getItem('activeView') || 'home');
  const [progressData, setProgressData] = useState({});
  const [unreadCount, setUnreadCount] = useState(0);
  const [showAuth, setShowAuth] = useState(false);
  const [loading, setLoading] = useState(true); 
  const [syncError, setSyncError] = useState(false); // حالة جديدة للخطأ في المزامنة
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (!mobile) setIsSidebarOpen(true);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    localStorage.setItem('activeView', currentView);
    if (isMobile) setIsSidebarOpen(false);
  }, [currentView, isMobile]);

  const handleOpenCourse = (course) => { 
    setSelectedCourse(course); 
    localStorage.setItem('activeCourseId', course?.id); 
  };

  const handleCloseCourse = () => {
    setSelectedCourse(null);
    localStorage.removeItem('activeCourseId'); 
    fetchData();
  };

  const handleDelete = async (id) => {
    if (window.confirm("⚠️ Confirm Delete?")) {
      try { await API.delete(`/activities/delete/${id}`); fetchData(); } 
      catch (err) { alert("Error deleting"); }
    }
  };

  const checkNotifications = async () => {
    if (!user?.id) return;
    try {
      const res = await API.get(`/notifications/${user.id}`);
      setUnreadCount(Array.isArray(res.data) ? res.data.filter(n => !n.is_read).length : 0);
    } catch (e) { }
  };

  const fetchData = async () => {
    setLoading(true); 
    setSyncError(false);

    // 🕒 إعداد تايم أوت لمدة 10 ثواني
    const timeoutId = setTimeout(() => {
        setSyncError(true);
        setLoading(false);
    }, 10000); 

    try {
      const [actsRes, statsRes] = await Promise.all([
        API.get('/activities/all').catch(() => ({ data: [] })),
        (user?.role === 'admin' ? API.get('/stats') : Promise.resolve({ data: null })).catch(() => ({ data: null })),
        checkNotifications()
      ]);

      clearTimeout(timeoutId); // إلغاء التايم أوت لو الداتا جت بسرعة

      const data = Array.isArray(actsRes.data) ? actsRes.data : [];
      setActivities(data);

      const totalTracks = data.length;
      const totalWorkshops = data.filter(a => a.type?.toLowerCase() === 'workshop').length;

      if (user?.role === 'admin' && statsRes.data) {
        setStats({
          total_activities: totalTracks,
          total_workshops: totalWorkshops,
          total_students: statsRes.data.total_students || 0
        });
      } else {
        setStats({ total_activities: totalTracks, total_workshops: totalWorkshops, total_students: '150+' });
      }

      if (user?.email && user.role !== 'company' && data.length > 0) {
        const progressPromises = data.map(course => 
           API.get(`/progress/calculate/${course.id}/${user.email}`)
             .then(res => ({id: course.id, val: res.data?.percent || 0}))
             .catch(() => ({id: course.id, val: 0}))
        );
        const results = await Promise.all(progressPromises);
        const newProgress = {};
        results.forEach(r => { newProgress[r.id] = r.val });
        setProgressData(newProgress);
      }

    } catch (err) {
      console.error("Global Fetch Error", err);
      setSyncError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { 
    if (user) fetchData(); 
    else setLoading(false);
  }, [user?.id]);

  const handleLogout = () => { setUser(null); localStorage.clear(); setCurrentView('home'); };

  // 1. شاشة تسجيل الدخول
  if (!user && !loading) {
    return (
      <div style={styles.appContainer}>
        <div style={styles.backgroundGrid}></div>
        {showAuth ? <AuthPage onLogin={(u) => {setUser(u); setShowAuth(false);}} /> : <LandingPage user={user} onGetStarted={() => setShowAuth(true)} />}
      </div>
    );
  }

  // 2. نافذة الخطأ في حالة فشل المزامنة (Timeout)
  if (syncError) {
      return (
          <div style={styles.loadingContainer}>
              <div style={styles.errorBox}>
                  <h2 style={{color: '#ff4d4d'}}>⚠️ Connection Timeout</h2>
                  <p style={{margin: '15px 0', color: '#94a3b8'}}>
                    The server is taking too long to respond. There might be a maintenance or network issue.
                  </p>
                  <p style={{fontSize: '0.9rem', color: '#64748b'}}>Please wait a moment or contact our <b>IEEE Officers</b> if the issue persists.</p>
                  <button onClick={() => window.location.reload()} style={styles.continueBtn}>🔄 Retry Now</button>
                  <button onClick={handleLogout} style={{...styles.continueBtn, background: 'transparent', color: '#fff', border: '1px solid #444', marginTop: '10px'}}>Logout</button>
              </div>
          </div>
      );
  }

  // 3. شاشة التحميل العادية
  if (loading) {
      return (
          <div style={styles.loadingContainer}>
              <LoadingEffect message="SYNCING WITH IEEE HUB..." />
          </div>
      );
  }

  return (
    <div style={styles.appContainer}>
      <div style={styles.backgroundGrid}></div>
      <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} style={{...styles.toggleBtn, left: (isSidebarOpen && !isMobile) ? '290px' : '20px'}}>
        {isSidebarOpen ? '✕' : '☰'}
      </button>

      <div style={{ display: 'flex', minHeight: '100vh', position: 'relative' }}>
        <Sidebar isOpen={isSidebarOpen} isMobile={isMobile} user={user} currentView={currentView} onNavigate={setCurrentView} onLogout={handleLogout} />

        <main style={{ ...styles.mainArea, marginLeft: (isSidebarOpen && !isMobile) ? '280px' : '0px', width: (isSidebarOpen && !isMobile) ? 'calc(100% - 280px)' : '100%' }}>
          <div style={styles.pageHeader}>
             {currentView === 'dashboard' && !selectedCourse && user.role !== 'company' && (
                <h1 style={styles.welcomeText}>Hello, {user?.name?.split(' ')[0]}! ⚡</h1>
             )}
             {currentView === 'dashboard' && !selectedCourse && (
               <div style={styles.searchContainer}>
                  <input placeholder="Search tracks..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={styles.searchInput} />
               </div>
             )}
          </div>
          
          {currentView === 'dashboard' && !selectedCourse && user.role !== 'company' && (
            <div style={styles.contentFadeIn}>
              <div style={styles.statsGrid}>
                <DashboardCard title="Total Tracks" value={stats.total_activities} icon="📚" color="#4facfe" />
                <DashboardCard title="Active Students" value={stats.total_students} icon="👨‍🎓" color="#43e97b" />
                <DashboardCard title="Workshops" value={stats.total_workshops} icon="⚡" color="#fa709a" />
              </div>
              <div style={styles.coursesGrid}>
                {activities.filter(a => a.title.toLowerCase().includes(searchTerm.toLowerCase())).map(act => (
                  <div key={act.id} style={styles.courseCard}>
                    <div style={styles.imageBox}>
                       {act.file_path ? <img src={act.file_path} alt="C" style={styles.courseImg} /> : <div style={styles.coursePlaceholder}>IEEE</div>}
                       <div style={styles.typeBadge}>{act.type}</div>
                    </div>
                    <div style={{ padding: '20px' }}>
                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px'}}>
                          <h3 style={styles.courseTitle}>{act.title}</h3>
                          {(user.role === 'admin' || (user.role === 'instructor' && act.created_by === user.id)) && (
                            <div style={{display: 'flex', gap: '8px'}}>
                                <button onClick={() => setEditingActivity(act)} style={styles.editBtnSmall}>✏️</button>
                                <button onClick={() => handleDelete(act.id)} style={styles.deleteBtnSmall}>🗑️</button>
                            </div>
                          )}
                      </div>
                      <div style={styles.progressSection}>
                          <div style={styles.progressText}>Progress: {progressData[act.id] || 0}%</div>
                          <div style={styles.barBg}><div style={{...styles.barFill, width: `${progressData[act.id] || 0}%`}}></div></div>
                      </div>
                      <button onClick={() => handleOpenCourse(act)} style={styles.continueBtn}>Continue Learning ▶️</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentView === 'team' && <TeamView />}
          {currentView === 'leaderboard' && <LeaderboardView />}
          {currentView === 'home' && <LandingPage user={user} onGetStarted={() => setCurrentView('dashboard')} />}
          {currentView === 'schedule' && <CalendarView onOpenCourse={handleOpenCourse} />}
          {currentView === 'users' && <AdminUsersView currentUser={user} />}
          {currentView === 'community' && <CommunityView />}
          {currentView === 'sponsors' && user.role === 'admin' && <SponsorsPartnersBoard />}
          {currentView === 'settings' && <SettingsView user={user} onUpdateUser={(u)=>setUser({...user,...u})} />}
        </main>
      </div>

      {showAddModal && <AddCourseModal onClose={() => setShowAddModal(false)} onAdd={fetchData} currentUser={user} />}
      {selectedCourse && <CourseDetailsModal course={selectedCourse} onClose={handleCloseCourse} currentUser={user} />}
      {editingActivity && <EditActivityModal activity={editingActivity} onClose={() => setEditingActivity(null)} onUpdate={fetchData} />}
      
      {(user.role === 'admin' || user.role === 'instructor') && currentView === 'dashboard' && (
        <button onClick={() => setShowAddModal(true)} style={styles.fab}>+</button>
      )}
    </div>
  );
}

const DashboardCard = ({ title, value, icon, color }) => (
  <div style={{ ...styles.statCard, borderBottom: `3px solid ${color}` }}>
    <div style={{ ...styles.iconCircle, backgroundColor: `${color}15`, color: color }}>{icon}</div>
    <div>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statLabel}>{title}</div>
    </div>
  </div>
);

const TeamView = () => {
    const [team, setTeam] = useState([]);
    useEffect(() => { API.get('/team').then(res => setTeam(res.data)).catch(() => {}); }, []);
    return (
        <div style={{paddingBottom: '50px'}}>
            <h2 style={{color: 'white', marginBottom: '40px', borderLeft: '5px solid #4facfe', paddingLeft: '15px', fontSize: '2rem'}}>🏆 Meet Our Heroes</h2>
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '25px'}}>
                {team.map((m, i) => (
                    <div key={i} style={{background: 'rgba(30, 41, 59, 0.4)', padding: '25px', borderRadius: '16px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.05)'}}>
                        <div style={{width: '90px', height: '90px', borderRadius: '50%', overflow: 'hidden', margin: '0 auto 15px', border: `3px solid #4facfe`}}>
                            {m.profile_pic ? <img src={m.profile_pic} style={{width: '100%', height: '100%', objectFit: 'cover'}} alt="P" /> : <div style={{width:'100%', height:'100%', background:'#333', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'2rem'}}>{m.name?.charAt(0)}</div>}
                        </div>
                        <h3 style={{margin: '0 0 5px 0', color: 'white', fontSize: '1.1rem'}}>{m.name}</h3>
                        <span style={{fontSize: '0.75rem', color: '#4facfe', background: 'rgba(79, 172, 254, 0.1)', padding: '4px 12px', borderRadius: '20px', fontWeight: 'bold'}}>{m.role?.toUpperCase()}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const styles = {
  appContainer: { fontFamily: "'Cairo', sans-serif", backgroundColor: '#050810', color: 'white', minHeight: '100vh', position: 'relative', overflowX: 'hidden' },
  backgroundGrid: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundImage: 'radial-gradient(rgba(79, 172, 254, 0.03) 2px, transparent 2px)', backgroundSize: '50px 50px', zIndex: 0 },
  loadingContainer: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100vh', backgroundColor: '#050810', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '20px', textAlign: 'center' },
  errorBox: { background: 'rgba(15, 23, 42, 0.8)', padding: '40px', borderRadius: '30px', border: '1px solid rgba(255,255,255,0.1)', maxWidth: '500px', backdropFilter: 'blur(10px)' },
  mainArea: { padding: '40px 20px', transition: '0.4s cubic-bezier(0.4, 0, 0.2, 1)', position: 'relative', zIndex: 1, minHeight: '100vh' },
  pageHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px', flexWrap: 'wrap', gap: '20px', paddingLeft: '70px', paddingTop: '10px' },
  welcomeText: { color: 'white', margin: 0, fontSize: '1.6rem', fontWeight: '800' },
  searchContainer: { background: 'rgba(15, 23, 42, 0.5)', padding: '10px 20px', borderRadius: '15px', border: '1px solid rgba(255,255,255,0.08)', width: '280px', backdropFilter: 'blur(10px)' },
  searchInput: { background: 'transparent', border: 'none', color: 'white', outline: 'none', width: '100%', fontSize: '0.9rem' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '25px', marginBottom: '50px' },
  statCard: { background: 'rgba(15, 23, 42, 0.4)', padding: '25px', borderRadius: '24px', display: 'flex', alignItems: 'center', gap: '20px', border: '1px solid rgba(255,255,255,0.03)', backdropFilter: 'blur(10px)' },
  iconCircle: { width: '55px', height: '55px', borderRadius: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' },
  statValue: { fontSize: '1.8rem', fontWeight: '900', color: 'white' },
  statLabel: { color: '#94a3b8', fontSize: '12px', fontWeight: '600' },
  coursesGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '30px' },
  courseCard: { backgroundColor: 'rgba(30, 41, 59, 0.2)', borderRadius: '24px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.05)', transition: '0.3s transform' },
  imageBox: { position: 'relative', height: '180px' },
  courseImg: { width: '100%', height: '100%', objectFit: 'cover' },
  coursePlaceholder: { width: '100%', height: '100%', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4facfe', fontWeight: '900', fontSize: '2rem' },
  typeBadge: { position: 'absolute', bottom: '15px', left: '15px', background: 'rgba(15, 23, 42, 0.8)', padding: '5px 12px', borderRadius: '10px', fontSize: '10px', fontWeight: 'bold', color: '#4facfe', backdropFilter: 'blur(5px)' },
  courseTitle: { color: 'white', margin: 0, fontSize: '1.2rem', fontWeight: '700' },
  progressSection: { margin: '20px 0' },
  progressText: { fontSize: '11px', color: '#64748b', marginBottom: '8px' },
  barBg: { width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px' },
  barFill: { height: '100%', background: 'linear-gradient(90deg, #4facfe, #00f2fe)', borderRadius: '10px', transition: '1.5s ease' },
  continueBtn: { width: '100%', padding: '14px', borderRadius: '14px', border: 'none', background: 'linear-gradient(90deg, #4facfe, #00f2fe)', color: '#050810', fontWeight: '900', cursor: 'pointer', transition: '0.3s' },
  deleteBtnSmall: { width: '35px', height:'35px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '10px', cursor: 'pointer', display:'flex', alignItems:'center', justifyContent:'center' },
  editBtnSmall: { width: '35px', height:'35px', background: 'rgba(255, 255, 255, 0.05)', color: '#fff', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '10px', cursor: 'pointer', display:'flex', alignItems:'center', justifyContent:'center' },
  toggleBtn: { position: 'fixed', zIndex: 3000, top: '20px', background: 'rgba(79, 172, 254, 0.9)', backdropFilter: 'blur(5px)', color: '#050810', border: 'none', borderRadius: '12px', width: '45px', height: '45px', cursor: 'pointer', fontSize: '1.4rem', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 15px rgba(79,172,254,0.3)', transition: '0.4s cubic-bezier(0.4, 0, 0.2, 1)' },
  fab: { position: 'fixed', bottom: '30px', right: '30px', width: '65px', height: '65px', borderRadius: '22px', background: 'linear-gradient(135deg, #4facfe, #00f2fe)', color: '#050810', fontSize: '35px', border: 'none', cursor: 'pointer', boxShadow: '0 15px 30px rgba(79,172,254,0.5)', zIndex:100, fontWeight: 'bold' }
};

export default App;
