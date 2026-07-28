import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1100),
      setTimeout(() => setPhase(3), 1900),
      setTimeout(() => setPhase(4), 2700),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #FFFBF5 0%, #F9F6F0 100%)' }}>
      
      {/* Background floating highlights */}
      <motion.div
        className="absolute top-[15%] left-[8%] w-64 h-3 rounded-full opacity-15"
        style={{ backgroundColor: '#E8A020' }}
        animate={{ scaleX: [1, 1.2, 1], opacity: [0.15, 0.25, 0.15] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-[25%] right-[10%] w-48 h-3 rounded-full opacity-15"
        style={{ backgroundColor: '#C084FC' }}
        animate={{ scaleX: [1, 1.15, 1], opacity: [0.15, 0.25, 0.15] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      />

      <div className="relative z-10 w-full h-full flex flex-col items-center justify-center px-[8vw]">
        
        {/* Title */}
        <motion.h2
          className="text-[6vw] font-bold mb-[4vw] text-center"
          style={{ 
            fontFamily: 'var(--font-display)',
            color: '#2A2520',
            letterSpacing: '-0.02em',
          }}
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          Highlight what<br />moves you
        </motion.h2>

        {/* Highlight example cards */}
        <div className="flex flex-col gap-[2vw] w-full max-w-[800px]">
          
          {/* First highlight */}
          <motion.div
            className="relative rounded-xl p-[2vw] shadow-lg"
            style={{ backgroundColor: '#FFFFFF', borderLeft: '4px solid #E8A020' }}
            initial={{ opacity: 0, x: -50 }}
            animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="text-[1.6vw] italic mb-[1vw]" style={{ color: '#2A2520', fontFamily: 'var(--font-body)' }}>
              "To be yourself in a world that is constantly trying to make you something else is the greatest accomplishment."
            </p>
            <div className="flex items-center gap-[1vw]">
              <div className="w-[2vw] h-[2vw] rounded-full" style={{ backgroundColor: '#C084FC' }} />
              <span className="text-[1.2vw] font-semibold" style={{ color: '#A08B76' }}>bookworm42</span>
              <span className="text-[1.2vw]" style={{ color: '#A08B76', opacity: 0.6 }}>highlighted this</span>
            </div>
          </motion.div>

          {/* Second highlight */}
          <motion.div
            className="relative rounded-xl p-[2vw] shadow-lg"
            style={{ backgroundColor: '#FFFFFF', borderLeft: '4px solid #C084FC' }}
            initial={{ opacity: 0, x: -50 }}
            animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
          >
            <p className="text-[1.6vw] italic mb-[1vw]" style={{ color: '#2A2520', fontFamily: 'var(--font-body)' }}>
              "The only way to do great work is to love what you do."
            </p>
            <div className="flex items-center gap-[1vw]">
              <div className="w-[2vw] h-[2vw] rounded-full" style={{ backgroundColor: '#E8A020' }} />
              <span className="text-[1.2vw] font-semibold" style={{ color: '#A08B76' }}>readingwitch</span>
              <span className="text-[1.2vw]" style={{ color: '#A08B76', opacity: 0.6 }}>highlighted this</span>
            </div>
          </motion.div>

          {/* Community count */}
          <motion.div
            className="text-center mt-[1vw]"
            initial={{ opacity: 0, y: 10 }}
            animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
            transition={{ duration: 0.5 }}
          >
            <p className="text-[1.4vw] font-semibold" style={{ color: '#E8A020' }}>
              See what your friends are highlighting
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
