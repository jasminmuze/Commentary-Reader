import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene7() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1400),
      setTimeout(() => setPhase(3), 2200),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #F9F6F0 0%, #FFFBF5 100%)' }}>
      
      {/* Background animated gradient orb */}
      <motion.div
        className="absolute w-[80vw] h-[80vw] rounded-full opacity-15"
        style={{
          background: 'radial-gradient(circle, rgba(232,160,32,0.5) 0%, rgba(192,132,252,0.3) 100%)',
          filter: 'blur(100px)',
        }}
        animate={{
          scale: [1, 1.2, 1],
          rotate: [0, 180, 360],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
      />

      {/* Floating accent shapes */}
      <motion.div
        className="absolute top-[10%] left-[15%] w-20 h-20 rounded-full opacity-15"
        style={{ backgroundColor: '#E8A020' }}
        animate={{
          y: [0, -20, 0],
          scale: [1, 1.1, 1],
        }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-[15%] right-[20%] w-16 h-16 rounded-full opacity-15"
        style={{ backgroundColor: '#C084FC' }}
        animate={{
          y: [0, 15, 0],
          scale: [1, 1.15, 1],
        }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      />

      <div className="relative z-10 text-center px-[8vw]">
        
        {/* Main logo/brand */}
        <motion.div
          className="mb-[3vw]"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={phase >= 1 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 
            className="text-[10vw] leading-[0.9] font-bold mb-[2vw]"
            style={{ 
              fontFamily: 'var(--font-display)',
              color: '#2A2520',
              letterSpacing: '-0.02em',
            }}
          >
            Shelfmates
          </h1>
        </motion.div>

        {/* Tagline */}
        <motion.p
          className="text-[3vw] font-semibold mb-[4vw]"
          style={{ 
            fontFamily: 'var(--font-body)',
            color: '#A08B76',
            letterSpacing: '-0.01em',
          }}
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          Read. Highlight. Connect.
        </motion.p>

        {/* Feature badges */}
        <motion.div
          className="flex flex-wrap gap-[1.5vw] justify-center items-center"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <div 
            className="px-[2vw] py-[1vw] rounded-full text-[1.3vw] font-bold"
            style={{ 
              backgroundColor: 'rgba(232,160,32,0.15)',
              color: '#E8A020',
              fontFamily: 'var(--font-body)',
            }}
          >
            EPUB Reader
          </div>
          <div 
            className="px-[2vw] py-[1vw] rounded-full text-[1.3vw] font-bold"
            style={{ 
              backgroundColor: 'rgba(192,132,252,0.15)',
              color: '#C084FC',
              fontFamily: 'var(--font-body)',
            }}
          >
            Social Highlights
          </div>
          <div 
            className="px-[2vw] py-[1vw] rounded-full text-[1.3vw] font-bold"
            style={{ 
              backgroundColor: 'rgba(160,139,118,0.15)',
              color: '#A08B76',
              fontFamily: 'var(--font-body)',
            }}
          >
            Reading Rooms
          </div>
        </motion.div>

        {/* Subtle app availability note */}
        <motion.div
          className="mt-[3vw]"
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          <p className="text-[1.4vw] font-medium" style={{ color: '#A08B76', opacity: 0.7 }}>
            Available for iOS and Android
          </p>
        </motion.div>
      </div>
    </div>
  );
}
