import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 900),
      setTimeout(() => setPhase(3), 1600),
      setTimeout(() => setPhase(4), 2400),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(165deg, #2A2520 0%, #3d3530 100%)' }}>
      
      {/* Background book page texture */}
      <div className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h100v100H0z' fill='%23F9F6F0'/%3E%3Cpath d='M50 0v100M0 50h100' stroke='%232A2520' stroke-width='0.5' opacity='0.1'/%3E%3C/svg%3E")`,
          backgroundSize: '80px 80px',
        }}
      />

      {/* Ambient glow */}
      <motion.div
        className="absolute w-[50vw] h-[50vw] rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(232,160,32,0.15) 0%, transparent 70%)',
          filter: 'blur(60px)',
          top: '20%',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
        animate={{ opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="relative z-10 w-full h-full flex items-center justify-center">
        <div className="w-[80%] max-w-[1000px]">
          
          {/* Mock reader UI */}
          <motion.div
            className="relative rounded-2xl overflow-hidden shadow-2xl"
            style={{ backgroundColor: '#FFFBF5' }}
            initial={{ opacity: 0, scale: 0.95, y: 40 }}
            animate={phase >= 1 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.95, y: 40 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="p-[6vw]">
              {/* Book passage */}
              <motion.p
                className="text-[2vw] leading-relaxed mb-4"
                style={{ 
                  fontFamily: 'var(--font-body)',
                  color: '#2A2520',
                }}
                initial={{ opacity: 0 }}
                animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
                transition={{ duration: 0.6 }}
              >
                It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.
              </motion.p>

              {/* Highlight underline animation */}
              <motion.div
                className="h-1 rounded-full mb-6"
                style={{ backgroundColor: '#E8A020' }}
                initial={{ width: '0%', opacity: 0 }}
                animate={phase >= 3 ? { width: '100%', opacity: 0.5 } : { width: '0%', opacity: 0 }}
                transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
              />

              {/* Bottom metadata */}
              <motion.div
                className="flex items-center gap-3"
                initial={{ opacity: 0, y: 10 }}
                animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
                transition={{ duration: 0.5 }}
              >
                <div className="text-[1.2vw] font-semibold" style={{ color: '#A08B76' }}>
                  Pride and Prejudice
                </div>
                <div className="text-[1.2vw]" style={{ color: '#A08B76', opacity: 0.6 }}>
                  · Jane Austen
                </div>
              </motion.div>
            </div>
          </motion.div>

          {/* Title overlay */}
          <motion.div
            className="absolute -top-[8vw] left-0"
            initial={{ opacity: 0, x: -30 }}
            animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <h2 
              className="text-[5vw] font-bold"
              style={{ 
                fontFamily: 'var(--font-display)',
                color: '#F9F6F0',
                letterSpacing: '-0.02em',
              }}
            >
              Your library.<br />Your way.
            </h2>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
