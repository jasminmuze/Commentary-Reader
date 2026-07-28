import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1100),
      setTimeout(() => setPhase(3), 1900),
      setTimeout(() => setPhase(4), 2800),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #FFFBF5 0%, #F9F6F0 100%)' }}>
      
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='30' cy='30' r='2' fill='%23E8A020'/%3E%3C/svg%3E")`,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Floating orb */}
      <motion.div
        className="absolute w-[50vw] h-[50vw] rounded-full opacity-20"
        style={{
          background: 'radial-gradient(circle, rgba(232,160,32,0.3) 0%, rgba(192,132,252,0.2) 100%)',
          filter: 'blur(80px)',
        }}
        animate={{
          scale: [1, 1.2, 1],
          rotate: [0, 180, 360],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
      />

      <div className="relative z-10 w-full h-full flex items-center justify-center px-[6vw]">
        <div className="w-full max-w-[1000px]">
          
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
            Create reading<br />rooms together
          </motion.h2>

          {/* Room cards */}
          <div className="flex gap-[2vw] justify-center">
            
            {/* Room 1 */}
            <motion.div
              className="flex-1 rounded-2xl p-[2.5vw] shadow-xl"
              style={{ backgroundColor: '#FFFFFF', maxWidth: '300px' }}
              initial={{ opacity: 0, y: 40, rotate: -5 }}
              animate={phase >= 2 ? { opacity: 1, y: 0, rotate: -2 } : { opacity: 0, y: 40, rotate: -5 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="w-full aspect-[3/4] rounded-lg mb-[1.5vw]"
                style={{ 
                  background: 'linear-gradient(135deg, #4A1942 0%, #7B2B6A 100%)',
                }}
              />
              <h3 className="text-[1.8vw] font-bold mb-[0.5vw]" style={{ color: '#2A2520' }}>
                Wilde Fans
              </h3>
              <p className="text-[1.2vw] mb-[1vw]" style={{ color: '#A08B76' }}>
                12 members
              </p>
              <div className="flex -space-x-2">
                <div className="w-[2vw] h-[2vw] rounded-full border-2 border-white" style={{ backgroundColor: '#E8A020' }} />
                <div className="w-[2vw] h-[2vw] rounded-full border-2 border-white" style={{ backgroundColor: '#C084FC' }} />
                <div className="w-[2vw] h-[2vw] rounded-full border-2 border-white" style={{ backgroundColor: '#4A9EFF' }} />
              </div>
            </motion.div>

            {/* Room 2 */}
            <motion.div
              className="flex-1 rounded-2xl p-[2.5vw] shadow-xl"
              style={{ backgroundColor: '#FFFFFF', maxWidth: '300px' }}
              initial={{ opacity: 0, y: 40, rotate: 5 }}
              animate={phase >= 3 ? { opacity: 1, y: 0, rotate: 2 } : { opacity: 0, y: 40, rotate: 5 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
            >
              <div className="w-full aspect-[3/4] rounded-lg mb-[1.5vw]"
                style={{ 
                  background: 'linear-gradient(135deg, #8B5E3C 0%, #B8865F 100%)',
                }}
              />
              <h3 className="text-[1.8vw] font-bold mb-[0.5vw]" style={{ color: '#2A2520' }}>
                Classic Lit
              </h3>
              <p className="text-[1.2vw] mb-[1vw]" style={{ color: '#A08B76' }}>
                8 members
              </p>
              <div className="flex -space-x-2">
                <div className="w-[2vw] h-[2vw] rounded-full border-2 border-white" style={{ backgroundColor: '#FB923C' }} />
                <div className="w-[2vw] h-[2vw] rounded-full border-2 border-white" style={{ backgroundColor: '#34D399' }} />
                <div className="w-[2vw] h-[2vw] rounded-full border-2 border-white" style={{ backgroundColor: '#F472B6' }} />
              </div>
            </motion.div>
          </div>

          {/* Subtitle */}
          <motion.p
            className="text-center mt-[3vw] text-[1.6vw] font-medium"
            style={{ color: '#A08B76' }}
            initial={{ opacity: 0, y: 15 }}
            animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 15 }}
            transition={{ duration: 0.6 }}
          >
            Share highlights and discuss books with your reading circle
          </motion.p>
        </div>
      </div>
    </div>
  );
}
