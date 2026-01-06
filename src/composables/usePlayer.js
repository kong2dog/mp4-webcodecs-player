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
  let audioContext = null;
  let audioGainNode = null;

  // 队列与缓冲
  const videoQueue = []; // stored as { frame, timestamp }
  const audioQueue = [];

  // 时间同步状态
  // 为了支持倍速，我们需要更复杂的模型：
  // videoTime = baseVideoTime + (audioContext.currentTime - baseAudioTime) * rate
  let baseVideoTime = 0;
  let baseAudioTime = 0;

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

  // ... handleWorkerMessage ...

  function scheduleAudio(audioData) {
    // ...
    const source = audioContext.createBufferSource();
    source.buffer = buffer;

    // 设置倍速
    source.playbackRate.value = playbackRate.value;

    source.connect(audioGainNode);

    // 计算播放时间
    // 这里非常棘手：audioData.timestamp 是原始视频时间。
    // 我们需要将其映射到 audioContext 的时间轴上。
    // 映射公式：audioTime = baseAudioTime + (frameTime - baseVideoTime) / rate

    const frameTime = audioData.timestamp / 1e6;
    const playTime =
      baseAudioTime + (frameTime - baseVideoTime) / playbackRate.value;

    const scheduleTime = Math.max(audioContext.currentTime, playTime);
    source.start(scheduleTime);

    // 我们需要保持对 source 的引用以便在倍速改变时能够停止它们？
    // 或者我们接受一个限制：改变倍速时，会有一点点音频延迟/重叠，或者我们需要清除 audioContext 的计划任务。
    // 简单起见，改变倍速时，我们暂时不做复杂的音频重排，而是依赖短的音频片段或接受短暂的不完美。
    // 但实际上 audioData 可能是一小段。如果 rate 变了，后续的 audioData 会用新 rate 调度。
    // 正在播放的 source 可以通过 source.playbackRate.value 实时改变！
    // 所以我们需要把 active sources 存起来。

    source.onended = () => {
      const idx = activeAudioSources.indexOf(source);
      if (idx > -1) activeAudioSources.splice(idx, 1);
    };
    activeAudioSources.push(source);

    audioData.close();
  }

  const activeAudioSources = [];

  function setPlaybackRate(rate) {
    if (rate === playbackRate.value) return;

    // 1. 更新当前的时间基准
    // 在改变速率的瞬间，videoTime 是确定的
    const now = audioContext.currentTime;
    const currentVideoTime =
      baseVideoTime + (now - baseAudioTime) * playbackRate.value;

    // 2. 更新状态
    playbackRate.value = rate;
    baseVideoTime = currentVideoTime;
    baseAudioTime = now;

    // 3. 更新所有正在播放的音频源的速率
    activeAudioSources.forEach((source) => {
      try {
        source.playbackRate.value = rate;
      } catch (e) {
        /* ignore */
      }
    });

    // 注意：改变 playbackRate 会导致后续音频调度的 playTime 计算变化
    // 但由于我们是基于 baseAudioTime + ... 计算的，只要 baseAudioTime 更新了，后续调度应该也是对的。
    // 但是，已经调度但还没播放的音频呢？
    // 它们的 start time 是基于旧 rate 计算的。
    // 如果 rate 变了，它们的实际播放时长变了，但 start time 没变... 这会导致重叠或空隙。
    // 完美的做法是：cancel 所有未播放的 audio，重新调度。但我们没有 raw audio data 了。
    // 妥协做法：对于 WebCodecs 这种流式解码，audio chunks 很小。
    // 我们可以 stop 所有 source，清空 audioQueue (如果有)，或者容忍。
    // 更好的做法可能是：seek 到当前时间，重新缓冲。
    // 但为了平滑，我们尝试直接更新 rate。对于已经 schedule 的 source，如果它们还没开始，
    // 我们其实没法简单调整 start time。
    // 鉴于复杂性，最稳健的方法可能是：记录下当前 videoTime，执行一次内部的 "seek(videoTime)" 逻辑但不清空 worker，
    // 或者就让它们播放完。
    // 这里我们先只更新 source.playbackRate.value，看看效果。
  }

  function renderLoop() {
    if (!isPlaying.value) return;

    const now = audioContext.currentTime;

    // 核心公式
    const videoTime =
      baseVideoTime + (now - baseAudioTime) * playbackRate.value;

    currentTime.value = videoTime;

    // ... rest same ...
    if (duration.value > 0 && videoTime >= duration.value) {
      // ...
    }

    // ... frame matching ...
    // timestamp <= videoTime
    // ...
    let frameToRender = null;
    while (videoQueue.length > 0) {
      const frame = videoQueue[0];
      const frameTime = frame.timestamp / 1e6;

      // 容差控制：如果 frameTime 稍微大于 videoTime，但也快到了，是否渲染？
      // 标准做法：渲染 <= videoTime 的最新帧。
      if (frameTime <= videoTime) {
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

  function setVolume(val) {
    volume.value = val;
    if (audioGainNode) {
      audioGainNode.gain.value = isMuted.value ? 0 : val;
    }
  }

  function toggleMute() {
    isMuted.value = !isMuted.value;
    if (audioGainNode) {
      audioGainNode.gain.value = isMuted.value ? 0 : volume.value;
    }
  }

  // ... load same ...

  function seek(time) {
    // ...
    // 更新基准
    const now = audioContext.currentTime;
    baseVideoTime = time;
    baseAudioTime = now;
    currentTime.value = time;

    // ...
  }

  async function play() {
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    if (!isPlaying.value) {
      isPlaying.value = true;

      // 恢复播放：以当前 currentTime 为起点
      const now = audioContext.currentTime;
      baseAudioTime = now;
      baseVideoTime = currentTime.value;

      renderLoop();
    }
  }

  function handleWorkerMessage(e) {
    const { type, frame, data, info } = e.data;

    if (type === "ready") {
      duration.value = info.duration;
      // 重置结束状态
      isEnded.value = false;
      // Ready means we have info, but maybe not frames yet.
      // We wait for some frames to be buffered before setting isReady = true?
      // No, let's keep isReady logic below.
    } else if (type === "videoFrame") {
      videoQueue.push(frame);
      // 简单的缓冲策略：如果还没开始播放且缓冲了一些帧，可以准备就绪
      // 优化：只需 1 帧即可显示首帧 (Pre-render)
      if (!isReady && videoQueue.length > 0) {
        isReady = true;
        isLoading.value = false;
        // 渲染首帧（即使不播放）
        const firstFrame = videoQueue[0];
        drawFrame(firstFrame);
        // 不 shift，保留给播放用？或者 clone？
        // VideoFrame clone is cheap? No.
        // 我们只是画一下，不 close。
        // 但是 renderLoop 会 shift。
        // 如果我们在这里画了，renderLoop 启动时会再次画（或者 shift 掉）。
        // 关键是：用户能看到图。
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

    // 设置倍速
    source.playbackRate.value = playbackRate.value;

    source.connect(audioGainNode);

    // 计算播放时间
    // 这里非常棘手：audioData.timestamp 是原始视频时间。
    // 我们需要将其映射到 audioContext 的时间轴上。
    // 映射公式：audioTime = baseAudioTime + (frameTime - baseVideoTime) / rate

    const frameTime = audioData.timestamp / 1e6;

    // 修正：如果 baseAudioTime 还没设置（比如刚开始播放），初始化它
    if (baseAudioTime === 0 && baseVideoTime === 0 && currentTime.value === 0) {
      baseAudioTime = audioContext.currentTime;
      baseVideoTime = frameTime;
      // 同时更新 currentTime 以便视频同步
      currentTime.value = frameTime;
    }

    const playTime =
      baseAudioTime + (frameTime - baseVideoTime) / playbackRate.value;

    const scheduleTime = Math.max(audioContext.currentTime, playTime);
    source.start(scheduleTime);

    source.onended = () => {
      const idx = activeAudioSources.indexOf(source);
      if (idx > -1) activeAudioSources.splice(idx, 1);
    };
    activeAudioSources.push(source);

    audioData.close();
  }

  function renderLoop() {
    if (!isPlaying.value) return;

    const now = audioContext.currentTime;
    // 计算当前视频应该播放到的时间点 (秒)
    // 核心公式
    const videoTime =
      baseVideoTime + (now - baseAudioTime) * playbackRate.value;

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
    videoQueue.forEach((f) => f.close());
    videoQueue.length = 0;

    // 通知 Worker 开始
    worker.postMessage({ type: "fetch", url });
  }

  function seek(time) {
    if (!worker) return;

    // 暂停播放，清理队列
    videoQueue.forEach((f) => f.close());
    videoQueue.length = 0;
    isReady = false;
    isLoading.value = true;

    // 调整时间
    // 更新基准
    const now = audioContext.currentTime;
    baseVideoTime = time;
    baseAudioTime = now;
    currentTime.value = time;

    worker.postMessage({ type: "seek", time: time });
  }

  async function play() {
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    if (!isPlaying.value) {
      isPlaying.value = true;

      // 恢复播放：以当前 currentTime 为起点
      const now = audioContext.currentTime;
      baseAudioTime = now;
      baseVideoTime = currentTime.value;

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
    volume,
    isMuted,
    playbackRate,
    setVolume,
    toggleMute,
    setPlaybackRate,
  };
}
