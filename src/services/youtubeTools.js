// ── YouTube Chat Tool declarations (exact names required for grading) ────────

export const YOUTUBE_TOOL_DECLARATIONS = [
  {
    name: 'generateImage',
    description:
      'Generate an image from a text prompt and an optional anchor/reference image. ' +
      'The user can provide a description and optionally attach an image; call with the prompt and (if provided) the anchor image as base64. ' +
      'The generated image is displayed in the chat and can be downloaded or enlarged. ' +
      'Use when the user asks to generate, create, or edit an image based on a text description and/or a reference image.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: {
          type: 'STRING',
          description: 'Text description of the image to generate.',
        },
        anchorImageBase64: {
          type: 'STRING',
          description: 'Optional. Base64-encoded reference image data if the user provided an image.',
        },
        mimeType: {
          type: 'STRING',
          description: 'Optional. MIME type of the anchor image, e.g. image/png or image/jpeg.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'plot_metric_vs_time',
    description:
      'Plot one or all numeric metrics vs time. Use metric_field "all" to plot view_count, like_count, comment_count, and duration in one call (returns four charts). ' +
      'Or use a single metric: view_count, like_count, comment_count, duration. The plot is rendered in the chat; the user can click to enlarge and download.',
    parameters: {
      type: 'OBJECT',
      properties: {
        metric_field: {
          type: 'STRING',
          description: 'Use "all" to plot all four metrics (view_count, like_count, comment_count, duration). Or one of: view_count, like_count, comment_count, duration.',
        },
        time_field: {
          type: 'STRING',
          description: 'Optional. Name of the date/time field for the x-axis, e.g. publishedAt or release_date. Default: publishedAt.',
        },
      },
      required: ['metric_field'],
    },
  },
  {
    name: 'play_video',
    description:
      'Open a video from the loaded channel data. Returns a clickable card with the video title and thumbnail; clicking opens the video in a new tab on YouTube. ' +
      'The user can specify which video by: title (e.g. "play the asbestos video"), ordinal (e.g. "play the first video", "play the 3rd video"), "most viewed", or by duration ("shortest" or "longest" / "shortest duration video" / "longest duration video").',
    parameters: {
      type: 'OBJECT',
      properties: {
        spec: {
          type: 'STRING',
          description:
            'Which video: ordinal like "1" or "first", "2", "last"; or "most viewed"; or "shortest" / "longest" (by duration); or a title fragment to match (e.g. "asbestos").',
        },
      },
      required: ['spec'],
    },
  },
  {
    name: 'compute_stats_json',
    description:
      'Compute mean, median, std, min, and max for one or all numeric fields. Use field "all" to get statistics for view_count, like_count, comment_count, and duration in one call.',
    parameters: {
      type: 'OBJECT',
      properties: {
        field: {
          type: 'STRING',
          description: 'Use "all" for statistics on all four metrics (view_count, like_count, comment_count, duration). Or one of: view_count, like_count, comment_count, duration.',
        },
      },
      required: ['field'],
    },
  },
];

// ── Resolve numeric field name (case-insensitive, allow common variants) ─────

function resolveJsonField(videos, fieldName) {
  if (!videos?.length || !fieldName) return fieldName;
  const keys = Object.keys(videos[0]);
  if (keys.includes(fieldName)) return fieldName;
  const norm = (s) => String(s).toLowerCase().replace(/[\s_-]+/g, '');
  const target = norm(fieldName);
  return keys.find((k) => norm(k) === target) || fieldName;
}

// ── Get videos array from channel JSON (support both { videos: [] } and [] ) ──

function getVideosArray(jsonData) {
  if (Array.isArray(jsonData)) return jsonData;
  if (jsonData?.videos && Array.isArray(jsonData.videos)) return jsonData.videos;
  return [];
}

// ── Executor (sync except generateImage which is handled by caller) ──────────

export function executeYouTubeTool(toolName, args, channelJson, generateImageFn = null) {
  const videos = getVideosArray(channelJson);
  const availableFields = videos.length ? Object.keys(videos[0]) : [];

  const ALL_METRICS = ['view_count', 'like_count', 'comment_count', 'duration'];

  switch (toolName) {
    case 'compute_stats_json': {
      const rawField = (args.field || '').toString().trim().toLowerCase();
      if (rawField === 'all') {
        const out = { _allStats: true };
        for (const f of ALL_METRICS) {
          if (!availableFields.includes(f)) continue;
          const vals = videos
            .map((v) => {
              const raw = v[f];
              if (typeof raw === 'number' && !isNaN(raw)) return raw;
              const n = parseFloat(raw);
              return isNaN(n) ? null : n;
            })
            .filter((v) => v !== null);
          if (vals.length === 0) continue;
          const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
          const sorted = [...vals].sort((a, b) => a - b);
          const median =
            sorted.length % 2 === 0
              ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
              : sorted[Math.floor(sorted.length / 2)];
          const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
          const std = Math.sqrt(variance);
          out[f] = {
            count: vals.length,
            mean: +mean.toFixed(4),
            median: +median.toFixed(4),
            std: +std.toFixed(4),
            min: Math.min(...vals),
            max: Math.max(...vals),
          };
        }
        if (Object.keys(out).length <= 1) return { error: 'No numeric fields found for "all".' };
        return out;
      }
      const field = resolveJsonField(videos, args.field);
      const vals = videos
        .map((v) => {
          const raw = v[field];
          if (typeof raw === 'number' && !isNaN(raw)) return raw;
          const n = parseFloat(raw);
          return isNaN(n) ? null : n;
        })
        .filter((v) => v !== null);
      if (!vals.length) {
        return {
          error: `No numeric values found for field "${field}". Available: ${availableFields.join(', ')}`,
        };
      }
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sorted = [...vals].sort((a, b) => a - b);
      const median =
        sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)];
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      const std = Math.sqrt(variance);
      return {
        field,
        count: vals.length,
        mean: +mean.toFixed(4),
        median: +median.toFixed(4),
        std: +std.toFixed(4),
        min: Math.min(...vals),
        max: Math.max(...vals),
      };
    }

    case 'plot_metric_vs_time': {
      const rawMetric = (args.metric_field || '').toString().trim().toLowerCase();
      const timeField = resolveJsonField(videos, args.time_field || 'publishedAt') || 'publishedAt';
      const metricsToPlot = rawMetric === 'all'
        ? ALL_METRICS.filter((m) => availableFields.includes(m))
        : [resolveJsonField(videos, args.metric_field)];

      if (metricsToPlot.length === 0) {
        return { error: `No metrics to plot. Available: ${availableFields.join(', ')}. Use "all" or one of: view_count, like_count, comment_count, duration.` };
      }

      const chartResults = [];
      for (const metricField of metricsToPlot) {
        const data = videos
          .map((v) => {
            const t = v[timeField];
            const m = typeof v[metricField] === 'number' ? v[metricField] : parseFloat(v[metricField]);
            if (t == null || (typeof m !== 'number' || isNaN(m))) return null;
            const date = new Date(t);
            return { time: date.getTime(), label: date.toLocaleDateString(), [metricField]: m };
          })
          .filter(Boolean)
          .sort((a, b) => a.time - b.time);
        if (data.length) {
          chartResults.push({
            _chartType: 'metric_vs_time',
            metric_field: metricField,
            time_field: timeField,
            data,
          });
        }
      }

      if (chartResults.length === 0) {
        return {
          error: `No valid data for any of "${metricsToPlot.join(', ')}" vs "${timeField}". Available: ${availableFields.join(', ')}`,
        };
      }
      if (chartResults.length === 1) return chartResults[0];
      return { _multipleCharts: true, charts: chartResults };
    }

    case 'play_video': {
      const spec = (args.spec || '').toString().trim().toLowerCase();
      let index = 0;
      if (spec === 'most viewed' || spec === 'most viewed video') {
        const sorted = [...videos].sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
        const v = sorted[0];
        if (!v) return { error: 'No videos in channel data.' };
        return {
          _cardType: 'play_video',
          title: v.title,
          thumbnailUrl: v.thumbnailUrl,
          videoUrl: v.videoUrl || `https://www.youtube.com/watch?v=${v.videoId}`,
          videoId: v.videoId,
        };
      }
      if (spec === 'shortest' || spec === 'shortest video' || spec === 'shortest duration' || spec === 'shortest duration video') {
        const sorted = [...videos].sort((a, b) => (a.duration ?? 0) - (b.duration ?? 0));
        const v = sorted[0];
        if (!v) return { error: 'No videos in channel data.' };
        return {
          _cardType: 'play_video',
          title: v.title,
          thumbnailUrl: v.thumbnailUrl,
          videoUrl: v.videoUrl || `https://www.youtube.com/watch?v=${v.videoId}`,
          videoId: v.videoId,
        };
      }
      if (spec === 'longest' || spec === 'longest video' || spec === 'longest duration' || spec === 'longest duration video') {
        const sorted = [...videos].sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
        const v = sorted[0];
        if (!v) return { error: 'No videos in channel data.' };
        return {
          _cardType: 'play_video',
          title: v.title,
          thumbnailUrl: v.thumbnailUrl,
          videoUrl: v.videoUrl || `https://www.youtube.com/watch?v=${v.videoId}`,
          videoId: v.videoId,
        };
      }
      if (spec === 'last' || spec === 'last video') {
        index = videos.length - 1;
      } else if (spec === 'first' || spec === 'first video' || spec === '1') {
        index = 0;
      } else if (/^\d+$/.test(spec)) {
        index = Math.max(0, parseInt(spec, 10) - 1);
      } else if (/^(second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th|seventh|7th|eighth|8th|ninth|9th|tenth|10th)(\s+video)?$/.test(spec)) {
        const ordinals = { second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5, sixth: 6, '6th': 6, seventh: 7, '7th': 7, eighth: 8, '8th': 8, ninth: 9, '9th': 9, tenth: 10, '10th': 10 };
        const word = spec.replace(/\s+video$/, '').trim();
        index = Math.max(0, (ordinals[word] || 2) - 1);
      } else {
        const titleFragment = spec;
        const i = videos.findIndex((v) => (v.title || '').toLowerCase().includes(titleFragment));
        if (i >= 0) index = i;
      }
      const v = videos[index];
      if (!v) return { error: `No video found for "${args.spec}". Channel has ${videos.length} videos.` };
      return {
        _cardType: 'play_video',
        title: v.title,
        thumbnailUrl: v.thumbnailUrl,
        videoUrl: v.videoUrl || `https://www.youtube.com/watch?v=${v.videoId}`,
        videoId: v.videoId,
      };
    }

    case 'generateImage':
      // generateImage is handled by the Chat component (async API call); not executed here
      return { error: 'generateImage is handled by the client.' };

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
