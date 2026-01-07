import MP4Box from "mp4box";

// 状态管理
let mp4boxfile = null;
let videoDecoder = null;
let videoTrack = null;
let abortController = null;

let fileBuffer = null;
let seekTargetTime = -1; // 微秒

// 配置
const CHUNK_SIZE = 1024 * 1024; // 1MB 每次读取

self.onmessage = async (e) => {
  const { type, url, time } = e.data;

  switch (type) {
    case "initialize":
      initializeDecoders();
      break;
    case "fetch":
      if (url) {
        // 必须重置之前的状态，防止上一个视频的解析干扰
        if (mp4boxfile) {
          mp4boxfile.flush();
          mp4boxfile = null;
        }
        // 重置解码器配置状态，但不必销毁解码器实例（initializeDecoders 创建的）
        // VideoDecoder.reset() 会清除所有待解码队列和配置
        if (videoDecoder) videoDecoder.reset();

        fileBuffer = null;
        seekTargetTime = -1;
        videoTrack = null;

        startFetch(url);
      }
      break;
    case "seek":
      if (typeof time === "number") {
        performSeek(time);
      }
      break;
    case "close":
      reset();
      break;
  }
};

/**
 * 重置所有状态，清理资源
 */
function reset() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }

  if (videoDecoder) {
    if (videoDecoder.state !== "closed") videoDecoder.close();
    videoDecoder = null;
  }

  if (mp4boxfile) {
    mp4boxfile.flush();
    mp4boxfile = null;
  }

  // 重新初始化以便下次使用
  initializeDecoders();
}

/**
 * 初始化 WebCodecs 视频解码器
 */
function initializeDecoders() {
  if (typeof VideoDecoder === "undefined") {
    console.error(
      "WebCodecs API (VideoDecoder) is not supported in this environment. Please ensure you are using a Secure Context (HTTPS) or a supported browser."
    );
    return;
  }

  // 视频解码器
  videoDecoder = new VideoDecoder({
    output: (videoFrame) => {
      // 过滤 Seek 之前的帧
      // 容差 10ms (10000us)，防止浮点数精度问题导致的丢帧
      if (
        seekTargetTime !== -1 &&
        videoFrame.timestamp < seekTargetTime - 10000
      ) {
        videoFrame.close();
        return;
      }

      // 一旦达到或超过目标时间，重置过滤（防止后续逻辑复杂化，虽然 timestamp < check 也够了）
      // 但为了保险起见，我们不重置，因为我们只关心 >= seekTargetTime 的帧。
      // 实际上，如果 B 帧导致输出顺序微调，严格 < 检查是安全的。

      // 发送解码后的视频帧到主线程
      self.postMessage(
        {
          type: "videoFrame",
          frame: videoFrame,
        },
        [videoFrame]
      ); // Transferable
    },
    error: (e) => {
      console.error("Video Decoder Error:", e);
    },
  });
}

/**
 * 开始下载视频文件
 * 目前策略是下载整个文件到内存，适用于中短视频
 * 对于长视频，应实现 Range 请求的分块下载
 */
async function startFetch(url) {
  reset(); // 确保清理旧状态

  abortController = new AbortController();

  try {
    // 1. 下载整个文件到内存 (ArrayBuffer)
    const response = await fetch(url, { signal: abortController.signal });
    const buffer = await response.arrayBuffer();

    // 2. 存储 buffer
    buffer.fileStart = 0;
    fileBuffer = buffer;

    // 3. 开始处理
    createMP4Box();
    mp4boxfile.appendBuffer(fileBuffer);
    mp4boxfile.flush();

    self.postMessage({ type: "complete" });
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error("Fetch error:", err);
    }
  }
}

/**
 * 创建 MP4Box 实例并配置事件
 */
function createMP4Box() {
  mp4boxfile = MP4Box.createFile();
  mp4boxfile.onError = (e) => console.error("MP4Box Error:", e);

  // 当 MP4Box 准备好文件信息时触发
  mp4boxfile.onReady = (info) => {
    // 提取视频轨道
    videoTrack = info.videoTracks[0];
    if (videoTrack) {
      // Reset seek target for initial play (start from 0 or wherever)
      seekTargetTime = -1;

      mp4boxfile.setExtractionOptions(videoTrack.id, "video", {
        nbSamples: 1000,
      });

      const videoDesc = videoTrack.codec.startsWith("vp08")
        ? "vp8"
        : videoTrack.codec;

      // 配置视频解码器
      const config = {
        codec: videoTrack.codec,
        codedWidth: videoTrack.video.width,
        codedHeight: videoTrack.video.height,
      };

      // 获取 avcC box 作为 description (Extra Data / Magic Cookie)
      // 这是 H.264 解码所必需的 SPS/PPS 信息
      const trak = mp4boxfile.getTrackById(videoTrack.id);
      for (const entry of trak.mdia.minf.stbl.stsd.entries) {
        if (entry.avcC) {
          const stream = new MP4Box.DataStream(
            undefined,
            0,
            MP4Box.DataStream.BIG_ENDIAN
          );
          entry.avcC.write(stream);
          config.description = new Uint8Array(stream.buffer, 8); // Skip box header
        }
      }

      if (videoDecoder.state === "unconfigured") videoDecoder.configure(config);
    }

    // 发送媒体信息回主线程
    const durationSec = info.duration / info.timescale;
    self.postMessage({
      type: "ready",
      info: {
        duration: durationSec,
        videoTrack: videoTrack
          ? { width: videoTrack.video.width, height: videoTrack.video.height }
          : null,
      },
    });

    mp4boxfile.start();
  };

  // 当 MP4Box 提取出样本数据时
  mp4boxfile.onSamples = (track_id, user, samples) => {
    if (videoTrack && track_id === videoTrack.id) {
      for (const sample of samples) {
        const type = sample.is_sync ? "key" : "delta";

        // 构建 EncodedVideoChunk，这是 WebCodecs 的输入
        const chunk = new EncodedVideoChunk({
          type: type,
          timestamp: (sample.cts * 1000000) / sample.timescale,
          duration: (sample.duration * 1000000) / sample.timescale,
          data: sample.data,
        });

        if (videoDecoder.state === "configured") videoDecoder.decode(chunk);
      }
    }
  };
}

/**
 * 执行 Seek 操作
 * @param {number} timeSec - 目标时间（秒）
 */
function performSeek(timeSec) {
  if (!mp4boxfile || !fileBuffer) return;

  // Set filter target (convert to microseconds)
  seekTargetTime = timeSec * 1000000;

  // Reset decoders to clear internal buffers
  videoDecoder.reset();

  // Re-configure decoder
  if (videoTrack) {
    const config = {
      codec: videoTrack.codec,
      codedWidth: videoTrack.video.width,
      codedHeight: videoTrack.video.height,
    };
    const trak = mp4boxfile.getTrackById(videoTrack.id);
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      if (entry.avcC) {
        const stream = new MP4Box.DataStream(
          undefined,
          0,
          MP4Box.DataStream.BIG_ENDIAN
        );
        entry.avcC.write(stream);
        config.description = new Uint8Array(stream.buffer, 8);
      }
    }
    videoDecoder.configure(config);
  }

  // Seek MP4Box (use 'true' for exact seek if supported, or nearest keyframe)
  mp4boxfile.seek(timeSec, true);
  mp4boxfile.start();
}
