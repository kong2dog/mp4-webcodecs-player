import { ref, onUnmounted, shallowRef } from "vue";
import MP4Worker from "../workers/mp4-worker.js?worker";

export function usePlayer(canvasRef) {
  const isPlaying = ref(false);
  const isLoading = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);
  const isEnded = ref(false);

  // 核心对象
  let worker = null;
  let audioContext = null;
  let audioGainNode = null;

  // 队列与缓冲
  const videoQueue = []; // stored as { frame, timestamp }
  const audioQueue = [];
  let startTime = 0; // 播放开始时的 audioContext 时间
  let pausedAt = 0; // 暂停时的偏移量
  let animationFrameId = null;

  // 状态
  let isReady = false;

  async function init() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioGainNode = audioContext.createGain();
    audioGainNode.connect(audioContext.destination);

    worker = new MP4Worker();
    worker.onmessage = handleWorkerMessage;
    worker.postMessage({ type: "initialize" });
  }

  function handleWorkerMessage(e) {
    const { type, frame, data, info } = e.data;

    if (type === "ready") {
      duration.value = info.duration;
      // 重置结束状态
      isEnded.value = false;
    } else if (type === "videoFrame") {
      videoQueue.push(frame);
      // 简单的缓冲策略：如果还没开始播放且缓冲了一些帧，可以准备就绪
      if (!isReady && videoQueue.length > 10) {
        isReady = true;
        isLoading.value = false;
      }
    } else if (type === "audioData") {
      scheduleAudio(data);
    } else if (type === "complete") {
      console.log("Download complete");
    }
  }

  function scheduleAudio(audioData) {
    // 将 AudioData 转换为 AudioBuffer 并播放
    // 注意：这需要一定的计算开销。AudioData API 提供了 copyTo
    const format = audioData.format || "f32-planar"; // 假设 float 32 planar

    // 创建 AudioBuffer
    const buffer = audioContext.createBuffer(
      audioData.numberOfChannels,
      audioData.numberOfFrames,
      audioData.sampleRate
    );

    // 填充数据
    for (let channel = 0; channel < audioData.numberOfChannels; channel++) {
      const destination = buffer.getChannelData(channel);
      audioData.copyTo(destination, { planeIndex: channel, format });
    }

    // 创建源节点
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioGainNode);

    // 计算播放时间
    // timestamp 是微秒，需要转为秒
    const playTime = startTime + audioData.timestamp / 1e6;

    // 如果播放时间已经过了，就立刻播放（防止卡顿累积）
    const scheduleTime = Math.max(audioContext.currentTime, playTime);
    source.start(scheduleTime);

    audioData.close();
  }

  function renderLoop() {
    if (!isPlaying.value) return;

    const now = audioContext.currentTime;
    // 计算当前视频应该播放到的时间点 (秒)
    const videoTime = now - startTime;
    currentTime.value = videoTime;

    // 检测播放结束
    if (duration.value > 0 && videoTime >= duration.value) {
      isEnded.value = true;
      pause();
      return;
    }

    // 渲染匹配的帧
    // 我们需要找到 timestamp <= videoTime * 1e6 的最新一帧
    // 并丢弃旧帧

    let frameToRender = null;

    while (videoQueue.length > 0) {
      const frame = videoQueue[0];
      const frameTime = frame.timestamp / 1e6;

      if (frameTime <= videoTime) {
        // 这一帧该播放了（或者是过期的）
        if (frameToRender) frameToRender.close(); // 丢弃上一帧
        frameToRender = videoQueue.shift();
      } else {
        // 这一帧还没到时间
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
    const ctx = canvasRef.value.getContext("2d");

    // 调整 canvas 尺寸匹配视频
    if (
      canvasRef.value.width !== frame.displayWidth ||
      canvasRef.value.height !== frame.displayHeight
    ) {
      canvasRef.value.width = frame.displayWidth;
      canvasRef.value.height = frame.displayHeight;
    }

    ctx.drawImage(frame, 0, 0);
  }

  function load(url) {
    isLoading.value = true;
    isReady = false;
    // 重置队列
    videoQueue.forEach(f => f.close());
    videoQueue.length = 0;
    
    // 通知 Worker 开始
    worker.postMessage({ type: 'fetch', url });
  }

  function seek(time) {
    if (!worker) return;
    
    // 暂停播放，清理队列
    videoQueue.forEach(f => f.close());
    videoQueue.length = 0;
    isReady = false;
    isLoading.value = true;
    
    // 调整时间
    // 假设 audioContext 正在运行，我们需要重新对齐 startTime
    // 新的 startTime = now - seekTime
    const now = audioContext.currentTime;
    startTime = now - time;
    currentTime.value = time;
    
    worker.postMessage({ type: 'seek', time: time });
  }
  
  async function play() {
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    if (!isPlaying.value) {
      isPlaying.value = true;
      // 重新校准 startTime
      // 如果是从暂停恢复，startTime 需要减去已经播放的时长
      // 这里简化处理：假设 currentTime 是准确的
      startTime = audioContext.currentTime - currentTime.value;
      renderLoop();
    }
  }

  function pause() {
    isPlaying.value = false;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    audioContext.suspend();
  }

  onUnmounted(() => {
    if (worker) {
      worker.postMessage({ type: "close" });
      worker.terminate();
    }
    if (audioContext) audioContext.close();
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
  };
}
