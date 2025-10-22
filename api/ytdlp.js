export default async function handler(req, res) {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  // Set CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  try {
    const { url } = req.query;
    
    // Validate URL parameter
    if (!url) {
      return res.status(400).json({ 
        success: false,
        error: "Missing 'url' parameter",
        message: "Please provide a YouTube URL in the 'url' query parameter"
      });
    }

    // Validate YouTube URL format
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/)|youtu\.be\/)[\w-]+/;
    if (!youtubeRegex.test(url)) {
      return res.status(400).json({
        success: false,
        error: "Invalid YouTube URL",
        message: "Please provide a valid YouTube URL"
      });
    }

    // Import ytdl-core dynamically
    const ytdl = await import("@distube/ytdl-core");
    
    // Check if URL is valid YouTube video
    if (!ytdl.validateURL(url)) {
      return res.status(400).json({
        success: false,
        error: "Invalid YouTube video URL",
        message: "The provided URL is not a valid YouTube video"
      });
    }

    // Get video info with timeout
    const info = await Promise.race([
      ytdl.getInfo(url),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 25000)
      )
    ]);

    // Choose best format
    const format = ytdl.chooseFormat(info.formats, { 
      quality: 'highest',
      filter: 'audioandvideo'
    });

    // Fallback to audio-only if no video+audio format available
    const fallbackFormat = format || ytdl.chooseFormat(info.formats, { 
      quality: 'highestaudio' 
    });

    if (!fallbackFormat) {
      return res.status(404).json({
        success: false,
        error: "No suitable format found",
        message: "Could not find a downloadable format for this video"
      });
    }

    // Prepare response data
    const responseData = {
      success: true,
      title: info.videoDetails.title,
      duration: parseInt(info.videoDetails.lengthSeconds) || 0,
      thumbnail: info.videoDetails.thumbnails?.length > 0 
        ? info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url 
        : null,
      videoUrl: fallbackFormat.url,
      format: {
        quality: fallbackFormat.quality,
        container: fallbackFormat.container,
        hasVideo: fallbackFormat.hasVideo,
        hasAudio: fallbackFormat.hasAudio
      },
      author: info.videoDetails.author?.name || 'Unknown',
      viewCount: parseInt(info.videoDetails.viewCount) || 0,
      uploadDate: info.videoDetails.uploadDate || null
    };

    res.status(200).json(responseData);

  } catch (err) {
    console.error("Error processing request:", err);
    
    // Handle specific error types
    let errorMessage = "Failed to fetch video info";
    let statusCode = 500;

    if (err.message.includes('Video unavailable')) {
      errorMessage = "Video is unavailable or private";
      statusCode = 404;
    } else if (err.message.includes('timeout')) {
      errorMessage = "Request timeout - video may be too long or server is busy";
      statusCode = 408;
    } else if (err.message.includes('age-restricted')) {
      errorMessage = "Video is age-restricted and cannot be accessed";
      statusCode = 403;
    } else if (err.message.includes('private')) {
      errorMessage = "Video is private and cannot be accessed";
      statusCode = 403;
    }

    res.status(statusCode).json({ 
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
}
