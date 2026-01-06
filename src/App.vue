<template>
  <div
    class="relative w-screen h-screen bg-black overflow-hidden font-sans select-none"
  >
    <!-- Players Layer -->
    <div class="absolute inset-0 z-0">
      <!-- Player 0 -->
      <div
        class="absolute inset-0 transition-opacity duration-300"
        :class="{
          'opacity-100 z-10': activePlayerIndex === 0,
          'opacity-0 z-0': activePlayerIndex !== 0,
        }"
      >
        <SinglePlayer
          ref="player0"
          :src="playerSources[0]"
          :active="activePlayerIndex === 0 && hasInteracted"
          @ended="handleVideoEnded(0)"
        />
      </div>

      <!-- Player 1 -->
      <div
        class="absolute inset-0 transition-opacity duration-300"
        :class="{
          'opacity-100 z-10': activePlayerIndex === 1,
          'opacity-0 z-0': activePlayerIndex !== 1,
        }"
      >
        <SinglePlayer
          ref="player1"
          :src="playerSources[1]"
          :active="activePlayerIndex === 1 && hasInteracted"
          @ended="handleVideoEnded(1)"
        />
      </div>
    </div>

    <!-- UI Overlay Layer -->
    <div
      class="absolute inset-0 z-20 pointer-events-none flex flex-col justify-between p-6 bg-gradient-to-b from-black/50 via-transparent to-black/80"
    >
      <!-- Header -->
      <div class="flex justify-between items-start pointer-events-auto">
        <div>
          <h1 class="text-2xl font-bold text-white tracking-tight">
            <i class="fas fa-film text-blue-500 mr-2"></i>WebCodecs Player
          </h1>
          <p class="text-white/60 text-sm mt-1">高性能 MP4 无缝播放器</p>
        </div>
        <div
          class="bg-white/10 backdrop-blur-md px-4 py-2 rounded-full text-xs font-mono text-white/80"
        >
          CPU Usage: Worker Safe
        </div>
      </div>

      <!-- Controls -->
      <div class="pointer-events-auto space-y-4">
        <!-- Progress Bar -->
        <div
          ref="progressBarRef"
          class="h-1 bg-white/20 rounded-full cursor-pointer group hover:h-2 transition-all"
          @mousedown="startDrag"
        >
          <div
            class="h-full bg-blue-500 relative"
            :style="{ width: `${(globalCurrentTime / totalDuration) * 100}%` }"
          >
            <div
              class="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg transform scale-0 group-hover:scale-100 transition-transform"
            ></div>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-6">
            <button
              @click="togglePlay"
              class="text-white hover:text-blue-400 transition-colors text-2xl w-8 h-8 flex items-center justify-center"
            >
              <i :class="isPlaying ? 'fas fa-pause' : 'fas fa-play'"></i>
            </button>
            <button class="text-white/70 hover:text-white transition-colors">
              <i class="fas fa-backward-step"></i>
            </button>
            <button class="text-white/70 hover:text-white transition-colors">
              <i class="fas fa-forward-step"></i>
            </button>

            <div class="text-xs font-mono text-white/60">
              <span class="text-white">{{
                formatTime(globalCurrentTime)
              }}</span>
              / {{ formatTime(totalDuration) }}
            </div>
          </div>

          <div class="flex items-center space-x-4">
            <div
              class="text-xs text-white/50 px-2 py-1 border border-white/10 rounded"
            >
              Queue: {{ playlist.length }} | Next: {{ nextVideoTitle }}
            </div>
            <button class="text-white/70 hover:text-white transition-colors">
              <i class="fas fa-volume-high"></i>
            </button>
            <button class="text-white/70 hover:text-white transition-colors">
              <i class="fas fa-expand"></i>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Playlist Overlay (Optional, simplified) -->
    <div
      class="absolute top-20 right-6 w-64 bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl p-4 pointer-events-auto transform transition-transform translate-x-full hover:translate-x-0 opacity-0 hover:opacity-100 duration-300"
    >
      <h3
        class="text-white font-bold mb-3 text-sm border-b border-white/10 pb-2"
      >
        播放列表
      </h3>
      <ul class="space-y-2">
        <li
          v-for="(url, index) in playlist"
          :key="index"
          class="text-xs p-2 rounded cursor-pointer transition-colors truncate"
          :class="
            index === currentPlaylistIndex
              ? 'bg-blue-600 text-white'
              : 'text-white/60 hover:bg-white/10'
          "
          @click="jumpTo(index)"
        >
          Video {{ index + 1 }}
        </li>
      </ul>
    </div>
    <!-- Start Overlay -->
    <div
      v-if="!hasInteracted"
      class="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm cursor-pointer"
      @click="startExperience"
    >
      <div class="text-center">
        <div
          class="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse shadow-lg shadow-blue-500/50"
        >
          <i class="fas fa-play text-3xl text-white ml-1"></i>
        </div>
        <h2 class="text-3xl font-bold text-white mb-2">进入沉浸式体验</h2>
        <p class="text-white/50">点击任意位置开始播放</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from "vue";
import SinglePlayer from "./components/SinglePlayer.vue";
import MP4Box from "mp4box";

const hasInteracted = ref(false);

const playlist = ["/4.mp4", "/2.mp4", "/3.mp4"];

// 状态
const currentPlaylistIndex = ref(0);
const activePlayerIndex = ref(0); // 0 or 1
const isPlaying = ref(true);

// 元数据
const videoDurations = ref(playlist.map(() => 0)); // 每个视频的时长
const totalDuration = computed(() =>
  videoDurations.value.reduce((a, b) => a + b, 0)
);

// 播放进度
const globalCurrentTime = ref(0);
const progressBarRef = ref(null);
const isDragging = ref(false);

// 两个播放器对应的源
const playerSources = ref([playlist[0], playlist[1]]);

const player0 = ref(null);
const player1 = ref(null);

const activePlayerRef = computed(() =>
  activePlayerIndex.value === 0 ? player0.value : player1.value
);

// 更新全局时间循环
let timeUpdateInterval = null;

// 获取视频时长
async function fetchDurations() {
  for (let i = 0; i < playlist.length; i++) {
    const url = playlist[i];
    try {
      // Fetch 头部
      // 对于本地文件，Vite 开发服务器支持 Range 请求，但可能不稳定
      // 我们先尝试下载前 1MB，通常足够包含 moov
      const response = await fetch(url, {
        headers: { Range: "bytes=0-1000000" },
      });
      const buffer = await response.arrayBuffer();
      buffer.fileStart = 0;

      const mp4box = MP4Box.createFile();

      await new Promise((resolve) => {
        mp4box.onReady = (info) => {
          videoDurations.value[i] = info.duration / info.timescale;
          resolve();
        };
        mp4box.onError = (e) => {
          console.error("MP4Box Error", e);
          resolve();
        };
        mp4box.appendBuffer(buffer);
        mp4box.flush();
      });
    } catch (e) {
      console.error(`Failed to fetch duration for ${url}`, e);
      // Fallback: 默认 60s
      if (videoDurations.value[i] === 0) videoDurations.value[i] = 60;
    }
  }
}

function updateGlobalTime() {
  if (isDragging.value || !activePlayerRef.value) return;

  // 计算当前视频之前的总时长
  let previousDuration = 0;
  for (let i = 0; i < currentPlaylistIndex.value; i++) {
    previousDuration += videoDurations.value[i];
  }

  // 当前播放器的本地时间
  const localTime = activePlayerRef.value.currentTime;
  globalCurrentTime.value = previousDuration + localTime;
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// 进度条交互
function handleSeek(e) {
  if (!progressBarRef.value || totalDuration.value === 0) return;
  const rect = progressBarRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const percentage = Math.max(0, Math.min(1, x / rect.width));
  const targetGlobalTime = percentage * totalDuration.value;

  // 仅更新 UI，松手时才真正 Seek，或者实时 Seek？
  // 实时 Seek 体验更好，但要注意性能。这里我们实时更新 globalCurrentTime 显示
  // 并在 onDrag/startDrag 中调用 performGlobalSeek

  performGlobalSeek(targetGlobalTime);
}

function startDrag(e) {
  isDragging.value = true;
  handleSeek(e);
  window.addEventListener("mousemove", onDrag);
  window.addEventListener("mouseup", stopDrag);
}

function onDrag(e) {
  if (isDragging.value) {
    // 拖拽时只更新 UI，不频繁触发 Seek (可选优化)
    // 或者节流触发 Seek
    handleSeek(e);
  }
}

function stopDrag() {
  isDragging.value = false;
  window.removeEventListener("mousemove", onDrag);
  window.removeEventListener("mouseup", stopDrag);
}

async function performGlobalSeek(targetTime) {
  globalCurrentTime.value = targetTime;

  // 1. 找到目标视频 index
  let accumulated = 0;
  let targetIndex = 0;
  let localSeekTime = 0;

  for (let i = 0; i < videoDurations.value.length; i++) {
    const dur = videoDurations.value[i];
    if (targetTime < accumulated + dur) {
      targetIndex = i;
      localSeekTime = targetTime - accumulated;
      break;
    }
    accumulated += dur;
  }

  // 如果超出范围，定位到最后一个视频末尾
  if (targetTime >= totalDuration.value) {
    targetIndex = videoDurations.value.length - 1;
    localSeekTime = videoDurations.value[targetIndex];
  }

  console.log(
    `Global Seek: ${targetTime.toFixed(
      2
    )}s -> Video ${targetIndex} @ ${localSeekTime.toFixed(2)}s`
  );

  // 2. 判断是否需要切换视频
  if (targetIndex !== currentPlaylistIndex.value) {
    currentPlaylistIndex.value = targetIndex;

    // 切换播放器逻辑
    // 重置当前播放器，准备加载新视频
    // 这里我们为了简化 Seek 逻辑，始终使用 activePlayerIndex (或切换它)
    // 策略：重置 activePlayerIndex 的源为目标视频，并 seek

    playerSources.value[activePlayerIndex.value] = playlist[targetIndex];

    // 预加载下一个
    const nextIdx = (targetIndex + 1) % playlist.length;
    const otherPlayerIndex = activePlayerIndex.value === 0 ? 1 : 0;
    playerSources.value[otherPlayerIndex] = playlist[nextIdx];

    // 等待加载完成并 seek (需要一点延迟或者监听 ready)
    // 这里我们只能乐观地调用 load 然后 seek
    // 注意：load 是异步的（在 worker 里），seek 也是。
    // 我们在 SinglePlayer 里暴露 load 和 seek。

    // 由于 SinglePlayer 监听到 src 变化会自动 load。
    // 我们需要等待 load 触发 fetch 后再 seek。
    // 简单 hack: setTimeout
    setTimeout(() => {
      if (activePlayerRef.value) {
        activePlayerRef.value.seek(localSeekTime);
        if (isPlaying.value) activePlayerRef.value.play();
      }
    }, 100);
  } else {
    // 同一个视频，直接 seek
    if (activePlayerRef.value) {
      activePlayerRef.value.seek(localSeekTime);
    }
  }
}

const nextVideoTitle = computed(() => {
  const nextIdx = (currentPlaylistIndex.value + 1) % playlist.length;
  return `Video ${nextIdx + 1}`;
});

function startExperience() {
  hasInteracted.value = true;
  fetchDurations(); // 开始获取时长
  timeUpdateInterval = setInterval(updateGlobalTime, 100);
}

function togglePlay() {
  isPlaying.value = !isPlaying.value;
  // 控制当前活跃的播放器
  if (activePlayerIndex.value === 0 && player0.value) {
    isPlaying.value ? player0.value.play() : player0.value.pause();
  } else if (activePlayerIndex.value === 1 && player1.value) {
    isPlaying.value ? player1.value.play() : player1.value.pause();
  }
}

function handleVideoEnded(playerIndex) {
  if (playerIndex !== activePlayerIndex.value) return; // 忽略后台播放器的结束事件

  console.log(`Player ${playerIndex} ended. Switching...`);

  // 1. 切换到下一个视频
  const nextPlaylistIndex = (currentPlaylistIndex.value + 1) % playlist.length;
  currentPlaylistIndex.value = nextPlaylistIndex;

  // 2. 切换活跃播放器
  const nextActivePlayer = activePlayerIndex.value === 0 ? 1 : 0;
  activePlayerIndex.value = nextActivePlayer;

  // 3. 为刚刚结束的那个播放器加载下下个视频（预加载）
  const preloadIndex = (nextPlaylistIndex + 1) % playlist.length;
  playerSources.value[playerIndex] = playlist[preloadIndex];

  // 4. 确保新的活跃播放器开始播放
  // (SinglePlayer 的 active prop watch 会处理，但为了保险)
  /*
  if (nextActivePlayer === 0 && player0.value) player0.value.play();
  if (nextActivePlayer === 1 && player1.value) player1.value.play();
  */
}

function jumpTo(index) {
  // 简单实现：强制重置
  currentPlaylistIndex.value = index;
  activePlayerIndex.value = 0;
  playerSources.value[0] = playlist[index];
  playerSources.value[1] = playlist[(index + 1) % playlist.length];
}

onMounted(() => {
  // Auto play handled by active prop
});
</script>
