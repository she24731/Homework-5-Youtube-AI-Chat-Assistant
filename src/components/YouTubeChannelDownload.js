import { useState } from 'react';
import './YouTubeChannelDownload.css';

const API = process.env.REACT_APP_API_URL || '';
// In dev, proxy forwards /api to backend; in prod use full backend URL
const apiBase = API || '';

export default function YouTubeChannelDownload({ user, onLogout }) {
  const [channelUrl, setChannelUrl] = useState('https://www.youtube.com/@veritasium');
  const [maxVideos, setMaxVideos] = useState(10);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handleDownload = async () => {
    setError('');
    setResult(null);
    setLoading(true);
    setProgress(0);
    const max = Math.min(100, Math.max(1, parseInt(maxVideos, 10) || 10));
    try {
      const timer = setInterval(() => {
        setProgress((p) => Math.min(p + 8, 90));
      }, 400);
      const res = await fetch(`${apiBase}/api/youtube/channel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelUrl: channelUrl.trim(), maxVideos: max }),
      });
      clearInterval(timer);
      setProgress(100);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setResult(data);
    } catch (err) {
      setError(err.message || 'Download failed');
    } finally {
      setLoading(false);
      setProgress(0);
    }
  };

  const handleDownloadJson = () => {
    if (!result) return;
    const payload = {
      channelId: result.channelId,
      channelTitle: result.channelTitle,
      fetchedAt: result.fetchedAt || null,
      videos: result.videos,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `youtube_channel_${result.channelId || 'data'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="youtube-download-page">
      <header className="youtube-download-header">
        <h1>YouTube Channel Download</h1>
        <div className="youtube-download-user">
          <span>{user?.firstName || user?.username}</span>
          <button type="button" onClick={onLogout} className="sidebar-logout">
            Log out
          </button>
        </div>
      </header>
      <div className="youtube-download-card">
        <label>
          Channel URL
          <input
            type="url"
            placeholder="https://www.youtube.com/@channelname"
            value={channelUrl}
            onChange={(e) => setChannelUrl(e.target.value)}
            disabled={loading}
          />
          <span className="youtube-url-hint">Use the exact channel handle after @ (e.g. veritasium, not veritasiui).</span>
        </label>
        <label>
          Max videos (default 10, max 100)
          <input
            type="number"
            min={1}
            max={100}
            value={maxVideos}
            onChange={(e) => setMaxVideos(e.target.value)}
            disabled={loading}
          />
        </label>
        <button type="button" onClick={handleDownload} disabled={loading} className="youtube-download-btn">
          {loading ? 'Downloading…' : 'Download Channel Data'}
        </button>
        {loading && (
          <div className="youtube-progress-wrap">
            <div className="youtube-progress-bar" style={{ width: `${progress}%` }} />
          </div>
        )}
        {error && <p className="youtube-download-error">{error}</p>}
        {result && (
          <div className="youtube-result">
            <p>
              Fetched {result.videos?.length || 0} videos
              {result.channelTitle && ` from ${result.channelTitle}`}.
              {result.fetchedAt && ` (stats as of ${new Date(result.fetchedAt).toLocaleString()})`}
            </p>
            <p className="youtube-json-fields-note">
              In the JSON: <strong>duration</strong> = video length in seconds; <strong>duration_iso</strong> = ISO 8601 (e.g. PT53M). View/like/comment counts are as returned by YouTube at fetch time and may differ slightly from the current numbers on the site.
            </p>
            <button type="button" onClick={handleDownloadJson} className="youtube-download-json-btn">
              Download JSON file
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
