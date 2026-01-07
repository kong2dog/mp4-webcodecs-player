import { ref, onUnmounted, shallowRef } from "vue";
import MP4Worker from "../workers/mp4-worker.js?worker";

/**
 * 播放器核心逻辑 Hook
 * 负责协调 Web Worker (视频解码) 和 HTMLAudioElement (音频播放)
 * @param {Ref<HTMLCanvasElement>} canvasRef - 渲染视频的 Canvas 引用
 */
export function usePlayer(canvasRef) {
  const isPlaying = ref(false);
  const isLoading = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);
  const isEnded = ref(false);
  const volume = ref(1.0);
  const isMuted = ref(false);
  const playbackRate = ref(1.0);

  // 核心对象
  let worker = null;
  let audioEl = null; // HTMLAudioElement

  // 队列与缓冲
  const videoQueue = []; // stored as { frame, timestamp }

  let animationFrameId = null;

  // 状态
  let isReady = false;
  let startSeekTime = -1;
  let autoPlayAfterSeek = false;

  /**
   * 初始化播放器
   * 创建 Worker 和 Audio 元素
   */
  async function init() {
    // 检查 WebCodecs 支持
    if (!("VideoDecoder" in window)) {
      console.error("WebCodecs API is not supported. HTTPS is required.");
      alert("当前环境不支持 WebCodecs API。请使用 HTTPS 访问或 localhost。");
      // return; // 允许部分初始化以显示 UI，但视频无法播放
    }

    // 初始化 Audio Element
    audioEl = new Audio();
    audioEl.crossOrigin = "anonymous";
    audioEl.preload = "auto";

    // 监听音频事件
    audioEl.addEventListener("play", () => (isPlaying.value = true));
    audioEl.addEventListener("pause", () => (isPlaying.value = false));
    audioEl.addEventListener("ended", () => {
      isEnded.value = true;
      pause();
    });
    audioEl.addEventListener("error", (e) => console.error("Audio Error", e));
    // audioEl.addEventListener('timeupdate', () => {}); // 我们主要靠 requestAnimationFrame 同步

    worker = new MP4Worker();
    worker.onmessage = handleWorkerMessage;
    worker.postMessage({ type: "initialize" });
  }

  /**
   * 处理 Worker 返回的消息
   */
  function handleWorkerMessage(e) {
    const { type, frame, info } = e.data;

    if (type === "ready") {
      duration.value = info.duration;
      isEnded.value = false;

      // 如果有预设的 Seek 目标（例如跨视频切换时）
      if (startSeekTime >= 0) {
        console.log(`Auto seeking to ${startSeekTime}s`);
        seek(startSeekTime);

        if (autoPlayAfterSeek) {
          play();
        }

        startSeekTime = -1;
        autoPlayAfterSeek = false;
      }
    } else if (type === "videoFrame") {
      // 收到新解码的视频帧
      videoQueue.push(frame);

      if (isLoading.value) {
        // Seek 后的首帧处理
        isLoading.value = false;
        isReady = true;

        // 立即渲染这一帧，不要等 renderLoop，以消除 Seek 延迟
        const firstFrame = videoQueue[0]; // Peek
        drawFrame(firstFrame);
      }

      // 优化：只需 1 帧即可显示首帧 (Pre-render)
      if (!isReady && videoQueue.length > 0) {
        isReady = true;
        isLoading.value = false;
        const firstFrame = videoQueue[0];
        drawFrame(firstFrame);
      }
    } else if (type === "complete") {
      console.log("Download complete");
    }
  }

  /**
   * 渲染循环
   * 负责同步视频帧到音频时间轴
   */
  function renderLoop() {
    if (!isPlaying.value) return;

    // 主时钟：Audio Element 的 currentTime
    const now = audioEl.currentTime;
    currentTime.value = now;

    // 检测播放结束
    if (duration.value > 0 && now >= duration.value) {
      // isEnded handled by audio event
    }

    // 渲染匹配的帧
    // 我们需要找到 timestamp <= now * 1e6 的最新一帧
    let frameToRender = null;

    // 策略：丢弃所有过期的帧，保留最接近当前时间的一帧
    // 如果没有新的过期帧，保持上一帧？或者如果不丢弃，videoQueue 会堆积。
    while (videoQueue.length > 0) {
      const frame = videoQueue[0];
      const frameTime = frame.timestamp / 1e6;

      // 容差：允许 30ms 误差，避免频繁丢帧
      if (frameTime <= now + 0.03) {
        if (frameToRender) frameToRender.close();
        frameToRender = videoQueue.shift();
      } else {
        break;
      }
    }

    if (frameToRender) {
      // 检查帧的时效性
      // 如果帧的时间戳比当前音频时间落后太多 (例如 > 0.5s)，说明这是“赶进度”的旧帧
      // 或者是浏览器后台切换回前台时，Worker 正在疯狂补发积压的帧
      // 为了避免视觉上的“快进”效果（Benny Hill Effect），我们直接丢弃这些旧帧不渲染
      // 保持画面静止在上一帧，直到追上进度
      const frameTime = frameToRender.timestamp / 1e6;
      const lag = now - frameTime;

      if (lag > 0.5) {
        // 落后超过 500ms，丢弃不画
        frameToRender.close();

        // 优化：如果落后非常严重（例如 > 2秒），说明解码器完全跟不上了
        // 或者是从长时间后台恢复。与其让解码器逐帧解码赶进度，不如直接 Seek 到当前时间
        // 注意：频繁 Seek 可能会有副作用，所以需要节流
        // 这里简单处理：如果积压严重，我们依赖丢帧追赶，因为 VideoDecoder 通常很快
      } else {
        drawFrame(frameToRender);
        frameToRender.close();
      }
    }

    animationFrameId = requestAnimationFrame(renderLoop);
  }

  /**
   * 将 VideoFrame 绘制到 Canvas
   * 实现 Letterboxing (Contain) 逻辑
   */
  function drawFrame(frame) {
    if (!canvasRef.value) return;
    const canvas = canvasRef.value;
    const ctx = canvas.getContext("2d");

    // 确保 Canvas 分辨率匹配其 CSS 显示尺寸（窗口大小）
    // 使用 clientWidth/Height 获取容器实际像素大小
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const targetWidth = Math.floor(rect.width * dpr);
    const targetHeight = Math.floor(rect.height * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    // 计算 contain 模式的绘制参数 (Letterboxing)
    const canvasAspect = canvas.width / canvas.height;
    const frameAspect = frame.displayWidth / frame.displayHeight;

    let drawWidth, drawHeight, offsetX, offsetY;

    if (canvasAspect > frameAspect) {
      // Canvas 更宽，以高度为基准，左右留黑边
      drawHeight = canvas.height;
      drawWidth = canvas.height * frameAspect;
      offsetX = (canvas.width - drawWidth) / 2;
      offsetY = 0;
    } else {
      // Canvas 更高，以宽度为基准，上下留黑边
      drawWidth = canvas.width;
      drawHeight = canvas.width / frameAspect;
      offsetX = 0;
      offsetY = (canvas.height - drawHeight) / 2;
    }

    // 清除画布（必须，因为可能留有黑边）
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 使用高质量缩放
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(frame, offsetX, offsetY, drawWidth, drawHeight);
  }

  /**
   * 加载视频
   * @param {string} url - 视频地址
   * @param {number} startTime - 起始播放时间 (秒)
   * @param {boolean} shouldAutoPlay - 加载完成后是否自动播放
   */
  function load(url, startTime = -1, shouldAutoPlay = false) {
    isLoading.value = true;
    isReady = false;
    startSeekTime = startTime;
    autoPlayAfterSeek = shouldAutoPlay;

    // 重置队列
    videoQueue.forEach((f) => f.close());
    videoQueue.length = 0;

    // 加载音频
    if (audioEl) {
      audioEl.src = url;
      audioEl.load();
      audioEl.playbackRate = playbackRate.value;
      audioEl.volume = isMuted.value ? 0 : volume.value;
    }

    // 通知 Worker 开始 (只处理视频)
    worker.postMessage({ type: "fetch", url });
  }

  /**
   * 跳转到指定时间
   * @param {number} time - 目标时间 (秒)
   */
  function seek(time) {
    if (!worker || !audioEl) return;

    // 暂停播放，清理队列
    videoQueue.forEach((f) => f.close());
    videoQueue.length = 0;

    // Seek 音频
    audioEl.currentTime = time;
    currentTime.value = time;

    // Seek 视频 Worker
    worker.postMessage({ type: "seek", time: time });
  }

  /**
   * 开始播放
   */
  async function play() {
    if (audioEl && audioEl.paused) {
      try {
        await audioEl.play();
        // isPlaying 设为 true 由事件监听处理
        renderLoop();
      } catch (e) {
        console.error("Audio play failed", e);
      }
    }
  }

  /**
   * 暂停播放
   */
  function pause() {
    if (audioEl && !audioEl.paused) {
      audioEl.pause();
    }
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
  }

  function setVolume(val) {
    volume.value = val;
    if (audioEl) audioEl.volume = isMuted.value ? 0 : val;
  }

  function toggleMute() {
    isMuted.value = !isMuted.value;
    if (audioEl) audioEl.volume = isMuted.value ? 0 : volume.value;
  }

  function setPlaybackRate(rate) {
    playbackRate.value = rate;
    if (audioEl) audioEl.playbackRate = rate;
  }

  onUnmounted(() => {
    if (worker) {
      worker.postMessage({ type: "close" });
      worker.terminate();
    }
    if (audioEl) {
      audioEl.pause();
      audioEl.src = "";
      audioEl = null;
    }
  });

  return {
    init,
    load,
    seek,
    play,
    pause,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    isEnded,
    volume,
    isMuted,
    playbackRate,
    setVolume,
    toggleMute,
    setPlaybackRate,
  };
}
