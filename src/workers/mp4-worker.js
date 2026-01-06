import MP4Box from "mp4box";

// 状态管理
let mp4boxfile = null;
let videoDecoder = null;
let audioDecoder = null;
let videoTrack = null;
let audioTrack = null;
let abortController = null;

let fileBuffer = null;

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
        fileBuffer = null;
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

function reset() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }

  if (videoDecoder) {
    if (videoDecoder.state !== "closed") videoDecoder.close();
    videoDecoder = null;
  }

  if (audioDecoder) {
    if (audioDecoder.state !== "closed") audioDecoder.close();
    audioDecoder = null;
  }

  if (mp4boxfile) {
    mp4boxfile.flush();
    mp4boxfile = null;
  }

  // 重新初始化以便下次使用
  initializeDecoders();
}

function initializeDecoders() {
  // 视频解码器
  videoDecoder = new VideoDecoder({
    output: (videoFrame) => {
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

  // 音频解码器
  audioDecoder = new AudioDecoder({
    output: (audioData) => {
      // 发送解码后的音频数据到主线程
      self.postMessage(
        {
          type: "audioData",
          data: audioData,
        },
        [audioData]
      ); // Transferable
    },
    error: (e) => {
      console.error("Audio Decoder Error:", e);
    },
  });
}

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

function configureAudioDecoder(track) {
  let codec = track.codec;

  // WebCodecs 映射 PCM 格式
  // MP4Box 通常返回 'alaw', 'ulaw' 或者 'twos', 'sowt', 'lpcm'
  // WebCodecs 需要 'alaw' 或 'ulaw' 或 'pcm'
  if (codec === "alaw" || codec === "pcma") {
    codec = "alaw";
  } else if (codec === "ulaw" || codec === "pcmu") {
    codec = "ulaw";
  } else if (codec === "twos" || codec === "sowt" || codec === "lpcm") {
    codec = "pcm-s16";
  }

  const config = {
    codec: codec,
    numberOfChannels: track.audio.channel_count,
    sampleRate: track.audio.sample_rate,
  };

  // Extract AAC description (esds)
  // 修正：对于 alaw/ulaw，通常不需要 description。提供错误的 description 可能会导致配置失败。
  // 只有当是 AAC (mp4a) 时才去提取 esds。
  if (codec.startsWith("mp4a")) {
    const trak = mp4boxfile.getTrackById(track.id);
    if (
      trak &&
      trak.mdia &&
      trak.mdia.minf &&
      trak.mdia.minf.stbl &&
      trak.mdia.minf.stbl.stsd
    ) {
      for (const entry of trak.mdia.minf.stbl.stsd.entries) {
        if (
          entry.esds &&
          entry.esds.esd &&
          entry.esds.esd.decoderConfigDescriptor &&
          entry.esds.esd.decoderConfigDescriptor.decoderSpecificInfo
        ) {
          const descriptor =
            entry.esds.esd.decoderConfigDescriptor.decoderSpecificInfo;
          // data is a Uint8Array
          config.description = descriptor.data;
        }
      }
    }
  }

  // 如果是 PCM A-law，WebCodecs 可能不需要 description，但需要正确的 codec 字符串
  console.log("Configuring Audio Decoder:", config);

  try {
    audioDecoder.configure(config);
  } catch (e) {
    console.error("Audio Decoder Config Error:", e);
  }
}

function createMP4Box() {
  mp4boxfile = MP4Box.createFile();
  mp4boxfile.onError = (e) => console.error("MP4Box Error:", e);

  // 当 MP4Box 准备好文件信息时触发
  mp4boxfile.onReady = (info) => {
    // 提取视频轨道
    videoTrack = info.videoTracks[0];
    if (videoTrack) {
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

      // 获取 avcC box 作为 description
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

    // 提取音频轨道
    audioTrack = info.audioTracks[0];
    if (audioTrack) {
      mp4boxfile.setExtractionOptions(audioTrack.id, "audio", {
        nbSamples: 1000,
      });
      if (audioDecoder.state === "unconfigured")
        configureAudioDecoder(audioTrack);
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

        const chunk = new EncodedVideoChunk({
          type: type,
          timestamp: (sample.cts * 1000000) / sample.timescale,
          duration: (sample.duration * 1000000) / sample.timescale,
          data: sample.data,
        });

        if (videoDecoder.state === "configured") videoDecoder.decode(chunk);
      }
    }

    if (audioTrack && track_id === audioTrack.id) {
      for (const sample of samples) {
        const type = sample.is_sync ? "key" : "delta";

        const chunk = new EncodedAudioChunk({
          type: type,
          timestamp: (sample.cts * 1000000) / sample.timescale,
          duration: (sample.duration * 1000000) / sample.timescale,
          data: sample.data,
        });

        if (audioDecoder.state === "configured") audioDecoder.decode(chunk);
      }
    }
  };
}

function performSeek(timeSec) {
  if (!mp4boxfile || !fileBuffer) return;

  // Reset decoders
  videoDecoder.reset();
  audioDecoder.reset();

  // Re-configure
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

  if (audioTrack) {
    configureAudioDecoder(audioTrack);
  }

  // Seek MP4Box
  mp4boxfile.seek(timeSec, true);
  mp4boxfile.start();
}
