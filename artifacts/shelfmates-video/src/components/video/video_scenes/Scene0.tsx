import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene0() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2200),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #F9F6F0 0%, #FFFBF5 100%)' }}>
      
      {/* Background animated gradient orb */}
      <motion.div
        className="absolute w-[70vw] h-[70vw] rounded-full opacity-20"
        style={{
          background: 'radial-gradient(circle, rgba(232,160,32,0.4) 0%, rgba(192,132,252,0.2) 100%)',
          filter: 'blur(80px)',
        }}
        animate={{
          scale: [1, 1.2, 1],
          x: [0, 30, 0],
          y: [0, -20, 0],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Floating book shapes in background */}
      <motion.div
        className="absolute top-[15%] right-[10%] w-32 h-44 rounded-lg opacity-10"
        style={{ backgroundColor: '#A08B76' }}
        animate={{
          y: [0, -15, 0],
          rotate: [2, -2, 2],
        }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-[20%] left-[12%] w-24 h-36 rounded-lg opacity-10"
        style={{ backgroundColor: '#C084FC' }}
        animate={{
          y: [0, 12, 0],
          rotate: [-3, 3, -3],
        }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      />

      {/* Main content */}
      <div className="relative z-10 text-center px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 
            className="text-[12vw] leading-[0.95] font-bold mb-4"
            style={{ 
              fontFamily: 'var(--font-display)',
              color: '#2A2520',
              letterSpacing: '-0.02em',
            }}
          >
            Reading<br />is better<br />together
          </h1>
        </motion.div>

        <motion.p
          className="text-[2.2vw] font-medium mt-6"
          style={{ 
            fontFamily: 'var(--font-body)',
            color: '#A08B76',
            letterSpacing: '-0.01em',
          }}
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          Connect with friends through the books you love
        </motion.p>

        <motion.div
          className="mt-8 flex items-center justify-center gap-3"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={phase >= 3 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div 
            className="px-6 py-2 rounded-full text-[1.4vw] font-bold"
            style={{ 
              backgroundColor: '#E8A020',
              color: '#FFFBF5',
              fontFamily: 'var(--font-body)',
            }}
          >
            Shelfmates
          </div>
        </motion.div>
      </div>
    </div>
  );
}
