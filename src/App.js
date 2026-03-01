import { useState } from 'react';
import Auth from './components/Auth';
import Chat from './components/Chat';
import YouTubeChannelDownload from './components/YouTubeChannelDownload';
import './App.css';

function App() {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('chatapp_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTab] = useState('chat');

  const handleLogin = (userData) => {
    const u =
      typeof userData === 'string'
        ? { username: userData, firstName: '', lastName: '' }
        : userData;
    localStorage.setItem('chatapp_user', JSON.stringify(u));
    setUser(u);
  };

  const handleLogout = () => {
    localStorage.removeItem('chatapp_user');
    setUser(null);
  };

  if (user) {
    return (
      <div className="app-with-tabs">
        <header className="app-tab-bar">
          <button
            type="button"
            className={`app-tab ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            Chat
          </button>
          <button
            type="button"
            className={`app-tab ${activeTab === 'youtube' ? 'active' : ''}`}
            onClick={() => setActiveTab('youtube')}
          >
            YouTube Channel Download
          </button>
        </header>
        <div className="app-tab-content">
          <div className={`app-tab-pane ${activeTab === 'chat' ? 'active' : ''}`}>
            <Chat user={user} onLogout={handleLogout} />
          </div>
          <div className={`app-tab-pane ${activeTab === 'youtube' ? 'active' : ''}`}>
            <YouTubeChannelDownload user={user} onLogout={handleLogout} />
          </div>
        </div>
      </div>
    );
  }
  return <Auth onLogin={handleLogin} />;
}

export default App;
