<template>
  <div
    class="relative w-full h-full bg-black flex items-center justify-center overflow-hidden"
  >
    <canvas
      ref="canvasRef"
      class="max-w-full max-h-full object-contain"
    ></canvas>

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

// Sync volume and rate changes if needed, but since they are reactive from usePlayer,
// and we will control them via refs exposed to parent, we might just need to expose them.

watch(
  () => props.src,
  (newSrc) => {
    if (newSrc) {
      load(newSrc);
    }
  }
);

watch(
  () => props.active,
  (isActive) => {
    if (isActive) {
      play();
    } else {
      // 即使不活跃，我们也可能想保持暂停状态，或者在后台预加载
      // 这里如果变为非活跃，就暂停，节省资源
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
  volume,
  isMuted,
  playbackRate,
  currentTime,
});
</script>
