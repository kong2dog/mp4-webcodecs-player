<template>
  <div
    class="relative w-full h-full bg-black flex items-center justify-center overflow-hidden"
  >
    <canvas ref="canvasRef" class="w-full h-full object-contain"></canvas>

    <!-- Loading Spinner -->
    <div
      v-if="isLoading"
      class="absolute inset-0 flex items-center justify-center bg-black/50 z-10"
    >
      <div
        class="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"
      ></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from "vue";
import { usePlayer } from "../composables/usePlayer";

const props = defineProps({
  src: String,
  active: Boolean,
});

const emit = defineEmits(["ended", "ready"]);

const canvasRef = ref(null);
// 使用 usePlayer 组合式函数管理播放器逻辑
const {
  init,
  load,
  seek,
  play,
  pause,
  isPlaying,
  isLoading,
  currentTime,
  isEnded,
  volume,
  isMuted,
  playbackRate,
  setVolume,
  toggleMute,
  setPlaybackRate,
} = usePlayer(canvasRef);

// 监听播放结束事件
watch(isEnded, (val) => {
  if (val) {
    emit("ended");
  }
});

onMounted(async () => {
  await init();
  if (props.src) {
    load(props.src);
  }
  emit("ready");
});

// 待处理的 Seek 操作，用于跨视频切换时的平滑过渡
const pendingSeekTime = ref(-1);
const pendingAutoPlay = ref(false);

/**
 * 设置待处理的 Seek 时间和自动播放意图
 * 当 src 变化触发 load 时，会使用这些参数
 */
function setPendingSeek(t, autoPlay = false) {
  pendingSeekTime.value = t;
  pendingAutoPlay.value = autoPlay;
}

// 监听源变化，自动加载新视频
watch(
  () => props.src,
  (newSrc) => {
    if (newSrc) {
      load(newSrc, pendingSeekTime.value, pendingAutoPlay.value);
      pendingSeekTime.value = -1; // Reset
      pendingAutoPlay.value = false;
    }
  }
);

// 监听激活状态，控制播放/暂停
watch(
  () => props.active,
  (isActive) => {
    if (isActive) {
      play();
    } else {
      // 当变为非活跃状态时暂停，节省资源
      pause();
    }
  }
);

defineExpose({
  play,
  pause,
  seek,
  load,
  setVolume,
  toggleMute,
  setPlaybackRate,
  setPendingSeek,
  volume,
  isMuted,
  playbackRate,
  currentTime,
});
</script>
