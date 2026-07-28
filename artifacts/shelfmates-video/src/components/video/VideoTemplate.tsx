import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene0 } from './video_scenes/Scene0';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { Scene6 } from './video_scenes/Scene6';

export const SCENE_DURATIONS: Record<string, number> = {
  hero: 4000,
  reading: 4500,
  highlights: 5000,
  comments: 4500,
  rooms: 5000,
  notifications: 4000,
  outro: 3500,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  hero: Scene0,
  reading: Scene1,
  highlights: Scene2,
  comments: Scene3,
  rooms: Scene4,
  notifications: Scene5,
  outro: Scene6,
};

const SCENE_START_SEC: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  let cumulativeMs = 0;
  for (const [key, ms] of Object.entries(SCENE_DURATIONS)) {
    out[key] = cumulativeMs / 1000;
    cumulativeMs += ms;
  }
  return out;
})();

const AUDIO_SEEK_EPSILON_SEC = 0.18;

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  muted = false,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  muted?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop });

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');
  const sceneIndex = Object.keys(SCENE_DURATIONS).indexOf(baseSceneKey);
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.45;
    const targetTime = SCENE_START_SEC[baseSceneKey] ?? 0;
    if (Math.abs(audio.currentTime - targetTime) > AUDIO_SEEK_EPSILON_SEC) {
      audio.currentTime = targetTime;
    }
    audio.play().catch(() => {});
  }, [currentSceneKey, baseSceneKey, muted]);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black">
      {/* Noise texture overlay */}
      <div className="noise-overlay" />

      {/* Background layer - persists across scenes with color transitions */}
      <motion.div
        className="absolute inset-0 -z-10"
        animate={{
          backgroundColor:
            sceneIndex === 0 || sceneIndex === 2 || sceneIndex === 4 || sceneIndex === 6
              ? '#F9F6F0'
              : '#2A2520',
        }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Persistent accent element - moves and transforms across scenes */}
      <motion.div
        className="absolute w-3 rounded-full opacity-30 pointer-events-none"
        style={{ backgroundColor: '#E8A020' }}
        animate={{
          height: sceneIndex % 2 === 0 ? '15vh' : '25vh',
          x: sceneIndex === 0 ? '5vw' : sceneIndex === 1 ? '90vw' : sceneIndex === 2 ? '10vw' : sceneIndex === 3 ? '85vw' : sceneIndex === 4 ? '8vw' : sceneIndex === 5 ? '88vw' : '50vw',
          y: sceneIndex === 0 ? '20vh' : sceneIndex === 1 ? '15vh' : sceneIndex === 2 ? '70vh' : sceneIndex === 3 ? '65vh' : sceneIndex === 4 ? '25vh' : sceneIndex === 5 ? '20vh' : '80vh',
          rotate: sceneIndex * 45,
        }}
        transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Scene content with custom transition */}
      <AnimatePresence mode="sync">
        <motion.div
          key={currentSceneKey}
          className="absolute inset-0"
          initial={{
            clipPath: 'polygon(0 0, 100% 0, 100% 0, 0 0)',
            opacity: 0,
          }}
          animate={{
            clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)',
            opacity: 1,
          }}
          exit={{
            clipPath: 'polygon(0 100%, 100% 100%, 100% 100%, 0 100%)',
            opacity: 0,
          }}
          transition={{
            duration: 0.9,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          {SceneComponent && <SceneComponent />}
        </motion.div>
      </AnimatePresence>

      <audio
        ref={audioRef}
        src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`}
        preload="auto"
        autoPlay
        muted={muted}
      />
    </div>
  );
}
