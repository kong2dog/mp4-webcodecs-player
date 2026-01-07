<template>
  <div
    ref="appContainer"
    class="relative w-screen h-screen bg-black overflow-hidden font-sans select-none"
    @mousemove="handleMouseMove"
    @mouseleave="showControls = false"
  >
    <!-- 播放器层：使用双播放器缓冲技术实现无缝切换 -->
    <div class="absolute inset-0 z-0">
      <!-- 播放器 0 -->
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

      <!-- 播放器 1 -->
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

    <!-- UI 覆盖层 -->
    <div
      class="absolute inset-0 z-20 pointer-events-none flex flex-col justify-between"
    >
      <!-- 顶部标题栏 -->
      <div
        class="p-6 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-500"
        :class="{ 'opacity-0': !showControls, 'opacity-100': showControls }"
      >
        <div class="flex justify-between items-start pointer-events-auto"></div>
      </div>

      <!-- 底部控制栏 -->
      <div
        class="p-6 bg-gradient-to-t from-black/80 to-transparent transition-opacity duration-500"
        :class="{ 'opacity-0': !showControls, 'opacity-100': showControls }"
      >
        <div class="pointer-events-auto space-y-4">
          <!-- 进度条 -->
          <div
            ref="progressBarRef"
            class="h-1 bg-white/20 rounded-full cursor-pointer group hover:h-2 transition-all"
            @mousedown="startDrag"
          >
            <div
              class="h-full bg-blue-500 relative"
              :style="{
                width: `${(globalCurrentTime / totalDuration) * 100}%`,
              }"
            >
              <div
                class="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg transform scale-0 group-hover:scale-100 transition-transform"
              ></div>
            </div>
          </div>

          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-6">
              <!-- 播放/暂停 -->
              <button
                @click="togglePlay"
                class="text-white hover:text-blue-400 transition-colors text-2xl w-8 h-8 flex items-center justify-center"
              >
                <i :class="isPlaying ? 'fas fa-pause' : 'fas fa-play'"></i>
              </button>

              <!-- 切换按钮（占位） -->
              <button class="text-white/70 hover:text-white transition-colors">
                <i class="fas fa-backward-step"></i>
              </button>
              <button class="text-white/70 hover:text-white transition-colors">
                <i class="fas fa-forward-step"></i>
              </button>

              <!-- 时间显示 -->
              <div class="text-xs font-mono text-white/60">
                <span class="text-white">{{
                  formatTime(globalCurrentTime)
                }}</span>
                / {{ formatTime(totalDuration) }}
              </div>
            </div>

            <div class="flex items-center space-x-4">
              <!-- 倍速控制 -->
              <div class="relative">
                <button
                  @click="showSpeedMenu = !showSpeedMenu"
                  class="text-white/70 hover:text-white transition-colors text-sm font-mono w-12 text-center"
                >
                  {{ playbackRate }}x
                </button>
                <div
                  v-if="showSpeedMenu"
                  class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-black/90 rounded-lg p-1 flex flex-col gap-1 min-w-[60px]"
                >
                  <button
                    v-for="rate in [0.5, 1.0, 1.5, 2.0]"
                    :key="rate"
                    @click="
                      playbackRate = rate;
                      showSpeedMenu = false;
                    "
                    class="px-2 py-1 text-xs hover:bg-white/20 rounded"
                    :class="
                      playbackRate === rate
                        ? 'text-blue-400 font-bold'
                        : 'text-white/70'
                    "
                  >
                    {{ rate }}x
                  </button>
                </div>
              </div>

              <!-- 音量控制 -->
              <div class="flex items-center space-x-2 group">
                <button
                  @click="isMuted = !isMuted"
                  class="text-white/70 hover:text-white transition-colors w-6"
                >
                  <i
                    class="fas"
                    :class="
                      isMuted || globalVolume === 0
                        ? 'fa-volume-mute'
                        : 'fa-volume-high'
                    "
                  ></i>
                </button>
                <div
                  class="w-0 overflow-hidden group-hover:w-20 transition-all duration-300"
                >
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    v-model.number="globalVolume"
                    class="w-20 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                </div>
              </div>

              <!-- 队列状态 -->
              <div
                class="text-xs text-white/50 px-2 py-1 border border-white/10 rounded"
              >
                Queue: {{ playlist.length }} | Next: {{ nextVideoTitle }}
              </div>

              <!-- 全屏控制 -->
              <button
                @click="toggleFullscreen"
                class="text-white/70 hover:text-white transition-colors"
              >
                <i
                  class="fas"
                  :class="isFullscreen ? 'fa-compress' : 'fa-expand'"
                ></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 播放列表侧边栏 -->
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
            v-for="(item, index) in playlist"
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

      <!-- 初始交互遮罩层 (解决浏览器自动播放限制) -->
      <div
        v-if="!hasInteracted"
        class="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm cursor-pointer pointer-events-auto"
        @click="startExperience"
      >
        <div class="text-center">
          <div
            class="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse shadow-lg shadow-blue-500/50"
          >
            <i class="fas fa-play text-3xl text-white ml-1"></i>
          </div>
          <p class="text-white/50">点击任意位置开始播放</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from "vue";
import SinglePlayer from "./components/SinglePlayer.vue";

// 用户是否已经进行了首次交互
const hasInteracted = ref(false);

/**
 * 播放列表配置
 * url: 视频地址
 * duration: 视频时长（秒）
 */
const playlist = [
  { url: "/1.mp4", duration: 300 },
  { url: "/2.mp4", duration: 300 },
  { url: "/3.mp4", duration: 300 },
];

// 播放器状态管理
const currentPlaylistIndex = ref(0);
const activePlayerIndex = ref(0); // 当前活跃的播放器索引 (0 或 1)
const isPlaying = ref(true);

// 元数据计算
const totalDuration = computed(() =>
  playlist.reduce((acc, item) => acc + item.duration, 0)
);

// 全局播放进度 (所有视频累加)
const globalCurrentTime = ref(0);
const progressBarRef = ref(null);
const isDragging = ref(false);

// 音量与倍速控制
const globalVolume = ref(1.0);
const isMuted = ref(false);
const playbackRate = ref(1.0);
const showSpeedMenu = ref(false);
const isFullscreen = ref(false);
const appContainer = ref(null);
const showControls = ref(true);
let controlsTimeout = null;

// 两个播放器分别加载的源（用于实现预加载和无缝切换）
const playerSources = ref([playlist[0].url, playlist[1].url]);

const player0 = ref(null);
const player1 = ref(null);

// 获取当前活跃播放器的引用
const activePlayerRef = computed(() =>
  activePlayerIndex.value === 0 ? player0.value : player1.value
);

// 监听全局音量和静音状态，同步到所有播放器
watch([globalVolume, isMuted], () => {
  if (player0.value) {
    player0.value.setVolume(globalVolume.value);
    if (isMuted.value !== player0.value.isMuted) player0.value.toggleMute();
  }
  if (player1.value) {
    player1.value.setVolume(globalVolume.value);
    if (isMuted.value !== player1.value.isMuted) player1.value.toggleMute();
  }
});

// 监听倍速变化，同步到所有播放器
watch(playbackRate, (val) => {
  if (player0.value) player0.value.setPlaybackRate(val);
  if (player1.value) player1.value.setPlaybackRate(val);
});

// 定时更新全局播放时间的计时器
let timeUpdateInterval = null;

/**
 * 更新全局播放时间
 * 根据当前活跃播放器的本地时间 + 之前视频的总时长计算
 */
function updateGlobalTime() {
  if (isDragging.value || !activePlayerRef.value) return;

  let previousDuration = 0;
  for (let i = 0; i < currentPlaylistIndex.value; i++) {
    previousDuration += playlist[i].duration;
  }

  const localTime = activePlayerRef.value.currentTime;
  globalCurrentTime.value = previousDuration + localTime;
}

/**
 * 格式化秒数为 MM:SS 格式
 */
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * 进度条点击/拖拽处理
 */
function handleSeek(e) {
  if (!progressBarRef.value || totalDuration.value === 0) return;
  const rect = progressBarRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const percentage = Math.max(0, Math.min(1, x / rect.width));
  const targetGlobalTime = percentage * totalDuration.value;

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
    handleSeek(e);
  }
}

function stopDrag() {
  isDragging.value = false;
  window.removeEventListener("mousemove", onDrag);
  window.removeEventListener("mouseup", stopDrag);
}

/**
 * 执行全局跳转 (跨视频 Seek)
 * @param {number} targetTime - 目标全局时间
 */
async function performGlobalSeek(targetTime) {
  globalCurrentTime.value = targetTime;

  // 1. 寻找目标视频及其内部偏移时间
  let accumulated = 0;
  let targetIndex = 0;
  let localSeekTime = 0;

  for (let i = 0; i < playlist.length; i++) {
    const dur = playlist[i].duration;
    if (targetTime < accumulated + dur) {
      targetIndex = i;
      localSeekTime = targetTime - accumulated;
      break;
    }
    accumulated += dur;
  }

  // 越界处理
  if (targetTime >= totalDuration.value) {
    targetIndex = playlist.length - 1;
    localSeekTime = playlist[targetIndex].duration;
  }

  // 2. 判断是否需要切换当前视频源
  if (targetIndex !== currentPlaylistIndex.value) {
    currentPlaylistIndex.value = targetIndex;

    // 跨视频切换逻辑
    if (activePlayerRef.value) {
      activePlayerRef.value.setPendingSeek(localSeekTime, isPlaying.value);
    }

    playerSources.value[activePlayerIndex.value] = playlist[targetIndex].url;

    // 更新预加载视频
    const nextIdx = (targetIndex + 1) % playlist.length;
    const otherPlayerIndex = activePlayerIndex.value === 0 ? 1 : 0;
    playerSources.value[otherPlayerIndex] = playlist[nextIdx].url;
  } else {
    // 同视频内跳转
    if (activePlayerRef.value) {
      activePlayerRef.value.seek(localSeekTime);
    }
  }
}

/**
 * 切换全屏状态
 */
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    appContainer.value.requestFullscreen().catch((err) => {
      console.error(`Error attempting to enable fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
}

onMounted(() => {
  document.addEventListener("fullscreenchange", () => {
    isFullscreen.value = !!document.fullscreenElement;
  });
});

const nextVideoTitle = computed(() => {
  const nextIdx = (currentPlaylistIndex.value + 1) % playlist.length;
  return `Video ${nextIdx + 1}`;
});

/**
 * 启动播放体验 (用户交互后)
 */
function startExperience() {
  hasInteracted.value = true;
  timeUpdateInterval = setInterval(updateGlobalTime, 100);
  resetControlsTimeout();
}

/**
 * 鼠标移动处理：显示控制栏并重置自动隐藏计时器
 */
function handleMouseMove() {
  showControls.value = true;
  resetControlsTimeout();
}

/**
 * 自动隐藏控制栏逻辑
 */
function resetControlsTimeout() {
  if (controlsTimeout) clearTimeout(controlsTimeout);
  if (isPlaying.value) {
    controlsTimeout = setTimeout(() => {
      showControls.value = false;
    }, 3000);
  }
}

watch(isPlaying, (val) => {
  if (!val) {
    showControls.value = true;
    if (controlsTimeout) clearTimeout(controlsTimeout);
  } else {
    resetControlsTimeout();
  }
});

/**
 * 切换播放/暂停
 */
function togglePlay() {
  isPlaying.value = !isPlaying.value;
  if (activePlayerIndex.value === 0 && player0.value) {
    isPlaying.value ? player0.value.play() : player0.value.pause();
  } else if (activePlayerIndex.value === 1 && player1.value) {
    isPlaying.value ? player1.value.play() : player1.value.pause();
  }
}

/**
 * 处理当前视频播放结束：实现无缝切换
 */
function handleVideoEnded(playerIndex) {
  if (playerIndex !== activePlayerIndex.value) return;

  console.log(`Player ${playerIndex} ended. Switching...`);

  const nextPlaylistIndex = (currentPlaylistIndex.value + 1) % playlist.length;
  currentPlaylistIndex.value = nextPlaylistIndex;

  // 切换到另一个已经预加载好的播放器
  const nextActivePlayer = activePlayerIndex.value === 0 ? 1 : 0;
  activePlayerIndex.value = nextActivePlayer;

  // 为闲置的播放器预加载下下个视频
  const preloadIndex = (nextPlaylistIndex + 1) % playlist.length;
  playerSources.value[playerIndex] = playlist[preloadIndex].url;
}

/**
 * 跳转到播放列表中的指定视频
 */
function jumpTo(index) {
  currentPlaylistIndex.value = index;
  activePlayerIndex.value = 0;
  playerSources.value[0] = playlist[index].url;
  playerSources.value[1] = playlist[(index + 1) % playlist.length].url;
}
</script>
