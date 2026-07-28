import { Variants } from 'framer-motion';

export const clipCircle: Variants = {
  initial: { clipPath: 'circle(0% at 50% 50%)' },
  animate: { clipPath: 'circle(150% at 50% 50%)' },
  exit: { clipPath: 'circle(0% at 50% 50%)' },
};

export const morphExpand: Variants = {
  initial: { scale: 0.8, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 1.2, opacity: 0 },
};

export const fadeUp: Variants = {
  initial: { opacity: 0, y: 40 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
};

export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const scaleBlur: Variants = {
  initial: { scale: 0.95, opacity: 0, filter: 'blur(10px)' },
  animate: { scale: 1, opacity: 1, filter: 'blur(0px)' },
  exit: { scale: 1.05, opacity: 0, filter: 'blur(10px)' },
};

export const wipeRight: Variants = {
  initial: { x: '-100%' },
  animate: { x: '0%' },
  exit: { x: '100%' },
};

export const perspectiveFlip: Variants = {
  initial: { rotateY: 90, opacity: 0 },
  animate: { rotateY: 0, opacity: 1 },
  exit: { rotateY: -90, opacity: 0 },
};
