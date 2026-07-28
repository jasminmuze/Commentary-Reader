import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2000),
      setTimeout(() => setPhase(4), 2800),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #2A2520 0%, #3d3530 100%)' }}>
      
      {/* Ambient glow */}
      <motion.div
        className="absolute w-[60vw] h-[60vw] rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(192,132,252,0.2) 0%, transparent 70%)',
          filter: 'blur(70px)',
        }}
        animate={{ 
          scale: [1, 1.3, 1],
          x: [0, -30, 0],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="relative z-10 w-full h-full flex flex-col items-center justify-center px-[6vw]">
        
        {/* Title */}
        <motion.h2
          className="text-[6vw] font-bold mb-[3vw] text-center"
          style={{ 
            fontFamily: 'var(--font-display)',
            color: '#F9F6F0',
            letterSpacing: '-0.02em',
          }}
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          Start the<br />conversation
        </motion.h2>

        {/* Comment thread mock */}
        <div className="flex flex-col gap-[2vw] w-full max-w-[900px]">
          
          {/* Quote bubble */}
          <motion.div
            className="rounded-xl p-[2.5vw]"
            style={{ backgroundColor: 'rgba(249,246,240,0.08)' }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={phase >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="text-[1.8vw] italic mb-[1.5vw]" style={{ color: '#F9F6F0', fontFamily: 'var(--font-body)' }}>
              "The only way to get rid of a temptation is to yield to it."
            </p>
            <div className="text-[1.3vw]" style={{ color: '#A08B76' }}>
              The Picture of Dorian Gray · Oscar Wilde
            </div>
          </motion.div>

          {/* Comment 1 */}
          <motion.div
            className="flex gap-[1.5vw] items-start ml-[3vw]"
            initial={{ opacity: 0, x: -30 }}
            animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="w-[3vw] h-[3vw] rounded-full flex-shrink-0" style={{ backgroundColor: '#E8A020' }} />
            <div>
              <div className="text-[1.2vw] font-bold mb-[0.5vw]" style={{ color: '#F9F6F0' }}>
                philosophybird
              </div>
              <p className="text-[1.5vw] leading-relaxed" style={{ color: '#F9F6F0', opacity: 0.9 }}>
                This is genuinely dangerous advice. But Wilde frames it so persuasively that you have to stop and think about why it's wrong.
              </p>
              <div className="flex items-center gap-[1vw] mt-[0.8vw]">
                <div className="text-[1.1vw]" style={{ color: '#C084FC' }}>♥ 61</div>
              </div>
            </div>
          </motion.div>

          {/* Comment 2 */}
          <motion.div
            className="flex gap-[1.5vw] items-start ml-[3vw]"
            initial={{ opacity: 0, x: -30 }}
            animate={phase >= 4 ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
          >
            <div className="w-[3vw] h-[3vw] rounded-full flex-shrink-0" style={{ backgroundColor: '#C084FC' }} />
            <div>
              <div className="text-[1.2vw] font-bold mb-[0.5vw]" style={{ color: '#F9F6F0' }}>
                latenightlit
              </div>
              <p className="text-[1.5vw] leading-relaxed" style={{ color: '#F9F6F0', opacity: 0.9 }}>
                The philosophy of yielding to temptation as spiritual health vs. the Victorian gospel of restraint — Wilde knew exactly how scandalous this was.
              </p>
              <div className="flex items-center gap-[1vw] mt-[0.8vw]">
                <div className="text-[1.1vw]" style={{ color: '#C084FC' }}>♥ 44</div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
