import { ref, onUnmounted, shallowRef } from "vue";
import MP4Worker from "../workers/mp4-worker.js?worker";

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

  async function init() {
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

  function handleWorkerMessage(e) {
    const { type, frame, info } = e.data;

    if (type === "ready") {
      duration.value = info.duration;
      isEnded.value = false;

      // Auto seek if requested
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
      // 收到新帧
      // 如果正在 seek (isLoading)，这可能是第一帧
      // 我们应该直接渲染它以更新画面

      // 简单的去重/顺序检查：如果新帧比队列里最后一帧还老（乱序？），或者比当前 currentTime 还要老很多？
      // 实际上 worker 已经过滤了。

      videoQueue.push(frame);

      if (isLoading.value) {
        // Seek 后的首帧处理
        isLoading.value = false;
        isReady = true;

        // 立即渲染这一帧，不要等 renderLoop
        const firstFrame = videoQueue[0]; // Peek
        // 注意：如果直接渲染，renderLoop 下次也会渲染它。
        // 关键是 seek 后如果不播放，renderLoop 可能不会运行或者不会消费。

        drawFrame(firstFrame);

        // 如果是暂停状态，我们不需要保留它在队列里？
        // 不，如果用户点播放，我们需要它。
        // 但是 drawFrame 不会 close frame。
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

  // 不再需要 scheduleAudio，由 audioEl 自动处理

  function renderLoop() {
    if (!isPlaying.value) return;

    // 主时钟：Audio Element 的 currentTime
    const now = audioEl.currentTime;
    currentTime.value = now;

    // 检测播放结束 (audioEl 会触发 ended，但我们这里也检查一下)
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

      // 容差：允许 30ms 误差
      if (frameTime <= now + 0.03) {
        if (frameToRender) frameToRender.close();
        frameToRender = videoQueue.shift();
      } else {
        break;
      }
    }

    if (frameToRender) {
      drawFrame(frameToRender);
      frameToRender.close();
    }

    animationFrameId = requestAnimationFrame(renderLoop);
  }

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
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(frame, offsetX, offsetY, drawWidth, drawHeight);
  }

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

  function seek(time) {
    if (!worker || !audioEl) return;

    // 暂停播放，清理队列
    videoQueue.forEach((f) => f.close());
    videoQueue.length = 0;
    // isReady = false; // Seek 时不要设为 false，否则会黑屏
    // isLoading.value = true; // 可选

    // Seek 音频
    audioEl.currentTime = time;
    currentTime.value = time;

    // Seek 视频 Worker
    worker.postMessage({ type: "seek", time: time });
  }

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
