import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene6() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1300),
      setTimeout(() => setPhase(3), 2100),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #2A2520 0%, #3d3530 100%)' }}>
      
      {/* Animated gradient background */}
      <motion.div
        className="absolute w-[70vw] h-[70vw] rounded-full opacity-25"
        style={{
          background: 'radial-gradient(circle, rgba(232,160,32,0.4) 0%, rgba(192,132,252,0.3) 100%)',
          filter: 'blur(90px)',
        }}
        animate={{
          scale: [1, 1.3, 1],
          x: [0, 40, 0],
          y: [0, -30, 0],
        }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="relative z-10 w-full h-full flex items-center justify-center px-[6vw]">
        <div className="w-full max-w-[900px]">
          
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
            Stay connected<br />while you read
          </motion.h2>

          {/* Notification cards */}
          <div className="flex flex-col gap-[2vw]">
            
            {/* Notification 1 */}
            <motion.div
              className="flex items-center gap-[2vw] rounded-xl p-[2vw] shadow-lg"
              style={{ backgroundColor: 'rgba(249,246,240,0.1)' }}
              initial={{ opacity: 0, x: -40 }}
              animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -40 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="w-[4vw] h-[4vw] rounded-full flex-shrink-0 flex items-center justify-center"
                style={{ backgroundColor: '#E8A020' }}>
                <div className="text-[2vw]">♥</div>
              </div>
              <div className="flex-1">
                <p className="text-[1.5vw] leading-relaxed" style={{ color: '#F9F6F0' }}>
                  <span className="font-bold">bookworm42</span> liked your highlight in <span className="italic">Pride and Prejudice</span>
                </p>
                <div className="text-[1.2vw] mt-[0.5vw]" style={{ color: '#A08B76' }}>
                  2 hours ago
                </div>
              </div>
            </motion.div>

            {/* Notification 2 */}
            <motion.div
              className="flex items-center gap-[2vw] rounded-xl p-[2vw] shadow-lg"
              style={{ backgroundColor: 'rgba(249,246,240,0.1)' }}
              initial={{ opacity: 0, x: -40 }}
              animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: -40 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
            >
              <div className="w-[4vw] h-[4vw] rounded-full flex-shrink-0 flex items-center justify-center"
                style={{ backgroundColor: '#C084FC' }}>
                <div className="text-[2vw]">💬</div>
              </div>
              <div className="flex-1">
                <p className="text-[1.5vw] leading-relaxed" style={{ color: '#F9F6F0' }}>
                  <span className="font-bold">philosophybird</span> left a comment on your highlight
                </p>
                <div className="text-[1.2vw] mt-[0.5vw]" style={{ color: '#A08B76' }}>
                  5 hours ago
                </div>
              </div>
            </motion.div>
          </div>

          {/* Bottom text */}
          <motion.p
            className="text-center mt-[3vw] text-[1.5vw] font-medium"
            style={{ color: '#A08B76' }}
            initial={{ opacity: 0, y: 15 }}
            animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 15 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            Never miss a conversation about the books you love
          </motion.p>
        </div>
      </div>
    </div>
  );
}
