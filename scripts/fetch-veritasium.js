#!/usr/bin/env node
/**
 * Fetches 10 videos from https://www.youtube.com/@veritasium and writes
 * public/veritasium_channel_data.json.
 * Requires YOUTUBE_API_KEY (or REACT_APP_YOUTUBE_API_KEY) in env.
 * Usage: node scripts/fetch-veritasium.js
 * Or: YOUTUBE_API_KEY=your_key node scripts/fetch-veritasium.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || process.env.REACT_APP_YOUTUBE_API_KEY;
const CHANNEL_URL = 'https://www.youtube.com/@veritasium';
const MAX_VIDEOS = 10;
const OUT_PATH = path.join(__dirname, '..', 'public', 'veritasium_channel_data.json');

function parseIsoDuration(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const h = parseInt(match[1] || 0, 10);
  const m = parseInt(match[2] || 0, 10);
  const s = parseInt(match[3] || 0, 10);
  return h * 3600 + m * 60 + s;
}

function extractHandle(url) {
  const match = String(url).match(/youtube\.com\/@([^/?]+)/);
  return match ? match[1] : null;
}

async function main() {
  if (!YOUTUBE_API_KEY) {
    console.error('Set YOUTUBE_API_KEY or REACT_APP_YOUTUBE_API_KEY in .env or environment');
    process.exit(1);
  }
  const handle = extractHandle(CHANNEL_URL);
  if (!handle) {
    console.error('Invalid channel URL');
    process.exit(1);
  }

  // Try forHandle first; if it returns nothing, fall back to a channel search.
  const handleRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=id,contentDetails,snippet&forHandle=${encodeURIComponent(handle)}&key=${YOUTUBE_API_KEY}`
  );
  const handleData = await handleRes.json();

  let channelId;
  let channelTitle = null;
  if (handleData.items?.length) {
    channelId = handleData.items[0].id;
    channelTitle = handleData.items[0].snippet?.title || null;
  } else {
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(handle)}&maxResults=1&key=${YOUTUBE_API_KEY}`
    );
    const searchData = await searchRes.json();
    const item = searchData.items && searchData.items[0];
    const searchChannelId = item?.id?.channelId;
    if (!searchChannelId) {
      console.error('Channel not found:', handle);
      process.exit(1);
    }
    channelId = searchChannelId;
    channelTitle = item.snippet?.title || null;
  }

  const channelRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${YOUTUBE_API_KEY}`
  );
  const channelData = await channelRes.json();
  const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) {
    console.error('No uploads playlist');
    process.exit(1);
  }

  const videoIds = [];
  let nextPageToken = '';
  while (videoIds.length < MAX_VIDEOS) {
    const listRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${Math.min(50, MAX_VIDEOS - videoIds.length)}&pageToken=${nextPageToken}&key=${YOUTUBE_API_KEY}`
    );
    const listData = await listRes.json();
    for (const item of listData.items || []) {
      const vid = item.snippet?.resourceId?.videoId;
      if (vid) videoIds.push(vid);
      if (videoIds.length >= MAX_VIDEOS) break;
    }
    nextPageToken = listData.nextPageToken || '';
    if (!nextPageToken) break;
  }

  const ids = videoIds.slice(0, MAX_VIDEOS);
  const videosRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${ids.join(',')}&key=${YOUTUBE_API_KEY}`
  );
  const videosData = await videosRes.json();

  let YoutubeTranscript;
  try {
    const mod = await import('youtube-transcript');
    YoutubeTranscript = mod.YoutubeTranscript || mod.default?.YoutubeTranscript || mod.default;
  } catch (_) {
    YoutubeTranscript = null;
  }

  const videos = (videosData.items || []).map((v) => {
    const snippet = v.snippet || {};
    const stats = v.statistics || {};
    const content = v.contentDetails || {};
    const videoId = v.id;
    const durationSeconds = parseIsoDuration(content.duration);
    return {
      videoId,
      videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
      title: snippet.title || '',
      description: (snippet.description || '').slice(0, 5000),
      publishedAt: snippet.publishedAt || null,
      release_date: snippet.publishedAt || null,
      view_count: parseInt(stats.viewCount, 10) || 0,
      like_count: parseInt(stats.likeCount, 10) || 0,
      comment_count: parseInt(stats.commentCount, 10) || 0,
      duration: durationSeconds,
      duration_iso: content.duration || null,
      thumbnailUrl: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || null,
      transcript: null,
    };
  });

  for (let i = 0; i < videos.length; i++) {
    if (YoutubeTranscript) {
      try {
        const transcript = await YoutubeTranscript.fetchTranscript(videos[i].videoId);
        videos[i].transcript = Array.isArray(transcript)
          ? transcript.map((t) => (typeof t === 'string' ? t : t.text)).join(' ')
          : String(transcript);
      } catch (_) {
        videos[i].transcript = null;
      }
    }
  }

  const output = { channelId, channelTitle, videos };
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Wrote ${videos.length} videos to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
